-- =====================================================================
-- iParkar LMS — self-paced study courses (ASP Self Paced Study Course)
--
-- A study course is separate from the practice-exam courses: its own
-- enrollments, its own versions, no dependency on exam entitlements.
--
-- Rules enforced here (never in the browser):
--   * Students read lesson content only through get_study_chapter, which
--     checks an active enrollment in that exact course version.
--   * Answer keys never leave the database; activities are graded here.
--   * A chapter completes only when every required section was opened and
--     acknowledged, every required activity has an attempt whose feedback
--     was viewed, and the learner pressed Finish chapter.
--   * Course completion is computed from canonical chapter rows inside a
--     transaction that locks the enrollment, so replays, refreshes and
--     parallel tabs produce exactly one completion record.
-- =====================================================================

-- Re-runnable: every statement is guarded so applying the file twice is harmless.
do $$
begin
  if to_regtype('public.study_content_status') is null then
    create type public.study_content_status as enum ('draft', 'in_review', 'approved', 'published', 'archived');
  end if;
  if to_regtype('public.study_progress_status') is null then
    create type public.study_progress_status as enum ('not_started', 'in_progress', 'completed');
  end if;
  if to_regtype('public.study_activity_kind') is null then
    create type public.study_activity_kind as enum ('single_choice', 'multi_choice', 'numeric', 'ordering', 'self_check');
  end if;
end $$;
-- self_check: a written response compared with a model answer (formative, always accepted).
alter type public.study_activity_kind add value if not exists 'self_check';

-- ---------- catalogue ----------
create table if not exists public.study_courses (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null unique check (code ~ '^[A-Z]{2,8}(-[A-Z]{2,8})?$'),
  title              text not null,
  product            text not null default 'iParkar Learning',
  description        text,
  -- 'admin': only administrators enrol learners. 'self': signed-in learners may enrol
  -- themselves into the version marked is_enrollment_default (must be published).
  enrollment_policy  text not null default 'admin' check (enrollment_policy in ('admin', 'self')),
  created_at         timestamptz not null default now()
);

create table if not exists public.study_course_versions (
  id                     uuid primary key default gen_random_uuid(),
  course_id              uuid not null references public.study_courses (id) on delete restrict,
  version                text not null check (version ~ '^[0-9]+\.[0-9]+\.[0-9]+(-[a-z0-9.]+)?$'),
  status                 public.study_content_status not null default 'draft',
  is_enrollment_default  boolean not null default false,
  source_title           text,
  source_edition         text,
  stated_blueprint       text,
  notes                  text,
  published_at           timestamptz,
  created_at             timestamptz not null default now(),
  unique (course_id, version),
  unique (id, course_id)
);
create unique index if not exists study_versions_one_default on public.study_course_versions (course_id) where is_enrollment_default;

create table if not exists public.study_domains (
  id          uuid primary key default gen_random_uuid(),
  version_id  uuid not null references public.study_course_versions (id) on delete cascade,
  number      int not null check (number between 1 and 20),
  title       text not null,
  weight      numeric(5,2),             -- exam weight stated by the guide; display only
  intro       text,
  unique (version_id, number),
  unique (id, version_id)
);

create table if not exists public.study_chapters (
  id             uuid primary key default gen_random_uuid(),
  version_id     uuid not null,
  domain_id      uuid not null,
  code           text not null check (code ~ '^[0-9]+\.[0-9]+$'),
  sort_order     int not null,
  title          text not null,
  objectives     text[] not null default '{}',
  is_prerequisite boolean not null default false,
  is_required    boolean not null default true,
  source_pages   int[] check (source_pages is null or array_length(source_pages, 1) = 2),
  est_minutes    int check (est_minutes is null or est_minutes between 1 and 600),
  review_status  public.study_content_status not null default 'draft',
  meta           jsonb not null default '{}'::jsonb,  -- outcomes, sources, related chapters, review notes
  unique (version_id, code),
  unique (id, version_id),
  foreign key (domain_id, version_id) references public.study_domains (id, version_id) on delete cascade
);

create table if not exists public.study_sections (
  id           uuid primary key default gen_random_uuid(),
  version_id   uuid not null,
  chapter_id   uuid not null,
  code         text not null check (code ~ '^[a-z0-9-]{1,40}$'),
  sort_order   int not null,
  title        text not null,
  est_minutes  int check (est_minutes is null or est_minutes between 1 and 120),
  is_required  boolean not null default true,
  blocks       jsonb not null default '[]'::jsonb check (jsonb_typeof(blocks) = 'array'),
  unique (chapter_id, code),
  unique (id, version_id),
  unique (id, chapter_id),
  foreign key (chapter_id, version_id) references public.study_chapters (id, version_id) on delete cascade
);

create table if not exists public.study_activities (
  id           uuid primary key default gen_random_uuid(),
  version_id   uuid not null,
  chapter_id   uuid not null,
  section_id   uuid not null,
  code         text not null check (code ~ '^[a-z0-9-]{1,40}$'),
  sort_order   int not null default 0,
  kind         public.study_activity_kind not null,
  is_required  boolean not null default true,
  spec         jsonb not null,   -- what the learner sees: prompt, options, unit, items
  answer_key   jsonb not null,   -- never returned to students
  feedback     jsonb not null default '{}'::jsonb, -- explanation + per-option feedback, shown after submit
  unique (chapter_id, code),
  unique (id, version_id),
  foreign key (chapter_id, version_id) references public.study_chapters (id, version_id) on delete cascade,
  foreign key (section_id, chapter_id) references public.study_sections (id, chapter_id) on delete cascade
);

-- ---------- learner state ----------
create table if not exists public.study_enrollments (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles (id) on delete cascade,
  course_id        uuid not null references public.study_courses (id) on delete restrict,
  version_id       uuid not null,
  status           text not null default 'active' check (status in ('active', 'revoked')),
  is_pilot         boolean not null default false,  -- enrolled into an unpublished version for review
  enrolled_by      uuid,
  enrolled_at      timestamptz not null default now(),
  first_activity_at timestamptz,
  last_activity_at timestamptz,
  completed_at     timestamptz,
  revoked_at       timestamptz,
  unique (user_id, course_id),
  unique (id, version_id),
  foreign key (version_id, course_id) references public.study_course_versions (id, course_id) on delete restrict
);

