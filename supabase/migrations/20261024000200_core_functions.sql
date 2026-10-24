-- =====================================================================
-- iParkar LMS — 0002 core functions
-- Identity, entitlements, blueprint allocation, exam generation,
-- answer persistence, finalization/scoring, results and analytics.
-- All student-facing RPCs return jsonb {ok, ...} so failures can be
-- audited without being rolled back.
-- =====================================================================

-- ---------- identity ----------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_username text;
begin
  v_username := coalesce(nullif(new.raw_user_meta_data ->> 'username', ''), split_part(new.email, '@', 1), 'user');
  v_username := left(regexp_replace(v_username, '[^A-Za-z0-9._-]', '', 'g'), 24);
  if length(v_username) < 3 then
    v_username := v_username || substr(md5(new.id::text), 1, 6);
  end if;
  if exists (select 1 from profiles where lower(username) = lower(v_username)) then
    v_username := left(v_username, 24) || '-' || substr(md5(new.id::text), 1, 6);
  end if;
  insert into profiles (id, username, full_name)
  values (new.id, v_username, nullif(left(new.raw_user_meta_data ->> 'full_name', 120), ''));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'admin' and status = 'active'
  );
$$;

create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and status = 'active');
$$;

create or replace function public.has_active_entitlement(p_user uuid, p_course uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from course_entitlements e
    where e.user_id = p_user and e.course_id = p_course
      and e.revoked_at is null
      and e.starts_at <= now()
      and (e.expires_at is null or e.expires_at > now())
  );
$$;

