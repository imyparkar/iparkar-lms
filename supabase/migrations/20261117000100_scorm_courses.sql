-- =====================================================================
-- SCORM 1.2 courses (free for signed-in learners)
--
-- * scorm_courses / scorm_modules: catalogue. A course is a set of SCORM 1.2
--   packages (one SCO each) shown in order. access = 'signed_in' means every
--   active signed-in learner can open it; nothing is sold.
-- * scorm_attempts: one row per learner per module holding the SCORM run-time
--   data the LMS must keep (cmi.core.lesson_status, lesson_location,
--   score.raw, total_time, cmi.suspend_data). The package files live in the
--   private R2 bucket under lms-assets/scorm/<course>/<module>/ and are served
--   only by /api/scorm/... after scorm_can_view() says yes.
-- * Learners never touch the tables: scorm_launch and scorm_commit derive the
--   learner from auth.uid(), validate every value against the SCORM 1.2
--   vocabulary and limits, and never let a status move backwards from
--   passed/completed, or a score go down.
--
-- Additive and re-runnable. Seeds the free "SAT" course (6 modules).
-- =====================================================================

create table if not exists public.scorm_courses (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[a-z0-9-]{2,40}$'),
  title       text not null,
  summary     text,
  access      text not null default 'signed_in' check (access in ('signed_in')),
  status      text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists public.scorm_modules (
  id              uuid primary key default gen_random_uuid(),
  course_id       uuid not null references public.scorm_courses (id) on delete cascade,
  code            text not null check (code ~ '^[a-z0-9-]{2,40}$'),
  title           text not null,
  summary         text,
  sort_order      int not null,
  launch_path     text not null default 'index.html' check (launch_path ~ '^[A-Za-z0-9._/-]+$' and launch_path !~ '\.\.'),
  package_version text not null default '1.0.0',
  mastery_score   int check (mastery_score between 0 and 100),
  minutes         int check (minutes between 1 and 600),
  unique (course_id, code),
  unique (course_id, sort_order)
);

create table if not exists public.scorm_attempts (
  user_id          uuid not null references auth.users (id) on delete cascade,
  module_id        uuid not null references public.scorm_modules (id) on delete cascade,
  lesson_status    text not null default 'not attempted'
                   check (lesson_status in ('passed', 'completed', 'failed', 'incomplete', 'browsed', 'not attempted')),
  lesson_location  text not null default '' check (length(lesson_location) <= 255),
  suspend_data     text not null default '' check (length(suspend_data) <= 4096),
  score_raw        numeric(5,2) check (score_raw between 0 and 100),
  best_score       numeric(5,2) check (best_score between 0 and 100),
  total_time       interval not null default '0',
  session_count    int not null default 0,
  first_launched_at timestamptz not null default now(),
  last_launched_at  timestamptz not null default now(),
  completed_at     timestamptz,
  updated_at       timestamptz not null default now(),
  primary key (user_id, module_id)
);
create index if not exists scorm_attempts_module on public.scorm_attempts (module_id);

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------

-- The course a signed-in learner may open (published, or any status for admins).
create or replace function public.scorm_open_course(p_course text) returns public.scorm_courses
language sql stable security definer set search_path = public as $$
  select c.* from scorm_courses c
   where c.code = p_course and public.is_active_user()
     and (c.status = 'published' or public.is_admin());
$$;

-- SCORM 1.2 CMITimespan: HHHH:MM:SS(.SS)
create or replace function public.scorm_parse_timespan(p text) returns interval
language plpgsql immutable set search_path = public as $$
declare m text[];
begin
  if p is null then return null; end if;
  m := regexp_match(p, '^(\d{2,4}):([0-5]\d):([0-5]\d)(\.\d{1,2})?$');
  if m is null then return null; end if;
  return make_interval(hours => m[1]::int, mins => m[2]::int, secs => (m[3] || coalesce(m[4], ''))::numeric);
end $$;

create or replace function public.scorm_format_timespan(p interval) returns text
language sql immutable set search_path = public as $$
  select lpad(floor(extract(epoch from p) / 3600)::int::text, 4, '0') || ':' ||
         lpad((floor(extract(epoch from p) / 60)::int % 60)::text, 2, '0') || ':' ||
         lpad((floor(extract(epoch from p))::int % 60)::text, 2, '0');
$$;

create or replace function public.scorm_status_rank(p text) returns int
language sql immutable set search_path = public as $$
  select case p when 'passed' then 5 when 'completed' then 4 when 'failed' then 3
                when 'incomplete' then 2 when 'browsed' then 1 else 0 end;
$$;

-- ---------------------------------------------------------------------
-- Learner RPCs
-- ---------------------------------------------------------------------

-- Catalogue of open SCORM courses with the caller's progress (for My learning).
create or replace function public.scorm_my_courses() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x->>'sort_order', x->>'code'), '[]'::jsonb) from (
    select jsonb_build_object(
      'code', c.code, 'title', c.title, 'summary', c.summary, 'status', c.status, 'sort_order', c.sort_order,
      'modules_total', (select count(*) from scorm_modules m where m.course_id = c.id),
      'modules_done', (select count(*) from scorm_modules m join scorm_attempts a on a.module_id = m.id and a.user_id = auth.uid()
                        where m.course_id = c.id and a.lesson_status in ('passed', 'completed')),
      'started', exists (select 1 from scorm_modules m join scorm_attempts a on a.module_id = m.id and a.user_id = auth.uid() where m.course_id = c.id),
      'last_activity_at', (select max(a.updated_at) from scorm_modules m join scorm_attempts a on a.module_id = m.id and a.user_id = auth.uid() where m.course_id = c.id)
    ) as x
    from scorm_courses c
    where public.is_active_user() and (c.status = 'published' or public.is_admin())
  ) s;