create table if not exists public.study_section_progress (
  enrollment_id    uuid not null references public.study_enrollments (id) on delete cascade,
  section_id       uuid not null references public.study_sections (id) on delete cascade,
  opened_at        timestamptz not null default now(),
  acknowledged_at  timestamptz,
  primary key (enrollment_id, section_id)
);

create table if not exists public.study_chapter_progress (
  enrollment_id    uuid not null references public.study_enrollments (id) on delete cascade,
  chapter_id       uuid not null references public.study_chapters (id) on delete cascade,
  status           public.study_progress_status not null default 'in_progress',
  first_opened_at  timestamptz not null default now(),
  last_opened_at   timestamptz not null default now(),
  completed_at     timestamptz,
  active_seconds   int not null default 0 check (active_seconds >= 0),
  primary key (enrollment_id, chapter_id),
  check ((status = 'completed') = (completed_at is not null))
);

create table if not exists public.study_activity_attempts (
  id                 uuid primary key default gen_random_uuid(),
  enrollment_id      uuid not null references public.study_enrollments (id) on delete cascade,
  activity_id        uuid not null references public.study_activities (id) on delete cascade,
  client_attempt_id  uuid not null,
  response           jsonb not null,
  is_correct         boolean not null,
  submitted_at       timestamptz not null default now(),
  feedback_viewed_at timestamptz,
  unique (enrollment_id, client_attempt_id)
);
create index if not exists study_attempts_lookup on public.study_activity_attempts (enrollment_id, activity_id, submitted_at desc);

create table if not exists public.study_resume (
  enrollment_id  uuid primary key references public.study_enrollments (id) on delete cascade,
  chapter_id     uuid not null references public.study_chapters (id) on delete cascade,
  section_id     uuid references public.study_sections (id) on delete set null,
  client_ts      bigint not null,       -- monotonic per tab; stale writes are ignored
  updated_at     timestamptz not null default now()
);

create table if not exists public.study_bookmarks (
  enrollment_id  uuid not null references public.study_enrollments (id) on delete cascade,
  section_id     uuid not null references public.study_sections (id) on delete cascade,
  created_at     timestamptz not null default now(),
  primary key (enrollment_id, section_id)
);

create table if not exists public.study_notes (
  enrollment_id  uuid not null references public.study_enrollments (id) on delete cascade,
  chapter_id     uuid not null references public.study_chapters (id) on delete cascade,
  body           text not null check (length(body) <= 10000),
  updated_at     timestamptz not null default now(),
  primary key (enrollment_id, chapter_id)
);

create table if not exists public.study_course_completions (
  id               uuid primary key default gen_random_uuid(),
  enrollment_id    uuid not null unique references public.study_enrollments (id) on delete restrict,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  course_id        uuid not null references public.study_courses (id) on delete restrict,
  version_id       uuid not null references public.study_course_versions (id) on delete restrict,
  learner_name     text not null,
  course_title     text not null,
  version_label    text not null,
  chapters_completed int not null,
  completed_at     timestamptz not null default now(),
  record_code      text not null unique,
  unique (user_id, version_id)
);

-- =====================================================================
-- Helpers
-- =====================================================================

-- The caller's active enrollment for a course code, or null.
create or replace function public.study_my_enrollment(p_course_code text) returns public.study_enrollments
language sql stable security definer set search_path = public as $$
  select e.* from study_enrollments e
  join study_courses c on c.id = e.course_id
  where c.code = upper(p_course_code) and e.user_id = auth.uid() and e.status = 'active'
    and public.is_active_user();
$$;

-- Enrollment that owns a chapter, for the caller.
create or replace function public.study_enrollment_for_chapter(p_chapter uuid) returns public.study_enrollments
language sql stable security definer set search_path = public as $$
  select e.* from study_enrollments e
  join study_chapters ch on ch.version_id = e.version_id
  where ch.id = p_chapter and e.user_id = auth.uid() and e.status = 'active' and public.is_active_user();
$$;

create or replace function public.study_touch(p_enrollment uuid) returns void
language sql security definer set search_path = public as $$
  update study_enrollments
     set last_activity_at = now(), first_activity_at = coalesce(first_activity_at, now())
   where id = p_enrollment;
$$;

-- What still stands between the learner and Finish chapter. Pure read.
create or replace function public.study_chapter_missing(p_enrollment uuid, p_chapter uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'has_content', exists (select 1 from study_sections s where s.chapter_id = p_chapter and s.is_required),
    'sections', coalesce((
      select jsonb_agg(jsonb_build_object('code', s.code, 'title', s.title,
               'state', case when sp.section_id is null then 'not_opened' else 'not_acknowledged' end)
             order by s.sort_order)
        from study_sections s
        left join study_section_progress sp on sp.section_id = s.id and sp.enrollment_id = p_enrollment
       where s.chapter_id = p_chapter and s.is_required and sp.acknowledged_at is null), '[]'::jsonb),
    'activities', coalesce((
      select jsonb_agg(jsonb_build_object('code', a.code, 'section', s.code,
               'state', case when not exists (select 1 from study_activity_attempts t
                                                where t.enrollment_id = p_enrollment and t.activity_id = a.id)
                             then 'not_attempted' else 'feedback_not_viewed' end)
             order by s.sort_order, a.sort_order)
        from study_activities a join study_sections s on s.id = a.section_id
       where a.chapter_id = p_chapter and a.is_required
         and not exists (select 1 from study_activity_attempts t
                          where t.enrollment_id = p_enrollment and t.activity_id = a.id
                            and t.feedback_viewed_at is not null)), '[]'::jsonb)
  );
$$;