create or replace function public.has_course_access(p_course uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_active_user()
     and (public.is_admin() or public.has_active_entitlement(auth.uid(), p_course));
$$;

create or replace function public.write_audit(p_action text, p_entity text, p_entity_id text, p_details jsonb)
returns void language sql security definer set search_path = public as $$
  insert into audit_logs (actor_id, action, entity, entity_id, details)
  values (auth.uid(), p_action, p_entity, p_entity_id, coalesce(p_details, '{}'::jsonb));
$$;

create or replace function public.get_setting(p_key text) returns jsonb
language sql stable security definer set search_path = public as $$
  select value from app_settings where key = p_key;
$$;

-- Simple fixed-window rate limiter (service role only; used by login).
create or replace function public.hit_rate_limit(p_bucket text, p_max int, p_window_seconds int)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits int;
begin
  insert into rate_limits (bucket, window_start, hits) values (p_bucket, v_window, 1)
  on conflict (bucket, window_start) do update set hits = rate_limits.hits + 1
  returning hits into v_hits;
  delete from rate_limits where window_start < now() - interval '1 day';
  return v_hits <= p_max;   -- true = allowed
end $$;

-- Username → email for sign-in (service role only; never exposed to clients).
create or replace function public.resolve_login_email(p_identifier text) returns text
language sql stable security definer set search_path = public, auth as $$
  select u.email::text
  from profiles p join auth.users u on u.id = p.id
  where lower(p.username) = lower(trim(p_identifier))
  limit 1;
$$;

-- ---------- blueprint allocation (largest-remainder method) ----------
-- Deterministic: ties on remainder go to the higher weight, then the lower
-- domain number. Weights are normalised by their sum.
create or replace function public.allocate_question_counts(p_blueprint uuid, p_total int)
returns table (domain_id uuid, question_count int)
language sql stable security definer set search_path = public as $$
  with w as (
    select bd.domain_id, bd.weight, cd.number,
           bd.weight * p_total / sum(bd.weight) over () as exact
    from blueprint_domains bd
    join course_domains cd on cd.id = bd.domain_id
    where bd.blueprint_id = p_blueprint
  ), f as (
    select w.*, floor(exact)::int as base, exact - floor(exact) as rem from w
  ), r as (
    select f.*,
           p_total - sum(base) over () as leftover,
           row_number() over (order by rem desc, weight desc, number asc) as rn
    from f
  )
  select r.domain_id, (r.base + case when r.rn <= r.leftover then 1 else 0 end)::int
  from r
  order by r.number;
$$;

-- ---------- question snapshot ----------
create or replace function public.build_question_snapshot(p_question uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', q.id,
    'course_id', q.course_id,
    'domain_id', q.domain_id,
    'task_id', q.task_id,
    'external_ref', q.external_ref,
    'topic', q.topic,
    'cognitive_level', q.cognitive_level,
    'stem', q.stem,
    'explanation', q.explanation,
    'reference_text', q.reference_text,
    'difficulty', q.difficulty,
    'allow_option_shuffle', q.allow_option_shuffle,
    'options', coalesce((
        select jsonb_agg(jsonb_build_object('id', o.id, 'label', o.label, 'body', o.body) order by o.sort_order)
        from question_options o where o.question_id = q.id), '[]'::jsonb),
    'correct_option_id', (select k.correct_option_id from question_keys k where k.question_id = q.id)
  )
  from questions q where q.id = p_question;
$$;

-- ---------- finalization & scoring (internal) ----------
-- Unanswered questions are scored as incorrect: score = correct ÷ total × 100.
create or replace function public.finalize_attempt_internal(p_attempt uuid, p_reason text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  a exam_attempts%rowtype;
  v_correct int; v_answered int; v_end timestamptz;
begin
  select * into a from exam_attempts where id = p_attempt for update;
  if not found or a.status <> 'in_progress' then
    return false;           -- idempotent: already finalized
  end if;

  -- answers for every question exist so grading is uniform
  insert into attempt_answers (attempt_id, question_id)
  select aq.attempt_id, aq.question_id from attempt_questions aq where aq.attempt_id = p_attempt
  on conflict do nothing;

  update attempt_answers aa
     set is_correct = (aa.selected_option_id is not null
                       and aa.selected_option_id = (qv.snapshot ->> 'correct_option_id')::uuid)
    from attempt_questions aq
    join question_versions qv on qv.question_id = aq.question_id and qv.version = aq.question_version
   where aa.attempt_id = p_attempt and aq.attempt_id = p_attempt and aq.question_id = aa.question_id;

  select count(*) filter (where is_correct), count(*) filter (where selected_option_id is not null)
    into v_correct, v_answered
    from attempt_answers where attempt_id = p_attempt;

  v_end := least(now(), a.expires_at);

  update exam_attempts set
    status            = case when p_reason = 'timeout' then 'expired'::attempt_status else 'submitted'::attempt_status end,
    submitted_at      = v_end,
    finalized_reason  = p_reason,
    correct_count     = v_correct,
    incorrect_count   = v_answered - v_correct,
    unanswered_count  = a.question_count - v_answered,
    score_pct         = round(v_correct * 100.0 / a.question_count, 2),
    time_used_seconds = least(a.duration_seconds, greatest(0, extract(epoch from (v_end - a.started_at))::int)),
    review_available_at = case a.feedback_policy
                            when 'delayed' then v_end + make_interval(hours => (select review_delay_hours from exams where id = a.exam_id))
                            when 'restricted' then null
                            else v_end end
  where id = p_attempt;

  insert into domain_performance (attempt_id, domain_id, course_id, blueprint_id, user_id, total, answered, correct, pct)
  select p_attempt, aq.domain_id, a.course_id, a.blueprint_id, a.user_id,
         count(*), count(aa.selected_option_id), count(*) filter (where aa.is_correct),
         round(count(*) filter (where aa.is_correct) * 100.0 / count(*), 2)
  from attempt_questions aq
  join attempt_answers aa on aa.attempt_id = aq.attempt_id and aa.question_id = aq.question_id
  where aq.attempt_id = p_attempt
  group by aq.domain_id;

  insert into task_performance (attempt_id, task_id, course_id, blueprint_id, user_id, total, correct)
  select p_attempt, aq.task_id, a.course_id, a.blueprint_id, a.user_id,
         count(*), count(*) filter (where aa.is_correct)
  from attempt_questions aq
  join attempt_answers aa on aa.attempt_id = aq.attempt_id and aa.question_id = aq.question_id
  where aq.attempt_id = p_attempt and aq.task_id is not null
  group by aq.task_id;

  insert into audit_logs (actor_id, action, entity, entity_id, details)
  values (auth.uid(), 'exam.finalized', 'exam_attempt', p_attempt::text,
          jsonb_build_object('reason', p_reason, 'correct', v_correct, 'total', a.question_count));
  return true;
end $$;

-- Finalize every expired attempt (pg_cron + lazy calls).
create or replace function public.finalize_expired_attempts() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select id from exam_attempts where status = 'in_progress' and expires_at <= now() loop
    if public.finalize_attempt_internal(r.id, 'timeout') then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- ---------- exam generation ----------
create or replace function public.start_attempt(
  p_course_id uuid, p_blueprint_id uuid, p_mode exam_mode, p_domain_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_course courses%rowtype;
  v_bp blueprints%rowtype;
  v_exam exams%rowtype;
  v_weight_sum numeric;
  v_existing uuid;
  v_shortages jsonb;
  v_attempt uuid;
  v_inserted int;
  r record;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_active_user() then
    return jsonb_build_object('ok', false, 'error', 'ACCOUNT_INACTIVE');
  end if;

  select * into v_course from courses where id = p_course_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'COURSE_NOT_FOUND');
  end if;
  if not public.has_course_access(p_course_id) then
    return jsonb_build_object('ok', false, 'error', 'NO_ENTITLEMENT');
  end if;
  if not v_course.exams_enabled and not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'EXAMS_NOT_ENABLED');
  end if;

  -- blueprint must be the course's current version
  select * into v_bp from blueprints where id = p_blueprint_id and course_id = p_course_id;
  if not found or not v_bp.is_current then
    return jsonb_build_object('ok', false, 'error', 'INVALID_BLUEPRINT');
  end if;
  select sum(weight) into v_weight_sum from blueprint_domains where blueprint_id = v_bp.id;
  if v_weight_sum is null or abs(v_weight_sum - 100) > 0.001 then
    return jsonb_build_object('ok', false, 'error', 'BLUEPRINT_WEIGHTS_INVALID');
  end if;

  select * into v_exam from exams where course_id = p_course_id and mode = p_mode and is_active;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'MODE_NOT_AVAILABLE');
  end if;

  if p_mode = 'domain' then
    if p_domain_id is null or not exists (
        select 1 from blueprint_domains where blueprint_id = v_bp.id and domain_id = p_domain_id and course_id = p_course_id) then
      return jsonb_build_object('ok', false, 'error', 'INVALID_DOMAIN');
    end if;
  elsif p_domain_id is not null then
    return jsonb_build_object('ok', false, 'error', 'INVALID_DOMAIN');
  end if;

  -- close out anything that already ran out of time
  for r in select id from exam_attempts
           where user_id = v_uid and status = 'in_progress' and expires_at <= now() loop
    perform public.finalize_attempt_internal(r.id, 'timeout');
  end loop;

  select id into v_existing from exam_attempts
  where user_id = v_uid and course_id = p_course_id and status = 'in_progress';
  if v_existing is not null then
    return jsonb_build_object('ok', false, 'error', 'ACTIVE_ATTEMPT', 'attempt_id', v_existing);
  end if;

  -- required counts per domain
  create temp table if not exists _alloc (domain_id uuid primary key, need int) on commit drop;
  truncate _alloc;
  if p_mode = 'mixed' then
    insert into _alloc select * from public.allocate_question_counts(v_bp.id, v_exam.question_count);
  else
    insert into _alloc values (p_domain_id, v_exam.question_count);
  end if;

  -- eligibility: published, same course, same domain — never substitutes
  select jsonb_agg(jsonb_build_object(
           'domain_id', s.domain_id, 'domain_code', cd.code, 'domain_name', bd.domain_name,
           'required', s.need, 'available', s.available) order by cd.number)
    into v_shortages
  from (
    select al.domain_id, al.need,
           (select count(*) from questions q
             where q.course_id = p_course_id and q.domain_id = al.domain_id and q.status = 'published') as available
    from _alloc al
  ) s
  join course_domains cd on cd.id = s.domain_id
  join blueprint_domains bd on bd.blueprint_id = v_bp.id and bd.domain_id = s.domain_id
  where s.available < s.need;

  if v_shortages is not null then
    perform public.write_audit('exam.generation_blocked', 'course', p_course_id::text,
      jsonb_build_object('mode', p_mode, 'blueprint_id', v_bp.id, 'shortages', v_shortages));
    return jsonb_build_object('ok', false, 'error', 'INSUFFICIENT_QUESTIONS', 'shortages', v_shortages);
  end if;

  begin
    insert into exam_attempts (user_id, course_id, blueprint_id, exam_id, mode, domain_id, feedback_policy,
                               question_count, duration_seconds, started_at, expires_at)
    values (v_uid, p_course_id, v_bp.id, v_exam.id, p_mode, p_domain_id, v_exam.feedback_policy,
            v_exam.question_count, v_exam.duration_minutes * 60, now(),
            now() + make_interval(mins => v_exam.duration_minutes))
    returning id into v_attempt;
  exception when unique_violation then
    select id into v_existing from exam_attempts
    where user_id = v_uid and course_id = p_course_id and status = 'in_progress';
    return jsonb_build_object('ok', false, 'error', 'ACTIVE_ATTEMPT', 'attempt_id', v_existing);
  end;

  -- Random selection, round-robin across task tags inside each domain for
  -- balanced coverage (internal balancing only; not an official weighting).
  insert into attempt_questions (attempt_id, position, question_id, question_version, course_id, domain_id, task_id, option_order)
  select v_attempt,
         row_number() over (order by random()),
         picked.id, picked.version, p_course_id, picked.domain_id, picked.task_id,
         case when v_exam.shuffle_options and picked.allow_option_shuffle
              then (select array_agg((o ->> 'id')::uuid order by random()) from jsonb_array_elements(picked.snapshot -> 'options') o)
              else (select array_agg((o.value ->> 'id')::uuid order by o.ordinality)
                      from jsonb_array_elements(picked.snapshot -> 'options') with ordinality o)
         end
  from (
    select ranked.*,
           row_number() over (partition by ranked.domain_id order by ranked.task_rank, ranked.tiebreak) as pick_rank
    from (
      select q.id, q.domain_id, q.task_id, q.version, q.allow_option_shuffle, qv.snapshot,
             row_number() over (partition by q.domain_id, coalesce(q.task_id, q.domain_id) order by random()) as task_rank,
             random() as tiebreak
      from questions q
      join _alloc al on al.domain_id = q.domain_id
      join question_versions qv on qv.question_id = q.id and qv.version = q.version
      where q.course_id = p_course_id and q.status = 'published'
    ) ranked
  ) picked
  join _alloc al on al.domain_id = picked.domain_id
  where picked.pick_rank <= al.need;

  get diagnostics v_inserted = row_count;
  if v_inserted <> v_exam.question_count then
    raise exception 'exam generation produced % questions, expected %', v_inserted, v_exam.question_count;
  end if;

  insert into attempt_answers (attempt_id, question_id)
  select v_attempt, question_id from attempt_questions where attempt_id = v_attempt;

  perform public.write_audit('exam.started', 'exam_attempt', v_attempt::text,
    jsonb_build_object('course', v_course.code, 'mode', p_mode, 'blueprint_id', v_bp.id, 'domain_id', p_domain_id));

  return jsonb_build_object('ok', true, 'attempt_id', v_attempt);
