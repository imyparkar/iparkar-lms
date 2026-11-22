-- =====================================================================
-- iParkar LMS — interactive item types, case briefs and exhibits
--
-- Adds the PMP-style formats on top of the existing single-best-answer engine:
--   multiple_response  choose N options, exact-set scoring
--   pulldown           one drop-down completing the stem ([[F1]]); scored like
--                      single best answer (stored as options + question_keys)
--   matching           pair left items with right options, all-or-nothing
--   enhanced_matching  drag labels onto targets of an exhibit, all-or-nothing
--   hotspot            click region(s) of an exhibit, exact-set scoring
-- plus shared case briefs (question_cases) and SVG exhibits (question_exhibits).
--
-- Compatibility: single-best-answer questions keep exactly the same snapshot
-- shape, grading, saving (save_answer) and review payloads, so ASP, CSP, CIH,
-- EPI, QEP and CIT behave as before. New keys are only added to snapshots of
-- items that use them.
--
-- Also adds courses.calculator_enabled (default true) so a course can hide the
-- exam calculator (PMP).
-- =====================================================================

-- ---------- course setting ----------
alter table public.courses add column if not exists calculator_enabled boolean not null default true;

-- ---------- case briefs and exhibits ----------
create table if not exists public.question_exhibits (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references public.courses (id) on delete restrict,
  ref         text not null check (ref ~ '^[A-Za-z0-9._-]{1,40}$'),
  title       text,
  svg         text not null check (length(svg) between 20 and 200000),
  alt_text    text not null check (length(alt_text) between 1 and 4000),
  data_table  jsonb,
  width       int check (width is null or width between 1 and 4000),
  height      int check (height is null or height between 1 and 4000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (course_id, ref)
);
drop trigger if exists question_exhibits_touch on public.question_exhibits;
create trigger question_exhibits_touch before update on public.question_exhibits
  for each row execute function public.touch_updated_at();

create table if not exists public.question_cases (
  id            uuid primary key default gen_random_uuid(),
  course_id     uuid not null references public.courses (id) on delete restrict,
  ref           text not null check (ref ~ '^[A-Za-z0-9._-]{1,40}$'),
  title         text not null check (length(title) between 1 and 300),
  brief         text not null check (length(brief) between 10 and 12000),
  exhibit_refs  text[] not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (course_id, ref),
  unique (id, course_id)
);
drop trigger if exists question_cases_touch on public.question_cases;
create trigger question_cases_touch before update on public.question_cases
  for each row execute function public.touch_updated_at();

alter table public.question_exhibits enable row level security;
alter table public.question_cases    enable row level security;
revoke all on public.question_exhibits, public.question_cases from anon, authenticated;
grant select on public.question_exhibits, public.question_cases to authenticated;
drop policy if exists question_exhibits_admin on public.question_exhibits;
drop policy if exists question_cases_admin on public.question_cases;
create policy question_exhibits_admin on public.question_exhibits for select to authenticated using (public.is_admin());
create policy question_cases_admin    on public.question_cases    for select to authenticated using (public.is_admin());

-- ---------- question columns ----------
alter table public.questions drop constraint if exists questions_question_type_check;
alter table public.questions add constraint questions_question_type_check
  check (question_type in ('single_best_answer', 'multiple_response', 'pulldown', 'matching', 'enhanced_matching', 'hotspot'));

alter table public.questions
  add column if not exists instructions      text,
  add column if not exists interaction       jsonb,
  add column if not exists answer_key        jsonb,
  add column if not exists response_feedback jsonb,
  add column if not exists case_id           uuid,
  add column if not exists case_seq          int check (case_seq is null or case_seq between 1 and 20),
  add column if not exists exhibit_refs      text[] not null default '{}';
alter table public.questions drop constraint if exists questions_case_fk;
alter table public.questions add constraint questions_case_fk
  foreign key (case_id, course_id) references public.question_cases (id, course_id) on delete restrict;
create index if not exists questions_case_idx on public.questions (case_id) where case_id is not null;

-- ---------- answers to interactive items ----------
alter table public.attempt_answers add column if not exists response jsonb;

-- Items without options (matching, drag-and-drop, hotspot) have nothing to
-- order; start_attempt's array_agg yields NULL for them, so store '{}'.
create or replace function public.attempt_questions_default_order() returns trigger
language plpgsql as $$
begin
  new.option_order := coalesce(new.option_order, '{}'::uuid[]);
  return new;
end $$;
drop trigger if exists attempt_questions_default_order on public.attempt_questions;
create trigger attempt_questions_default_order before insert on public.attempt_questions
  for each row execute function public.attempt_questions_default_order();

-- ---------- helpers ----------
create or replace function public.jsonb_text_set(j jsonb) returns text[]
language sql immutable set search_path = public as $$
  select case when j is null or jsonb_typeof(j) <> 'array' then '{}'::text[]
              else coalesce((select array_agg(distinct x order by x) from jsonb_array_elements_text(j) x), '{}'::text[]) end;
$$;

-- Is this answer row answered? (single: an option; interactive: a stored response)
create or replace function public.answer_present(p_sel uuid, p_resp jsonb) returns boolean
language sql immutable as $$ select p_sel is not null or p_resp is not null $$;

-- Grade one answer against a version snapshot. Single best answer and
-- pull-down compare the selected option with correct_option_id exactly as before.
create or replace function public.grade_answer(s jsonb, p_sel uuid, p_resp jsonb) returns boolean
language plpgsql immutable set search_path = public as $$
declare
  t text := coalesce(s ->> 'question_type', 'single_best_answer');
  k jsonb := s -> 'answer_key';
  d text;
begin
  if t in ('single_best_answer', 'pulldown') then
    return p_sel is not null and p_sel = (s ->> 'correct_option_id')::uuid;
  end if;
  if p_resp is null then return false; end if;
  if t = 'multiple_response' then
    return public.jsonb_text_set(p_resp -> 'selected') = public.jsonb_text_set(s -> 'correct_option_ids');
  end if;
  if k is null then return false; end if;
  if t = 'hotspot' then
    return public.jsonb_text_set(p_resp -> 'regions') = public.jsonb_text_set(k);
  elsif t = 'matching' then
    return jsonb_typeof(p_resp -> 'pairs') = 'object' and (p_resp -> 'pairs') = k;
  elsif t = 'enhanced_matching' then
    for d in select jsonb_object_keys(k) loop
      if not ((k -> d) ? coalesce(p_resp -> 'placements' ->> d, 'UNPLACED')) then return false; end if;
    end loop;
    return true;
  end if;
  return false;
end $$;

-- Learner-safe case and exhibit payloads for a question (no keys).
create or replace function public.question_exhibits_json(p_course uuid, p_refs text[]) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_agg(jsonb_build_object('ref', e.ref, 'title', e.title, 'svg', e.svg, 'alt', e.alt_text,
                                      'data_table', e.data_table, 'width', e.width, 'height', e.height)
                   order by array_position(p_refs, e.ref))
  from question_exhibits e where e.course_id = p_course and e.ref = any (p_refs);
$$;

-- ---------- snapshot ----------
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
  ) || jsonb_strip_nulls(jsonb_build_object(
    'question_type', nullif(q.question_type, 'single_best_answer'),
    'instructions', q.instructions,
    'interaction', q.interaction,
    'answer_key', case when q.question_type in ('single_best_answer', 'pulldown', 'multiple_response') then null else q.answer_key end,
    'correct_option_ids', case when q.question_type = 'multiple_response' then (
        select jsonb_agg(o.id order by o.sort_order) from question_options o
         where o.question_id = q.id and q.answer_key ? o.label) end,
    'response_feedback', q.response_feedback,
    'case_seq', q.case_seq,
    'case', (select jsonb_build_object('ref', c.ref, 'title', c.title, 'brief', c.brief,
                                       'exhibits', public.question_exhibits_json(c.course_id, c.exhibit_refs))
               from question_cases c where c.id = q.case_id),
    'exhibits', case when cardinality(q.exhibit_refs) > 0 then public.question_exhibits_json(q.course_id, q.exhibit_refs) end
  ))
  from questions q where q.id = p_question;
