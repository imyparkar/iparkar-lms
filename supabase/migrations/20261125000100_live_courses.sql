-- =====================================================================
-- Live instructor-led courses (first course: OHBP, "Basic Principles in Occupational Hygiene").
--
-- A live course is a study_courses row with delivery = 'live'. It reuses the study-course enrolment,
-- Razorpay checkout, refund handling and certificate pipeline, and adds:
--   * cohorts, each with the course's scheduled live sessions and a Microsoft Teams joining link per session;
--   * attendance, with make-up (captioned recording + make-up task) within 14 days of a missed session;
--   * practical assessments (marked out of 10, pass 6, one resubmission);
--   * independent study, tracked as completed SCORM modules in a SCORM course linked to the study course;
--   * an internal final course examination: fixed forms of single-best-answer items, server-timed, autosaved,
--     submitted on expiry, idempotent, with retakes, a cooldown and extra-time accommodations;
--   * certificate rule 'live': issued only when the SAME enrolment has (1) a verified purchase with no refund or
--     open/lost dispute, (2) every live session attended or made up, every practical passed and every
--     independent-study module completed, and (3) a final-exam result at or above the pass mark.
--     The purchase is re-checked when the certificate is generated AND each time it is downloaded.
--
-- Exam items live only in the database (imported with the service role); learners never read keys.
-- Additive and re-runnable.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Course flags
-- ---------------------------------------------------------------------
alter table public.study_courses add column if not exists delivery text not null default 'self_paced';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'study_courses_delivery_check') then
    alter table public.study_courses add constraint study_courses_delivery_check check (delivery in ('self_paced', 'live'));
  end if;
end $$;

alter table public.study_certificate_programs add column if not exists completion_rule text not null default 'chapters';
alter table public.study_certificate_programs add column if not exists statement text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'study_certificate_programs_rule_check') then
    alter table public.study_certificate_programs add constraint study_certificate_programs_rule_check
      check (completion_rule in ('chapters', 'live'));
  end if;
end $$;

-- SCORM courses that belong to a paid study course (independent study, slide review).
alter table public.scorm_courses add column if not exists study_course_id uuid references public.study_courses (id) on delete restrict;
alter table public.scorm_courses add column if not exists role text;
alter table public.scorm_courses drop constraint if exists scorm_courses_access_check;
alter table public.scorm_courses add constraint scorm_courses_access_check check (access in ('signed_in', 'study'));
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'scorm_courses_study_link_check') then
    alter table public.scorm_courses add constraint scorm_courses_study_link_check
      check ((access = 'study') = (study_course_id is not null) and (role is null or role in ('independent', 'slides')));
  end if;
end $$;

create table if not exists public.live_course_settings (
  course_id        uuid primary key references public.study_courses (id) on delete cascade,
  designed_hours   numeric(5,2) not null check (designed_hours >= 1),
  exam_items       int not null default 40 check (exam_items between 1 and 200),
  exam_minutes     int not null default 60 check (exam_minutes between 5 and 600),
  pass_mark        int not null default 24,
  max_attempts     int not null default 3 check (max_attempts between 1 and 10),
  cooldown_days    int not null default 7 check (cooldown_days between 0 and 90),
  makeup_days      int not null default 14 check (makeup_days between 1 and 90),
  resubmit_days    int not null default 14 check (resubmit_days between 1 and 90),
  practical_max    int not null default 10,
  practical_pass   int not null default 6,
  check (pass_mark between 1 and exam_items),
  check (practical_pass between 1 and practical_max)
);

-- ---------------------------------------------------------------------
-- Schedule: plan (per course version) → cohort → sessions
-- ---------------------------------------------------------------------
create table if not exists public.live_session_plan (
  id           uuid primary key default gen_random_uuid(),
  version_id   uuid not null references public.study_course_versions (id) on delete cascade,
  session_no   int not null check (session_no between 1 and 100),
  title        text not null,
  minutes      int not null check (minutes between 10 and 600),
  makeup_task  text not null,
  unique (version_id, session_no)
);

create table if not exists public.live_cohorts (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references public.study_courses (id) on delete restrict,
  version_id  uuid not null references public.study_course_versions (id) on delete restrict,
  code        text not null unique check (code ~ '^[A-Z0-9-]{3,30}$'),
  title       text not null,
  time_zone   text not null default 'Asia/Kuwait',
  status      text not null default 'draft' check (status in ('draft', 'open', 'closed')),
  created_at  timestamptz not null default now()
);

create table if not exists public.live_sessions (
  id             uuid primary key default gen_random_uuid(),
  cohort_id      uuid not null references public.live_cohorts (id) on delete cascade,
  plan_id        uuid not null references public.live_session_plan (id) on delete restrict,
  starts_at      timestamptz,
  ends_at        timestamptz,
  join_url       text check (join_url is null or join_url ~ '^https://(teams\.microsoft\.com|teams\.live\.com)/[^\s<>"]+$'),
  recording_url  text check (recording_url is null or recording_url ~ '^https://[^\s<>"]+$'),
  instructor     text,
  unique (cohort_id, plan_id),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create table if not exists public.live_cohort_members (
  enrollment_id uuid primary key references public.study_enrollments (id) on delete cascade,
  cohort_id     uuid not null references public.live_cohorts (id) on delete restrict,
  assigned_by   uuid,
  assigned_at   timestamptz not null default now()
);
create index if not exists live_cohort_members_cohort on public.live_cohort_members (cohort_id);

create table if not exists public.live_attendance (
  session_id    uuid not null references public.live_sessions (id) on delete cascade,
  enrollment_id uuid not null references public.study_enrollments (id) on delete cascade,
  status        text not null check (status in ('present', 'absent')),
  minutes       int check (minutes between 0 and 600),
  recorded_by   uuid,
  recorded_at   timestamptz not null default now(),
  primary key (session_id, enrollment_id)
);

create table if not exists public.live_makeups (
  session_id        uuid not null references public.live_sessions (id) on delete cascade,
  enrollment_id     uuid not null references public.study_enrollments (id) on delete cascade,
  status            text not null default 'submitted' check (status in ('open', 'submitted', 'approved', 'returned')),
  recording_watched boolean not null default false,
  response          text not null check (char_length(response) between 20 and 8000),
  submitted_at      timestamptz not null default now(),
  deadline_override timestamptz,
  reviewed_by       uuid,
  reviewed_at       timestamptz,
  feedback          text check (feedback is null or char_length(feedback) <= 4000),
  primary key (session_id, enrollment_id)
);

-- ---------------------------------------------------------------------
-- Practicals
-- ---------------------------------------------------------------------
create table if not exists public.live_practicals (
  id          uuid primary key default gen_random_uuid(),
  version_id  uuid not null references public.study_course_versions (id) on delete cascade,
  code        text not null check (code ~ '^P[0-9]{1,2}$'),
  title       text not null,
  session_no  int not null,
  sort_order  int not null,
  unique (version_id, code)
);

create table if not exists public.live_practical_submissions (
  id             uuid primary key default gen_random_uuid(),
  practical_id   uuid not null references public.live_practicals (id) on delete restrict,
  enrollment_id  uuid not null references public.study_enrollments (id) on delete cascade,
  attempt_no     int not null check (attempt_no between 1 and 2),
  route          text not null default 'session' check (route in ('session', 'clinic', 'individual')),
  response       text check (response is null or char_length(response) <= 20000),
  file_key       text check (file_key is null or (file_key ~ '^live-submissions/[0-9a-f-]{36}/[A-Za-z0-9._/-]+$' and file_key !~ '\.\.')),
  file_name      text check (file_name is null or char_length(file_name) <= 200),
  submitted_at   timestamptz not null default now(),
  mark           int,
  feedback       text check (feedback is null or char_length(feedback) <= 4000),
  marked_by      uuid,
  marked_at      timestamptz,
  unique (practical_id, enrollment_id, attempt_no),
  check (response is not null or file_key is not null)
);

-- ---------------------------------------------------------------------
-- Final course examination
-- ---------------------------------------------------------------------
create table if not exists public.live_exam_forms (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid not null references public.study_courses (id) on delete restrict,
  code       text not null check (code ~ '^[A-Z]$'),
  is_active  boolean not null default false,
  reviewed   boolean not null default false,          -- set after the occupational hygiene reviewer signs off
  unique (course_id, code)
);

create table if not exists public.live_exam_items (
  id             uuid primary key default gen_random_uuid(),
  form_id        uuid not null references public.live_exam_forms (id) on delete cascade,
  ref            text not null check (ref ~ '^[A-Z]-U[0-9]-[0-9]{2}$'),
  section        int not null check (section between 1 and 20),
  syllabus_ref   text not null,
  competency     text not null,
  level          text,
  difficulty     text,
  stem           text not null check (char_length(stem) between 10 and 2000),
  options        jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) = 4),
  sort_order     int not null,
  unique (form_id, ref),
  unique (form_id, sort_order)
);

-- Keys and rationales: never readable by learners (no grants; RPCs below never return them to learners).
create table if not exists public.live_exam_keys (
  item_id    uuid primary key references public.live_exam_items (id) on delete cascade,
  answer     smallint not null check (answer between 0 and 3),
  rationale  text not null,
  source     text not null
);

create table if not exists public.live_exam_sections (
  course_id  uuid not null references public.study_courses (id) on delete cascade,
  section    int not null,
  title      text not null,
  items      int not null check (items > 0),
  primary key (course_id, section)
);

create table if not exists public.live_exam_accommodations (
  enrollment_id uuid primary key references public.study_enrollments (id) on delete cascade,
  extra_pct     int not null check (extra_pct between 0 and 100),
  note          text,
  approved_by   uuid,
  approved_at   timestamptz not null default now()
);