create or replace function public.study_progress_summary(p_enrollment uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with req as (
    select ch.id, ch.domain_id from study_chapters ch
    join study_enrollments e on e.version_id = ch.version_id
    where e.id = p_enrollment and ch.is_required
  ), done as (
    select cp.chapter_id from study_chapter_progress cp
    where cp.enrollment_id = p_enrollment and cp.status = 'completed'
  ), per_domain as (
    select d.number, d.title, d.weight,
           count(r.id)::int as required,
           count(dn.chapter_id)::int as completed
      from study_domains d
      join study_enrollments e on e.version_id = d.version_id and e.id = p_enrollment
      left join req r on r.domain_id = d.id
      left join done dn on dn.chapter_id = r.id
     group by d.number, d.title, d.weight
  )
  select jsonb_build_object(
    'required_chapters', (select count(*) from req),
    'completed_chapters', (select count(*) from req r join done d on d.chapter_id = r.id),
    'domains_total', (select count(*) from per_domain),
    'domains_completed', (select count(*) from per_domain where required > 0 and completed = required),
    'domains', coalesce((select jsonb_agg(jsonb_build_object('number', number, 'title', title, 'weight', weight,
                         'required', required, 'completed', completed,
                         'is_complete', required > 0 and completed = required) order by number) from per_domain), '[]'::jsonb)
  );
$$;

-- Grade a response against a key. Returns null when the response is malformed.
create or replace function public.study_grade(p_kind public.study_activity_kind, p_key jsonb, p_response jsonb)
returns boolean language plpgsql immutable set search_path = public as $$
declare
  v_num numeric; v_target numeric; v_tol numeric;
begin
  if p_kind::text = 'single_choice' then
    if jsonb_typeof(p_response -> 'choice') <> 'string' then return null; end if;
    return (p_response ->> 'choice') = (p_key ->> 'correct');
  elsif p_kind::text = 'multi_choice' then
    if jsonb_typeof(p_response -> 'choices') <> 'array' then return null; end if;
    return (select coalesce(array_agg(x order by x), '{}') from (select distinct jsonb_array_elements_text(p_response -> 'choices') x) s)
         = (select coalesce(array_agg(x order by x), '{}') from (select jsonb_array_elements_text(p_key -> 'correct') x) s);
  elsif p_kind::text = 'numeric' then
    begin
      v_num := (p_response ->> 'value')::numeric;
    exception when others then return null;
    end;
    if v_num is null then return null; end if;
    v_target := (p_key ->> 'value')::numeric;
    v_tol := coalesce((p_key ->> 'abs_tol')::numeric, abs(v_target) * coalesce((p_key ->> 'rel_tol')::numeric, 0.01));
    return abs(v_num - v_target) <= v_tol;
  elsif p_kind::text = 'self_check' then
    if jsonb_typeof(p_response -> 'text') <> 'string' or length(btrim(p_response ->> 'text')) = 0
       or length(p_response ->> 'text') > 3000 then return null; end if;
    return true;
  elsif p_kind::text = 'ordering' then
    if jsonb_typeof(p_response -> 'order') <> 'array' then return null; end if;
    return (p_response -> 'order') = (p_key -> 'order');
  end if;
  return null;
end $$;

-- =====================================================================
-- Learner RPCs (all return jsonb {ok, ...})
-- =====================================================================

create or replace function public.get_my_study_courses() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'code', c.code, 'title', c.title, 'version', v.version, 'version_status', v.status,
      'is_pilot', e.is_pilot, 'enrolled_at', e.enrolled_at, 'last_activity_at', e.last_activity_at,
      'completed_at', e.completed_at,
      'progress', public.study_progress_summary(e.id),
      'resume', (select jsonb_build_object('chapter', ch.code, 'chapter_title', ch.title, 'section', s.code)
                   from study_resume r join study_chapters ch on ch.id = r.chapter_id
                   left join study_sections s on s.id = r.section_id where r.enrollment_id = e.id),
      'recent', (select coalesce(jsonb_agg(x order by x ->> 'at' desc), '[]'::jsonb) from (
                   select jsonb_build_object('chapter', ch.code, 'title', ch.title, 'status', cp.status,
                                             'at', cp.last_opened_at) x
                     from study_chapter_progress cp join study_chapters ch on ch.id = cp.chapter_id
                    where cp.enrollment_id = e.id order by cp.last_opened_at desc limit 5) r),
      'bookmarks', (select coalesce(jsonb_agg(jsonb_build_object('chapter', ch.code, 'section', s.code,
                                     'section_title', s.title, 'chapter_title', ch.title) order by b.created_at desc), '[]'::jsonb)
                      from study_bookmarks b join study_sections s on s.id = b.section_id
                      join study_chapters ch on ch.id = s.chapter_id where b.enrollment_id = e.id)
    ) order by c.code), '[]'::jsonb)
  from study_enrollments e
  join study_courses c on c.id = e.course_id
  join study_course_versions v on v.id = e.version_id
  where e.user_id = auth.uid() and e.status = 'active' and public.is_active_user();
$$;

