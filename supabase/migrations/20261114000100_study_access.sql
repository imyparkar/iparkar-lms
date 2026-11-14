-- =====================================================================
-- Study course access: free trial, paid access period, protected assets,
-- and per-domain reference resources (formula sheets).
--
-- * A study course can offer a free trial to every signed-in learner
--   (study_courses.trial_days). Starting it creates a self enrollment whose
--   access_expires_at = start + trial_days. One trial per learner per course,
--   ever: the enrollment row is unique per (user, course) and is never reset.
-- * A verified payment for a study product (study_products, a separate
--   catalogue from the practice-exam course_products) extends access by
--   access_days. Refunds remove the days that payment granted.
-- * access_expires_at null = no time limit (admin and pilot enrollments).
-- * When access has lapsed, progress, notes and the completion record are
--   kept and the overview stays visible; chapter content, activities,
--   resources and drawings are refused until access is renewed.
--
-- Additive and re-runnable.
-- =====================================================================

alter table public.study_courses
  add column if not exists trial_days   int check (trial_days is null or trial_days between 1 and 90),
  add column if not exists access_days  int check (access_days is null or access_days between 1 and 3650),
  add column if not exists price_label  text;

alter table public.study_enrollments
  add column if not exists access_expires_at timestamptz,
  add column if not exists access_source     text not null default 'admin',
  add column if not exists trial_started_at  timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'study_enrollments_access_source_check') then
    alter table public.study_enrollments add constraint study_enrollments_access_source_check
      check (access_source in ('admin', 'pilot', 'self', 'trial', 'purchase'));
  end if;
end $$;
update public.study_enrollments set access_source = 'pilot' where is_pilot and access_source = 'admin';

-- Study-course products: Paddle price → study course. Kept apart from course_products
-- (practice-exam packages) so buying one never grants the other.
create table if not exists public.study_products (
  id                 uuid primary key default gen_random_uuid(),
  course_id          uuid not null references public.study_courses (id) on delete restrict,
  provider           text not null default 'paddle',
  provider_price_id  text not null,
  access_days        int not null check (access_days between 1 and 3650),
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  unique (provider, provider_price_id)
);

create table if not exists public.study_purchases (
  id             uuid primary key default gen_random_uuid(),
  payment_id     uuid unique references public.payments (id) on delete set null,
  enrollment_id  uuid not null references public.study_enrollments (id) on delete cascade,
  days           int not null,
  access_from    timestamptz not null,
  access_until   timestamptz,
  revoked_at     timestamptz,
  revoked_reason text,
  created_at     timestamptz not null default now()
);

alter table public.payments add column if not exists study_course_id uuid references public.study_courses (id) on delete set null;

-- Reference resources per course version (per-domain formula sheets).
create table if not exists public.study_resources (
  id             uuid primary key default gen_random_uuid(),
  version_id     uuid not null references public.study_course_versions (id) on delete cascade,
  code           text not null check (code ~ '^[a-z0-9-]{1,40}$'),
  kind           text not null check (kind in ('formula_sheet')),
  domain_number  int,
  title          text not null,
  source_pages   int[],
  blocks         jsonb not null default '[]'::jsonb,
  review_status  text not null default 'draft',
  updated_at     timestamptz not null default now(),
  unique (version_id, code)
);


-- =====================================================================
-- Helpers
-- =====================================================================

create or replace function public.study_has_access(e public.study_enrollments) returns boolean
language sql stable set search_path = public as $$
  select e.id is not null and e.status = 'active' and (e.access_expires_at is null or e.access_expires_at > now());
$$;

create or replace function public.study_access_json(e public.study_enrollments) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'has_access', public.study_has_access(e),
    'source', e.access_source,
    'expires_at', e.access_expires_at,
    'trial_started_at', e.trial_started_at,
    'days_left', case when e.access_expires_at is null then null
                      else greatest(0, ceil(extract(epoch from (e.access_expires_at - now())) / 86400))::int end,
    'trial_days', c.trial_days, 'access_days', c.access_days, 'price_label', c.price_label)
  from study_courses c where c.id = e.course_id;
$$;

-- Every content-bearing learner write goes through this helper; lapsed access
-- now returns no enrollment, so nothing can be studied, answered or completed.
create or replace function public.study_enrollment_for_chapter(p_chapter uuid) returns public.study_enrollments
language sql stable security definer set search_path = public as $$
  select e.* from study_enrollments e
  join study_chapters ch on ch.version_id = e.version_id
  where ch.id = p_chapter and e.user_id = auth.uid() and e.status = 'active' and public.is_active_user()
    and (e.access_expires_at is null or e.access_expires_at > now());
$$;