$$;

-- One course with its modules and the caller's status per module.
create or replace function public.scorm_get_course(p_course text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c scorm_courses;
begin
  c := public.scorm_open_course(p_course);
  if c.id is null then return null; end if;
  return jsonb_build_object(
    'code', c.code, 'title', c.title, 'summary', c.summary, 'status', c.status,
    'modules', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', m.code, 'title', m.title, 'summary', m.summary, 'sort_order', m.sort_order, 'minutes', m.minutes,
        'status', coalesce(a.lesson_status, 'not attempted'), 'score', a.best_score,
        'completed_at', a.completed_at, 'last_launched_at', a.last_launched_at) order by m.sort_order)
      from scorm_modules m left join scorm_attempts a on a.module_id = m.id and a.user_id = auth.uid()
      where m.course_id = c.id), '[]'::jsonb));
end $$;

-- Start or resume a module: returns the values the SCORM API reports to the package.
create or replace function public.scorm_launch(p_course text, p_module text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c scorm_courses; m scorm_modules; a scorm_attempts; p profiles;
begin
  c := public.scorm_open_course(p_course);
  if c.id is null then raise exception 'course_unavailable' using errcode = 'P0001'; end if;
  select * into m from scorm_modules where course_id = c.id and code = p_module;
  if m.id is null then raise exception 'module_not_found' using errcode = 'P0001'; end if;
  select * into p from profiles where id = auth.uid();

  insert into scorm_attempts (user_id, module_id, session_count)
  values (auth.uid(), m.id, 1)
  on conflict (user_id, module_id) do update
     set session_count = scorm_attempts.session_count + 1, last_launched_at = now()
  returning * into a;

  return jsonb_build_object(
    'course', jsonb_build_object('code', c.code, 'title', c.title),
    'module', jsonb_build_object('code', m.code, 'title', m.title, 'launch_path', m.launch_path,
                                 'package_version', m.package_version, 'mastery_score', m.mastery_score),
    'cmi', jsonb_build_object(
      'student_id', p.username,
      'student_name', coalesce(nullif(p.full_name, ''), p.username),
      'lesson_status', a.lesson_status,
      'lesson_location', a.lesson_location,
      'suspend_data', a.suspend_data,
      'score_raw', coalesce(a.score_raw::text, ''),
      'total_time', public.scorm_format_timespan(a.total_time),
      'entry', case when a.session_count > 1 and a.suspend_data <> '' then 'resume' else 'ab-initio' end,
      'mastery_score', coalesce(m.mastery_score::text, '')));
end $$;

-- Save run-time data. p_data keys: lesson_status, lesson_location, suspend_data,
-- score_raw, session_time (only added to total_time when finish = true).
create or replace function public.scorm_commit(p_course text, p_module text, p_data jsonb, p_finish boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare c scorm_courses; m scorm_modules; a scorm_attempts;
        v_status text; v_loc text; v_susp text; v_score numeric; v_sess interval; v_new_status text; v_was_done boolean;
begin
  c := public.scorm_open_course(p_course);
  if c.id is null then raise exception 'course_unavailable' using errcode = 'P0001'; end if;
  select * into m from scorm_modules where course_id = c.id and code = p_module;
  if m.id is null then raise exception 'module_not_found' using errcode = 'P0001'; end if;
  if jsonb_typeof(coalesce(p_data, '{}'::jsonb)) <> 'object' then raise exception 'invalid_data' using errcode = 'P0001'; end if;

  v_status := p_data->>'lesson_status';
  if v_status is not null and v_status not in ('passed', 'completed', 'failed', 'incomplete', 'browsed') then
    raise exception 'invalid_lesson_status' using errcode = 'P0001';
  end if;
  v_loc := p_data->>'lesson_location';
  if v_loc is not null and length(v_loc) > 255 then raise exception 'lesson_location_too_long' using errcode = 'P0001'; end if;
  v_susp := p_data->>'suspend_data';
  if v_susp is not null and length(v_susp) > 4096 then raise exception 'suspend_data_too_long' using errcode = 'P0001'; end if;
  if nullif(p_data->>'score_raw', '') is not null then
    if (p_data->>'score_raw') !~ '^\d{1,3}(\.\d{1,2})?$' then raise exception 'invalid_score' using errcode = 'P0001'; end if;
    v_score := (p_data->>'score_raw')::numeric;
    if v_score > 100 then raise exception 'invalid_score' using errcode = 'P0001'; end if;
  end if;
  if p_finish and p_data ? 'session_time' then
    v_sess := public.scorm_parse_timespan(p_data->>'session_time');
    if v_sess is null then raise exception 'invalid_session_time' using errcode = 'P0001'; end if;
    v_sess := least(v_sess, interval '12 hours');
  end if;

  select * into a from scorm_attempts where user_id = auth.uid() and module_id = m.id for update;
  if a.user_id is null then raise exception 'not_launched' using errcode = 'P0001'; end if;
  v_was_done := a.completed_at is not null;

  -- A finished module never goes back to unfinished; passed beats completed beats failed.
  v_new_status := case when v_status is null then a.lesson_status
                       when public.scorm_status_rank(v_status) >= public.scorm_status_rank(a.lesson_status) then v_status
                       when a.lesson_status in ('passed', 'completed') then a.lesson_status
                       else v_status end;

  update scorm_attempts set
    lesson_status   = v_new_status,
    lesson_location = coalesce(v_loc, lesson_location),
    suspend_data    = coalesce(v_susp, suspend_data),
    score_raw       = coalesce(v_score, score_raw),
    best_score      = greatest(best_score, v_score),
    total_time      = total_time + coalesce(v_sess, interval '0'),
    completed_at    = case when completed_at is null and v_new_status in ('passed', 'completed') then now() else completed_at end,
    updated_at      = now()
  where user_id = auth.uid() and module_id = m.id
  returning * into a;

  if not v_was_done and a.completed_at is not null then
    insert into audit_logs (actor_id, action, entity, entity_id, details)
    values (auth.uid(), 'scorm.module_completed', 'scorm_module', m.id::text,
            jsonb_build_object('course', c.code, 'module', m.code, 'status', v_new_status, 'score', a.score_raw));
  end if;

  return jsonb_build_object('ok', true, 'lesson_status', a.lesson_status, 'best_score', a.best_score);
end $$;

-- File access check for /api/scorm/<course>/<module>/<path>.
create or replace function public.scorm_can_view(p_course text, p_module text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from scorm_courses c join scorm_modules m on m.course_id = c.id
     where c.code = p_course and m.code = p_module and public.is_active_user()
       and (c.status = 'published' or public.is_admin()));
$$;

-- ---------------------------------------------------------------------
-- RLS and grants: no direct table access; RPCs only.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['scorm_courses', 'scorm_modules', 'scorm_attempts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

revoke all on function public.scorm_open_course(text), public.scorm_parse_timespan(text),
  public.scorm_format_timespan(interval), public.scorm_status_rank(text),
  public.scorm_my_courses(), public.scorm_get_course(text), public.scorm_launch(text, text),
  public.scorm_commit(text, text, jsonb, boolean), public.scorm_can_view(text, text) from public, anon;
grant execute on function public.scorm_my_courses(), public.scorm_get_course(text), public.scorm_launch(text, text),
  public.scorm_commit(text, text, jsonb, boolean), public.scorm_can_view(text, text) to authenticated;

-- ---------------------------------------------------------------------
-- Seed: free SAT course
-- ---------------------------------------------------------------------
insert into public.scorm_courses (code, title, summary, access, status, sort_order)
values ('sat', 'Systematic Approach to Training (SAT)',
        'A free six-module course on the systematic approach to training: an overview, then one module for each ADDIE phase — analysis, design, development, implementation and evaluation.',
        'signed_in', 'published', 10)
on conflict (code) do update set title = excluded.title, summary = excluded.summary;

insert into public.scorm_modules (course_id, code, title, summary, sort_order, mastery_score, minutes)
select c.id, v.code, v.title, v.summary, v.sort_order, 80, v.minutes
  from public.scorm_courses c,
  (values
    ('overview',       'Overview of a systematic approach to training', 'Purpose of SAT, the five ADDIE phases, benefits, and who does what.', 1, 20),
    ('analysis',       'Analysis phase',       'Work out which tasks and competencies need training, and the KSAs behind them.', 2, 15),
    ('design',         'Design phase',         'Write training objectives and choose methods, assessment and settings.', 3, 25),
    ('development',    'Development phase',    'Build, quality-assure and pilot the materials; prepare instructors.', 4, 20),
    ('implementation', 'Implementation phase', 'Deliver the training, assess trainees and capture feedback.', 5, 20),
    ('evaluation',     'Evaluation phase',     'Prove the training worked with the four levels of evaluation, and feed improvements back.', 6, 20)
  ) as v(code, title, summary, sort_order, minutes)
 where c.code = 'sat'
on conflict (course_id, code) do update
   set title = excluded.title, summary = excluded.summary, mastery_score = excluded.mastery_score, minutes = excluded.minutes;