create or replace function public.get_study_course(p_course_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  e study_enrollments;
begin
  e := public.study_my_enrollment(p_course_code);
  if e.id is null then return jsonb_build_object('ok', false, 'error', 'not_enrolled'); end if;
  return jsonb_build_object('ok', true,
    'course', (select jsonb_build_object('code', c.code, 'title', c.title, 'product', c.product,
                 'version', v.version, 'version_status', v.status, 'source_title', v.source_title,
                 'source_edition', v.source_edition, 'stated_blueprint', v.stated_blueprint, 'is_pilot', e.is_pilot,
                 'completed_at', e.completed_at)
                 from study_courses c join study_course_versions v on v.id = e.version_id where c.id = e.course_id),
    'progress', public.study_progress_summary(e.id),
    'resume', (select jsonb_build_object('chapter', ch.code, 'section', s.code, 'chapter_title', ch.title)
                 from study_resume r join study_chapters ch on ch.id = r.chapter_id
                 left join study_sections s on s.id = r.section_id where r.enrollment_id = e.id),
    'domains', (select jsonb_agg(jsonb_build_object(
        'number', d.number, 'title', d.title, 'weight', d.weight, 'intro', d.intro,
        'chapters', (select coalesce(jsonb_agg(jsonb_build_object(
              'code', ch.code, 'title', ch.title, 'objectives', ch.objectives,
              'is_prerequisite', ch.is_prerequisite, 'is_required', ch.is_required,
              'est_minutes', ch.est_minutes, 'source_pages', ch.source_pages,
              'review_status', ch.review_status,
              'has_content', exists (select 1 from study_sections s where s.chapter_id = ch.id),
              'sections', (select count(*) from study_sections s where s.chapter_id = ch.id),
              'status', coalesce(cp.status, 'not_started')) order by ch.sort_order), '[]'::jsonb)
           from study_chapters ch
           left join study_chapter_progress cp on cp.chapter_id = ch.id and cp.enrollment_id = e.id
           where ch.domain_id = d.id)
      ) order by d.number) from study_domains d where d.version_id = e.version_id)
  );
end $$;

create or replace function public.get_study_chapter(p_course_code text, p_chapter_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e study_enrollments;
  ch study_chapters;
begin
  e := public.study_my_enrollment(p_course_code);
  if e.id is null then return jsonb_build_object('ok', false, 'error', 'not_enrolled'); end if;
  select * into ch from study_chapters where version_id = e.version_id and code = p_chapter_code;
  if ch.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;

  -- Opening marks the chapter in progress. It never completes anything.
  if exists (select 1 from study_sections s where s.chapter_id = ch.id) then
    insert into study_chapter_progress (enrollment_id, chapter_id) values (e.id, ch.id)
    on conflict (enrollment_id, chapter_id) do update set last_opened_at = now();
    perform public.study_touch(e.id);
  end if;

  return jsonb_build_object('ok', true,
    'chapter', jsonb_build_object('id', ch.id, 'code', ch.code, 'title', ch.title, 'objectives', ch.objectives,
       'is_prerequisite', ch.is_prerequisite, 'is_required', ch.is_required, 'est_minutes', ch.est_minutes,
       'source_pages', ch.source_pages, 'review_status', ch.review_status, 'meta', ch.meta,
       'domain', (select jsonb_build_object('number', d.number, 'title', d.title) from study_domains d where d.id = ch.domain_id),
       'prev', (select code from study_chapters where version_id = ch.version_id and sort_order < ch.sort_order order by sort_order desc limit 1),
       'next', (select code from study_chapters where version_id = ch.version_id and sort_order > ch.sort_order order by sort_order limit 1),
       'status', coalesce((select status from study_chapter_progress where enrollment_id = e.id and chapter_id = ch.id), 'not_started'),
       'completed_at', (select completed_at from study_chapter_progress where enrollment_id = e.id and chapter_id = ch.id),
       'note', (select body from study_notes where enrollment_id = e.id and chapter_id = ch.id)),
    'sections', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'code', s.code, 'title', s.title, 'est_minutes', s.est_minutes, 'is_required', s.is_required,
        'blocks', s.blocks,
        'opened', sp.section_id is not null, 'acknowledged', sp.acknowledged_at is not null,
        'bookmarked', exists (select 1 from study_bookmarks b where b.enrollment_id = e.id and b.section_id = s.id),
        'activities', (select coalesce(jsonb_agg(jsonb_build_object(
              'id', a.id, 'code', a.code, 'kind', a.kind, 'is_required', a.is_required, 'spec', a.spec,
              'last', (select jsonb_build_object('id', t.id, 'response', t.response, 'is_correct', t.is_correct,
                              'feedback_viewed', t.feedback_viewed_at is not null, 'feedback', a.feedback, 'correct', a.answer_key,
                              'attempts', (select count(*) from study_activity_attempts t2 where t2.enrollment_id = e.id and t2.activity_id = a.id))
                         from study_activity_attempts t where t.enrollment_id = e.id and t.activity_id = a.id
                         order by t.submitted_at desc limit 1)
            ) order by a.sort_order), '[]'::jsonb)
           from study_activities a where a.section_id = s.id)
      ) order by s.sort_order), '[]'::jsonb)
      from study_sections s
      left join study_section_progress sp on sp.section_id = s.id and sp.enrollment_id = e.id
      where s.chapter_id = ch.id),
    'missing', public.study_chapter_missing(e.id, ch.id),
    'progress', public.study_progress_summary(e.id)
  );
end $$;

