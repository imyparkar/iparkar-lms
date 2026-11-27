-- =====================================================================
-- Certificates of completion for free SCORM courses (owner request, 27 Nov 2026).
-- First course: Systematic Approach to Training (SAT), 2 contact hours, 0.2 CEU, provider-issued.
--
-- * The same study_certificates table, download route (study_certificate_file), Certificates list
--   (study_my_certificates) and public verification (study_verify_certificate) are used. A SCORM
--   certificate has no study enrollment or completion row; it points at the SCORM course instead
--   (scorm_course_id), one per learner per course.
-- * Eligibility comes from the database only: every module of the course must be 'passed' when the
--   module has a mastery score (the iParkar SAT packages report 'passed' only at 80 % or more in the
--   knowledge checks), or 'passed'/'completed' when it has none. Learners never write scorm_attempts.
-- * Issuance reuses the two-step claim / finalize of study certificates: scorm_claim_certificate
--   (learner session) then service_finalize_study_certificate (service role) once the PDF is stored.
-- * The owner-approved "nordic" design (template nordic-a4-landscape-v1) is also used by the self-paced
--   study courses from now on: PMP-SPS switches to it (35 contact hours with the Talent Triangle split), and
--   ASP-SPS (63 h) and CSP-SPS (50 h) start offering certificates (purchase still required, as for PMP).
--   CEU = hours ÷ 10, provider-issued. Certificates already issued keep their stored PDF.
-- * Additive and re-runnable. Existing certificates are untouched.
-- =====================================================================

-- ---------- certificate rows may come from a SCORM course ----------
alter table public.study_certificates alter column completion_id drop not null;
alter table public.study_certificates alter column enrollment_id drop not null;
alter table public.study_certificates add column if not exists scorm_course_id uuid references public.scorm_courses (id) on delete restrict;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'study_certificates_source_check') then
    alter table public.study_certificates add constraint study_certificates_source_check check (
      (scorm_course_id is null and completion_id is not null and enrollment_id is not null)
      or (scorm_course_id is not null and completion_id is null and enrollment_id is null));
  end if;
end $$;
create unique index if not exists study_certificates_scorm_once
  on public.study_certificates (user_id, scorm_course_id) where scorm_course_id is not null;

-- ---------- programmes: a 'scorm' completion rule, linked to the SCORM course by code ----------
alter table public.study_certificate_programs drop constraint if exists study_certificate_programs_rule_check;
alter table public.study_certificate_programs add constraint study_certificate_programs_rule_check
  check (completion_rule in ('chapters', 'live', 'scorm'));
alter table public.study_certificate_programs add column if not exists scorm_course_code text;

insert into public.study_certificate_programs (course_code, template, certificate_title, short_title, hours, categories, wording,
                                               signatory_name, signatory_title, completion_rule, scorm_course_code)
values ('SAT', 'nordic-a4-landscape-v1', 'Systematic Approach to Training (SAT)', 'Systematic Approach to Training', 2,
        '{}'::jsonb, 'hours', 'Imran Parkar', 'Course director, iParkar Learning', 'scorm', 'sat')
on conflict (course_code) do update set template = excluded.template, certificate_title = excluded.certificate_title,
  short_title = excluded.short_title, hours = excluded.hours, signatory_name = excluded.signatory_name,
  signatory_title = excluded.signatory_title, completion_rule = excluded.completion_rule, scorm_course_code = excluded.scorm_course_code,
  updated_at = now();

-- ---------- self-paced study courses: the same design (owner, 27 Nov 2026) ----------
update public.study_certificate_programs
   set template = 'nordic-a4-landscape-v1', signatory_name = 'Imran Parkar, PMP, CIT',
       signatory_title = 'Course director, iParkar Learning', updated_at = now()
 where course_code = 'PMP-SPS';

insert into public.study_certificate_programs (course_code, template, certificate_title, short_title, hours, categories, wording,
                                               signatory_name, signatory_title, completion_rule)