create table if not exists public.live_exam_attempts (
  id             uuid primary key default gen_random_uuid(),
  enrollment_id  uuid not null references public.study_enrollments (id) on delete restrict,
  user_id        uuid not null references public.profiles (id) on delete cascade,
  form_id        uuid not null references public.live_exam_forms (id) on delete restrict,
  attempt_no     int not null check (attempt_no between 1 and 10),
  item_ids       uuid[] not null,
  minutes        int not null,
  started_at     timestamptz not null default now(),
  deadline_at    timestamptz not null,
  status         text not null default 'in_progress' check (status in ('in_progress', 'submitted', 'expired')),
  finished_at    timestamptz,
  score          int,
  max_score      int,
  passed         boolean,
  sections       jsonb,
  unique (enrollment_id, attempt_no)
);
create unique index if not exists live_exam_one_open on public.live_exam_attempts (enrollment_id) where status = 'in_progress';

create table if not exists public.live_exam_answers (
  attempt_id  uuid not null references public.live_exam_attempts (id) on delete cascade,
  item_id     uuid not null references public.live_exam_items (id) on delete restrict,
  choice      smallint check (choice between 0 and 3),
  client_seq  bigint not null default 0,
  saved_at    timestamptz not null default now(),
  primary key (attempt_id, item_id)
);

-- Razorpay disputes (chargebacks). An open or lost dispute blocks a live-course certificate; a lost one also
-- takes back the access that payment bought.
create table if not exists public.payment_disputes (
  dispute_id          text primary key,
  provider            text not null default 'razorpay',
  provider_payment_id text not null,
  status              text not null check (status in ('open', 'won', 'lost', 'closed')),
  amount_minor        bigint,
  updated_at          timestamptz not null default now()
);
create index if not exists payment_disputes_payment on public.payment_disputes (provider, provider_payment_id);

-- No direct table access: RPCs only.
do $$
declare t text;
begin
  foreach t in array array['live_course_settings','live_session_plan','live_cohorts','live_sessions','live_cohort_members',
                           'live_attendance','live_makeups','live_practicals','live_practical_submissions','live_exam_forms',
                           'live_exam_items','live_exam_keys','live_exam_sections','live_exam_accommodations',
                           'live_exam_attempts','live_exam_answers','payment_disputes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- =====================================================================
-- Helpers (private)
-- =====================================================================

-- The caller's enrolment in a live course (any status), or null.
create or replace function public.live_my_enrollment(p_course_code text) returns public.study_enrollments
language sql stable security definer set search_path = public as $$
  select e.* from study_enrollments e join study_courses c on c.id = e.course_id
   where c.code = upper(p_course_code) and c.delivery = 'live' and e.user_id = auth.uid() and public.is_active_user();
$$;

-- (1) Verified qualifying purchase: a purchase row not revoked, for a captured payment that has not been refunded
-- (in full or in part) and has no open or lost dispute. Admin-recorded offline payments count (provider 'manual').
-- Free, trial, pilot and pending-payment enrolments never pass.
create or replace function public.live_purchase_verified(e public.study_enrollments) returns boolean
language sql stable security definer set search_path = public as $$
  select e.id is not null and not coalesce(e.is_pilot, false) and e.status = 'active' and exists (
    select 1 from study_purchases sp join payments p on p.id = sp.payment_id
     where sp.enrollment_id = e.id and sp.revoked_at is null
       and p.status = 'captured' and p.user_id = e.user_id
       and not exists (select 1 from payments r where r.provider = p.provider and r.provider_txn_id = p.provider_txn_id
                         and r.status = 'refunded')
       and (p.provider <> 'razorpay' or exists (select 1 from checkout_orders o where o.payment_id = p.id and o.status = 'paid'))
       and not exists (select 1 from payment_disputes d where d.provider = p.provider and d.provider_payment_id = p.provider_txn_id
                         and d.status in ('open', 'lost')));
$$;

-- Session requirement for one learner: attended, or a make-up approved.
create or replace function public.live_sessions_json(e public.study_enrollments, p_show_links boolean) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'no', pl.session_no, 'title', pl.title, 'minutes', pl.minutes,
      'starts_at', s.starts_at, 'ends_at', s.ends_at, 'instructor', s.instructor,
      'join_url', case when p_show_links and (s.ends_at is null or s.ends_at > now() - interval '1 hour') then s.join_url end,
      'recording_url', case when p_show_links and (a.status is distinct from 'present') then s.recording_url end,
      'attendance', a.status,
      'makeup_task', case when a.status = 'absent' then pl.makeup_task end,
      'makeup_status', m.status, 'makeup_feedback', m.feedback,
      'makeup_deadline', case when a.status = 'absent' then coalesce(m.deadline_override, s.ends_at + make_interval(days => st.makeup_days)) end,
      'satisfied', (a.status = 'present' or m.status = 'approved')
    ) order by pl.session_no), '[]'::jsonb)
  from live_cohort_members cm
  join live_cohorts co on co.id = cm.cohort_id
  join live_sessions s on s.cohort_id = co.id
  join live_session_plan pl on pl.id = s.plan_id
  join live_course_settings st on st.course_id = co.course_id
  left join live_attendance a on a.session_id = s.id and a.enrollment_id = e.id
  left join live_makeups m on m.session_id = s.id and m.enrollment_id = e.id
  where cm.enrollment_id = e.id;
$$;

create or replace function public.live_practicals_json(e public.study_enrollments) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'code', pr.code, 'title', pr.title, 'session_no', pr.session_no,
      'submissions', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'attempt_no', x.attempt_no, 'route', x.route,
                         'submitted_at', x.submitted_at, 'file_name', x.file_name, 'has_response', x.response is not null,
                         'mark', x.mark, 'max', st.practical_max, 'feedback', x.feedback, 'marked_at', x.marked_at) order by x.attempt_no), '[]'::jsonb)
                       from live_practical_submissions x where x.practical_id = pr.id and x.enrollment_id = e.id),
      'passed', exists (select 1 from live_practical_submissions x where x.practical_id = pr.id and x.enrollment_id = e.id
                          and x.mark >= st.practical_pass)
    ) order by pr.sort_order), '[]'::jsonb)
  from live_practicals pr join live_course_settings st on st.course_id = e.course_id
  where pr.version_id = e.version_id;
$$;

create or replace function public.live_independent_json(e public.study_enrollments) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'course', c.code, 'module', m.code, 'title', m.title, 'minutes', m.minutes,
      'status', coalesce(a.lesson_status, 'not attempted'), 'completed_at', a.completed_at,
      'done', coalesce(a.lesson_status in ('completed', 'passed'), false)
    ) order by m.sort_order), '[]'::jsonb)
  from scorm_courses c join scorm_modules m on m.course_id = c.id
  left join scorm_attempts a on a.module_id = m.id and a.user_id = e.user_id
  where c.study_course_id = e.course_id and c.role = 'independent' and c.status = 'published';
$$;

-- (2) All required activities: every scheduled session satisfied (and the cohort has sessions), every practical
-- passed, every independent-study module completed.
create or replace function public.live_activities_complete(e public.study_enrollments) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare s jsonb; p jsonb; i jsonb;
begin
  if e.id is null then return false; end if;
  s := public.live_sessions_json(e, false);
  p := public.live_practicals_json(e);
  i := public.live_independent_json(e);
  return jsonb_array_length(s) > 0 and jsonb_array_length(p) > 0 and jsonb_array_length(i) > 0
     and not exists (select 1 from jsonb_array_elements(s) x where not coalesce((x->>'satisfied')::boolean, false))
     and not exists (select 1 from jsonb_array_elements(p) x where not (x->>'passed')::boolean)
     and not exists (select 1 from jsonb_array_elements(i) x where not (x->>'done')::boolean);
end $$;

-- (3) A passing final-exam result for this enrolment.
create or replace function public.live_exam_passed(e public.study_enrollments) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from live_exam_attempts a where a.enrollment_id = e.id and a.passed);
$$;

-- Close an attempt and score the saved answers. Idempotent: a closed attempt is returned unchanged.
create or replace function public.live_exam_finalize(p_attempt uuid, p_status text) returns public.live_exam_attempts
language plpgsql security definer set search_path = public as $$
declare a live_exam_attempts; st live_course_settings; v_score int; v_sections jsonb;
begin
  select * into a from live_exam_attempts where id = p_attempt for update;
  if a.id is null or a.status <> 'in_progress' then return a; end if;
  select s.* into st from live_course_settings s join study_enrollments e on e.course_id = s.course_id where e.id = a.enrollment_id;
  select count(*) filter (where k.answer = ans.choice) into v_score
    from unnest(a.item_ids) as t(item_id)
    join live_exam_keys k on k.item_id = t.item_id
    left join live_exam_answers ans on ans.attempt_id = a.id and ans.item_id = t.item_id;
  select coalesce(jsonb_agg(jsonb_build_object('section', x.section, 'title', sec.title, 'correct', x.correct, 'total', x.total)
                            order by x.section), '[]'::jsonb)
    into v_sections
    from (select i.section, count(*) as total, count(*) filter (where k.answer = ans.choice) as correct
            from unnest(a.item_ids) as t(item_id)
            join live_exam_items i on i.id = t.item_id
            join live_exam_keys k on k.item_id = i.id
            left join live_exam_answers ans on ans.attempt_id = a.id and ans.item_id = i.id
           group by i.section) x
    left join live_exam_sections sec on sec.course_id = st.course_id and sec.section = x.section;
  update live_exam_attempts
     set status = p_status, finished_at = now(), score = v_score, max_score = cardinality(a.item_ids),
         passed = v_score >= st.pass_mark, sections = v_sections
   where id = a.id returning * into a;
  insert into audit_logs (actor_id, action, entity, entity_id, details)
  values (a.user_id, 'live_exam.' || p_status, 'live_exam_attempt', a.id::text,
          jsonb_build_object('score', a.score, 'max', a.max_score, 'passed', a.passed, 'attempt_no', a.attempt_no));
  return a;
end $$;