create or replace function public.study_open_section(p_section uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s study_sections; e study_enrollments;
begin
  select * into s from study_sections where id = p_section;
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  e := public.study_enrollment_for_chapter(s.chapter_id);
  if e.id is null then return jsonb_build_object('ok', false, 'error', 'not_enrolled'); end if;
  insert into study_section_progress (enrollment_id, section_id) values (e.id, s.id)
  on conflict do nothing;
  insert into study_chapter_progress (enrollment_id, chapter_id) values (e.id, s.chapter_id)
  on conflict (enrollment_id, chapter_id) do update set last_opened_at = now();
  perform public.study_touch(e.id);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.study_ack_section(p_section uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s study_sections; e study_enrollments; v_ack timestamptz;
begin
  select * into s from study_sections where id = p_section;
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  e := public.study_enrollment_for_chapter(s.chapter_id);
  if e.id is null then return jsonb_build_object('ok', false, 'error', 'not_enrolled'); end if;
  update study_section_progress set acknowledged_at = coalesce(acknowledged_at, now())
   where enrollment_id = e.id and section_id = s.id
  returning acknowledged_at into v_ack;
  if v_ack is null then return jsonb_build_object('ok', false, 'error', 'section_not_opened'); end if;
  perform public.study_touch(e.id);
  return jsonb_build_object('ok', true, 'acknowledged_at', v_ack,
                            'missing', public.study_chapter_missing(e.id, s.chapter_id));
end $$;

create or replace function public.study_submit_activity(p_activity uuid, p_response jsonb, p_client_attempt uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a study_activities; e study_enrollments; v_ok boolean; t study_activity_attempts;
begin
  select * into a from study_activities where id = p_activity;
  if a.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  e := public.study_enrollment_for_chapter(a.chapter_id);
  if e.id is null then return jsonb_build_object('ok', false, 'error', 'not_enrolled'); end if;
  if p_client_attempt is null or p_response is null or length(p_response::text) > 6000 then
    return jsonb_build_object('ok', false, 'error', 'invalid_response');
  end if;
  -- The learner must have opened the section that holds the activity.
  if not exists (select 1 from study_section_progress where enrollment_id = e.id and section_id = a.section_id) then
    return jsonb_build_object('ok', false, 'error', 'section_not_opened');
  end if;

  -- Replays of the same submission return the original result.
  select * into t from study_activity_attempts where enrollment_id = e.id and client_attempt_id = p_client_attempt;
  if t.id is null then
    v_ok := public.study_grade(a.kind, a.answer_key, p_response);
    if v_ok is null then return jsonb_build_object('ok', false, 'error', 'invalid_response'); end if;
    insert into study_activity_attempts (enrollment_id, activity_id, client_attempt_id, response, is_correct)
    values (e.id, a.id, p_client_attempt, p_response, v_ok)
    on conflict (enrollment_id, client_attempt_id) do nothing
    returning * into t;
    if t.id is null then
      select * into t from study_activity_attempts where enrollment_id = e.id and client_attempt_id = p_client_attempt;
    end if;
    perform public.study_touch(e.id);
  elsif t.activity_id <> a.id then
    return jsonb_build_object('ok', false, 'error', 'invalid_response');
  end if;

  return jsonb_build_object('ok', true, 'attempt_id', t.id, 'is_correct', t.is_correct,
    'feedback', a.feedback,
    'correct', a.answer_key,
    'attempts', (select count(*) from study_activity_attempts where enrollment_id = e.id and activity_id = a.id));
end $$;

create or replace function public.study_ack_feedback(p_attempt uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t study_activity_attempts; e study_enrollments; v_chapter uuid;
begin
  select * into t from study_activity_attempts where id = p_attempt;
  if t.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  select chapter_id into v_chapter from study_activities where id = t.activity_id;
  e := public.study_enrollment_for_chapter(v_chapter);
  if e.id is null or e.id <> t.enrollment_id then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  update study_activity_attempts set feedback_viewed_at = coalesce(feedback_viewed_at, now()) where id = t.id;
  return jsonb_build_object('ok', true, 'missing', public.study_chapter_missing(e.id, v_chapter));
end $$;

create or replace function public.study_finish_chapter(p_chapter uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e study_enrollments; ch study_chapters; v_missing jsonb; v_summary jsonb;
  v_required int; v_done int; v_completion study_course_completions; v_name text;
  v_newly boolean := false;
begin
  e := public.study_enrollment_for_chapter(p_chapter);
  if e.id is null then return jsonb_build_object('ok', false, 'error', 'not_enrolled'); end if;
  -- Serialise every finish for this learner: parallel tabs and replays queue here.
  perform 1 from study_enrollments where id = e.id for update;
  select * into ch from study_chapters where id = p_chapter;

  v_missing := public.study_chapter_missing(e.id, ch.id);
  if not (v_missing ->> 'has_content')::boolean then
    return jsonb_build_object('ok', false, 'error', 'chapter_in_preparation', 'missing', v_missing);
  end if;
  if jsonb_array_length(v_missing -> 'sections') > 0 or jsonb_array_length(v_missing -> 'activities') > 0 then
    return jsonb_build_object('ok', false, 'error', 'requirements_incomplete', 'missing', v_missing);
  end if;

  update study_chapter_progress set status = 'completed', completed_at = now()
   where enrollment_id = e.id and chapter_id = ch.id and status <> 'completed';
  v_newly := found;
  if v_newly then
    perform public.write_audit('study_chapter_completed', 'study_enrollment', e.id::text,
                               jsonb_build_object('chapter', ch.code));
  end if;
  perform public.study_touch(e.id);

  -- Course completion from canonical rows: every required chapter of the pinned version.
  select count(*) into v_required from study_chapters where version_id = e.version_id and is_required;
  select count(*) into v_done from study_chapters c
    join study_chapter_progress p on p.chapter_id = c.id and p.enrollment_id = e.id and p.status = 'completed'
   where c.version_id = e.version_id and c.is_required;

  if v_required > 0 and v_done = v_required then
    select coalesce(nullif(full_name, ''), username) into v_name from profiles where id = e.user_id;
    insert into study_course_completions (enrollment_id, user_id, course_id, version_id, learner_name, course_title,
                                          version_label, chapters_completed, record_code)
    select e.id, e.user_id, e.course_id, e.version_id, v_name, c.title, v.version, v_done,
           'IPL-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))
      from study_courses c join study_course_versions v on v.id = e.version_id where c.id = e.course_id
    on conflict (enrollment_id) do nothing
    returning * into v_completion;
    if v_completion.id is not null then
      update study_enrollments set completed_at = v_completion.completed_at where id = e.id;
      perform public.write_audit('study_course_completed', 'study_enrollment', e.id::text,
                                 jsonb_build_object('record', v_completion.record_code, 'chapters', v_done));
    end if;
  end if;

  v_summary := public.study_progress_summary(e.id);
  return jsonb_build_object('ok', true, 'chapter_newly_completed', v_newly,
    'course_completed', exists (select 1 from study_course_completions where enrollment_id = e.id),
    'progress', v_summary);
end $$;

create or replace function public.study_save_resume(p_chapter uuid, p_section uuid, p_client_ts bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e study_enrollments;
begin
  e := public.study_enrollment_for_chapter(p_chapter);
  if e.id is null then return jsonb_build_object('ok', false, 'error', 'not_enrolled'); end if;
  if p_section is not null and not exists (select 1 from study_sections where id = p_section and chapter_id = p_chapter) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  insert into study_resume (enrollment_id, chapter_id, section_id, client_ts) values (e.id, p_chapter, p_section, p_client_ts)
  on conflict (enrollment_id) do update
     set chapter_id = excluded.chapter_id, section_id = excluded.section_id,
         client_ts = excluded.client_ts, updated_at = now()
   where study_resume.client_ts <= excluded.client_ts;
  return jsonb_build_object('ok', true, 'applied', found);
end $$;

create or replace function public.study_set_bookmark(p_section uuid, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s study_sections; e study_enrollments;
begin
  select * into s from study_sections where id = p_section;
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  e := public.study_enrollment_for_chapter(s.chapter_id);
  if e.id is null then return jsonb_build_object('ok', false, 'error', 'not_enrolled'); end if;
  if p_on then
    insert into study_bookmarks (enrollment_id, section_id) values (e.id, s.id) on conflict do nothing;
  else
    delete from study_bookmarks where enrollment_id = e.id and section_id = s.id;
  end if;
  return jsonb_build_object('ok', true, 'bookmarked', p_on);
end $$;

create or replace function public.study_save_note(p_chapter uuid, p_body text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e study_enrollments;
begin
  e := public.study_enrollment_for_chapter(p_chapter);
  if e.id is null then return jsonb_build_object('ok', false, 'error', 'not_enrolled'); end if;
  if length(coalesce(p_body, '')) > 10000 then return jsonb_build_object('ok', false, 'error', 'too_long'); end if;
  if coalesce(btrim(p_body), '') = '' then
    delete from study_notes where enrollment_id = e.id and chapter_id = p_chapter;
  else
    insert into study_notes (enrollment_id, chapter_id, body) values (e.id, p_chapter, p_body)
    on conflict (enrollment_id, chapter_id) do update set body = excluded.body, updated_at = now();
  end if;
  return jsonb_build_object('ok', true, 'saved_at', now());
end $$;

-- Optional active-time estimate. Never a completion gate; capped per call.
create or replace function public.study_record_time(p_chapter uuid, p_seconds int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e study_enrollments;
begin
  e := public.study_enrollment_for_chapter(p_chapter);
  if e.id is null then return jsonb_build_object('ok', false, 'error', 'not_enrolled'); end if;
  update study_chapter_progress set active_seconds = active_seconds + greatest(0, least(coalesce(p_seconds, 0), 120))
   where enrollment_id = e.id and chapter_id = p_chapter;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.get_study_completion(p_course_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_build_object('ok', true, 'learner_name', k.learner_name, 'course_title', k.course_title,
             'product', c.product, 'version', k.version_label, 'completed_at', k.completed_at,
             'record_code', k.record_code, 'chapters_completed', k.chapters_completed)
      from study_course_completions k join study_courses c on c.id = k.course_id
     where c.code = upper(p_course_code) and k.user_id = auth.uid() and public.is_active_user()),
    jsonb_build_object('ok', false, 'error', 'not_completed'));
$$;

create or replace function public.study_self_enroll(p_course_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c study_courses; v study_course_versions; v_id uuid;
begin
  if not public.is_active_user() then return jsonb_build_object('ok', false, 'error', 'not_signed_in'); end if;
  select * into c from study_courses where code = upper(p_course_code);
  if c.id is null or c.enrollment_policy <> 'self' then return jsonb_build_object('ok', false, 'error', 'enrollment_closed'); end if;
  select * into v from study_course_versions where course_id = c.id and is_enrollment_default and status = 'published';
  if v.id is null then return jsonb_build_object('ok', false, 'error', 'enrollment_closed'); end if;
  insert into study_enrollments (user_id, course_id, version_id, enrolled_by) values (auth.uid(), c.id, v.id, auth.uid())
  on conflict (user_id, course_id) do nothing returning id into v_id;
  if v_id is not null then
    perform public.write_audit('study_self_enroll', 'study_enrollment', v_id::text, jsonb_build_object('version', v.version));
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- =====================================================================
-- Admin RPCs
-- =====================================================================

-- Load or update a course version from a structured package (manifest + chapter content).
-- Structure keys are stable codes, so ids — and learner progress — survive re-imports.
-- On a version that already has enrollments only non-material edits are accepted:
-- the set of chapters, required sections and required activities must not change.
create or replace function public.admin_study_import(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c study_courses; v study_course_versions; d jsonb; ch jsonb; s jsonb; a jsonb;
  v_domain uuid; v_chapter uuid; v_section uuid; v_before text; v_after text; v_has_learners boolean;
  v_counts jsonb;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;

  insert into study_courses (code, title, product, description)
  values (upper(p #>> '{course,code}'), p #>> '{course,title}', coalesce(p #>> '{course,product}', 'iParkar Learning'), p #>> '{course,description}')
  on conflict (code) do update set title = excluded.title, product = excluded.product,
                                   description = coalesce(excluded.description, study_courses.description)
  returning * into c;

  insert into study_course_versions (course_id, version, source_title, source_edition, stated_blueprint, notes)
  values (c.id, p #>> '{course,version}', p #>> '{source,title}', p #>> '{source,edition}', p #>> '{source,stated_blueprint}', p #>> '{source,blueprint_note}')
  on conflict (course_id, version) do update set source_title = excluded.source_title, source_edition = excluded.source_edition,
     stated_blueprint = excluded.stated_blueprint, notes = excluded.notes
  returning * into v;
  if v.status = 'archived' then return jsonb_build_object('ok', false, 'error', 'version_archived'); end if;

  v_has_learners := exists (select 1 from study_enrollments where version_id = v.id);
  select string_agg(x, '|' order by x) into v_before from (
    select 'c:' || ch2.code || ':' || ch2.is_required from study_chapters ch2 where ch2.version_id = v.id
    union all select 's:' || ch2.code || '/' || s2.code from study_sections s2 join study_chapters ch2 on ch2.id = s2.chapter_id where s2.version_id = v.id and s2.is_required
    union all select 'a:' || ch2.code || '/' || a2.code from study_activities a2 join study_chapters ch2 on ch2.id = a2.chapter_id where a2.version_id = v.id and a2.is_required) z(x);

  for d in select * from jsonb_array_elements(p -> 'domains') loop
    insert into study_domains (version_id, number, title, weight, intro)
    values (v.id, (d ->> 'domain')::int, d ->> 'title', (d ->> 'weight')::numeric, d ->> 'intro')
    on conflict (version_id, number) do update set title = excluded.title, weight = excluded.weight,
       intro = coalesce(excluded.intro, study_domains.intro);
  end loop;

  for ch in select * from jsonb_array_elements(p -> 'chapters') loop
    select id into v_domain from study_domains where version_id = v.id and number = (ch ->> 'domain')::int;
    if v_domain is null then raise exception 'chapter % names unknown domain', ch ->> 'id'; end if;
    insert into study_chapters (version_id, domain_id, code, sort_order, title, objectives, is_prerequisite,
                                is_required, source_pages, est_minutes, review_status, meta)
    values (v.id, v_domain, ch ->> 'id', (ch ->> 'sort_order')::int, ch ->> 'title',
            coalesce((select array_agg(x) from jsonb_array_elements_text(ch -> 'objectives') x), '{}'),
            coalesce((ch ->> 'prerequisite')::boolean, false), coalesce((ch ->> 'required')::boolean, true),
            (select array_agg(x::int) from jsonb_array_elements_text(ch -> 'pages') x),
            (ch ->> 'est_minutes')::int, coalesce((ch ->> 'review_status')::study_content_status, 'draft'),
            coalesce(ch -> 'meta', '{}'::jsonb))
    on conflict (version_id, code) do update set domain_id = excluded.domain_id, sort_order = excluded.sort_order,
       title = excluded.title, objectives = excluded.objectives, is_prerequisite = excluded.is_prerequisite,
       is_required = excluded.is_required, source_pages = excluded.source_pages, est_minutes = excluded.est_minutes,
       review_status = excluded.review_status, meta = excluded.meta
    returning id into v_chapter;

    if ch ? 'sections' then
      -- Sections and activities absent from the package are removed (only allowed pre-learners; checked below).
      delete from study_sections where chapter_id = v_chapter
        and code not in (select x ->> 'code' from jsonb_array_elements(ch -> 'sections') x);
      for s in select * from jsonb_array_elements(ch -> 'sections') loop
        insert into study_sections (version_id, chapter_id, code, sort_order, title, est_minutes, is_required, blocks)
        values (v.id, v_chapter, s ->> 'code', (s ->> 'sort_order')::int, s ->> 'title', (s ->> 'est_minutes')::int,
                coalesce((s ->> 'required')::boolean, true), coalesce(s -> 'blocks', '[]'::jsonb))
        on conflict (chapter_id, code) do update set sort_order = excluded.sort_order, title = excluded.title,
           est_minutes = excluded.est_minutes, is_required = excluded.is_required, blocks = excluded.blocks
        returning id into v_section;
        delete from study_activities where section_id = v_section
          and code not in (select x ->> 'code' from jsonb_array_elements(coalesce(s -> 'activities', '[]'::jsonb)) x);
        for a in select * from jsonb_array_elements(coalesce(s -> 'activities', '[]'::jsonb)) loop
          if public.study_grade((a ->> 'kind')::study_activity_kind, a -> 'answer_key', a -> 'sample_response') is not true then
            raise exception 'activity %/% fails its own sample_response check', ch ->> 'id', a ->> 'code';
          end if;
          insert into study_activities (version_id, chapter_id, section_id, code, sort_order, kind, is_required, spec, answer_key, feedback)
          values (v.id, v_chapter, v_section, a ->> 'code', coalesce((a ->> 'sort_order')::int, 0), (a ->> 'kind')::study_activity_kind,
                  coalesce((a ->> 'required')::boolean, true), a -> 'spec', a -> 'answer_key', coalesce(a -> 'feedback', '{}'::jsonb))
          on conflict (chapter_id, code) do update set section_id = excluded.section_id, sort_order = excluded.sort_order,
             kind = excluded.kind, is_required = excluded.is_required, spec = excluded.spec,
             answer_key = excluded.answer_key, feedback = excluded.feedback;
        end loop;
      end loop;
    end if;
  end loop;

  select string_agg(x, '|' order by x) into v_after from (
    select 'c:' || ch2.code || ':' || ch2.is_required from study_chapters ch2 where ch2.version_id = v.id
    union all select 's:' || ch2.code || '/' || s2.code from study_sections s2 join study_chapters ch2 on ch2.id = s2.chapter_id where s2.version_id = v.id and s2.is_required
    union all select 'a:' || ch2.code || '/' || a2.code from study_activities a2 join study_chapters ch2 on ch2.id = a2.chapter_id where a2.version_id = v.id and a2.is_required) z(x);

  if v_has_learners and v_before is distinct from v_after then
    raise exception 'material change to version % which has enrolled learners: create a new version instead', v.version
      using errcode = 'P0001';
  end if;

  v_counts := jsonb_build_object(
    'domains', (select count(*) from study_domains where version_id = v.id),
    'chapters', (select count(*) from study_chapters where version_id = v.id),
    'chapters_with_content', (select count(distinct chapter_id) from study_sections where version_id = v.id),
    'sections', (select count(*) from study_sections where version_id = v.id),
    'activities', (select count(*) from study_activities where version_id = v.id));
  perform public.write_audit('study_import', 'study_course_version', v.id::text,
                             jsonb_build_object('version', v.version, 'structure_changed', v_before is distinct from v_after) || v_counts);
  return jsonb_build_object('ok', true, 'version_id', v.id, 'counts', v_counts);
end $$;

create or replace function public.admin_study_set_version_status(p_version uuid, p_status text, p_default boolean default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v study_course_versions; v_problems text[] := '{}';
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  select * into v from study_course_versions where id = p_version for update;
  if v.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if p_status = 'published' then
    -- Publication never promotes incomplete content.
    select coalesce(array_agg(ch.code || ': ' || case when not exists (select 1 from study_sections s where s.chapter_id = ch.id and s.is_required)
                                                      then 'no lesson content' else 'review status ' || ch.review_status end order by ch.sort_order), '{}')
      into v_problems
      from study_chapters ch where ch.version_id = v.id and ch.is_required
       and (ch.review_status not in ('approved', 'published')
            or not exists (select 1 from study_sections s where s.chapter_id = ch.id and s.is_required));
    if array_length(v_problems, 1) > 0 then
      return jsonb_build_object('ok', false, 'error', 'not_ready', 'problems', to_jsonb(v_problems[1:50]),
                                'problem_count', array_length(v_problems, 1));
    end if;
  end if;
  update study_course_versions set status = p_status::study_content_status,
         published_at = case when p_status = 'published' then coalesce(published_at, now()) else published_at end
   where id = v.id;
  if p_default is not null then
    if p_default then update study_course_versions set is_enrollment_default = false where course_id = v.course_id and id <> v.id; end if;
    update study_course_versions set is_enrollment_default = p_default where id = v.id;
  end if;
  perform public.write_audit('study_version_status', 'study_course_version', v.id::text,
                             jsonb_build_object('from', v.status, 'to', p_status, 'default', p_default));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_study_enroll(p_user uuid, p_version uuid, p_pilot boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v study_course_versions; v_id uuid;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  select * into v from study_course_versions where id = p_version;
  if v.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if v.status <> 'published' and not p_pilot then
    return jsonb_build_object('ok', false, 'error', 'version_not_published');
  end if;
  insert into study_enrollments (user_id, course_id, version_id, is_pilot, enrolled_by)
  values (p_user, v.course_id, v.id, v.status <> 'published', auth.uid())
  on conflict (user_id, course_id) do update set status = 'active', revoked_at = null
     where study_enrollments.version_id = excluded.version_id
  returning id into v_id;
  if v_id is null then return jsonb_build_object('ok', false, 'error', 'enrolled_in_other_version'); end if;
  perform public.write_audit('study_enroll', 'study_enrollment', v_id::text,
                             jsonb_build_object('user', p_user, 'version', v.version, 'pilot', v.status <> 'published'));
  return jsonb_build_object('ok', true, 'enrollment_id', v_id);
end $$;

create or replace function public.admin_study_revoke(p_enrollment uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if coalesce(btrim(p_reason), '') = '' then return jsonb_build_object('ok', false, 'error', 'reason_required'); end if;
  update study_enrollments set status = 'revoked', revoked_at = now() where id = p_enrollment;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  perform public.write_audit('study_revoke', 'study_enrollment', p_enrollment::text, jsonb_build_object('reason', p_reason));
  return jsonb_build_object('ok', true);
end $$;

-- Deliberate, audited reset of one chapter's progress. Completion records are kept as history.
create or replace function public.admin_study_reset_chapter(p_enrollment uuid, p_chapter_code text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e study_enrollments; v_chapter uuid;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if coalesce(btrim(p_reason), '') = '' then return jsonb_build_object('ok', false, 'error', 'reason_required'); end if;
  select * into e from study_enrollments where id = p_enrollment for update;
  select id into v_chapter from study_chapters where version_id = e.version_id and code = p_chapter_code;
  if v_chapter is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  delete from study_chapter_progress where enrollment_id = e.id and chapter_id = v_chapter;
  delete from study_section_progress where enrollment_id = e.id
    and section_id in (select id from study_sections where chapter_id = v_chapter);
  update study_activity_attempts set feedback_viewed_at = null where enrollment_id = e.id
    and activity_id in (select id from study_activities where chapter_id = v_chapter);
  perform public.write_audit('study_reset_chapter', 'study_enrollment', e.id::text,
                             jsonb_build_object('chapter', p_chapter_code, 'reason', p_reason));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_study_overview() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not public.is_admin() then jsonb_build_object('ok', false, 'error', 'forbidden') else
    jsonb_build_object('ok', true, 'versions', coalesce((select jsonb_agg(jsonb_build_object(
      'id', v.id, 'course', c.code, 'title', c.title, 'version', v.version, 'status', v.status,
      'is_default', v.is_enrollment_default, 'enrollment_policy', c.enrollment_policy,
      'chapters', (select count(*) from study_chapters where version_id = v.id),
      'chapters_with_content', (select count(distinct chapter_id) from study_sections where version_id = v.id),
      'by_review', (select coalesce(jsonb_object_agg(review_status, n), '{}'::jsonb) from
                     (select review_status, count(*) n from study_chapters where version_id = v.id group by 1) r),
      'enrollments', (select count(*) from study_enrollments where version_id = v.id and status = 'active'),
      'completions', (select count(*) from study_course_completions where version_id = v.id),
      'learners', (select coalesce(jsonb_agg(jsonb_build_object('enrollment_id', e.id, 'username', pr.username,
                     'name', pr.full_name, 'pilot', e.is_pilot, 'last_activity_at', e.last_activity_at,
                     'completed_at', e.completed_at,
                     'chapters_completed', (select count(*) from study_chapter_progress cp where cp.enrollment_id = e.id and cp.status = 'completed'))
                     order by e.last_activity_at desc nulls last), '[]'::jsonb)
                   from study_enrollments e join profiles pr on pr.id = e.user_id
                   where e.version_id = v.id and e.status = 'active')
    ) order by c.code, v.created_at desc) from study_course_versions v join study_courses c on c.id = v.course_id), '[]'::jsonb))
  end;
$$;

-- =====================================================================
-- RLS and grants: nothing is readable or writable directly by learners.
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array['study_courses','study_course_versions','study_domains','study_chapters','study_sections',
                           'study_activities','study_enrollments','study_section_progress','study_chapter_progress',
                           'study_activity_attempts','study_resume','study_bookmarks','study_notes','study_course_completions']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Admin read access for the admin screens (writes still go through RPCs).
grant select on public.study_courses, public.study_course_versions, public.study_enrollments,
                public.study_course_completions to authenticated;
drop policy if exists study_courses_admin on public.study_courses;
create policy study_courses_admin on public.study_courses for select to authenticated using (public.is_admin());
drop policy if exists study_versions_admin on public.study_course_versions;
create policy study_versions_admin on public.study_course_versions for select to authenticated using (public.is_admin());
drop policy if exists study_enrollments_admin on public.study_enrollments;
create policy study_enrollments_admin on public.study_enrollments for select to authenticated using (public.is_admin());
drop policy if exists study_completions_admin on public.study_course_completions;
create policy study_completions_admin on public.study_course_completions for select to authenticated using (public.is_admin());

do $$
declare f text;
begin
  foreach f in array array[
    'study_my_enrollment(text)', 'study_enrollment_for_chapter(uuid)', 'study_touch(uuid)',
    'study_chapter_missing(uuid,uuid)', 'study_progress_summary(uuid)',
    'study_grade(public.study_activity_kind,jsonb,jsonb)',
    'get_my_study_courses()', 'get_study_course(text)', 'get_study_chapter(text,text)', 'study_open_section(uuid)',
    'study_ack_section(uuid)', 'study_submit_activity(uuid,jsonb,uuid)', 'study_ack_feedback(uuid)',
    'study_finish_chapter(uuid)', 'study_save_resume(uuid,uuid,bigint)', 'study_set_bookmark(uuid,boolean)',
    'study_save_note(uuid,text)', 'study_record_time(uuid,int)', 'get_study_completion(text)', 'study_self_enroll(text)',
    'admin_study_import(jsonb)', 'admin_study_set_version_status(uuid,text,boolean)', 'admin_study_enroll(uuid,uuid,boolean)',
    'admin_study_revoke(uuid,text)', 'admin_study_reset_chapter(uuid,text,text)', 'admin_study_overview()']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
  end loop;
end $$;

-- Internal helpers stay internal.
revoke all on function public.study_my_enrollment(text), public.study_enrollment_for_chapter(uuid), public.study_touch(uuid),
  public.study_chapter_missing(uuid, uuid), public.study_progress_summary(uuid) from authenticated;

grant execute on function
  public.get_my_study_courses(), public.get_study_course(text), public.get_study_chapter(text, text),
  public.study_open_section(uuid), public.study_ack_section(uuid), public.study_submit_activity(uuid, jsonb, uuid),
  public.study_ack_feedback(uuid), public.study_finish_chapter(uuid), public.study_save_resume(uuid, uuid, bigint),
  public.study_set_bookmark(uuid, boolean), public.study_save_note(uuid, text), public.study_record_time(uuid, int),
  public.get_study_completion(text), public.study_self_enroll(text),
  public.admin_study_import(jsonb), public.admin_study_set_version_status(uuid, text, boolean),
  public.admin_study_enroll(uuid, uuid, boolean), public.admin_study_revoke(uuid, text),
  public.admin_study_reset_chapter(uuid, text, text), public.admin_study_overview()
to authenticated;