end $$;

-- ---------- attempt access helpers ----------
create or replace function public.attempt_owner_check(p_attempt uuid) returns exam_attempts
language plpgsql security definer set search_path = public as $$
declare a exam_attempts%rowtype;
begin
  select * into a from exam_attempts where id = p_attempt;
  if not found or (a.user_id <> auth.uid() and not public.is_admin()) then
    return null;
  end if;
  return a;
end $$;

-- ---------- read attempt (no answer keys) ----------
create or replace function public.get_attempt(p_attempt uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a exam_attempts%rowtype;
  v_questions jsonb;
begin
  a := public.attempt_owner_check(p_attempt);
  if a.id is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;
  if a.status = 'in_progress' and a.expires_at <= now() then
    perform public.finalize_attempt_internal(a.id, 'timeout');
    select * into a from exam_attempts where id = p_attempt;
  end if;

  select jsonb_agg(jsonb_build_object(
           'position', aq.position,
           'question_id', aq.question_id,
           'stem', qv.snapshot ->> 'stem',
           'options', (select jsonb_agg(jsonb_build_object('id', o ->> 'id', 'body', o ->> 'body') order by ord.n)
                         from unnest(aq.option_order) with ordinality ord(oid, n)
                         join jsonb_array_elements(qv.snapshot -> 'options') o on (o ->> 'id')::uuid = ord.oid),
           'selected_option_id', aa.selected_option_id,
           'flagged', coalesce(aa.flagged, false),
           'locked', coalesce(aa.locked, false),
           'feedback', case when a.feedback_policy = 'immediate' and aa.locked then jsonb_build_object(
                          'is_correct', aa.selected_option_id = (qv.snapshot ->> 'correct_option_id')::uuid,
                          'correct_option_id', qv.snapshot ->> 'correct_option_id',
                          'explanation', qv.snapshot ->> 'explanation') end
         ) order by aq.position)
    into v_questions
  from attempt_questions aq
  join question_versions qv on qv.question_id = aq.question_id and qv.version = aq.question_version
  left join attempt_answers aa on aa.attempt_id = aq.attempt_id and aa.question_id = aq.question_id
  where aq.attempt_id = a.id;

  return jsonb_build_object(
    'ok', true,
    'attempt', jsonb_build_object(
      'id', a.id, 'status', a.status, 'mode', a.mode,
      'course', (select jsonb_build_object('id', c.id, 'code', c.code, 'name', c.name) from courses c where c.id = a.course_id),
      'domain', (select jsonb_build_object('code', cd.code, 'name', bd.domain_name)
                   from course_domains cd join blueprint_domains bd on bd.domain_id = cd.id and bd.blueprint_id = a.blueprint_id
                  where cd.id = a.domain_id),
      'blueprint', (select jsonb_build_object('id', b.id, 'version', b.version, 'name', b.name) from blueprints b where b.id = a.blueprint_id),
      'question_count', a.question_count,
      'duration_seconds', a.duration_seconds,
      'started_at', a.started_at, 'expires_at', a.expires_at, 'server_now', now(),
      'feedback_policy', a.feedback_policy),
    'questions', case when a.status = 'in_progress' then coalesce(v_questions, '[]'::jsonb) else '[]'::jsonb end);
end $$;

-- ---------- save answer ----------
-- Accepts writes up to 2 s after expiry to absorb network latency.
create or replace function public.save_answer(p_attempt uuid, p_question uuid, p_option uuid, p_client_seq bigint default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a exam_attempts%rowtype;
  v_snapshot jsonb;
  v_locked boolean;
  v_rows int;
begin
  select * into a from exam_attempts where id = p_attempt for update;
  if not found or a.user_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;
  if a.status <> 'in_progress' then
    return jsonb_build_object('ok', false, 'error', 'ATTEMPT_CLOSED');
  end if;
  if now() > a.expires_at + interval '2 seconds' then
    perform public.finalize_attempt_internal(a.id, 'timeout');
    return jsonb_build_object('ok', false, 'error', 'ATTEMPT_EXPIRED');
  end if;

  select qv.snapshot into v_snapshot
  from attempt_questions aq
  join question_versions qv on qv.question_id = aq.question_id and qv.version = aq.question_version
  where aq.attempt_id = a.id and aq.question_id = p_question;
  if v_snapshot is null then
    return jsonb_build_object('ok', false, 'error', 'QUESTION_NOT_IN_ATTEMPT');
  end if;
  if p_option is not null and not exists (
      select 1 from jsonb_array_elements(v_snapshot -> 'options') o where (o ->> 'id')::uuid = p_option) then
    return jsonb_build_object('ok', false, 'error', 'OPTION_NOT_IN_QUESTION');
  end if;

  select locked into v_locked from attempt_answers where attempt_id = a.id and question_id = p_question;
  if coalesce(v_locked, false) then
    return jsonb_build_object('ok', false, 'error', 'ANSWER_LOCKED');
  end if;
  if a.feedback_policy = 'immediate' and p_option is null then
    return jsonb_build_object('ok', false, 'error', 'ANSWER_REQUIRED');
  end if;

  insert into attempt_answers (attempt_id, question_id, selected_option_id, client_seq, answered_at, updated_at, locked)
  values (a.id, p_question, p_option, p_client_seq, now(), now(), a.feedback_policy = 'immediate')
  on conflict (attempt_id, question_id) do update
    set selected_option_id = excluded.selected_option_id,
        client_seq = excluded.client_seq,
        answered_at = excluded.answered_at,
        updated_at = now(),
        locked = excluded.locked
    where attempt_answers.client_seq <= excluded.client_seq;
  get diagnostics v_rows = row_count;

  if a.feedback_policy = 'immediate' then
    return jsonb_build_object('ok', true, 'saved_at', now(), 'feedback', jsonb_build_object(
      'is_correct', p_option = (v_snapshot ->> 'correct_option_id')::uuid,
      'correct_option_id', v_snapshot ->> 'correct_option_id',
      'explanation', v_snapshot ->> 'explanation'));
  end if;
  return jsonb_build_object('ok', true, 'saved_at', now(), 'stale', v_rows = 0);
end $$;

create or replace function public.set_flag(p_attempt uuid, p_question uuid, p_flagged boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a exam_attempts%rowtype;
begin
  select * into a from exam_attempts where id = p_attempt;
  if not found or a.user_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;
  if a.status <> 'in_progress' or now() > a.expires_at + interval '2 seconds' then
    return jsonb_build_object('ok', false, 'error', 'ATTEMPT_CLOSED');
  end if;
  update attempt_answers set flagged = p_flagged, updated_at = now()
  where attempt_id = a.id and question_id = p_question;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'QUESTION_NOT_IN_ATTEMPT');
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- submit (idempotent) ----------
create or replace function public.submit_attempt(p_attempt uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a exam_attempts%rowtype;
  v_done boolean;
begin
  select * into a from exam_attempts where id = p_attempt for update;
  if not found or a.user_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;
  if a.status <> 'in_progress' then
    return jsonb_build_object('ok', true, 'already_finalized', true, 'attempt_id', a.id, 'status', a.status);
  end if;
  -- an auto-submit fired by the countdown arrives at/after expiry → 'timeout'
  v_done := public.finalize_attempt_internal(a.id,
              case when now() >= a.expires_at then 'timeout' else 'student' end);
  select * into a from exam_attempts where id = p_attempt;
  return jsonb_build_object('ok', true, 'already_finalized', not v_done, 'attempt_id', a.id, 'status', a.status);
end $$;

-- ---------- results & review ----------
create or replace function public.get_attempt_result(p_attempt uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a exam_attempts%rowtype;
  v_domains jsonb;
  v_review jsonb;
  v_review_allowed boolean;
begin
  a := public.attempt_owner_check(p_attempt);
  if a.id is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;
  if a.status = 'in_progress' and a.expires_at <= now() then
    perform public.finalize_attempt_internal(a.id, 'timeout');
    select * into a from exam_attempts where id = p_attempt;
  end if;
  if a.status = 'in_progress' then
    return jsonb_build_object('ok', false, 'error', 'NOT_FINALIZED');
  end if;

  select jsonb_agg(jsonb_build_object(
           'domain_id', dp.domain_id, 'code', cd.code, 'number', cd.number, 'name', bd.domain_name,
           'weight', bd.weight, 'total', dp.total, 'answered', dp.answered, 'correct', dp.correct, 'pct', dp.pct)
         order by cd.number)
    into v_domains
  from domain_performance dp
  join course_domains cd on cd.id = dp.domain_id
  join blueprint_domains bd on bd.blueprint_id = a.blueprint_id and bd.domain_id = dp.domain_id
  where dp.attempt_id = a.id;

  v_review_allowed := public.is_admin() or (a.feedback_policy <> 'restricted'
                      and a.review_available_at is not null and a.review_available_at <= now());

  if v_review_allowed then
    select jsonb_agg(jsonb_build_object(
             'position', aq.position,
             'external_ref', qv.snapshot ->> 'external_ref',
             'domain_code', cd.code,
             'task_code', ct.code,
             'stem', qv.snapshot ->> 'stem',
             'options', (select jsonb_agg(jsonb_build_object('id', o ->> 'id', 'body', o ->> 'body') order by ord.n)
                           from unnest(aq.option_order) with ordinality ord(oid, n)
                           join jsonb_array_elements(qv.snapshot -> 'options') o on (o ->> 'id')::uuid = ord.oid),
             'selected_option_id', aa.selected_option_id,
             'correct_option_id', qv.snapshot ->> 'correct_option_id',
             'is_correct', coalesce(aa.is_correct, false),
             'flagged', aa.flagged,
             'explanation', qv.snapshot ->> 'explanation',
             'reference', qv.snapshot ->> 'reference_text') order by aq.position)
      into v_review
    from attempt_questions aq
    join question_versions qv on qv.question_id = aq.question_id and qv.version = aq.question_version
    join course_domains cd on cd.id = aq.domain_id
    left join course_tasks ct on ct.id = aq.task_id
    left join attempt_answers aa on aa.attempt_id = aq.attempt_id and aa.question_id = aq.question_id
    where aq.attempt_id = a.id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'attempt', jsonb_build_object(
      'id', a.id, 'status', a.status, 'mode', a.mode, 'finalized_reason', a.finalized_reason,
      'course', (select jsonb_build_object('id', c.id, 'code', c.code, 'name', c.name) from courses c where c.id = a.course_id),
      'domain', (select jsonb_build_object('code', cd.code, 'name', bd.domain_name)
                   from course_domains cd join blueprint_domains bd on bd.domain_id = cd.id and bd.blueprint_id = a.blueprint_id
                  where cd.id = a.domain_id),
      'blueprint', (select jsonb_build_object('id', b.id, 'version', b.version, 'name', b.name) from blueprints b where b.id = a.blueprint_id),
      'question_count', a.question_count, 'correct', a.correct_count, 'incorrect', a.incorrect_count,
      'unanswered', a.unanswered_count, 'score_pct', a.score_pct,
      'started_at', a.started_at, 'submitted_at', a.submitted_at, 'time_used_seconds', a.time_used_seconds,
      'feedback_policy', a.feedback_policy, 'review_available_at', a.review_available_at),
    'domains', coalesce(v_domains, '[]'::jsonb),
    'review_allowed', v_review_allowed,
    'review', coalesce(v_review, '[]'::jsonb));
end $$;

-- ---------- course catalogue for the signed-in user ----------
create or replace function public.get_my_courses() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'code', c.code, 'name', c.name, 'description', c.description,
    'exams_enabled', c.exams_enabled,
    'has_access', public.has_course_access(c.id),
    'access_expires_at', (select max(e.expires_at) from course_entitlements e
                           where e.user_id = auth.uid() and e.course_id = c.id and e.revoked_at is null
                             and e.starts_at <= now() and (e.expires_at is null or e.expires_at > now())),
    'has_lifetime_access', exists (select 1 from course_entitlements e
                           where e.user_id = auth.uid() and e.course_id = c.id and e.revoked_at is null
                             and e.starts_at <= now() and e.expires_at is null),
    'active_attempt_id', (select x.id from exam_attempts x where x.user_id = auth.uid() and x.course_id = c.id
                            and x.status = 'in_progress' and x.expires_at > now()),
    'completed_attempts', (select count(*) from exam_attempts x where x.user_id = auth.uid() and x.course_id = c.id
                            and x.status <> 'in_progress'),
    'last_score', (select x.score_pct from exam_attempts x where x.user_id = auth.uid() and x.course_id = c.id
                     and x.status <> 'in_progress' order by x.submitted_at desc limit 1),
    'blueprint', (select jsonb_build_object('id', b.id, 'name', b.name, 'version', b.version,
                    'verification_status', b.verification_status,
                    'domains', (select jsonb_agg(jsonb_build_object('id', cd.id, 'code', cd.code, 'number', cd.number,
                                   'name', bd.domain_name, 'weight', bd.weight) order by cd.number)
                                from blueprint_domains bd join course_domains cd on cd.id = bd.domain_id
                                where bd.blueprint_id = b.id))
                  from blueprints b where b.course_id = c.id and b.is_current),
    'exams', (select jsonb_agg(jsonb_build_object('mode', ex.mode, 'title', ex.title, 'question_count', ex.question_count,
                 'duration_minutes', ex.duration_minutes, 'feedback_policy', ex.feedback_policy) order by ex.mode)
              from exams ex where ex.course_id = c.id and ex.is_active)
  ) order by c.sort_order), '[]'::jsonb)
  from courses c
  where c.is_visible and auth.uid() is not null;