-- Grace for network latency: answers that reach the server within 5 s of the deadline are kept; an attempt still
-- open 30 s after its deadline is closed as 'expired' with the answers saved so far.
create or replace function public.live_exam_finalize_expired() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select id from live_exam_attempts where status = 'in_progress' and now() > deadline_at + interval '30 seconds' loop
    perform public.live_exam_finalize(r.id, 'expired'); n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.live_exam_status_json(e public.study_enrollments) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare st live_course_settings; v_used int; v_last live_exam_attempts; v_open live_exam_attempts; v_pass live_exam_attempts;
        v_extra int; v_next timestamptz; v_reason text;
begin
  select * into st from live_course_settings where course_id = e.course_id;
  select count(*) into v_used from live_exam_attempts where enrollment_id = e.id;
  select * into v_open from live_exam_attempts where enrollment_id = e.id and status = 'in_progress';
  select * into v_pass from live_exam_attempts where enrollment_id = e.id and passed order by finished_at limit 1;
  select * into v_last from live_exam_attempts where enrollment_id = e.id and status <> 'in_progress' order by attempt_no desc limit 1;
  select extra_pct into v_extra from live_exam_accommodations where enrollment_id = e.id;
  if v_last.id is not null and not coalesce(v_last.passed, false) then
    v_next := v_last.finished_at + make_interval(days => st.cooldown_days);
  end if;
  v_reason := case
    when v_pass.id is not null then 'passed'
    when v_open.id is not null then null
    when not public.study_has_access(e) then 'access_ended'
    when not public.live_activities_complete(e) then 'activities_incomplete'
    when v_used >= st.max_attempts then 'no_attempts_left'
    when v_next is not null and v_next > now() then 'cooldown'
    when not exists (select 1 from live_exam_forms f where f.course_id = e.course_id and f.is_active) then 'exam_not_open'
    else null end;
  return jsonb_build_object(
    'items', st.exam_items, 'minutes', st.exam_minutes, 'pass_mark', st.pass_mark, 'max_attempts', st.max_attempts,
    'cooldown_days', st.cooldown_days, 'extra_pct', coalesce(v_extra, 0),
    'minutes_allowed', ceil(st.exam_minutes * (100 + coalesce(v_extra, 0)) / 100.0)::int,
    'attempts_used', v_used, 'open_attempt', v_open.id, 'next_allowed_at', v_next,
    'can_start', v_reason is null, 'blocked_reason', v_reason, 'passed', v_pass.id is not null,
    'best', (select jsonb_build_object('score', score, 'max', max_score, 'passed', passed, 'attempt_id', id)
               from live_exam_attempts where enrollment_id = e.id and status <> 'in_progress'
              order by score desc nulls last, finished_at limit 1),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'attempt_no', attempt_no, 'status', status, 'score', score,
                  'max', max_score, 'passed', passed, 'finished_at', finished_at) order by attempt_no), '[]'::jsonb)
                  from live_exam_attempts where enrollment_id = e.id));
end $$;

-- =====================================================================
-- Learner RPCs
-- =====================================================================