-- =====================================================================
-- Learner reads: wrap the existing payloads with access information
-- =====================================================================

do $$
begin
  if to_regprocedure('public.study_course_payload(text)') is null then
    alter function public.get_study_course(text) rename to study_course_payload;
  end if;
  if to_regprocedure('public.study_chapter_payload(text,text)') is null then
    alter function public.get_study_chapter(text, text) rename to study_chapter_payload;
  end if;
end $$;
revoke all on function public.study_course_payload(text), public.study_chapter_payload(text, text) from public, anon, authenticated;

create or replace function public.study_offer_json(p_course_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('code', c.code, 'title', c.title, 'description', c.description,
           'self_enroll', c.enrollment_policy = 'self' and v.id is not null,
           'trial_days', c.trial_days, 'access_days', c.access_days, 'price_label', c.price_label)
  from study_courses c
  left join study_course_versions v on v.course_id = c.id and v.is_enrollment_default and v.status = 'published'
  where c.code = upper(p_course_code);
$$;

create or replace function public.get_study_course(p_course_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  e study_enrollments;
  r jsonb;
begin
  e := public.study_my_enrollment(p_course_code);
  if e.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_enrolled', 'offer', public.study_offer_json(p_course_code));
  end if;
  r := public.study_course_payload(p_course_code);
  return r || jsonb_build_object(
    'access', public.study_access_json(e),
    'resources', (select coalesce(jsonb_agg(jsonb_build_object('code', x.code, 'kind', x.kind, 'domain', x.domain_number,
                                    'title', x.title) order by x.domain_number, x.code), '[]'::jsonb)
                    from study_resources x where x.version_id = e.version_id));
end $$;

create or replace function public.get_study_chapter(p_course_code text, p_chapter_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e study_enrollments;
begin
  e := public.study_my_enrollment(p_course_code);
  if e.id is null then return jsonb_build_object('ok', false, 'error', 'not_enrolled', 'offer', public.study_offer_json(p_course_code)); end if;
  if not public.study_has_access(e) then
    return jsonb_build_object('ok', false, 'error', 'access_expired', 'access', public.study_access_json(e),
                              'progress', public.study_progress_summary(e.id));
  end if;
  return public.study_chapter_payload(p_course_code, p_chapter_code) || jsonb_build_object('access', public.study_access_json(e));
end $$;

create or replace function public.get_my_study_courses() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'code', c.code, 'title', c.title, 'version', v.version, 'version_status', v.status,
      'is_pilot', e.is_pilot, 'enrolled_at', e.enrolled_at, 'last_activity_at', e.last_activity_at,
      'completed_at', e.completed_at,
      'access', public.study_access_json(e),
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

-- Self-enrol courses the learner has not started yet (shown on My learning).
create or replace function public.get_study_offers() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(public.study_offer_json(c.code) order by c.code), '[]'::jsonb)
  from study_courses c
  where public.is_active_user() and c.enrollment_policy = 'self'
    and exists (select 1 from study_course_versions v where v.course_id = c.id and v.is_enrollment_default and v.status = 'published')
    and not exists (select 1 from study_enrollments e where e.course_id = c.id and e.user_id = auth.uid());
$$;

-- Starting a self-enrol course starts its free trial (or unlimited access when the
-- course has no trial configured). Never restarts: one enrollment per learner per course.
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
  insert into study_enrollments (user_id, course_id, version_id, enrolled_by, access_source, access_expires_at, trial_started_at)
  values (auth.uid(), c.id, v.id, auth.uid(),
          case when c.trial_days is null then 'self' else 'trial' end,
          case when c.trial_days is null then null else now() + make_interval(days => c.trial_days) end,
          case when c.trial_days is null then null else now() end)
  on conflict (user_id, course_id) do nothing returning id into v_id;
  if v_id is not null then
    perform public.write_audit('study_self_enroll', 'study_enrollment', v_id::text,
                               jsonb_build_object('version', v.version, 'trial_days', c.trial_days));
  end if;
  return jsonb_build_object('ok', true, 'started', v_id is not null);
end $$;

-- Reference resource (formula sheet) for an enrolled learner with current access.
create or replace function public.get_study_resource(p_course_code text, p_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  e study_enrollments; x study_resources;
begin
  e := public.study_my_enrollment(p_course_code);
  if e.id is null then return jsonb_build_object('ok', false, 'error', 'not_enrolled', 'offer', public.study_offer_json(p_course_code)); end if;
  if not public.study_has_access(e) then return jsonb_build_object('ok', false, 'error', 'access_expired', 'access', public.study_access_json(e)); end if;
  select * into x from study_resources where version_id = e.version_id and code = p_code;
  if x.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  return jsonb_build_object('ok', true,
    'course', (select jsonb_build_object('code', c.code, 'title', c.title, 'version', v.version)
                 from study_courses c join study_course_versions v on v.id = e.version_id where c.id = e.course_id),
    'domain', (select jsonb_build_object('number', d.number, 'title', d.title) from study_domains d
                where d.version_id = e.version_id and d.number = x.domain_number),
    'resource', jsonb_build_object('code', x.code, 'kind', x.kind, 'domain', x.domain_number, 'title', x.title,
                                   'source_pages', x.source_pages, 'blocks', x.blocks, 'review_status', x.review_status),
    'access', public.study_access_json(e));
end $$;

-- Protected drawings: keys are "<course-slug>/<file>". Viewable by administrators
-- (preview) and by learners with current access to that course.
create or replace function public.study_can_view_asset(p_key text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_active_user() and p_key ~ '^[a-z0-9-]+/[A-Za-z0-9._-]+\.(webp|png)$' and (
    public.is_admin() or exists (
      select 1 from study_enrollments e join study_courses c on c.id = e.course_id
       where c.code = upper(split_part(p_key, '/', 1)) and e.user_id = auth.uid()
         and e.status = 'active' and (e.access_expires_at is null or e.access_expires_at > now())));
$$;


-- =====================================================================
-- Service role: verified payments → study access
-- =====================================================================

create or replace function public.service_apply_study_purchase(p_user uuid, p_course uuid, p_days int, p_payment uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  e study_enrollments; v study_course_versions; v_from timestamptz; v_until timestamptz;
begin
  if p_days is null or p_days < 1 then return jsonb_build_object('ok', false, 'error', 'bad_days'); end if;
  if p_payment is not null and exists (select 1 from study_purchases where payment_id = p_payment) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  select * into e from study_enrollments where user_id = p_user and course_id = p_course for update;
  if e.id is null then
    select * into v from study_course_versions where course_id = p_course and is_enrollment_default and status = 'published';
    if v.id is null then return jsonb_build_object('ok', false, 'error', 'no_published_version'); end if;
    insert into study_enrollments (user_id, course_id, version_id, enrolled_by, access_source, access_expires_at)
    values (p_user, p_course, v.id, null, 'purchase', now() + make_interval(days => p_days))
    on conflict (user_id, course_id) do nothing;
    select * into e from study_enrollments where user_id = p_user and course_id = p_course for update;
    v_from := now(); v_until := e.access_expires_at;
  elsif e.access_expires_at is null and e.status = 'active' then
    -- already unlimited (administrator or pilot access): record the purchase, change nothing
    v_from := now(); v_until := null;
  else
    -- a renewal extends unexpired paid time; a trial is replaced, not added to
    v_from := case when e.access_source = 'purchase' and e.status = 'active' and e.access_expires_at > now()
                   then e.access_expires_at else now() end;
    v_until := v_from + make_interval(days => p_days);
    update study_enrollments set status = 'active', revoked_at = null, access_source = 'purchase', access_expires_at = v_until
     where id = e.id;
  end if;

  insert into study_purchases (payment_id, enrollment_id, days, access_from, access_until)
  values (p_payment, e.id, p_days, v_from, v_until);
  insert into audit_logs (actor_id, action, entity, entity_id, details)
  values (null, 'study_access.purchase', 'study_enrollment', e.id::text,
          jsonb_build_object('user_id', p_user, 'course_id', p_course, 'payment_id', p_payment, 'days', p_days, 'until', v_until));
  return jsonb_build_object('ok', true, 'enrollment_id', e.id, 'access_until', v_until);
end $$;

-- Refund: take back the days this payment granted (never below now). Progress is kept.
create or replace function public.service_revoke_study_purchase(p_payment uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  p study_purchases;
begin
  select * into p from study_purchases where payment_id = p_payment and revoked_at is null for update;
  if p.id is null then return jsonb_build_object('ok', true, 'note', 'nothing to revoke'); end if;
  update study_purchases set revoked_at = now(), revoked_reason = p_reason where id = p.id;
  if p.access_until is not null then
    update study_enrollments
       set access_expires_at = greatest(now(), access_expires_at - make_interval(days => p.days))
     where id = p.enrollment_id and access_source = 'purchase' and access_expires_at is not null;
  end if;
  insert into audit_logs (actor_id, action, entity, entity_id, details)
  values (null, 'study_access.revoked_by_payment', 'study_enrollment', p.enrollment_id::text,
          jsonb_build_object('payment_id', p_payment, 'days', p.days, 'reason', p_reason));
  return jsonb_build_object('ok', true);
end $$;


-- =====================================================================
-- Admin
-- =====================================================================

create or replace function public.admin_study_set_course_access(p_course_code text, p_policy text, p_trial_days int,
                                                                p_access_days int, p_price_label text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c study_courses;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  update study_courses set enrollment_policy = p_policy, trial_days = p_trial_days, access_days = p_access_days,
                           price_label = nullif(btrim(p_price_label), '')
   where code = upper(p_course_code) returning * into c;
  if c.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  perform public.write_audit('study_course_access', 'study_course', c.id::text,
    jsonb_build_object('policy', p_policy, 'trial_days', p_trial_days, 'access_days', p_access_days, 'price', p_price_label));
  return jsonb_build_object('ok', true);
end $$;

-- Grant, extend or end a learner's access by hand (null = no time limit).
create or replace function public.admin_study_set_access(p_enrollment uuid, p_expires_at timestamptz, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if coalesce(btrim(p_reason), '') = '' then return jsonb_build_object('ok', false, 'error', 'reason_required'); end if;
  update study_enrollments set access_expires_at = p_expires_at, access_source = 'admin' where id = p_enrollment;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  perform public.write_audit('study_set_access', 'study_enrollment', p_enrollment::text,
                             jsonb_build_object('expires_at', p_expires_at, 'reason', p_reason));
  return jsonb_build_object('ok', true);
end $$;

-- Load per-domain resources for a version: {course, version, resources:[{code, kind, domain, title, pages, blocks}]}.
create or replace function public.admin_study_import_resources(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v study_course_versions; r jsonb; n int := 0;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  select v2.* into v from study_course_versions v2 join study_courses c on c.id = v2.course_id
   where c.code = upper(p ->> 'course') and v2.version = p ->> 'version';
  if v.id is null then return jsonb_build_object('ok', false, 'error', 'version_not_found'); end if;
  for r in select * from jsonb_array_elements(coalesce(p -> 'resources', '[]'::jsonb)) loop
    insert into study_resources (version_id, code, kind, domain_number, title, source_pages, blocks, review_status)
    values (v.id, r ->> 'code', r ->> 'kind', (r ->> 'domain')::int, r ->> 'title',
            (select array_agg(x::int) from jsonb_array_elements_text(coalesce(r -> 'pages', '[]'::jsonb)) x),
            coalesce(r -> 'blocks', '[]'::jsonb), coalesce(r ->> 'review_status', 'draft'))
    on conflict (version_id, code) do update
       set kind = excluded.kind, domain_number = excluded.domain_number, title = excluded.title,
           source_pages = excluded.source_pages, blocks = excluded.blocks, review_status = excluded.review_status,
           updated_at = now();
    n := n + 1;
  end loop;
  perform public.write_audit('study_import_resources', 'study_course_version', v.id::text, jsonb_build_object('count', n));
  return jsonb_build_object('ok', true, 'resources', n);
end $$;


-- =====================================================================
-- RLS and grants
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array['study_products', 'study_purchases', 'study_resources'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
grant select on public.study_products, public.study_purchases to authenticated;
drop policy if exists study_products_admin on public.study_products;
create policy study_products_admin on public.study_products for select to authenticated using (public.is_admin());
drop policy if exists study_purchases_admin on public.study_purchases;
create policy study_purchases_admin on public.study_purchases for select to authenticated using (public.is_admin());

revoke all on function public.study_has_access(public.study_enrollments), public.study_access_json(public.study_enrollments),
  public.study_offer_json(text), public.service_apply_study_purchase(uuid, uuid, int, uuid),
  public.service_revoke_study_purchase(uuid, text) from public, anon, authenticated;
revoke all on function public.get_study_course(text), public.get_study_chapter(text, text), public.get_my_study_courses(),
  public.get_study_offers(), public.study_self_enroll(text), public.get_study_resource(text, text),
  public.study_can_view_asset(text), public.admin_study_set_course_access(text, text, int, int, text),
  public.admin_study_set_access(uuid, timestamptz, text), public.admin_study_import_resources(jsonb),
  public.study_enrollment_for_chapter(uuid) from public, anon;
revoke all on function public.study_enrollment_for_chapter(uuid) from authenticated;

grant execute on function
  public.get_study_course(text), public.get_study_chapter(text, text), public.get_my_study_courses(),
  public.get_study_offers(), public.study_self_enroll(text), public.get_study_resource(text, text),
  public.study_can_view_asset(text), public.admin_study_set_course_access(text, text, int, int, text),
  public.admin_study_set_access(uuid, timestamptz, text), public.admin_study_import_resources(jsonb)
to authenticated;
grant execute on function public.service_apply_study_purchase(uuid, uuid, int, uuid),
  public.service_revoke_study_purchase(uuid, text) to service_role;