$$;

-- ---------- publication rules ----------
create or replace function public.question_publish_problems(p_question uuid) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare
  q questions%rowtype;
  v_problems text[] := '{}';
  v_opts int;
  v_labels text[];
  v_ids text[];
  v_targets text[];
  d text;
begin
  select * into q from questions where id = p_question;
  if not found then return array['question not found']; end if;
  select count(*), coalesce(array_agg(label), '{}') into v_opts, v_labels from question_options where question_id = q.id;

  if q.question_type in ('single_best_answer', 'pulldown') then
    if v_opts < 2 then v_problems := v_problems || 'needs at least 2 options'; end if;
    if not exists (select 1 from question_keys where question_id = q.id) then
      v_problems := v_problems || 'missing answer key';
    end if;
    if q.question_type = 'pulldown' and position('[[F1]]' in q.stem) = 0 then
      v_problems := v_problems || 'pull-down stem must contain [[F1]]';
    end if;
  elsif q.question_type = 'multiple_response' then
    if v_opts < 3 then v_problems := v_problems || 'needs at least 3 options'; end if;
    if cardinality(public.jsonb_text_set(q.answer_key)) < 2 then
      v_problems := v_problems || 'needs at least 2 keyed options';
    elsif not (public.jsonb_text_set(q.answer_key) <@ v_labels) then
      v_problems := v_problems || 'answer key names an option that does not exist';
    end if;
  elsif q.question_type = 'matching' then
    v_ids := array(select x ->> 'id' from jsonb_array_elements(coalesce(q.interaction -> 'left', '[]')) x);
    v_targets := array(select x ->> 'id' from jsonb_array_elements(coalesce(q.interaction -> 'right', '[]')) x);
    if cardinality(v_ids) < 2 or cardinality(v_targets) < 2 then v_problems := v_problems || 'matching needs two lists'; end if;
    if jsonb_typeof(q.answer_key) <> 'object'
       or array(select jsonb_object_keys(q.answer_key) order by 1) <> array(select unnest(v_ids) order by 1) then
      v_problems := v_problems || 'answer key must pair every left item';
    elsif exists (select 1 from jsonb_each_text(q.answer_key) e where e.value <> all (v_targets)) then
      v_problems := v_problems || 'answer key names a right-hand option that does not exist';
    end if;
  elsif q.question_type = 'enhanced_matching' then
    v_ids := array(select x ->> 'id' from jsonb_array_elements(coalesce(q.interaction -> 'draggables', '[]')) x);
    v_targets := array(select x ->> 'id' from jsonb_array_elements(coalesce(q.interaction -> 'targets', '[]')) x) || 'UNPLACED'::text;
    if cardinality(v_ids) < 2 or cardinality(v_targets) < 2 then v_problems := v_problems || 'drag-and-drop needs items and targets'; end if;
    if jsonb_typeof(q.answer_key) <> 'object'
       or array(select jsonb_object_keys(q.answer_key) order by 1) <> array(select unnest(v_ids) order by 1) then
      v_problems := v_problems || 'answer key must place every draggable';
    else
      for d in select jsonb_object_keys(q.answer_key) loop
        if jsonb_typeof(q.answer_key -> d) <> 'array' or jsonb_array_length(q.answer_key -> d) = 0
           or not (public.jsonb_text_set(q.answer_key -> d) <@ v_targets) then
          v_problems := v_problems || format('accepted targets for %s are invalid', d);
        end if;
      end loop;
    end if;
    if cardinality(q.exhibit_refs) = 0 then v_problems := v_problems || 'drag-and-drop needs an exhibit'; end if;
  elsif q.question_type = 'hotspot' then
    v_ids := array(select x ->> 'id' from jsonb_array_elements(coalesce(q.interaction -> 'regions', '[]')) x);
    if cardinality(v_ids) < 2 then v_problems := v_problems || 'hotspot needs at least 2 regions'; end if;
    if cardinality(public.jsonb_text_set(q.answer_key)) = 0 or not (public.jsonb_text_set(q.answer_key) <@ v_ids) then
      v_problems := v_problems || 'answer key must name existing regions';
    end if;
    if cardinality(q.exhibit_refs) = 0 then v_problems := v_problems || 'hotspot needs an exhibit'; end if;
  end if;

  if exists (select 1 from unnest(q.exhibit_refs) r
             where not exists (select 1 from question_exhibits e where e.course_id = q.course_id and e.ref = r)) then
    v_problems := v_problems || 'an exhibit is missing';
  end if;
  if coalesce(trim(q.explanation), '') = '' then v_problems := v_problems || 'missing explanation'; end if;
  if not exists (select 1 from question_versions where question_id = q.id and version = q.version) then
    v_problems := v_problems || 'missing version snapshot';
  end if;
  return v_problems;
