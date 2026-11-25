-- Public certificate verification (owner request, 25 Nov 2026).
-- Anyone holding a certificate number (printed on the PDF and in its QR code) can confirm that iParkar Learning
-- issued it. Only what is printed on the certificate is returned; nothing about the learner's account.
-- A live-course certificate whose eligibility was withdrawn (refund, chargeback, pilot) reports as no longer valid.

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
  select * into e from study_enrollments where id = c.enrollment_id;
  if pr.completion_rule = 'live' then v_valid := public.live_certificate_allowed(e);
  else v_valid := e.id is not null and e.status <> 'revoked';
  end if;
  return jsonb_build_object('ok', true, 'found', true, 'valid', v_valid,
    'certificate_code', c.certificate_code, 'name', c.name_on_certificate, 'course_title', c.certificate_title,
    'hours', c.hours, 'issued_on', to_char(c.issued_at at time zone 'UTC', 'YYYY-MM-DD'),
    'completed_on', to_char(c.completed_at at time zone 'UTC', 'YYYY-MM-DD'),
    'issuer', coalesce(pr.issuer, 'iParkar Learning'));
end $$;
revoke all on function public.study_verify_certificate(text) from public;
grant execute on function public.study_verify_certificate(text) to anon, authenticated;