values ('ASP-SPS', 'nordic-a4-landscape-v1', 'ASP® Exam Prep Course', 'ASP® Exam Prep Course', 63, '{}'::jsonb, 'hours',
        'Imran Parkar, CSP, CIT', 'Course director, iParkar Learning', 'chapters'),
       ('CSP-SPS', 'nordic-a4-landscape-v1', 'CSP® Exam Prep Course', 'CSP® Exam Prep Course', 50, '{}'::jsonb, 'hours',
        'Imran Parkar, CSP, CIT', 'Course director, iParkar Learning', 'chapters')
on conflict (course_code) do update set template = excluded.template, certificate_title = excluded.certificate_title,
  short_title = excluded.short_title, hours = excluded.hours, signatory_name = excluded.signatory_name,
  signatory_title = excluded.signatory_title, updated_at = now();

-- ---------- helpers ----------
-- Has this learner passed every module of the SCORM course? Returns the completion time (latest module) or null.
create or replace function public.scorm_course_completed_at(p_user uuid, p_course uuid) returns timestamptz
language sql stable security definer set search_path = public as $$
  select case
    when count(*) > 0 and count(*) = count(*) filter (
      where a.lesson_status = 'passed' or (m.mastery_score is null and a.lesson_status = 'completed'))
    then max(a.completed_at) end
    from scorm_modules m
    left join scorm_attempts a on a.module_id = m.id and a.user_id = p_user
   where m.course_id = p_course;
$$;