end $$;

-- ---------- finalized answers cannot change ----------
create or replace function public.guard_finalized_answers() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_status attempt_status;
begin
  select status into v_status from exam_attempts where id = coalesce(new.attempt_id, old.attempt_id);
  if v_status <> 'in_progress' and (tg_op = 'DELETE'
       or new.selected_option_id is distinct from old.selected_option_id
       or new.response is distinct from old.response) then
    raise exception 'Attempt is finalized; answers cannot change.' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;

-- ---------- grading ----------
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
     set is_correct = public.grade_answer(qv.snapshot, aa.selected_option_id, aa.response)
    from attempt_questions aq
    join question_versions qv on qv.question_id = aq.question_id and qv.version = aq.question_version
   where aa.attempt_id = p_attempt and aq.attempt_id = p_attempt and aq.question_id = aa.question_id;

  select count(*) filter (where is_correct),
         count(*) filter (where public.answer_present(selected_option_id, response))
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
         count(*), count(*) filter (where public.answer_present(aa.selected_option_id, aa.response)),
         count(*) filter (where aa.is_correct),
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

-- Key and feedback in the shape the exam/review screens use.
create or replace function public.answer_feedback_json(s jsonb, p_sel uuid, p_resp jsonb) returns jsonb
language sql immutable set search_path = public as $$
  select jsonb_build_object(
    'is_correct', public.grade_answer(s, p_sel, p_resp),
    'correct_option_id', s ->> 'correct_option_id',
    'explanation', s ->> 'explanation')
  || jsonb_strip_nulls(jsonb_build_object(
    'correct_option_ids', s -> 'correct_option_ids',
    'answer_key', s -> 'answer_key',
    'response_feedback', s -> 'response_feedback'));
