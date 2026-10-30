-- ============================================================================
-- Subject-area practice exams and subject-wise performance.
--
-- CIH candidates revise by BGC subject area (Toxicology, Noise, Ventilation…)
-- rather than by blueprint domain, so the practice exam is selected by subject
-- area. The full mixed exam is unchanged: it stays weighted to the blueprint
-- domains, which is how the real examination is built.
--
-- A question's subject area is questions.topic, carried into every version
-- snapshot, so historical attempts keep the subject they were sat under.
-- ============================================================================

-- ---------- attempts carry the subject area ----------
alter table public.exam_attempts add column if not exists subject_area text;

alter table public.exam_attempts drop constraint if exists exam_attempts_subject_area_check;
alter table public.exam_attempts add constraint exam_attempts_subject_area_check
  check ((mode = 'subject') = (subject_area is not null));

create index if not exists exam_attempts_subject
  on public.exam_attempts (user_id, course_id, subject_area) where subject_area is not null;

create index if not exists questions_course_topic
  on public.questions (course_id, topic) where status = 'published';

-- ---------- subject areas available in a course ----------
create or replace function public.get_subject_areas(p_course uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('subject_area', t.topic, 'published', t.n) order by t.topic), '[]'::jsonb)
  from (
    select q.topic, count(*) as n
    from questions q
    where q.course_id = p_course and q.status = 'published'
      and coalesce(trim(q.topic), '') <> ''
      and (public.has_course_access(p_course) or public.is_admin())
    group by q.topic
  ) t;
$$;

-- ============================================================================
-- start_attempt, now accepting a subject area
-- ============================================================================
drop function if exists public.start_attempt(uuid, uuid, public.exam_mode, uuid);