$$;

-- ---------- course-scoped analytics ----------
-- Scoped to ONE course and ONE blueprint version (default: current), so
-- domain identities and weights are never mixed across courses/versions.
create or replace function public.get_course_analytics(p_course uuid, p_blueprint uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_bp uuid;
  v_settings jsonb := coalesce(public.get_setting('study_indicators'),
                               '{"strong":80,"developing":60,"min_questions":20}'::jsonb);
  v_summary jsonb; v_trend jsonb; v_domains jsonb; v_tasks jsonb; v_missed jsonb; v_history jsonb;
  v_other_versions int;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  end if;
  v_bp := coalesce(p_blueprint, (select id from blueprints where course_id = p_course and is_current));
  if not exists (select 1 from blueprints where id = v_bp and course_id = p_course) then
    return jsonb_build_object('ok', false, 'error', 'INVALID_BLUEPRINT');
  end if;

  select jsonb_build_object(
           'completed', count(*),
           'average_score', round(avg(score_pct), 1),
           'best_score', max(score_pct),
           'questions_attempted', coalesce(sum(question_count), 0),
           'correct', coalesce(sum(correct_count), 0),
           'accuracy', case when sum(question_count) > 0
                            then round(sum(correct_count) * 100.0 / sum(question_count), 1) end)
    into v_summary
  from exam_attempts
  where user_id = v_uid and course_id = p_course and blueprint_id = v_bp and status <> 'in_progress';

  select coalesce(jsonb_agg(t order by t ->> 'submitted_at'), '[]'::jsonb) into v_trend from (
    select jsonb_build_object('attempt_id', id, 'submitted_at', submitted_at, 'score_pct', score_pct, 'mode', mode) t
    from exam_attempts
    where user_id = v_uid and course_id = p_course and blueprint_id = v_bp and status <> 'in_progress'
    order by submitted_at desc limit 12) s;

  select coalesce(jsonb_agg(jsonb_build_object(
           'domain_id', bd.domain_id, 'code', cd.code, 'number', cd.number, 'name', bd.domain_name, 'weight', bd.weight,
           'total', coalesce(d.total, 0), 'correct', coalesce(d.correct, 0),
           'pct', case when d.total > 0 then round(d.correct * 100.0 / d.total, 1) end,
           'attempts', coalesce(d.attempts, 0),
           'recent_pct', d.recent_pct) order by cd.number), '[]'::jsonb)
    into v_domains
  from blueprint_domains bd
  join course_domains cd on cd.id = bd.domain_id
  left join lateral (
    select sum(dp.total) total, sum(dp.correct) correct, count(*) attempts,
           (select round(sum(x.correct) * 100.0 / nullif(sum(x.total), 0), 1) from (
              select dp2.total, dp2.correct from domain_performance dp2
              join exam_attempts ea2 on ea2.id = dp2.attempt_id
              where dp2.user_id = v_uid and dp2.course_id = p_course and dp2.blueprint_id = v_bp and dp2.domain_id = bd.domain_id
              order by ea2.submitted_at desc limit 3) x) recent_pct
    from domain_performance dp
    where dp.user_id = v_uid and dp.course_id = p_course and dp.blueprint_id = v_bp and dp.domain_id = bd.domain_id
  ) d on true
  where bd.blueprint_id = v_bp;

  select coalesce(jsonb_agg(jsonb_build_object(
           'task_id', ct.id, 'code', ct.code, 'name', ct.name, 'domain_code', cd.code,
           'total', t.total, 'correct', t.correct, 'pct', round(t.correct * 100.0 / t.total, 1))
         order by cd.number, ct.sort_order, ct.code), '[]'::jsonb)
    into v_tasks
  from (select task_id, sum(total) total, sum(correct) correct from task_performance
        where user_id = v_uid and course_id = p_course and blueprint_id = v_bp group by task_id) t
  join course_tasks ct on ct.id = t.task_id
  join course_domains cd on cd.id = ct.domain_id;

  -- repeatedly missed topics: task/topic labels missed in 2+ answers
  select coalesce(jsonb_agg(m order by (m ->> 'misses')::int desc), '[]'::jsonb) into v_missed from (
    select jsonb_build_object(
             'label', coalesce(qv.snapshot ->> 'topic', ct.code || ' · ' || ct.name, cd.name),
             'domain_code', cd.code, 'misses', count(*)) m
    from attempt_answers aa
    join exam_attempts ea on ea.id = aa.attempt_id
    join attempt_questions aq on aq.attempt_id = aa.attempt_id and aq.question_id = aa.question_id
    join question_versions qv on qv.question_id = aq.question_id and qv.version = aq.question_version
    join course_domains cd on cd.id = aq.domain_id
    left join course_tasks ct on ct.id = aq.task_id
    where ea.user_id = v_uid and ea.course_id = p_course and ea.blueprint_id = v_bp
      and ea.status <> 'in_progress' and aa.is_correct is false
    group by coalesce(qv.snapshot ->> 'topic', ct.code || ' · ' || ct.name, cd.name), cd.code
    having count(*) >= 2
    order by count(*) desc
    limit 8) s;

  select coalesce(jsonb_agg(h order by h ->> 'started_at' desc), '[]'::jsonb) into v_history from (
    select jsonb_build_object(
             'attempt_id', ea.id, 'mode', ea.mode, 'status', ea.status,
             'domain_name', (select bd.domain_name from blueprint_domains bd where bd.blueprint_id = ea.blueprint_id and bd.domain_id = ea.domain_id),
             'blueprint_version', b.version,
             'started_at', ea.started_at, 'submitted_at', ea.submitted_at,
             'score_pct', ea.score_pct, 'correct', ea.correct_count, 'question_count', ea.question_count,
             'time_used_seconds', ea.time_used_seconds,
             'review_available', ea.status <> 'in_progress' and ea.feedback_policy <> 'restricted'
                                 and ea.review_available_at is not null and ea.review_available_at <= now()) h
    from exam_attempts ea join blueprints b on b.id = ea.blueprint_id
    where ea.user_id = v_uid and ea.course_id = p_course
    order by ea.started_at desc limit 50) s;

  select count(*) into v_other_versions from exam_attempts
  where user_id = v_uid and course_id = p_course and blueprint_id <> v_bp and status <> 'in_progress';

  return jsonb_build_object('ok', true, 'blueprint_id', v_bp, 'indicators', v_settings,
    'summary', v_summary, 'trend', v_trend, 'domains', v_domains, 'tasks', v_tasks,
    'missed_topics', v_missed, 'history', v_history, 'attempts_on_other_blueprints', v_other_versions);
end $$;

-- Recent activity across courses: a high-level list only (no domain merging).
create or replace function public.get_recent_activity(p_limit int default 5) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x ->> 'started_at' desc), '[]'::jsonb) from (
    select jsonb_build_object('attempt_id', ea.id, 'course_code', c.code, 'course_name', c.name, 'mode', ea.mode,
             'status', ea.status, 'started_at', ea.started_at, 'submitted_at', ea.submitted_at, 'score_pct', ea.score_pct) x
    from exam_attempts ea join courses c on c.id = ea.course_id
    where ea.user_id = auth.uid()
    order by ea.started_at desc
    limit least(greatest(p_limit, 1), 20)) s;
$$;

-- Lightweight clock re-sync for the exam timer.
create or replace function public.get_attempt_clock(p_attempt uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a exam_attempts%rowtype;
begin
  a := public.attempt_owner_check(p_attempt);
  if a.id is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;
  if a.status = 'in_progress' and a.expires_at <= now() - interval '2 seconds' then
    perform public.finalize_attempt_internal(a.id, 'timeout');
    select * into a from exam_attempts where id = p_attempt;
  end if;
  return jsonb_build_object('ok', true, 'status', a.status, 'expires_at', a.expires_at, 'server_now', now());
end $$;