$$;

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
           'type', coalesce(qv.snapshot ->> 'question_type', 'single_best_answer'),
           'stem', qv.snapshot ->> 'stem',
           'options', coalesce((select jsonb_agg(jsonb_build_object('id', o ->> 'id', 'body', o ->> 'body') order by ord.n)
                         from unnest(aq.option_order) with ordinality ord(oid, n)
                         join jsonb_array_elements(qv.snapshot -> 'options') o on (o ->> 'id')::uuid = ord.oid), '[]'::jsonb),
           'selected_option_id', aa.selected_option_id,
           'response', aa.response,
           'flagged', coalesce(aa.flagged, false),
           'locked', coalesce(aa.locked, false),
           'feedback', case when a.feedback_policy = 'immediate' and aa.locked
                            then public.answer_feedback_json(qv.snapshot, aa.selected_option_id, aa.response) end
         ) || jsonb_strip_nulls(jsonb_build_object(
           'instructions', qv.snapshot ->> 'instructions',
           'interaction', qv.snapshot -> 'interaction',
           'case', qv.snapshot -> 'case',
           'case_seq', qv.snapshot -> 'case_seq',
           'exhibits', qv.snapshot -> 'exhibits'
         )) order by aq.position)
    into v_questions
  from attempt_questions aq
  join question_versions qv on qv.question_id = aq.question_id and qv.version = aq.question_version
  left join attempt_answers aa on aa.attempt_id = aq.attempt_id and aa.question_id = aq.question_id
  where aq.attempt_id = a.id;

  return jsonb_build_object(
    'ok', true,
    'attempt', jsonb_build_object(
      'id', a.id, 'status', a.status, 'mode', a.mode,
      'course', (select jsonb_build_object('id', c.id, 'code', c.code, 'name', c.name,
                                           'calculator_enabled', c.calculator_enabled) from courses c where c.id = a.course_id),
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

-- ---------- save a response to an interactive item ----------
-- p_response shapes:
--   multiple_response {"selected": [option uuid, ...]}
--   hotspot           {"regions": [region id, ...]}
--   matching          {"pairs": {"L1": "R3", ...}}
--   enhanced_matching {"placements": {"D1": "cell-r1c2", ...}}
-- An empty response clears the answer. Same timing, ownership, lock and
-- client_seq rules as save_answer.
create or replace function public.save_response(p_attempt uuid, p_question uuid, p_response jsonb, p_client_seq bigint default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a exam_attempts%rowtype;
  v_snap jsonb;
  v_type text;
  v_ix jsonb;
  v_resp jsonb;
  v_allowed text[];
  v_vals text[];
  v_locked boolean;
  v_rows int;
  r record;
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

  select qv.snapshot into v_snap
  from attempt_questions aq
  join question_versions qv on qv.question_id = aq.question_id and qv.version = aq.question_version
  where aq.attempt_id = a.id and aq.question_id = p_question;
  if v_snap is null then
    return jsonb_build_object('ok', false, 'error', 'QUESTION_NOT_IN_ATTEMPT');
  end if;
  v_type := coalesce(v_snap ->> 'question_type', 'single_best_answer');
  v_ix := coalesce(v_snap -> 'interaction', '{}'::jsonb);
  if v_type not in ('multiple_response', 'matching', 'enhanced_matching', 'hotspot') then
    return jsonb_build_object('ok', false, 'error', 'USE_SAVE_ANSWER');
  end if;
  if p_response is not null and jsonb_typeof(p_response) <> 'object' then
    return jsonb_build_object('ok', false, 'error', 'INVALID_RESPONSE');
  end if;

  -- validate and normalise
  if v_type in ('multiple_response', 'hotspot') then
    if v_type = 'multiple_response' then
      v_allowed := array(select o ->> 'id' from jsonb_array_elements(v_snap -> 'options') o);
      v_vals := public.jsonb_text_set(p_response -> 'selected');
    else
      v_allowed := array(select x ->> 'id' from jsonb_array_elements(coalesce(v_ix -> 'regions', '[]')) x);
      v_vals := public.jsonb_text_set(p_response -> 'regions');
    end if;
    if p_response is not null and (p_response -> case when v_type = 'hotspot' then 'regions' else 'selected' end) is not null
       and jsonb_typeof(p_response -> case when v_type = 'hotspot' then 'regions' else 'selected' end) <> 'array' then
      return jsonb_build_object('ok', false, 'error', 'INVALID_RESPONSE');
    end if;
    if not (v_vals <@ v_allowed) then
      return jsonb_build_object('ok', false, 'error', 'OPTION_NOT_IN_QUESTION');
    end if;
    v_resp := case when cardinality(v_vals) = 0 then null
                   when v_type = 'hotspot' then jsonb_build_object('regions', to_jsonb(v_vals))
                   else jsonb_build_object('selected', to_jsonb(v_vals)) end;
  else
    declare
      v_key text := case when v_type = 'matching' then 'pairs' else 'placements' end;
      v_left text[];
      v_right text[];
      v_reusable boolean;
      v_obj jsonb := '{}'::jsonb;
    begin
      if v_type = 'matching' then
        v_left := array(select x ->> 'id' from jsonb_array_elements(coalesce(v_ix -> 'left', '[]')) x);
        v_right := array(select x ->> 'id' from jsonb_array_elements(coalesce(v_ix -> 'right', '[]')) x);
        v_reusable := coalesce((v_ix ->> 'options_reusable')::boolean, false);
      else
        v_left := array(select x ->> 'id' from jsonb_array_elements(coalesce(v_ix -> 'draggables', '[]')) x);
        v_right := array(select x ->> 'id' from jsonb_array_elements(coalesce(v_ix -> 'targets', '[]')) x);
        v_reusable := coalesce((v_ix ->> 'targets_reusable')::boolean, false);
      end if;
      if p_response is not null and (p_response -> v_key) is not null and jsonb_typeof(p_response -> v_key) <> 'object' then
        return jsonb_build_object('ok', false, 'error', 'INVALID_RESPONSE');
      end if;
      for r in select key, value from jsonb_each(coalesce(p_response -> v_key, '{}'::jsonb)) loop
        continue when r.value is null or jsonb_typeof(r.value) = 'null' or (r.value #>> '{}') = '';
        if jsonb_typeof(r.value) <> 'string' or not (r.key = any (v_left)) or not ((r.value #>> '{}') = any (v_right)) then
          return jsonb_build_object('ok', false, 'error', 'OPTION_NOT_IN_QUESTION');
        end if;
        v_obj := v_obj || jsonb_build_object(r.key, r.value #>> '{}');
      end loop;
      if not v_reusable and (select count(*) <> count(distinct value) from jsonb_each_text(v_obj)) then
        return jsonb_build_object('ok', false, 'error', 'OPTION_REUSED');
      end if;
      v_resp := case when v_obj = '{}'::jsonb then null else jsonb_build_object(v_key, v_obj) end;
    end;
  end if;

  select locked into v_locked from attempt_answers where attempt_id = a.id and question_id = p_question;
  if coalesce(v_locked, false) then
    return jsonb_build_object('ok', false, 'error', 'ANSWER_LOCKED');
  end if;
  if a.feedback_policy = 'immediate' and v_resp is null then
    return jsonb_build_object('ok', false, 'error', 'ANSWER_REQUIRED');
  end if;

  insert into attempt_answers (attempt_id, question_id, response, client_seq, answered_at, updated_at, locked)
  values (a.id, p_question, v_resp, p_client_seq, now(), now(), a.feedback_policy = 'immediate')
  on conflict (attempt_id, question_id) do update
    set response = excluded.response,
        client_seq = excluded.client_seq,
        answered_at = excluded.answered_at,
        updated_at = now(),
        locked = excluded.locked
    where attempt_answers.client_seq <= excluded.client_seq;
  get diagnostics v_rows = row_count;

  if a.feedback_policy = 'immediate' then
    return jsonb_build_object('ok', true, 'saved_at', now(),
                              'feedback', public.answer_feedback_json(v_snap, null, v_resp));
  end if;
  return jsonb_build_object('ok', true, 'saved_at', now(), 'stale', v_rows = 0, 'response', v_resp);
end $$;

-- ---------- results & review ----------
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
             'reference', qv.snapshot ->> 'reference_text'
           ) || case when qv.snapshot ?| array['question_type', 'case', 'exhibits', 'response_feedback'] then
             jsonb_build_object('type', coalesce(qv.snapshot ->> 'question_type', 'single_best_answer'),
                                'response', aa.response)
             || jsonb_strip_nulls(jsonb_build_object(
                  'instructions', qv.snapshot ->> 'instructions',
                  'interaction', qv.snapshot -> 'interaction',
                  'answer_key', qv.snapshot -> 'answer_key',
                  'correct_option_ids', qv.snapshot -> 'correct_option_ids',
                  'response_feedback', qv.snapshot -> 'response_feedback',
                  'case', qv.snapshot -> 'case',
                  'case_seq', qv.snapshot -> 'case_seq',
                  'exhibits', qv.snapshot -> 'exhibits'))
             else '{}'::jsonb end
           order by aq.position)
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

-- ---------- cancel: count interactive answers too (audit detail only) ----------
create or replace function public.cancel_attempt(p_attempt uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a exam_attempts%rowtype;
  v_answered int;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  end if;
  select * into a from exam_attempts where id = p_attempt for update;
  if not found or a.user_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;
  if a.status <> 'in_progress' then
    return jsonb_build_object('ok', false, 'error', 'ATTEMPT_CLOSED');
  end if;

  select count(*) into v_answered from attempt_answers
   where attempt_id = a.id and public.answer_present(selected_option_id, response);

  perform public.write_audit('attempt.cancel', 'exam_attempt', a.id::text,
    jsonb_build_object('course_id', a.course_id, 'mode', a.mode, 'domain_id', a.domain_id,
                       'subject_area', a.subject_area, 'question_count', a.question_count,
                       'answered', v_answered, 'started_at', a.started_at));

  -- answers first, while the attempt is still in progress (the finalized-answer guard checks it)
  delete from attempt_answers where attempt_id = a.id;
  delete from exam_attempts where id = a.id;   -- cascades to attempt_questions and performance rows
  return jsonb_build_object('ok', true, 'attempt_id', a.id);
end $$;

-- ---------- the single-question editor stays single-answer ----------
-- Interactive items carry structures the form cannot edit, so the editor (and the
-- CSV/JSON importer, which calls it) refuses them; they are maintained with
-- admin_import_rich_questions. Pull-down items are edited like single best answer.
do $$
begin
  -- once only: on a re-run admin_upsert_question is already the wrapper below
  if to_regprocedure('public.admin_upsert_question_single(jsonb)') is null then
    alter function public.admin_upsert_question(jsonb) rename to admin_upsert_question_single;
  end if;
end $$;
revoke execute on function public.admin_upsert_question_single(jsonb) from public, anon, authenticated;

create or replace function public.admin_upsert_question(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_type text;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('admin role required'));
  end if;
  begin
    select q.question_type into v_type
    from questions q join courses c on c.id = q.course_id
    where q.id = nullif(p ->> 'id', '')::uuid
       or ((c.id = nullif(p ->> 'course_id', '')::uuid or c.code = upper(nullif(p ->> 'course_code', '')))
           and q.external_ref = nullif(p ->> 'external_ref', ''))
    limit 1;
  exception when others then
    v_type := null;   -- malformed id: let the editor report it
  end;
  if v_type is not null and v_type not in ('single_best_answer', 'pulldown') then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array(
      format('%s is a %s item; update it by re-importing the bank (admin_import_rich_questions).',
             coalesce(p ->> 'external_ref', 'This question'), replace(v_type, '_', ' '))));
  end if;
  return public.admin_upsert_question_single(p);
end $$;

-- ---------- bulk import of a rich bank (service role / database owner only) ----------
-- p_payload: {"exhibits": [{ref,title,svg,alt_text,data_table,width,height}],
--             "cases":    [{ref,title,brief,exhibit_refs}],
--             "items":    [{external_ref, domain_code, task_code, question_type, stem, instructions,
--                           options:[{label,body}], key (label; single/pulldown),
--                           answer_key (labels for multiple_response; object/array for the rest),
--                           interaction, response_feedback, explanation, reference, difficulty,
--                           cognitive_level, topic, case_ref, case_seq, exhibit_refs}]}
-- Upserts by (course, ref). A changed item gets a new version; earlier attempts
-- keep the version they were sat under. Each item succeeds or fails on its own.
create or replace function public.admin_import_rich_questions(p_course_code text, p_payload jsonb,
                                                              p_status text default 'draft')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_course courses%rowtype;
  v_status question_status := coalesce(nullif(p_status, ''), 'draft')::question_status;
  it jsonb;
  v_ref text;
  v_type text;
  v_domain course_domains%rowtype;
  v_task uuid;
  v_case uuid;
  v_existing questions%rowtype;
  v_qid uuid;
  v_old jsonb; v_new jsonb; v_version int;
  v_labels text[];
  v_key text;
  v_created int := 0; v_updated int := 0; v_unchanged int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_problems text[];
begin
  if auth.uid() is not null and not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;
  select * into v_course from courses where code = upper(p_course_code);
  if not found then return jsonb_build_object('ok', false, 'error', 'UNKNOWN_COURSE'); end if;

  insert into question_exhibits (course_id, ref, title, svg, alt_text, data_table, width, height)
  select v_course.id, e ->> 'ref', e ->> 'title', e ->> 'svg', e ->> 'alt_text', e -> 'data_table',
         nullif(e ->> 'width', '')::int, nullif(e ->> 'height', '')::int
  from jsonb_array_elements(coalesce(p_payload -> 'exhibits', '[]')) e
  on conflict (course_id, ref) do update set title = excluded.title, svg = excluded.svg, alt_text = excluded.alt_text,
    data_table = excluded.data_table, width = excluded.width, height = excluded.height;

  insert into question_cases (course_id, ref, title, brief, exhibit_refs)
  select v_course.id, c ->> 'ref', c ->> 'title', c ->> 'brief',
         coalesce(array(select jsonb_array_elements_text(c -> 'exhibit_refs')), '{}')
  from jsonb_array_elements(coalesce(p_payload -> 'cases', '[]')) c
  on conflict (course_id, ref) do update set title = excluded.title, brief = excluded.brief, exhibit_refs = excluded.exhibit_refs;

  for it in select * from jsonb_array_elements(coalesce(p_payload -> 'items', '[]')) loop
    v_ref := it ->> 'external_ref';
    begin
      v_type := coalesce(nullif(it ->> 'question_type', ''), 'single_best_answer');
      select * into v_domain from course_domains where course_id = v_course.id and code = it ->> 'domain_code';
      if not found then raise exception 'unknown domain %', it ->> 'domain_code'; end if;
      v_task := null;
      if nullif(it ->> 'task_code', '') is not null then
        select id into v_task from course_tasks where course_id = v_course.id and domain_id = v_domain.id and code = it ->> 'task_code';
        if v_task is null then raise exception 'task % is not defined in domain %', it ->> 'task_code', v_domain.code; end if;
      end if;
      v_case := null;
      if nullif(it ->> 'case_ref', '') is not null then
        select id into v_case from question_cases where course_id = v_course.id and ref = it ->> 'case_ref';
        if v_case is null then raise exception 'unknown case %', it ->> 'case_ref'; end if;
      end if;
      v_labels := array(select upper(o ->> 'label') from jsonb_array_elements(coalesce(it -> 'options', '[]')) o);
      if v_type in ('single_best_answer', 'pulldown', 'multiple_response') and cardinality(v_labels) < 2 then
        raise exception 'options are required';
      end if;
      if v_type not in ('single_best_answer', 'pulldown', 'multiple_response') and cardinality(v_labels) > 0 then
        raise exception '% items have no options', v_type;
      end if;
      v_key := upper(nullif(it ->> 'key', ''));
      if v_type in ('single_best_answer', 'pulldown') and (v_key is null or not (v_key = any (v_labels))) then
        raise exception 'answer key % does not match an option', coalesce(v_key, '(none)');
      end if;

      select * into v_existing from questions where course_id = v_course.id and external_ref = v_ref;
      if v_existing.id is not null and v_existing.question_type <> v_type then
        raise exception 'question type cannot change (% → %)', v_existing.question_type, v_type;
      end if;

      if v_existing.id is null then
        insert into questions (course_id, domain_id, task_id, external_ref, topic, cognitive_level, question_type,
                               stem, instructions, interaction, answer_key, response_feedback, case_id, case_seq,
                               exhibit_refs, explanation, reference_text, difficulty, status, allow_option_shuffle)
        values (v_course.id, v_domain.id, v_task, v_ref, nullif(it ->> 'topic', ''), nullif(it ->> 'cognitive_level', ''), v_type,
                trim(it ->> 'stem'), nullif(it ->> 'instructions', ''), it -> 'interaction',
                case when v_type in ('single_best_answer', 'pulldown') then null else it -> 'answer_key' end,
                it -> 'response_feedback', v_case, nullif(it ->> 'case_seq', '')::int,
                coalesce(array(select jsonb_array_elements_text(it -> 'exhibit_refs')), '{}'),
                nullif(trim(it ->> 'explanation'), ''), nullif(trim(it ->> 'reference'), ''),
                nullif(it ->> 'difficulty', '')::numeric, 'draft', false)
        returning id into v_qid;
        v_version := 1;
      else
        v_qid := v_existing.id;
        v_old := public.build_question_snapshot(v_qid);
        update questions set
          domain_id = v_domain.id, task_id = v_task, topic = nullif(it ->> 'topic', ''),
          cognitive_level = nullif(it ->> 'cognitive_level', ''), stem = trim(it ->> 'stem'),
          instructions = nullif(it ->> 'instructions', ''), interaction = it -> 'interaction',
          answer_key = case when v_type in ('single_best_answer', 'pulldown') then null else it -> 'answer_key' end,
          response_feedback = it -> 'response_feedback', case_id = v_case, case_seq = nullif(it ->> 'case_seq', '')::int,
          exhibit_refs = coalesce(array(select jsonb_array_elements_text(it -> 'exhibit_refs')), '{}'),
          explanation = nullif(trim(it ->> 'explanation'), ''), reference_text = nullif(trim(it ->> 'reference'), ''),
          difficulty = nullif(it ->> 'difficulty', '')::numeric
        where id = v_qid;
      end if;

      delete from question_keys where question_id = v_qid;
      delete from question_options where question_id = v_qid and label <> all (v_labels);
      insert into question_options (question_id, label, body, sort_order)
      select v_qid, upper(o ->> 'label'), trim(o ->> 'body'), (ord - 1)::int
      from jsonb_array_elements(coalesce(it -> 'options', '[]')) with ordinality as t(o, ord)
      on conflict (question_id, label) do update set body = excluded.body, sort_order = excluded.sort_order;
      if v_type in ('single_best_answer', 'pulldown') then
        insert into question_keys (question_id, correct_option_id)
        select v_qid, id from question_options where question_id = v_qid and label = v_key;
      end if;

      v_new := public.build_question_snapshot(v_qid);
      if v_existing.id is not null then
        if (v_old - 'id') is distinct from (v_new - 'id') then
          v_version := v_existing.version + 1;
          update questions set version = v_version where id = v_qid;
          v_updated := v_updated + 1;
        else
          v_version := v_existing.version;
          v_unchanged := v_unchanged + 1;
        end if;
      else
        v_created := v_created + 1;
      end if;
      insert into question_versions (question_id, version, snapshot, changed_by, change_note)
      values (v_qid, v_version, v_new, auth.uid(), 'rich import')
      on conflict (question_id, version) do nothing;

      v_problems := public.question_publish_problems(v_qid);
      if array_length(v_problems, 1) > 0 then
        raise exception '%', array_to_string(v_problems, '; ');
      end if;
      if v_status is distinct from (select status from questions where id = v_qid) then
        update questions set status = v_status,
          reviewed_at = case when v_status = 'published' then now() else reviewed_at end
        where id = v_qid;
      end if;
    exception when others then
      v_errors := v_errors || jsonb_build_object('ref', v_ref, 'error', sqlerrm);
    end;
  end loop;

  perform public.write_audit('questions.rich_import', 'course', v_course.id::text,
    jsonb_build_object('created', v_created, 'updated', v_updated, 'unchanged', v_unchanged,
                       'errors', jsonb_array_length(v_errors)));
  return jsonb_build_object('ok', jsonb_array_length(v_errors) = 0, 'created', v_created, 'updated', v_updated,
                            'unchanged', v_unchanged, 'errors', v_errors);
end $$;

-- ---------- grants ----------
revoke execute on function public.jsonb_text_set(jsonb), public.answer_present(uuid, jsonb),
  public.grade_answer(jsonb, uuid, jsonb), public.answer_feedback_json(jsonb, uuid, jsonb),
  public.question_exhibits_json(uuid, text[]), public.attempt_questions_default_order()
  from public, anon, authenticated;
revoke execute on function public.save_response(uuid, uuid, jsonb, bigint), public.admin_upsert_question(jsonb),
  public.admin_import_rich_questions(text, jsonb, text)
  from public, anon;
-- admin_import_rich_questions checks is_admin() for signed-in callers (scripts/import-pmp-bank.ts signs in as an admin)
grant execute on function public.save_response(uuid, uuid, jsonb, bigint), public.admin_upsert_question(jsonb),
  public.admin_import_rich_questions(text, jsonb, text)
  to authenticated;
grant execute on function public.admin_import_rich_questions(text, jsonb, text) to service_role;