-- Status for the free course page.
create or replace function public.scorm_certificate_status(p_course text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pr study_certificate_programs; sc scorm_courses; c study_certificates; v_done timestamptz; v_name text;
begin
  if not public.is_active_user() then return jsonb_build_object('ok', false, 'error', 'not_signed_in'); end if;
  select * into pr from study_certificate_programs
   where completion_rule = 'scorm' and scorm_course_code = lower(p_course) and is_enabled;
  if pr.course_code is null then return jsonb_build_object('ok', true, 'offered', false); end if;
  select * into sc from scorm_courses where code = pr.scorm_course_code and (status = 'published' or public.is_admin());
  if sc.id is null then return jsonb_build_object('ok', true, 'offered', false); end if;
  v_done := public.scorm_course_completed_at(auth.uid(), sc.id);
  select * into c from study_certificates where user_id = auth.uid() and scorm_course_id = sc.id;
  select nullif(btrim(full_name), '') into v_name from profiles where id = auth.uid();
  return jsonb_build_object('ok', true, 'offered', true, 'course_code', pr.course_code, 'hours', pr.hours,
    'completed', v_done is not null, 'completed_at', v_done, 'eligible', v_done is not null,
    'suggested_name', coalesce(c.name_on_certificate, v_name, ''),
    'certificate', case when c.id is null then null else public.study_certificate_json(c) end);
end $$;

-- Step 1 of issuance (learner session): same contract as study_claim_certificate.
create or replace function public.scorm_claim_certificate(p_course_code text, p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  pr study_certificate_programs; sc scorm_courses; c study_certificates; v_done timestamptz;
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_code text; v_token uuid := gen_random_uuid(); v_try int := 0; v_uid uuid := auth.uid();
begin
  if not public.is_active_user() then return jsonb_build_object('ok', false, 'error', 'not_signed_in'); end if;
  select * into pr from study_certificate_programs
   where course_code = upper(p_course_code) and completion_rule = 'scorm' and is_enabled;
  if pr.course_code is null then return jsonb_build_object('ok', false, 'error', 'not_offered'); end if;
  select * into sc from scorm_courses where code = pr.scorm_course_code and status = 'published';
  if sc.id is null then return jsonb_build_object('ok', false, 'error', 'not_offered'); end if;
  -- Serialise parallel claims from other tabs or devices for this learner.
  perform pg_advisory_xact_lock(hashtextextended('scorm_cert:' || v_uid::text || ':' || sc.id::text, 0));

  select * into c from study_certificates where user_id = v_uid and scorm_course_id = sc.id for update;
  if c.status = 'issued' then
    return jsonb_build_object('ok', true, 'state', 'issued', 'certificate', public.study_certificate_json(c));
  end if;
  v_done := public.scorm_course_completed_at(v_uid, sc.id);
  if v_done is null then return jsonb_build_object('ok', false, 'error', 'course_incomplete'); end if;
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
        insert into study_certificates (certificate_code, scorm_course_id, user_id, course_code, name_on_certificate,
          certificate_title, short_title, version_label, completed_at, hours, categories, wording, template,
          claim_token, claimed_at, attempts)
        values (v_code, sc.id, v_uid, pr.course_code, v_name, pr.certificate_title, pr.short_title, '1',
          v_done, pr.hours, pr.categories, pr.wording, pr.template, v_token, now(), 1)
        returning * into c;
        exit;
      exception when unique_violation then
        if v_try >= 5 then raise; end if;
      end;
    end loop;
  else
    update study_certificates set name_on_certificate = v_name, completed_at = v_done, claim_token = v_token,
           claimed_at = now(), attempts = attempts + 1
     where id = c.id returning * into c;
  end if;
  perform public.write_audit('study_certificate_claimed', 'study_certificate', c.certificate_code,
                             jsonb_build_object('attempt', c.attempts, 'rule', 'scorm'));
  return jsonb_build_object('ok', true, 'state', 'claimed', 'claim_token', v_token,
    'certificate', public.study_certificate_json(c) || jsonb_build_object(
      'id', c.id, 'user_id', c.user_id, 'short_title', c.short_title, 'categories', c.categories, 'wording', c.wording,
      'template', c.template, 'issuer', pr.issuer, 'signatory_name', pr.signatory_name, 'signatory_title', pr.signatory_title,
      'statement', pr.statement));
end $$;

-- Verification: a SCORM certificate stays valid once issued (no purchase or enrolment behind it).
create or replace function public.study_verify_certificate(p_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c study_certificates; pr study_certificate_programs; e study_enrollments; v_valid boolean := true;
begin
  if p_code is null or upper(btrim(p_code)) !~ '^IPL-[A-Z]{2,8}-[0-9A-Z]{4}-[0-9A-Z]{4}$' then
    return jsonb_build_object('ok', true, 'found', false);
  end if;
  select * into c from study_certificates where certificate_code = upper(btrim(p_code)) and status = 'issued';
  if c.id is null then return jsonb_build_object('ok', true, 'found', false); end if;
  select * into pr from study_certificate_programs where course_code = c.course_code;
  if c.scorm_course_id is not null then v_valid := true;
  else
    select * into e from study_enrollments where id = c.enrollment_id;
    if pr.completion_rule = 'live' then v_valid := public.live_certificate_allowed(e);
    else v_valid := e.id is not null and e.status <> 'revoked';
    end if;
  end if;
  return jsonb_build_object('ok', true, 'found', true, 'valid', v_valid,
    'certificate_code', c.certificate_code, 'name', c.name_on_certificate, 'course_title', c.certificate_title,
    'hours', c.hours, 'issued_on', to_char(c.issued_at at time zone 'UTC', 'YYYY-MM-DD'),
    'completed_on', to_char(c.completed_at at time zone 'UTC', 'YYYY-MM-DD'),
    'issuer', coalesce(pr.issuer, 'iParkar Learning'));
end $$;

-- ---------- grants ----------
revoke all on function public.scorm_course_completed_at(uuid, uuid), public.scorm_certificate_status(text),
  public.scorm_claim_certificate(text, text), public.study_verify_certificate(text) from public, anon, authenticated;
grant execute on function public.scorm_certificate_status(text), public.scorm_claim_certificate(text, text) to authenticated;
grant execute on function public.study_verify_certificate(text) to anon, authenticated;
