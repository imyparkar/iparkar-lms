-- Live courses: the certificate no longer requires a verified payment (owner decision, 25 Nov 2026).
-- Access to a live course is only granted by a purchase or by an administrator, and there is no trial,
-- so the certificate rule becomes: an active, non-pilot enrolment that has not lost its payment
-- (refund in full or in part, open or lost dispute, revoked purchase), plus activities complete and exam passed.

create or replace function public.live_certificate_allowed(e public.study_enrollments) returns boolean
language sql stable security definer set search_path = public as $$
  select e.id is not null and e.status = 'active' and not coalesce(e.is_pilot, false)
     and coalesce(e.access_source, '') <> 'pilot'
     and (public.live_purchase_verified(e)
          or not exists (select 1 from study_purchases sp where sp.enrollment_id = e.id));
$$;
revoke all on function public.live_certificate_allowed(public.study_enrollments) from public, anon, authenticated;

create or replace function public.live_ensure_completion(e public.study_enrollments) returns public.study_course_completions
language plpgsql security definer set search_path = public as $$
declare k study_course_completions; v_name text; v_at timestamptz;
begin
  select * into k from study_course_completions where enrollment_id = e.id;
  if k.id is not null then return k; end if;
  if not (public.live_certificate_allowed(e) and public.live_activities_complete(e) and public.live_exam_passed(e)) then return k; end if;
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
  v_paid := case when v_live then public.live_certificate_allowed(e) else public.study_enrollment_paid(e) end;
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
    -- Eligibility, activities and exam re-checked on every request (including for a certificate already issued).
    if not public.live_certificate_allowed(e) then return jsonb_build_object('ok', false, 'error', 'purchase_required'); end if;
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
                                                'purchase', case when v_live then public.live_purchase_verified(e) end));
  return jsonb_build_object('ok', true, 'state', 'claimed', 'claim_token', v_token,
    'certificate', public.study_certificate_json(c) || jsonb_build_object(
      'id', c.id, 'user_id', c.user_id, 'short_title', c.short_title, 'categories', c.categories, 'wording', c.wording,
      'template', c.template, 'issuer', pr.issuer, 'signatory_name', pr.signatory_name, 'signatory_title', pr.signatory_title,
      'statement', pr.statement));
end $function$;

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
    if not public.live_certificate_allowed(e) then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  end if;
  return jsonb_build_object('ok', true, 'storage_key', c.storage_key, 'sha256', c.file_sha256, 'bytes', c.file_bytes,
                            'certificate_code', c.certificate_code, 'course_code', c.course_code);
end $$;

-- Learner dashboard: the certificate's first condition is now course access, not a separate payment check.
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
      'eligible', pr.course_code is not null and public.live_certificate_allowed(e) and v_done and v_exam,
      'conditions', jsonb_build_object('purchase', public.live_certificate_allowed(e), 'activities', v_done, 'exam', v_exam),
      'issued', case when cert.id is null then null else public.study_certificate_json(cert) end,
      'suggested_name', coalesce(cert.name_on_certificate, (select coalesce(nullif(full_name, ''), username) from profiles where id = e.user_id)))
  );
end $$;

-- Course description: state the scope of the equipment work (owner decision, 25 Nov 2026).
update public.study_courses
   set description = 'A foundation course in anticipating, recognising, evaluating and controlling workplace health hazards, taught in twelve live instructor-led online sessions on Microsoft Teams, with practical assignments, independent study and an internal course examination. Sampling and measuring equipment is shown in live demonstrations: the course builds understanding of how it is used and does not certify hands-on competence. Independent course by iParkar Learning, aligned to a published foundation syllabus in occupational hygiene.'
 where code = 'OHBP';