-- Everything the course dashboard shows. Joining links and recordings only for a verified purchase
-- (or administrator/pilot access) with access still open.
create or replace function public.live_course_dashboard(p_course_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e study_enrollments; c study_courses; v study_course_versions; co live_cohorts; st live_course_settings;
        v_paid boolean; v_links boolean; v_done boolean; v_exam boolean; pr study_certificate_programs; cert study_certificates;
begin
  if not public.is_active_user() then return jsonb_build_object('ok', false, 'error', 'not_signed_in'); end if;
  perform public.live_exam_finalize_expired();
  select * into c from study_courses where code = upper(p_course_code) and delivery = 'live';
  if c.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  e := public.live_my_enrollment(c.code);
  if e.id is null or e.status <> 'active' then
    return jsonb_build_object('ok', false, 'error', 'not_enrolled',
      'course', jsonb_build_object('code', c.code, 'title', c.title, 'description', c.description, 'price_label', c.price_label,
                                   'access_days', c.access_days));
  end if;
  select * into v from study_course_versions where id = e.version_id;
  select * into st from live_course_settings where course_id = c.id;
  select co2.* into co from live_cohort_members cm join live_cohorts co2 on co2.id = cm.cohort_id where cm.enrollment_id = e.id;
  v_paid := public.live_purchase_verified(e);
  v_links := public.study_has_access(e) and (v_paid or e.access_source in ('admin', 'pilot'));
  v_done := public.live_activities_complete(e);
  v_exam := public.live_exam_passed(e);
  select * into pr from study_certificate_programs where course_code = c.code and is_enabled;
  select sc.* into cert from study_certificates sc where sc.enrollment_id = e.id and sc.status = 'issued';
  update study_enrollments set last_activity_at = now(), first_activity_at = coalesce(first_activity_at, now()) where id = e.id;
  return jsonb_build_object('ok', true,
    'course', jsonb_build_object('code', c.code, 'title', c.title, 'description', c.description, 'version', v.version,
                                 'designed_hours', st.designed_hours),
    'access', public.study_access_json(e),
    'purchase_verified', v_paid,
    'links_visible', v_links,
    'cohort', case when co.id is null then null else jsonb_build_object('code', co.code, 'title', co.title, 'time_zone', co.time_zone, 'status', co.status) end,
    'sessions', public.live_sessions_json(e, v_links),
    'practicals', public.live_practicals_json(e),
    'practical_rules', jsonb_build_object('max', st.practical_max, 'pass', st.practical_pass, 'resubmit_days', st.resubmit_days),
    'independent', public.live_independent_json(e),
    'activities_complete', v_done,
    'exam', public.live_exam_status_json(e),
    'certificate', jsonb_build_object(
      'offered', pr.course_code is not null,
      'eligible', pr.course_code is not null and v_paid and v_done and v_exam,
      'conditions', jsonb_build_object('purchase', v_paid, 'activities', v_done, 'exam', v_exam),
      'issued', case when cert.id is null then null else public.study_certificate_json(cert) end,
      'suggested_name', coalesce(cert.name_on_certificate, (select coalesce(nullif(full_name, ''), username) from profiles where id = e.user_id)))
  );
end $$;

create or replace function public.live_submit_makeup(p_session uuid, p_response text, p_watched boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e study_enrollments; s live_sessions; a live_attendance; m live_makeups; st live_course_settings; v_deadline timestamptz;
begin
  if not public.is_active_user() then return jsonb_build_object('ok', false, 'error', 'not_signed_in'); end if;
  select * into s from live_sessions where id = p_session;
  select en.* into e from study_enrollments en join live_cohort_members cm on cm.enrollment_id = en.id
   where cm.cohort_id = s.cohort_id and en.user_id = auth.uid() and en.status = 'active';
  if s.id is null or e.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not public.study_has_access(e) then return jsonb_build_object('ok', false, 'error', 'access_ended'); end if;
  select * into a from live_attendance where session_id = s.id and enrollment_id = e.id;
  if a.status is distinct from 'absent' then return jsonb_build_object('ok', false, 'error', 'not_missed'); end if;
  if not coalesce(p_watched, false) then return jsonb_build_object('ok', false, 'error', 'watch_recording'); end if;
  if char_length(btrim(coalesce(p_response, ''))) < 20 then return jsonb_build_object('ok', false, 'error', 'too_short'); end if;
  select * into st from live_course_settings where course_id = e.course_id;
  select * into m from live_makeups where session_id = s.id and enrollment_id = e.id for update;
  v_deadline := coalesce(m.deadline_override, s.ends_at + make_interval(days => st.makeup_days));
  if v_deadline is not null and now() > v_deadline then return jsonb_build_object('ok', false, 'error', 'deadline_passed'); end if;
  if m.status = 'approved' then return jsonb_build_object('ok', true, 'status', 'approved'); end if;
  insert into live_makeups (session_id, enrollment_id, response, recording_watched)
  values (s.id, e.id, left(btrim(p_response), 8000), true)
  on conflict (session_id, enrollment_id) do update
     set response = excluded.response, recording_watched = true, status = 'submitted', submitted_at = now(), reviewed_at = null;
  perform public.write_audit('live.makeup_submitted', 'live_session', s.id::text, jsonb_build_object('enrollment', e.id));
  return jsonb_build_object('ok', true, 'status', 'submitted');
end $$;

-- Is the caller allowed to submit this practical now? Returns the attempt number the next submission will use.
create or replace function public.live_practical_can_submit(p_course_code text, p_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e study_enrollments; pr live_practicals; st live_course_settings; last live_practical_submissions;
begin
  e := public.live_my_enrollment(p_course_code);
  if e.id is null or e.status <> 'active' then return jsonb_build_object('ok', false, 'error', 'not_enrolled'); end if;
  if not public.study_has_access(e) then return jsonb_build_object('ok', false, 'error', 'access_ended'); end if;
  select * into pr from live_practicals where version_id = e.version_id and code = upper(p_code);
  if pr.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  select * into st from live_course_settings where course_id = e.course_id;
  select * into last from live_practical_submissions where practical_id = pr.id and enrollment_id = e.id order by attempt_no desc limit 1;
  if last.id is null then return jsonb_build_object('ok', true, 'attempt_no', 1, 'user_id', e.user_id); end if;
  if last.mark is null then return jsonb_build_object('ok', false, 'error', 'awaiting_marking'); end if;
  if last.mark >= st.practical_pass then return jsonb_build_object('ok', false, 'error', 'already_passed'); end if;
  if last.attempt_no >= 2 then return jsonb_build_object('ok', false, 'error', 'no_resubmissions_left'); end if;
  if now() > last.marked_at + make_interval(days => st.resubmit_days) then return jsonb_build_object('ok', false, 'error', 'deadline_passed'); end if;
  return jsonb_build_object('ok', true, 'attempt_no', 2, 'user_id', e.user_id);
end $$;

create or replace function public.live_submit_practical(p_course_code text, p_code text, p_response text, p_file_key text,
                                                        p_file_name text, p_route text default 'session') returns jsonb
language plpgsql security definer set search_path = public as $$
declare chk jsonb; e study_enrollments; pr live_practicals; x live_practical_submissions;
begin
  if not public.is_active_user() then return jsonb_build_object('ok', false, 'error', 'not_signed_in'); end if;
  chk := public.live_practical_can_submit(p_course_code, p_code);
  if not (chk->>'ok')::boolean then return chk; end if;
  e := public.live_my_enrollment(p_course_code);
  perform 1 from study_enrollments where id = e.id for update;
  select * into pr from live_practicals where version_id = e.version_id and code = upper(p_code);
  if nullif(btrim(coalesce(p_response, '')), '') is null and p_file_key is null then
    return jsonb_build_object('ok', false, 'error', 'empty');
  end if;
  if p_file_key is not null and p_file_key not like 'live-submissions/' || auth.uid()::text || '/%' then
    return jsonb_build_object('ok', false, 'error', 'bad_file');
  end if;
  if coalesce(p_route, 'session') not in ('session', 'clinic', 'individual') then return jsonb_build_object('ok', false, 'error', 'bad_route'); end if;
  begin
    insert into live_practical_submissions (practical_id, enrollment_id, attempt_no, route, response, file_key, file_name)
    values (pr.id, e.id, (chk->>'attempt_no')::int, coalesce(p_route, 'session'), nullif(left(btrim(coalesce(p_response, '')), 20000), ''),
            p_file_key, left(p_file_name, 200))
    returning * into x;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'already_submitted');
  end;
  perform public.write_audit('live.practical_submitted', 'live_practical_submission', x.id::text,
                             jsonb_build_object('practical', pr.code, 'attempt_no', x.attempt_no));
  return jsonb_build_object('ok', true, 'id', x.id, 'attempt_no', x.attempt_no);
end $$;

-- Start (or resume) the final exam. Every rule is checked here; the browser decides nothing.
create or replace function public.live_exam_start(p_course_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e study_enrollments; st live_course_settings; s jsonb; f live_exam_forms; a live_exam_attempts; v_items uuid[];
        v_minutes int; v_no int;
begin
  if not public.is_active_user() then return jsonb_build_object('ok', false, 'error', 'not_signed_in'); end if;
  e := public.live_my_enrollment(p_course_code);
  if e.id is null or e.status <> 'active' then return jsonb_build_object('ok', false, 'error', 'not_enrolled'); end if;
  perform 1 from study_enrollments where id = e.id for update;      -- one start at a time per learner
  perform public.live_exam_finalize_expired();
  select * into a from live_exam_attempts where enrollment_id = e.id and status = 'in_progress';
  if a.id is not null then return jsonb_build_object('ok', true, 'attempt_id', a.id, 'resumed', true); end if;
  s := public.live_exam_status_json(e);
  if not (s->>'can_start')::boolean then return jsonb_build_object('ok', false, 'error', s->>'blocked_reason', 'exam', s); end if;
  select * into st from live_course_settings where course_id = e.course_id;

  -- An unseen active form first, then the least recently used one.
  select f2.* into f from live_exam_forms f2
   where f2.course_id = e.course_id and f2.is_active
     and (select count(*) from live_exam_items i where i.form_id = f2.id) = st.exam_items
   order by (select max(started_at) from live_exam_attempts x where x.enrollment_id = e.id and x.form_id = f2.id) nulls first, f2.code
   limit 1;
  if f.id is null then return jsonb_build_object('ok', false, 'error', 'exam_not_open'); end if;
  select array_agg(id order by random()) into v_items from live_exam_items where form_id = f.id;
  v_minutes := (s->>'minutes_allowed')::int;
  v_no := (s->>'attempts_used')::int + 1;
  insert into live_exam_attempts (enrollment_id, user_id, form_id, attempt_no, item_ids, minutes, deadline_at)
  values (e.id, e.user_id, f.id, v_no, v_items, v_minutes, now() + make_interval(mins => v_minutes))
  returning * into a;
  perform public.write_audit('live_exam.started', 'live_exam_attempt', a.id::text,
                             jsonb_build_object('form', f.code, 'attempt_no', v_no, 'minutes', v_minutes));
  return jsonb_build_object('ok', true, 'attempt_id', a.id, 'resumed', false);
end $$;

create or replace function public.live_exam_owned(p_attempt uuid) returns public.live_exam_attempts
language sql stable security definer set search_path = public as $$
  select a.* from live_exam_attempts a where a.id = p_attempt and a.user_id = auth.uid() and public.is_active_user();
$$;

-- The attempt as the learner sees it: items without keys, saved choices, server time and deadline.
create or replace function public.live_exam_get(p_attempt uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a live_exam_attempts; c study_courses;
begin
  a := public.live_exam_owned(p_attempt);
  if a.id is null then return jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); end if;
  if a.status = 'in_progress' and now() > a.deadline_at + interval '30 seconds' then
    a := public.live_exam_finalize(a.id, 'expired');
  end if;
  select co.* into c from study_courses co join study_enrollments e on e.course_id = co.id where e.id = a.enrollment_id;
  return jsonb_build_object('ok', true,
    'attempt', jsonb_build_object('id', a.id, 'status', a.status, 'attempt_no', a.attempt_no, 'minutes', a.minutes,
                                  'started_at', a.started_at, 'deadline_at', a.deadline_at, 'server_now', now()),
    'course', jsonb_build_object('code', c.code, 'title', c.title),
    'items', case when a.status = 'in_progress' then (
      select jsonb_agg(jsonb_build_object('id', i.id, 'n', t.n, 'stem', i.stem, 'options', i.options, 'choice', ans.choice) order by t.n)
        from unnest(a.item_ids) with ordinality as t(item_id, n)
        join live_exam_items i on i.id = t.item_id
        left join live_exam_answers ans on ans.attempt_id = a.id and ans.item_id = i.id) else '[]'::jsonb end);
end $$;

create or replace function public.live_exam_save(p_attempt uuid, p_item uuid, p_choice int, p_client_seq bigint default 0) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a live_exam_attempts;
begin
  a := public.live_exam_owned(p_attempt);
  if a.id is null then return jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); end if;
  select * into a from live_exam_attempts where id = a.id for update;
  if a.status <> 'in_progress' then return jsonb_build_object('ok', false, 'error', 'ATTEMPT_CLOSED'); end if;
  if now() > a.deadline_at + interval '5 seconds' then
    perform public.live_exam_finalize(a.id, 'expired');
    return jsonb_build_object('ok', false, 'error', 'ATTEMPT_EXPIRED');
  end if;
  if not (p_item = any (a.item_ids)) then return jsonb_build_object('ok', false, 'error', 'BAD_ITEM'); end if;
  if p_choice is not null and (p_choice < 0 or p_choice > 3) then return jsonb_build_object('ok', false, 'error', 'BAD_CHOICE'); end if;
  insert into live_exam_answers (attempt_id, item_id, choice, client_seq)
  values (a.id, p_item, p_choice, coalesce(p_client_seq, 0))
  on conflict (attempt_id, item_id) do update
     set choice = excluded.choice, client_seq = excluded.client_seq, saved_at = now()
   where live_exam_answers.client_seq <= excluded.client_seq;
  return jsonb_build_object('ok', true, 'server_now', now(), 'deadline_at', a.deadline_at);
end $$;

-- Submit. Repeated calls return the same result.
create or replace function public.live_exam_submit(p_attempt uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a live_exam_attempts;
begin
  a := public.live_exam_owned(p_attempt);
  if a.id is null then return jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); end if;
  if a.status = 'in_progress' then
    a := public.live_exam_finalize(a.id, case when now() > a.deadline_at + interval '30 seconds' then 'expired' else 'submitted' end);
  end if;
  return public.live_exam_result(a.id);
end $$;

-- Result: score, pass or fail, and revision guidance by unit. Keys and rationales are never shown, so the bank
-- stays usable for retakes.
create or replace function public.live_exam_result(p_attempt uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a live_exam_attempts; e study_enrollments; st live_course_settings;
begin
  a := public.live_exam_owned(p_attempt);
  if a.id is null then return jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); end if;
  if a.status = 'in_progress' and now() > a.deadline_at + interval '30 seconds' then a := public.live_exam_finalize(a.id, 'expired'); end if;
  if a.status = 'in_progress' then return jsonb_build_object('ok', false, 'error', 'IN_PROGRESS'); end if;
  select * into e from study_enrollments where id = a.enrollment_id;
  select * into st from live_course_settings where course_id = e.course_id;
  return jsonb_build_object('ok', true, 'attempt_id', a.id, 'attempt_no', a.attempt_no, 'status', a.status,
    'score', a.score, 'max', a.max_score, 'pass_mark', st.pass_mark, 'passed', a.passed, 'finished_at', a.finished_at,
    'answered', (select count(*) from live_exam_answers x where x.attempt_id = a.id and x.choice is not null),
    'sections', a.sections,
    'revise', (select coalesce(jsonb_agg(s->'section' order by (s->>'correct')::numeric / nullif((s->>'total')::numeric, 0)), '[]'::jsonb)
                 from jsonb_array_elements(a.sections) s
                where (s->>'correct')::numeric / nullif((s->>'total')::numeric, 0) < st.pass_mark::numeric / st.exam_items),
    'exam', public.live_exam_status_json(e));
end $$;

-- =====================================================================
-- Certificates: course-specific rule
-- =====================================================================

-- For rule 'live': create the completion record once all three conditions hold for this enrolment.
create or replace function public.live_ensure_completion(e public.study_enrollments) returns public.study_course_completions
language plpgsql security definer set search_path = public as $$
declare k study_course_completions; v_name text; v_at timestamptz;
begin
  select * into k from study_course_completions where enrollment_id = e.id;
  if k.id is not null then return k; end if;
  if not (public.live_purchase_verified(e) and public.live_activities_complete(e) and public.live_exam_passed(e)) then return k; end if;
  select min(finished_at) into v_at from live_exam_attempts where enrollment_id = e.id and passed;
  select coalesce(nullif(full_name, ''), username) into v_name from profiles where id = e.user_id;
  insert into study_course_completions (enrollment_id, user_id, course_id, version_id, learner_name, course_title,
                                        version_label, chapters_completed, completed_at, record_code)
  select e.id, e.user_id, e.course_id, e.version_id, v_name, c.title, v.version, 0, coalesce(v_at, now()),
         'IPL-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))
    from study_courses c join study_course_versions v on v.id = e.version_id where c.id = e.course_id
  on conflict (enrollment_id) do nothing;
  select * into k from study_course_completions where enrollment_id = e.id;
  update study_enrollments set completed_at = k.completed_at where id = e.id and completed_at is null;
  return k;
end $$;

create or replace function public.study_certificate_status(p_course_code text)
 returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare
  e study_enrollments; k study_course_completions; pr study_certificate_programs; c study_certificates; v_live boolean; v_paid boolean;
begin
  if not public.is_active_user() then return jsonb_build_object('ok', false, 'error', 'not_signed_in'); end if;
  select * into pr from study_certificate_programs where course_code = upper(p_course_code) and is_enabled;
  v_live := coalesce(pr.completion_rule = 'live', false);
  select en.* into e from study_enrollments en join study_courses co on co.id = en.course_id
   where co.code = upper(p_course_code) and en.user_id = auth.uid();
  if e.id is not null then select * into k from study_course_completions where enrollment_id = e.id; end if;
  if k.id is not null then select * into c from study_certificates where completion_id = k.id; end if;
  v_paid := case when v_live then public.live_purchase_verified(e) else public.study_enrollment_paid(e) end;
  return jsonb_build_object('ok', true,
    'offered', pr.course_code is not null,
    'enrolled', e.id is not null and e.status = 'active',
    'paid', v_paid,
    'completed', case when v_live then public.live_activities_complete(e) and public.live_exam_passed(e) else k.id is not null end,
    'completed_at', k.completed_at,
    'eligible', pr.course_code is not null and e.status = 'active' and v_paid
                and case when v_live then public.live_activities_complete(e) and public.live_exam_passed(e) else k.id is not null end,
    'suggested_name', coalesce(c.name_on_certificate, k.learner_name),
    'certificate', case when c.id is null or (v_live and not v_paid) then null else public.study_certificate_json(c) end);
end $function$;

create or replace function public.study_claim_certificate(p_course_code text, p_name text)
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  e study_enrollments; k study_course_completions; pr study_certificate_programs; c study_certificates;
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_code text; v_token uuid := gen_random_uuid(); v_try int := 0; v_live boolean;
begin
  if not public.is_active_user() then return jsonb_build_object('ok', false, 'error', 'not_signed_in'); end if;
  select * into pr from study_certificate_programs where course_code = upper(p_course_code) and is_enabled;
  if pr.course_code is null then return jsonb_build_object('ok', false, 'error', 'not_offered'); end if;
  v_live := pr.completion_rule = 'live';
  select en.* into e from study_enrollments en join study_courses co on co.id = en.course_id
   where co.code = pr.course_code and en.user_id = auth.uid();
  if e.id is null or e.status <> 'active' then return jsonb_build_object('ok', false, 'error', 'not_enrolled'); end if;
  perform 1 from study_enrollments where id = e.id for update;
  select * into e from study_enrollments where id = e.id;

  if v_live then
    -- All three conditions, re-checked on every request (including for a certificate already issued).
    if not public.live_purchase_verified(e) then return jsonb_build_object('ok', false, 'error', 'purchase_required'); end if;
    if not public.live_activities_complete(e) then return jsonb_build_object('ok', false, 'error', 'course_incomplete'); end if;
    if not public.live_exam_passed(e) then return jsonb_build_object('ok', false, 'error', 'exam_not_passed'); end if;
    k := public.live_ensure_completion(e);
  else
    select * into k from study_course_completions where enrollment_id = e.id;
  end if;
  if k.id is null then return jsonb_build_object('ok', false, 'error', 'course_incomplete'); end if;

  select * into c from study_certificates where completion_id = k.id for update;
  if c.status = 'issued' then
    return jsonb_build_object('ok', true, 'state', 'issued', 'certificate', public.study_certificate_json(c));
  end if;
  if not v_live and not public.study_enrollment_paid(e) then return jsonb_build_object('ok', false, 'error', 'purchase_required'); end if;
  if c.id is not null and c.claim_token is not null and c.claimed_at > now() - interval '2 minutes' then
    return jsonb_build_object('ok', false, 'error', 'in_progress', 'certificate', public.study_certificate_json(c));
  end if;
  if not public.study_certificate_name_ok(v_name) then return jsonb_build_object('ok', false, 'error', 'invalid_name'); end if;

  if c.id is null then
    loop
      v_try := v_try + 1;
      v_code := upper(replace(gen_random_uuid()::text, '-', ''));
      v_code := 'IPL-' || split_part(pr.course_code, '-', 1) || '-' || substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4);
      begin
        insert into study_certificates (certificate_code, completion_id, enrollment_id, user_id, course_code, name_on_certificate,
          certificate_title, short_title, version_label, completed_at, hours, categories, wording, template,
          claim_token, claimed_at, attempts)
        values (v_code, k.id, e.id, e.user_id, pr.course_code, v_name, pr.certificate_title, pr.short_title, k.version_label,
          k.completed_at, pr.hours, pr.categories, pr.wording, pr.template, v_token, now(), 1)
        returning * into c;
        exit;
      exception when unique_violation then
        if v_try >= 5 then raise; end if;
      end;
    end loop;
  else
    update study_certificates set name_on_certificate = v_name, claim_token = v_token, claimed_at = now(), attempts = attempts + 1
     where id = c.id returning * into c;
  end if;
  perform public.write_audit('study_certificate_claimed', 'study_certificate', c.certificate_code,
                             jsonb_build_object('attempt', c.attempts, 'rule', pr.completion_rule,
                                                'purchase', case when v_live then true end));
  return jsonb_build_object('ok', true, 'state', 'claimed', 'claim_token', v_token,
    'certificate', public.study_certificate_json(c) || jsonb_build_object(
      'id', c.id, 'user_id', c.user_id, 'short_title', c.short_title, 'categories', c.categories, 'wording', c.wording,
      'template', c.template, 'issuer', pr.issuer, 'signatory_name', pr.signatory_name, 'signatory_title', pr.signatory_title,
      'statement', pr.statement));
end $function$;

-- Download: the owner (or an admin). For a live course the purchase must still be verified at download time.
create or replace function public.study_certificate_file(p_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c study_certificates; pr study_certificate_programs; e study_enrollments;
begin
  select * into c from study_certificates where certificate_code = upper(p_code) and status = 'issued';
  if c.id is null or not public.is_active_user() or not (c.user_id = auth.uid() or public.is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  select * into pr from study_certificate_programs where course_code = c.course_code;
  if pr.completion_rule = 'live' and not public.is_admin() then
    select * into e from study_enrollments where id = c.enrollment_id;
    if not public.live_purchase_verified(e) then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  end if;
  return jsonb_build_object('ok', true, 'storage_key', c.storage_key, 'sha256', c.file_sha256, 'bytes', c.file_bytes,
                            'certificate_code', c.certificate_code, 'course_code', c.course_code);
end $$;

-- =====================================================================
-- SCORM: modules of a paid study course open only to learners with access to it
-- =====================================================================
create or replace function public.scorm_open_course(p_course text) returns public.scorm_courses
language sql stable security definer set search_path = public as $$
  select c.* from scorm_courses c
   where c.code = p_course and public.is_active_user()
     and (c.status = 'published' or public.is_admin())
     and (c.access = 'signed_in' or public.is_admin()
          or exists (select 1 from study_enrollments e where e.course_id = c.study_course_id and e.user_id = auth.uid()
                       and public.study_has_access(e)));
$$;

create or replace function public.scorm_can_view(p_course text, p_module text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from scorm_modules m where m.course_id = (public.scorm_open_course(p_course)).id and m.code = p_module);
$$;

-- My learning lists the free courses; study-linked courses appear on their own course page instead.
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
    where public.is_active_user() and (c.status = 'published' or public.is_admin()) and c.access = 'signed_in'
  ) s;
$$;

-- =====================================================================
-- Payment disputes (service role, from the Razorpay webhook)
-- =====================================================================
create or replace function public.service_record_payment_dispute(p_payment text, p_dispute text, p_phase text, p_amount bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_status text; o checkout_orders;
begin
  v_status := case p_phase when 'created' then 'open' when 'under_review' then 'open' when 'action_required' then 'open'
                           when 'won' then 'won' when 'lost' then 'lost' when 'closed' then 'closed' else null end;
  if v_status is null then return jsonb_build_object('ok', true, 'ignored', p_phase); end if;
  insert into payment_disputes (dispute_id, provider_payment_id, status, amount_minor)
  values (p_dispute, p_payment, v_status, p_amount)
  on conflict (dispute_id) do update set status = excluded.status, amount_minor = coalesce(excluded.amount_minor, payment_disputes.amount_minor),
                                         updated_at = now();
  insert into audit_logs (actor_id, action, entity, entity_id, details)
  values (null, 'payment.dispute_' || v_status, 'payment', p_payment, jsonb_build_object('dispute', p_dispute, 'amount', p_amount));
  if v_status = 'lost' then
    select * into o from checkout_orders where provider = 'razorpay' and provider_payment_id = p_payment;
    if o.study_course_id is not null and o.payment_id is not null then
      perform service_revoke_study_purchase(o.payment_id, 'Chargeback lost');
    elsif o.course_id is not null and o.user_id is not null then
      perform service_revoke_for_payment(o.user_id, o.course_id, 'Chargeback lost');
    end if;
  end if;
  return jsonb_build_object('ok', true, 'status', v_status);
end $$;

-- =====================================================================
-- Instructor / administrator RPCs
-- =====================================================================
create or replace function public.admin_live_create_cohort(p_course_code text, p_code text, p_title text, p_time_zone text default 'Asia/Kuwait')
returns jsonb language plpgsql security definer set search_path = public as $$
declare c study_courses; v study_course_versions; co live_cohorts;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  select * into c from study_courses where code = upper(p_course_code) and delivery = 'live';
  select * into v from study_course_versions where course_id = c.id and is_enrollment_default;
  if v.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  insert into live_cohorts (course_id, version_id, code, title, time_zone) values (c.id, v.id, upper(p_code), p_title, coalesce(p_time_zone, 'Asia/Kuwait'))
  returning * into co;
  insert into live_sessions (cohort_id, plan_id) select co.id, pl.id from live_session_plan pl where pl.version_id = v.id;
  perform public.write_audit('live.cohort_created', 'live_cohort', co.code, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'cohort_id', co.id);
end $$;

-- Set the time, Teams link, recording link and instructor of one session.
create or replace function public.admin_live_update_session(p_session uuid, p_starts_at timestamptz, p_ends_at timestamptz,
  p_join_url text, p_recording_url text, p_instructor text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  begin
    update live_sessions set starts_at = p_starts_at, ends_at = p_ends_at, join_url = nullif(btrim(p_join_url), ''),
           recording_url = nullif(btrim(p_recording_url), ''), instructor = nullif(btrim(p_instructor), '')
     where id = p_session;
  exception when check_violation then
    return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Use a Microsoft Teams meeting link (https://teams.microsoft.com/…), https recording link, and an end time after the start.');
  end;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  perform public.write_audit('live.session_updated', 'live_session', p_session::text, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_live_set_cohort_status(p_cohort uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  update live_cohorts set status = p_status where id = p_cohort;
  return jsonb_build_object('ok', found);
end $$;

create or replace function public.admin_live_assign(p_enrollment uuid, p_cohort uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e study_enrollments; co live_cohorts;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  select * into e from study_enrollments where id = p_enrollment;
  select * into co from live_cohorts where id = p_cohort;
  if e.id is null or co.id is null or co.course_id <> e.course_id or co.version_id <> e.version_id then
    return jsonb_build_object('ok', false, 'error', 'mismatch');
  end if;
  insert into live_cohort_members (enrollment_id, cohort_id, assigned_by) values (e.id, co.id, auth.uid())
  on conflict (enrollment_id) do update set cohort_id = excluded.cohort_id, assigned_by = excluded.assigned_by, assigned_at = now();
  perform public.write_audit('live.cohort_assigned', 'study_enrollment', e.id::text, jsonb_build_object('cohort', co.code));
  return jsonb_build_object('ok', true);
end $$;

-- Record attendance for a session: p_rows = [{"enrollment": uuid, "status": "present"|"absent", "minutes": int}]
create or replace function public.admin_live_record_attendance(p_session uuid, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s live_sessions; r jsonb; n int := 0;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  select * into s from live_sessions where id = p_session;
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    if not exists (select 1 from live_cohort_members where enrollment_id = (r->>'enrollment')::uuid and cohort_id = s.cohort_id) then
      return jsonb_build_object('ok', false, 'error', 'not_in_cohort', 'enrollment', r->>'enrollment');
    end if;
    insert into live_attendance (session_id, enrollment_id, status, minutes, recorded_by)
    values (s.id, (r->>'enrollment')::uuid, r->>'status', (r->>'minutes')::int, auth.uid())
    on conflict (session_id, enrollment_id) do update
       set status = excluded.status, minutes = excluded.minutes, recorded_by = excluded.recorded_by, recorded_at = now();
    n := n + 1;
  end loop;
  perform public.write_audit('live.attendance_recorded', 'live_session', s.id::text, jsonb_build_object('rows', n));
  return jsonb_build_object('ok', true, 'recorded', n);
end $$;

create or replace function public.admin_live_review_makeup(p_session uuid, p_enrollment uuid, p_approve boolean, p_feedback text,
  p_deadline_override timestamptz default null) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  update live_makeups set status = case when p_approve then 'approved' else 'returned' end, feedback = nullif(btrim(p_feedback), ''),
         reviewed_by = auth.uid(), reviewed_at = now(), deadline_override = coalesce(p_deadline_override, deadline_override)
   where session_id = p_session and enrollment_id = p_enrollment;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  perform public.write_audit('live.makeup_reviewed', 'live_session', p_session::text,
                             jsonb_build_object('enrollment', p_enrollment, 'approved', p_approve));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_live_mark_practical(p_submission uuid, p_mark int, p_feedback text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare x live_practical_submissions; st live_course_settings;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  select * into x from live_practical_submissions where id = p_submission for update;
  if x.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  select s.* into st from live_course_settings s join study_enrollments e on e.course_id = s.course_id where e.id = x.enrollment_id;
  if p_mark is null or p_mark < 0 or p_mark > st.practical_max then return jsonb_build_object('ok', false, 'error', 'bad_mark'); end if;
  if char_length(btrim(coalesce(p_feedback, ''))) < 10 then return jsonb_build_object('ok', false, 'error', 'feedback_required'); end if;
  update live_practical_submissions set mark = p_mark, feedback = btrim(p_feedback), marked_by = auth.uid(), marked_at = now()
   where id = x.id;
  perform public.write_audit('live.practical_marked', 'live_practical_submission', x.id::text,
                             jsonb_build_object('mark', p_mark, 'passed', p_mark >= st.practical_pass));
  return jsonb_build_object('ok', true, 'passed', p_mark >= st.practical_pass);
end $$;

create or replace function public.admin_live_set_accommodation(p_enrollment uuid, p_extra_pct int, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if p_extra_pct is null or p_extra_pct = 0 then
    delete from live_exam_accommodations where enrollment_id = p_enrollment;
  else
    insert into live_exam_accommodations (enrollment_id, extra_pct, note, approved_by) values (p_enrollment, p_extra_pct, p_note, auth.uid())
    on conflict (enrollment_id) do update set extra_pct = excluded.extra_pct, note = excluded.note, approved_by = excluded.approved_by, approved_at = now();
  end if;
  perform public.write_audit('live.accommodation_set', 'study_enrollment', p_enrollment::text, jsonb_build_object('extra_pct', p_extra_pct));
  return jsonb_build_object('ok', true);
end $$;

-- Record a verified offline payment (e.g. bank transfer) and grant access. The reference must be unique.
create or replace function public.admin_live_record_purchase(p_user uuid, p_course_code text, p_reference text,
  p_amount_minor bigint, p_currency text, p_days int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c study_courses; v_pay uuid;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  select * into c from study_courses where code = upper(p_course_code);
  if c.id is null or char_length(btrim(coalesce(p_reference, ''))) < 4 or coalesce(p_amount_minor, 0) <= 0 or p_currency !~ '^[A-Z]{3}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  begin
    insert into payments (user_id, study_course_id, provider, provider_event_id, provider_txn_id, event_type, status, amount_minor, currency, payload)
    values (p_user, c.id, 'manual', 'manual:' || btrim(p_reference), btrim(p_reference), 'manual.recorded', 'captured', p_amount_minor, p_currency,
            jsonb_build_object('recorded_by', auth.uid()))
    returning id into v_pay;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'duplicate_reference');
  end;
  return public.service_apply_study_purchase(p_user, c.id, p_days, v_pay);
end $$;

-- Refund of an offline payment: recorded as a refund row; takes back the access and blocks the certificate.
create or replace function public.admin_live_record_refund(p_reference text, p_amount_minor bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p payments;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  select * into p from payments where provider = 'manual' and provider_txn_id = btrim(p_reference) and status = 'captured';
  if p.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  insert into payments (user_id, study_course_id, provider, provider_event_id, provider_txn_id, event_type, status, amount_minor, currency, payload)
  values (p.user_id, p.study_course_id, 'manual', 'manual-refund:' || p.provider_txn_id || ':' || gen_random_uuid(), p.provider_txn_id,
          'manual.refund', 'refunded', p_amount_minor, p.currency, jsonb_build_object('recorded_by', auth.uid()));
  perform service_revoke_study_purchase(p.id, 'Refunded (offline)');
  return jsonb_build_object('ok', true);
end $$;

-- Cohort roster for the instructor: every learner with each requirement's state.
create or replace function public.admin_live_cohort(p_cohort uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare co live_cohorts;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  select * into co from live_cohorts where id = p_cohort;
  if co.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  return jsonb_build_object('ok', true,
    'cohort', jsonb_build_object('id', co.id, 'code', co.code, 'title', co.title, 'status', co.status, 'time_zone', co.time_zone),
    'sessions', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'no', pl.session_no, 'title', pl.title, 'minutes', pl.minutes,
                   'starts_at', s.starts_at, 'ends_at', s.ends_at, 'join_url', s.join_url, 'recording_url', s.recording_url,
                   'instructor', s.instructor) order by pl.session_no), '[]'::jsonb)
                   from live_sessions s join live_session_plan pl on pl.id = s.plan_id where s.cohort_id = co.id),
    'learners', (select coalesce(jsonb_agg(jsonb_build_object(
                   'enrollment', e.id, 'name', coalesce(nullif(p.full_name, ''), p.username), 'username', p.username,
                   'access', public.study_access_json(e), 'purchase_verified', public.live_purchase_verified(e),
                   'sessions', public.live_sessions_json(e, false), 'practicals', public.live_practicals_json(e),
                   'independent', public.live_independent_json(e), 'activities_complete', public.live_activities_complete(e),
                   'exam', public.live_exam_status_json(e),
                   'makeups', (select coalesce(jsonb_agg(jsonb_build_object('session', m.session_id, 'status', m.status, 'response', m.response,
                                 'submitted_at', m.submitted_at)), '[]'::jsonb) from live_makeups m where m.enrollment_id = e.id),
                   'certificate', (select certificate_code from study_certificates sc where sc.enrollment_id = e.id and sc.status = 'issued')
                 ) order by p.full_name, p.username), '[]'::jsonb)
                 from live_cohort_members cm join study_enrollments e on e.id = cm.enrollment_id join profiles p on p.id = e.user_id
                 where cm.cohort_id = co.id));
end $$;

create or replace function public.admin_live_overview(p_course_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not public.is_admin() then jsonb_build_object('ok', false, 'error', 'forbidden') else jsonb_build_object('ok', true,
    'cohorts', (select coalesce(jsonb_agg(jsonb_build_object('id', co.id, 'code', co.code, 'title', co.title, 'status', co.status,
                  'learners', (select count(*) from live_cohort_members m where m.cohort_id = co.id),
                  'first_session', (select min(starts_at) from live_sessions s where s.cohort_id = co.id)) order by co.created_at desc), '[]'::jsonb)
                from live_cohorts co join study_courses c on c.id = co.course_id where c.code = upper(p_course_code)),
    'unassigned', (select coalesce(jsonb_agg(jsonb_build_object('enrollment', e.id, 'name', coalesce(nullif(p.full_name, ''), p.username),
                     'username', p.username, 'source', e.access_source)), '[]'::jsonb)
                   from study_enrollments e join study_courses c on c.id = e.course_id join profiles p on p.id = e.user_id
                   where c.code = upper(p_course_code) and e.status = 'active'
                     and not exists (select 1 from live_cohort_members m where m.enrollment_id = e.id)),
    'pending_marking', (select count(*) from live_practical_submissions x join study_enrollments e on e.id = x.enrollment_id
                         join study_courses c on c.id = e.course_id where c.code = upper(p_course_code) and x.mark is null),
    'pending_makeups', (select count(*) from live_makeups m join study_enrollments e on e.id = m.enrollment_id
                         join study_courses c on c.id = e.course_id where c.code = upper(p_course_code) and m.status = 'submitted'),
    'forms', (select coalesce(jsonb_agg(jsonb_build_object('code', f.code, 'active', f.is_active, 'reviewed', f.reviewed,
                'items', (select count(*) from live_exam_items i where i.form_id = f.id)) order by f.code), '[]'::jsonb)
              from live_exam_forms f join study_courses c on c.id = f.course_id where c.code = upper(p_course_code))) end;
$$;

-- Submissions awaiting marking (with the learner's text) for the instructor.
create or replace function public.admin_live_submission(p_submission uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not public.is_admin() then jsonb_build_object('ok', false, 'error', 'forbidden') else coalesce((
    select jsonb_build_object('ok', true, 'id', x.id, 'practical', pr.code, 'title', pr.title, 'attempt_no', x.attempt_no, 'route', x.route,
           'response', x.response, 'file_key', x.file_key, 'file_name', x.file_name, 'submitted_at', x.submitted_at,
           'mark', x.mark, 'feedback', x.feedback, 'learner', coalesce(nullif(p.full_name, ''), p.username))
      from live_practical_submissions x join live_practicals pr on pr.id = x.practical_id
      join study_enrollments e on e.id = x.enrollment_id join profiles p on p.id = e.user_id where x.id = p_submission),
    jsonb_build_object('ok', false, 'error', 'not_found')) end;
$$;

-- File download check for a practical submission: the submitter or an admin.
create or replace function public.live_submission_file(p_submission uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_build_object('ok', true, 'file_key', x.file_key, 'file_name', x.file_name)
      from live_practical_submissions x join study_enrollments e on e.id = x.enrollment_id
     where x.id = p_submission and x.file_key is not null and public.is_active_user() and (e.user_id = auth.uid() or public.is_admin())),
    jsonb_build_object('ok', false, 'error', 'not_found'));
$$;

-- Exam bank import (service role only): p = {"course": "OHBP", "forms": [{"code": "A", "items": [...]}]}
create or replace function public.service_live_import_exam(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c study_courses; f jsonb; it jsonb; fr live_exam_forms; v_item uuid; n int := 0; v_ord int;
begin
  select * into c from study_courses where code = upper(p->>'course') and delivery = 'live';
  if c.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  for f in select * from jsonb_array_elements(p->'forms') loop
    insert into live_exam_forms (course_id, code) values (c.id, upper(f->>'code'))
    on conflict (course_id, code) do update set code = excluded.code returning * into fr;
    if exists (select 1 from live_exam_attempts a where a.form_id = fr.id) then
      return jsonb_build_object('ok', false, 'error', 'form_in_use', 'form', fr.code);   -- never change a form learners have sat
    end if;
    delete from live_exam_items where form_id = fr.id;
    v_ord := 0;
    for it in select * from jsonb_array_elements(f->'items') loop
      v_ord := v_ord + 1;
      insert into live_exam_items (form_id, ref, section, syllabus_ref, competency, level, difficulty, stem, options, sort_order)
      values (fr.id, it->>'ref', (it->>'section')::int, it->>'syllabus_ref', it->>'competency', it->>'level', it->>'difficulty',
              it->>'stem', it->'options', v_ord)
      returning id into v_item;
      insert into live_exam_keys (item_id, answer, rationale, source) values (v_item, (it->>'answer')::smallint, it->>'rationale', it->>'source');
      n := n + 1;
    end loop;
    -- the form must match the course blueprint exactly
    if exists (select 1 from live_exam_sections s where s.course_id = c.id
                and s.items <> (select count(*) from live_exam_items i where i.form_id = fr.id and i.section = s.section))
       or (select count(*) from live_exam_items i where i.form_id = fr.id) <> (select exam_items from live_course_settings where course_id = c.id) then
      raise exception 'form % does not match the blueprint', fr.code;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'items', n);
end $$;

create or replace function public.admin_live_set_form(p_course_code text, p_form text, p_active boolean, p_reviewed boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if p_active and not coalesce(p_reviewed, false) then
    return jsonb_build_object('ok', false, 'error', 'review_first', 'message', 'A form can only be opened to learners after the technical review.');
  end if;
  update live_exam_forms f set is_active = p_active, reviewed = coalesce(p_reviewed, f.reviewed)
    from study_courses c where c.id = f.course_id and c.code = upper(p_course_code) and f.code = upper(p_form);
  return jsonb_build_object('ok', found);
end $$;

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
revoke all on function
  public.live_my_enrollment(text), public.live_purchase_verified(public.study_enrollments),
  public.live_sessions_json(public.study_enrollments, boolean), public.live_practicals_json(public.study_enrollments),
  public.live_independent_json(public.study_enrollments), public.live_activities_complete(public.study_enrollments),
  public.live_exam_passed(public.study_enrollments), public.live_exam_finalize(uuid, text), public.live_exam_finalize_expired(),
  public.live_exam_status_json(public.study_enrollments), public.live_exam_owned(uuid),
  public.live_ensure_completion(public.study_enrollments), public.service_record_payment_dispute(text, text, text, bigint),
  public.service_live_import_exam(jsonb)
from public, anon, authenticated;

revoke all on function
  public.live_course_dashboard(text), public.live_submit_makeup(uuid, text, boolean), public.live_practical_can_submit(text, text),
  public.live_submit_practical(text, text, text, text, text, text), public.live_exam_start(text), public.live_exam_get(uuid),
  public.live_exam_save(uuid, uuid, int, bigint), public.live_exam_submit(uuid), public.live_exam_result(uuid),
  public.live_submission_file(uuid), public.study_certificate_file(text),
  public.admin_live_create_cohort(text, text, text, text), public.admin_live_update_session(uuid, timestamptz, timestamptz, text, text, text),
  public.admin_live_set_cohort_status(uuid, text), public.admin_live_assign(uuid, uuid), public.admin_live_record_attendance(uuid, jsonb),
  public.admin_live_review_makeup(uuid, uuid, boolean, text, timestamptz), public.admin_live_mark_practical(uuid, int, text),
  public.admin_live_set_accommodation(uuid, int, text), public.admin_live_record_purchase(uuid, text, text, bigint, text, int),
  public.admin_live_record_refund(text, bigint), public.admin_live_cohort(uuid), public.admin_live_overview(text),
  public.admin_live_submission(uuid), public.admin_live_set_form(text, text, boolean, boolean)
from public, anon;

grant execute on function
  public.live_course_dashboard(text), public.live_submit_makeup(uuid, text, boolean), public.live_practical_can_submit(text, text),
  public.live_submit_practical(text, text, text, text, text, text), public.live_exam_start(text), public.live_exam_get(uuid),
  public.live_exam_save(uuid, uuid, int, bigint), public.live_exam_submit(uuid), public.live_exam_result(uuid),
  public.live_submission_file(uuid), public.study_certificate_file(text),
  public.admin_live_create_cohort(text, text, text, text), public.admin_live_update_session(uuid, timestamptz, timestamptz, text, text, text),
  public.admin_live_set_cohort_status(uuid, text), public.admin_live_assign(uuid, uuid), public.admin_live_record_attendance(uuid, jsonb),
  public.admin_live_review_makeup(uuid, uuid, boolean, text, timestamptz), public.admin_live_mark_practical(uuid, int, text),
  public.admin_live_set_accommodation(uuid, int, text), public.admin_live_record_purchase(uuid, text, text, bigint, text, int),
  public.admin_live_record_refund(text, bigint), public.admin_live_cohort(uuid), public.admin_live_overview(text),
  public.admin_live_submission(uuid), public.admin_live_set_form(text, text, boolean, boolean)
to authenticated;
grant execute on function public.service_record_payment_dispute(text, text, text, bigint), public.service_live_import_exam(jsonb),
  public.live_exam_finalize_expired() to service_role;

-- Expired attempts are also closed lazily on every read; the job keeps results timely.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('iparkar-live-exam-expiry', '* * * * *', 'select public.live_exam_finalize_expired();');
  end if;
end $$;

-- =====================================================================
-- Seed: OHBP — Basic Principles in Occupational Hygiene (version 1.0.0)
-- Owner decisions 24–25 Nov 2026: 36 h designed study; 40-item open-book exam, 60 min, pass 24; 2 retakes,
-- 7-day cooldown, +25% time for approved accommodations; make-up within 14 days; practicals /10, pass 6.
-- Enrolment is by purchase or administrator only (no free trial). Fee KD 60 (owner, 25 Nov 2026; other currencies in catalogue.ts).
-- =====================================================================
insert into public.study_courses (code, title, product, description, enrollment_policy, delivery, access_days)
values ('OHBP', 'Basic Principles in Occupational Hygiene', 'iParkar Learning',
        'A foundation course in anticipating, recognising, evaluating and controlling workplace health hazards, taught in twelve live instructor-led online sessions on Microsoft Teams, with practical assignments, independent study and an internal course examination. Independent course by iParkar Learning, aligned to a published foundation syllabus in occupational hygiene.',
        'admin', 'live', 365)
on conflict (code) do update set title = excluded.title, description = excluded.description, delivery = 'live';
update public.study_courses set price_label = 'KD 60' where code = 'OHBP';

insert into public.study_course_versions (course_id, version, status, is_enrollment_default, source_title, source_edition, notes, published_at)
select id, '1.0.0', 'published', true, 'Internal coverage reference: occupational hygiene foundation syllabus', 'November 2023',
       'Live programme 1,740 min; independent study 360 min; final exam 60 min.', now()
  from public.study_courses where code = 'OHBP'
on conflict (course_id, version) do nothing;

insert into public.live_course_settings (course_id, designed_hours, exam_items, exam_minutes, pass_mark, max_attempts, cooldown_days,
                                         makeup_days, resubmit_days, practical_max, practical_pass)
select id, 36, 40, 60, 24, 3, 7, 14, 14, 10, 6 from public.study_courses where code = 'OHBP'
on conflict (course_id) do nothing;

insert into public.live_exam_sections (course_id, section, title, items)
select c.id, v.section, v.title, v.items from public.study_courses c,
  (values (1, 'Unit 1 — The occupational hygienist''s role', 2), (2, 'Unit 2 — How the body responds to exposure', 6),
          (3, 'Unit 3 — Hazardous substances and exposure scenarios', 8), (4, 'Unit 4 — Physical and related health hazards', 8),
          (5, 'Unit 5 — Planning and interpreting exposure assessments', 8), (6, 'Unit 6 — Selecting and checking exposure controls', 8))
  as v(section, title, items)
 where c.code = 'OHBP'
on conflict (course_id, section) do update set title = excluded.title, items = excluded.items;

insert into public.live_session_plan (version_id, session_no, title, minutes, makeup_task)
select v.id, p.no, p.title, p.minutes,
       'Watch the captioned recording of Session ' || p.no || ', complete its knowledge checks, then write 150–250 words: the three points from the session you will use at work, and one question for your instructor.'
  from public.study_course_versions v join public.study_courses c on c.id = v.course_id,
  (values (1, 'Foundations of occupational hygiene', 127), (2, 'Breathing, circulation and the eye', 125),
          (3, 'Hearing, heat and the COSHH approach', 141), (4, 'Information, Practical 1 and toxicology', 155),
          (5, 'Material forms and process case studies', 148), (6, 'Noise, vibration and thermal environments', 130),
          (7, 'Radiation, lighting and ergonomics', 145), (8, 'DSE, stress and starting measurement', 163),
          (9, 'Limits, TWA and sampling plans', 140), (10, 'Measuring physical hazards', 163),
          (11, 'Ventilation and LEV', 165), (12, 'PPE, control selection and exam briefing', 138))
  as p(no, title, minutes)
 where c.code = 'OHBP' and v.version = '1.0.0'
on conflict (version_id, session_no) do update set title = excluded.title, minutes = excluded.minutes, makeup_task = excluded.makeup_task;

insert into public.live_practicals (version_id, code, title, session_no, sort_order)
select v.id, p.code, p.title, p.session_no, p.ord
  from public.study_course_versions v join public.study_courses c on c.id = v.course_id,
  (values ('P1', 'SDS-based hazard review', 4, 1), ('P2', 'Worked 8-hour time-weighted average', 9, 2),
          ('P3', 'Exposure sampling plan', 9, 3), ('P4', 'Noise or heat data interpretation', 10, 4),
          ('P5', 'Control selection with a ventilation diagram', 12, 5))
  as p(code, title, session_no, ord)
 where c.code = 'OHBP' and v.version = '1.0.0'
on conflict (version_id, code) do update set title = excluded.title, session_no = excluded.session_no, sort_order = excluded.sort_order;

-- Independent study (required) and session slides (review only), uploaded to private R2 as SCORM 1.2 packages.
insert into public.scorm_courses (code, title, summary, access, status, sort_order, study_course_id, role)
select v.code, v.title, v.summary, 'study', 'draft', v.ord, c.id, v.role from public.study_courses c,
  (values ('ohbp-study', 'Independent study', 'Six self-paced revision modules, one per unit: retrieval practice, worked problems and exam preparation.', 'independent', 100),
          ('ohbp-slides', 'Session slides', 'The slides from each live session, for review.', 'slides', 101)) as v(code, title, summary, role, ord)
 where c.code = 'OHBP'
on conflict (code) do update set title = excluded.title, summary = excluded.summary, study_course_id = excluded.study_course_id, role = excluded.role;

insert into public.scorm_modules (course_id, code, title, summary, sort_order, minutes)
select sc.id, m.code, m.title, m.summary, m.ord, m.minutes from public.scorm_courses sc,
  (values ('unit-1', 'Unit 1 — The occupational hygienist''s role', 'Revision and retrieval practice.', 1, 18),
          ('unit-2', 'Unit 2 — How the body responds to exposure', 'Revision and retrieval practice.', 2, 54),
          ('unit-3', 'Unit 3 — Hazardous substances and exposure scenarios', 'Revision and retrieval practice.', 3, 72),
          ('unit-4', 'Unit 4 — Physical and related health hazards', 'Revision and retrieval practice.', 4, 72),
          ('unit-5', 'Unit 5 — Planning and interpreting exposure assessments', 'Revision, calculations and retrieval practice.', 5, 72),
          ('unit-6', 'Unit 6 — Selecting and checking exposure controls', 'Revision and retrieval practice.', 6, 72)) as m(code, title, summary, ord, minutes)
 where sc.code = 'ohbp-study'
on conflict (course_id, code) do update set title = excluded.title, summary = excluded.summary, minutes = excluded.minutes;

insert into public.scorm_modules (course_id, code, title, sort_order, minutes)
select sc.id, 's' || lpad(pl.session_no::text, 2, '0'), 'Session ' || pl.session_no || ' — ' || pl.title, pl.session_no, pl.minutes
  from public.scorm_courses sc, public.live_session_plan pl
  join public.study_course_versions v on v.id = pl.version_id join public.study_courses c on c.id = v.course_id
 where sc.code = 'ohbp-slides' and c.code = 'OHBP' and v.version = '1.0.0'
on conflict (course_id, code) do update set title = excluded.title, minutes = excluded.minutes;

insert into public.study_certificate_programs (course_code, is_enabled, template, certificate_title, short_title, hours, categories, wording,
                                               signatory_name, signatory_title, completion_rule, statement)
values ('OHBP', true, 'course-a4-landscape-v1', 'Basic Principles in Occupational Hygiene', 'Basic Principles in Occupational Hygiene', 36,
        '{}'::jsonb, 'hours', 'Imran Parkar, CIH, CIT', 'Course Instructor', 'live',
        'Evidence of completion of an independent course by iParkar Learning: live instructor-led sessions, practical assessments, independent study and an internal course examination. It is not a qualification awarded by a professional body.')
on conflict (course_code) do update set template = excluded.template, certificate_title = excluded.certificate_title, short_title = excluded.short_title,
  hours = excluded.hours, completion_rule = excluded.completion_rule, statement = excluded.statement,
  signatory_name = excluded.signatory_name, signatory_title = excluded.signatory_title;

-- Extend a learner's make-up deadline (e.g. illness). Creates the deadline override even before anything is submitted.
create or replace function public.admin_live_extend_makeup(p_session uuid, p_enrollment uuid, p_days int, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s live_sessions; st live_course_settings; v_until timestamptz;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if p_days is null or p_days not between 1 and 30 or char_length(btrim(coalesce(p_reason, ''))) < 3 then
    return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Give 1–30 days and a reason.');
  end if;
  select * into s from live_sessions where id = p_session;
  select c.* into st from live_course_settings c join live_cohorts co on co.course_id = c.course_id where co.id = s.cohort_id;
  if s.id is null or not exists (select 1 from live_attendance a where a.session_id = s.id and a.enrollment_id = p_enrollment and a.status = 'absent') then
    return jsonb_build_object('ok', false, 'error', 'not_missed');
  end if;
  v_until := greatest(now(), coalesce(s.ends_at, now()) + make_interval(days => st.makeup_days)) + make_interval(days => p_days);
  insert into live_makeups (session_id, enrollment_id, status, response, deadline_override)
  values (s.id, p_enrollment, 'open', '(no submission yet — deadline extended by the instructor)', v_until)
  on conflict (session_id, enrollment_id) do update set deadline_override = v_until;
  perform public.write_audit('live.makeup_extended', 'live_session', s.id::text,
                             jsonb_build_object('enrollment', p_enrollment, 'until', v_until, 'reason', p_reason));
  return jsonb_build_object('ok', true, 'until', v_until);
end $$;
revoke all on function public.admin_live_extend_makeup(uuid, uuid, int, text) from public, anon;
grant execute on function public.admin_live_extend_makeup(uuid, uuid, int, text) to authenticated;