create or replace function public.start_attempt(
  p_course_id uuid, p_blueprint_id uuid, p_mode public.exam_mode,
  p_domain_id uuid default null, p_subject text default null)
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
  v_available int;
  v_count int;
  v_subject text := nullif(trim(coalesce(p_subject, '')), '');
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

  -- mode-specific arguments: exactly one selector, matching the mode
  if p_mode = 'domain' then
    if v_subject is not null then
      return jsonb_build_object('ok', false, 'error', 'INVALID_SUBJECT');
    end if;
    if p_domain_id is null or not exists (
        select 1 from blueprint_domains
        where blueprint_id = v_bp.id and domain_id = p_domain_id and course_id = p_course_id) then
      return jsonb_build_object('ok', false, 'error', 'INVALID_DOMAIN');
    end if;
  elsif p_mode = 'subject' then
    if p_domain_id is not null then
      return jsonb_build_object('ok', false, 'error', 'INVALID_DOMAIN');
    end if;
    if v_subject is null then
      return jsonb_build_object('ok', false, 'error', 'INVALID_SUBJECT');
    end if;
    select count(*) into v_available from questions
     where course_id = p_course_id and status = 'published' and topic = v_subject;
    if v_available = 0 then
      perform public.write_audit('exam.generation_blocked', 'course', p_course_id::text,
        jsonb_build_object('mode', p_mode, 'subject_area', v_subject, 'available', 0));
      return jsonb_build_object('ok', false, 'error', 'INSUFFICIENT_QUESTIONS',
        'shortages', jsonb_build_array(jsonb_build_object(
          'domain_code', v_subject, 'domain_name', v_subject,
          'required', v_exam.question_count, 'available', 0)));
    end if;
  else
    if p_domain_id is not null or v_subject is not null then
      return jsonb_build_object('ok', false, 'error', 'INVALID_DOMAIN');
    end if;
  end if;

  for r in select id from exam_attempts
           where user_id = v_uid and status = 'in_progress' and expires_at <= now() loop
    perform public.finalize_attempt_internal(r.id, 'timeout');
  end loop;

  select id into v_existing from exam_attempts
  where user_id = v_uid and course_id = p_course_id and status = 'in_progress';
  if v_existing is not null then
    return jsonb_build_object('ok', false, 'error', 'ACTIVE_ATTEMPT', 'attempt_id', v_existing);
  end if;

  -- ---------- how many questions this attempt holds ----------
  if p_mode = 'subject' then
    -- a thin subject area yields a shorter set rather than refusing to run
    v_count := least(v_exam.question_count, v_available);
  else
    v_count := v_exam.question_count;
    create temp table if not exists _alloc (domain_id uuid primary key, need int) on commit drop;
    truncate _alloc;
    if p_mode = 'mixed' then
      insert into _alloc select * from public.allocate_question_counts(v_bp.id, v_count);
    else
      insert into _alloc values (p_domain_id, v_count);
    end if;

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
  end if;

  begin
    insert into exam_attempts (user_id, course_id, blueprint_id, exam_id, mode, domain_id, subject_area,
                               feedback_policy, question_count, duration_seconds, started_at, expires_at)
    values (v_uid, p_course_id, v_bp.id, v_exam.id, p_mode, p_domain_id, v_subject, v_exam.feedback_policy,
            v_count, v_exam.duration_minutes * 60, now(),
            now() + make_interval(mins => v_exam.duration_minutes))
    returning id into v_attempt;
  exception when unique_violation then
    select id into v_existing from exam_attempts
    where user_id = v_uid and course_id = p_course_id and status = 'in_progress';
    return jsonb_build_object('ok', false, 'error', 'ACTIVE_ATTEMPT', 'attempt_id', v_existing);
  end;

  if p_mode = 'subject' then
    -- Random selection within the subject area, round-robin across the tasks it
    -- spans so a long set is not dominated by one corner of the subject.
    -- Course scoping is explicit, exactly as in the other modes.
    insert into attempt_questions (attempt_id, position, question_id, question_version, course_id, domain_id, task_id, option_order)
    select v_attempt, row_number() over (order by random()),
           picked.id, picked.version, p_course_id, picked.domain_id, picked.task_id,
           case when v_exam.shuffle_options and picked.allow_option_shuffle
                then (select array_agg((o ->> 'id')::uuid order by random())
                        from jsonb_array_elements(picked.snapshot -> 'options') o)
                else (select array_agg((o.value ->> 'id')::uuid order by o.ordinality)
                        from jsonb_array_elements(picked.snapshot -> 'options') with ordinality o)
           end
    from (
      select ranked.*
      from (
        select q.id, q.domain_id, q.task_id, q.version, q.allow_option_shuffle, qv.snapshot,
               row_number() over (partition by coalesce(q.task_id::text, '-') order by random()) as task_rank,
               random() as tiebreak
        from questions q
        join question_versions qv on qv.question_id = q.id and qv.version = q.version
        where q.course_id = p_course_id and q.status = 'published' and q.topic = v_subject
      ) ranked
      order by ranked.task_rank, ranked.tiebreak
      limit v_count
    ) picked;
  else
    insert into attempt_questions (attempt_id, position, question_id, question_version, course_id, domain_id, task_id, option_order)
    select v_attempt,
           row_number() over (order by random()),
           picked.id, picked.version, p_course_id, picked.domain_id, picked.task_id,
           case when v_exam.shuffle_options and picked.allow_option_shuffle
                then (select array_agg((o ->> 'id')::uuid order by random())
                        from jsonb_array_elements(picked.snapshot -> 'options') o)
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
  end if;

  get diagnostics v_inserted = row_count;
  if v_inserted <> v_count then
    raise exception 'exam generation produced % questions, expected %', v_inserted, v_count;
  end if;

  insert into attempt_answers (attempt_id, question_id)
  select v_attempt, question_id from attempt_questions where attempt_id = v_attempt;

  perform public.write_audit('exam.started', 'exam_attempt', v_attempt::text,
    jsonb_build_object('course', v_course.code, 'mode', p_mode, 'blueprint_id', v_bp.id,
                       'domain_id', p_domain_id, 'subject_area', v_subject, 'question_count', v_count));

  return jsonb_build_object('ok', true, 'attempt_id', v_attempt);
end $$;

