-- Certificates of course completion are issued only to learners who have bought the course (owner, 22 Nov 2026).
-- A learner on the free trial (or on a pilot/reviewer enrollment) can finish the course and keep the completion
-- record, but study_claim_certificate refuses with 'purchase_required' until access_source is 'purchase'
-- (a verified Razorpay payment, set by service_apply_study_purchase) or 'admin' (access granted by an admin, e.g.
-- after a manual payment). Certificates already issued are unaffected. The check runs in the database with the
-- learner's own session, so it applies to the UI and to direct requests alike.

create or replace function public.study_enrollment_paid(e public.study_enrollments) returns boolean
language sql immutable as $$
  select e.id is not null and not coalesce(e.is_pilot, false) and e.access_source in ('purchase', 'admin');
$$;

create or replace function public.study_certificate_status(p_course_code text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  e study_enrollments; k study_course_completions; pr study_certificate_programs; c study_certificates;
begin
  if not public.is_active_user() then return jsonb_build_object('ok', false, 'error', 'not_signed_in'); end if;
  select * into pr from study_certificate_programs where course_code = upper(p_course_code) and is_enabled;
  select en.* into e from study_enrollments en join study_courses co on co.id = en.course_id
   where co.code = upper(p_course_code) and en.user_id = auth.uid();
  if e.id is not null then select * into k from study_course_completions where enrollment_id = e.id; end if;
  if k.id is not null then select * into c from study_certificates where completion_id = k.id; end if;
  return jsonb_build_object('ok', true,
    'offered', pr.course_code is not null,
    'enrolled', e.id is not null and e.status = 'active',
    'paid', public.study_enrollment_paid(e),
    'completed', k.id is not null,
    'completed_at', k.completed_at,
    'eligible', pr.course_code is not null and e.status = 'active' and k.id is not null and public.study_enrollment_paid(e),
    'suggested_name', coalesce(c.name_on_certificate, k.learner_name),
    'certificate', case when c.id is null then null else public.study_certificate_json(c) end);
end $function$;

create or replace function public.study_claim_certificate(p_course_code text, p_name text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  e study_enrollments; k study_course_completions; pr study_certificate_programs; c study_certificates;
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_code text; v_token uuid := gen_random_uuid(); v_try int := 0;
begin
  if not public.is_active_user() then return jsonb_build_object('ok', false, 'error', 'not_signed_in'); end if;
  select * into pr from study_certificate_programs where course_code = upper(p_course_code) and is_enabled;
  if pr.course_code is null then return jsonb_build_object('ok', false, 'error', 'not_offered'); end if;
  select en.* into e from study_enrollments en join study_courses co on co.id = en.course_id
   where co.code = pr.course_code and en.user_id = auth.uid();
  if e.id is null or e.status <> 'active' then return jsonb_build_object('ok', false, 'error', 'not_enrolled'); end if;
  perform 1 from study_enrollments where id = e.id for update;
  select * into e from study_enrollments where id = e.id;
  select * into k from study_course_completions where enrollment_id = e.id;
  if k.id is null then return jsonb_build_object('ok', false, 'error', 'course_incomplete'); end if;

  select * into c from study_certificates where completion_id = k.id for update;
  if c.status = 'issued' then
    return jsonb_build_object('ok', true, 'state', 'issued', 'certificate', public.study_certificate_json(c));
  end if;
  -- New in this migration: no certificate on free (trial) or pilot access.
  if not public.study_enrollment_paid(e) then return jsonb_build_object('ok', false, 'error', 'purchase_required'); end if;
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
                             jsonb_build_object('attempt', c.attempts));
  return jsonb_build_object('ok', true, 'state', 'claimed', 'claim_token', v_token,
    'certificate', public.study_certificate_json(c) || jsonb_build_object(
      'id', c.id, 'user_id', c.user_id, 'short_title', c.short_title, 'categories', c.categories, 'wording', c.wording,
      'template', c.template, 'issuer', pr.issuer, 'signatory_name', pr.signatory_name, 'signatory_title', pr.signatory_title));
end $function$;

-- PMP® Exam Prep Course: 3-day free trial (owner, 22 Nov 2026). ASP-SPS and CSP-SPS keep 7 days.
update public.study_courses set trial_days = 3 where code = 'PMP-SPS';

revoke all on function public.study_enrollment_paid(public.study_enrollments) from public, anon;