-- ============================================================================
-- results and analytics gain a subject breakdown
-- ============================================================================
create or replace function public.get_attempt_result(p_attempt uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a exam_attempts%rowtype;
  v_domains jsonb;
  v_subjects jsonb;
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

  -- subject area comes from the version snapshot the attempt was sat under, so
  -- retagging a question later never rewrites an earlier result
  select jsonb_agg(jsonb_build_object(
           'subject_area', s.subject_area, 'total', s.total, 'correct', s.correct,
           'pct', round(s.correct * 100.0 / s.total, 1)) order by s.subject_area)
    into v_subjects
  from (
    select qv.snapshot ->> 'topic' as subject_area,
           count(*) as total, count(*) filter (where aa.is_correct) as correct
    from attempt_questions aq
    join question_versions qv on qv.question_id = aq.question_id and qv.version = aq.question_version
    join attempt_answers aa on aa.attempt_id = aq.attempt_id and aa.question_id = aq.question_id
    where aq.attempt_id = a.id and coalesce(trim(qv.snapshot ->> 'topic'), '') <> ''
    group by 1
  ) s;

  v_review_allowed := public.is_admin() or (a.feedback_policy <> 'restricted'
                      and a.review_available_at is not null and a.review_available_at <= now());

  if v_review_allowed then
    select jsonb_agg(jsonb_build_object(
             'position', aq.position,
             'external_ref', qv.snapshot ->> 'external_ref',
             'domain_code', cd.code,
             'task_code', ct.code,
             'subject_area', qv.snapshot ->> 'topic',
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
      'subject_area', a.subject_area,
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
    'subjects', coalesce(v_subjects, '[]'::jsonb),
    'review_allowed', v_review_allowed,
    'review', coalesce(v_review, '[]'::jsonb));
end $$;

-- ---------- course catalogue gains the subject areas ----------
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
              from exams ex where ex.course_id = c.id and ex.is_active),
    'subject_areas', case when exists (select 1 from exams ex where ex.course_id = c.id and ex.mode = 'subject' and ex.is_active)
                            and public.has_course_access(c.id)
                          then public.get_subject_areas(c.id) else '[]'::jsonb end
  ) order by c.sort_order), '[]'::jsonb)
  from courses c
  where c.is_visible and auth.uid() is not null;
$$;

-- ---------- analytics gain a subject breakdown ----------
create or replace function public.get_course_subject_analytics(p_course uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'subject_area', s.subject_area, 'total', s.total, 'correct', s.correct,
           'pct', round(s.correct * 100.0 / s.total, 1), 'attempts', s.attempts)
         order by (s.correct * 1.0 / s.total), s.subject_area), '[]'::jsonb)
  from (
    select qv.snapshot ->> 'topic' as subject_area,
           count(*) as total,
           count(*) filter (where aa.is_correct) as correct,
           count(distinct ea.id) as attempts
    from exam_attempts ea
    join attempt_questions aq on aq.attempt_id = ea.id
    join question_versions qv on qv.question_id = aq.question_id and qv.version = aq.question_version
    join attempt_answers aa on aa.attempt_id = aq.attempt_id and aa.question_id = aq.question_id
    where ea.user_id = auth.uid() and ea.course_id = p_course and ea.status <> 'in_progress'
      and coalesce(trim(qv.snapshot ->> 'topic'), '') <> ''
    group by 1
  ) s;
$$;

-- ---------- CIH: subject-area practice replaces the domain practice exam ----------
insert into public.exams (course_id, mode, title, question_count, duration_minutes, feedback_policy)
select c.id, 'subject', 'Subject-area practice', 20, 30, 'after_submit'
from public.courses c where c.code = 'CIH'
on conflict (course_id, mode) do update
  set title = excluded.title, question_count = excluded.question_count,
      duration_minutes = excluded.duration_minutes, is_active = true;

update public.exams ex set is_active = false
from public.courses c
where c.id = ex.course_id and c.code = 'CIH' and ex.mode = 'domain';

-- ---------- grants ----------
grant execute on function
  public.start_attempt(uuid, uuid, public.exam_mode, uuid, text),
  public.get_subject_areas(uuid),
  public.get_course_subject_analytics(uuid)
to authenticated;
