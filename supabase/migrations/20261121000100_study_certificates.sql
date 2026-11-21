-- =====================================================================
-- Certificates of course completion for self-paced study courses.
--
-- * A course opts in through study_certificate_programs (PMP-SPS is seeded here).
-- * Eligibility is never taken from the client: a certificate can only be claimed by
--   the signed-in owner of an ACTIVE enrollment that already has a course completion
--   record (study_course_completions, written by study_finish_chapter from canonical
--   chapter rows). The completion row fixes the completion time and course version, so
--   later curriculum versions never invalidate an issued certificate.
-- * Issuance is a two-step claim / finalize so that the PDF is stored before success is
--   reported, retries are safe and duplicate clicks or concurrent requests never issue
--   twice:
--     1. study_claim_certificate (learner, via the session) locks the enrollment, creates or
--        reuses ONE certificate row per completion with a stable certificate code, and hands
--        out a short-lived claim token. A concurrent request gets 'in_progress'.
--     2. The server renders the PDF, stores it privately in R2 and calls
--        service_finalize_study_certificate (service role only) with the claim token. Only then
--        is the certificate 'issued'. On failure, service_release_study_certificate_claim frees
--        the claim so the learner can retry at once; the certificate code never changes.
-- * The name on an issued certificate, its PDF key and checksum are immutable. Renaming the
--   account profile has no effect on an issued certificate.
-- * Downloads: study_certificate_file returns the storage key only to the certificate owner
--   (or an admin); the route streams the stored PDF, never a re-render.
-- =====================================================================

create table if not exists public.study_certificate_programs (
  course_code     text primary key check (course_code ~ '^[A-Z]{2,8}(-[A-Z]{2,8})?$'),
  is_enabled      boolean not null default true,
  template        text not null,                          -- renderer template id
  certificate_title text not null,                        -- course title printed on the certificate
  short_title     text not null,                          -- left-panel course label
  hours           numeric(5,2) not null check (hours > 0),
  categories      jsonb not null default '{}'::jsonb check (jsonb_typeof(categories) = 'object'),
  wording         text not null default 'hours' check (wording in ('hours', 'pdu')),
  issuer          text not null default 'iParkar Learning',
  signatory_name  text not null,
  signatory_title text not null,
  updated_at      timestamptz not null default now()
);

create table if not exists public.study_certificates (
  id               uuid primary key default gen_random_uuid(),
  certificate_code text not null unique check (certificate_code ~ '^IPL-[A-Z]{2,8}-[0-9A-Z]{4}-[0-9A-Z]{4}$'),
  completion_id    uuid not null unique references public.study_course_completions (id) on delete restrict,
  enrollment_id    uuid not null references public.study_enrollments (id) on delete restrict,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  course_code      text not null,
  status           text not null default 'pending' check (status in ('pending', 'issued')),
  name_on_certificate text not null check (char_length(name_on_certificate) between 2 and 70),
  -- Snapshot printed on the PDF (from the completion record and the programme at issue time).
  certificate_title text not null,
  short_title      text not null,
  version_label    text not null,
  completed_at     timestamptz not null,
  hours            numeric(5,2) not null,
  categories       jsonb not null,
  wording          text not null,
  template         text not null,
  -- Claim (in-flight render) and stored file.
  claim_token      uuid,
  claimed_at       timestamptz,
  attempts         int not null default 0,
  issued_at        timestamptz,
  storage_key      text,
  file_sha256      text check (file_sha256 is null or file_sha256 ~ '^[0-9a-f]{64}$'),
  file_bytes       int check (file_bytes is null or file_bytes > 0),
  created_at       timestamptz not null default now(),
  check ((status = 'issued') = (issued_at is not null and storage_key is not null and file_sha256 is not null))
);
create index if not exists study_certificates_user on public.study_certificates (user_id, issued_at desc);

-- Issued certificates are immutable and never deleted (the profile cascade aside).
create or replace function public.study_certificates_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    -- A cascade from deleting the learner's profile (account erasure) runs at trigger depth > 1 and is allowed.
    if old.status = 'issued' and pg_trigger_depth() = 1 then
      raise exception 'issued certificates cannot be deleted';
    end if;
    return old;
  end if;
  if old.status = 'issued' then
    if new.status is distinct from old.status or new.name_on_certificate is distinct from old.name_on_certificate
       or new.certificate_code is distinct from old.certificate_code or new.storage_key is distinct from old.storage_key
       or new.file_sha256 is distinct from old.file_sha256 or new.issued_at is distinct from old.issued_at
       or new.completed_at is distinct from old.completed_at or new.user_id is distinct from old.user_id
       or new.certificate_title is distinct from old.certificate_title or new.hours is distinct from old.hours then
      raise exception 'issued certificates are immutable';
    end if;
  end if;
  if new.certificate_code is distinct from old.certificate_code or new.completion_id is distinct from old.completion_id
     or new.user_id is distinct from old.user_id then
    raise exception 'certificate identity is immutable';
  end if;
  return new;
end $$;
drop trigger if exists study_certificates_guard on public.study_certificates;
create trigger study_certificates_guard before update or delete on public.study_certificates
  for each row execute function public.study_certificates_guard();

-- Learner names: 2–70 characters, letters (any script the font set covers is checked by the app),
-- single spaces, apostrophes, hyphens and full stops. The app normalises to NFC first.
create or replace function public.study_certificate_name_ok(p text) returns boolean
language sql immutable set search_path = public as $$
  select p is not null and p = btrim(p) and char_length(p) between 2 and 70
     and p !~ '\s{2,}' and p !~ '[0-9_@#$%^&*()+=<>{}\[\]|\\/:;"!?,~`]' and p !~ '[[:cntrl:]]'
     and p ~ '^[[:alpha:]]' and (select count(*) from regexp_matches(p, '[[:alpha:]]', 'g')) >= 2;
$$;

create or replace function public.study_certificate_json(c public.study_certificates) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object('certificate_code', c.certificate_code, 'status', c.status,
    'name_on_certificate', c.name_on_certificate, 'course_code', c.course_code, 'certificate_title', c.certificate_title,
    'completed_at', c.completed_at, 'issued_at', c.issued_at, 'hours', c.hours, 'version', c.version_label);
$$;

-- Status for the completion page: is the course complete, is a certificate available, issued or pending.
create or replace function public.study_certificate_status(p_course_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
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
    'completed', k.id is not null,
    'completed_at', k.completed_at,
    'eligible', pr.course_code is not null and e.status = 'active' and k.id is not null,
    'suggested_name', coalesce(c.name_on_certificate, k.learner_name),
    'certificate', case when c.id is null then null else public.study_certificate_json(c) end);
end $$;

-- Step 1 of issuance (learner session). Returns the render payload and a claim token, or the issued certificate.
create or replace function public.study_claim_certificate(p_course_code text, p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
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
  -- Serialise with study_finish_chapter and with parallel claims from other tabs or devices.
  perform 1 from study_enrollments where id = e.id for update;
  select * into k from study_course_completions where enrollment_id = e.id;
  if k.id is null then return jsonb_build_object('ok', false, 'error', 'course_incomplete'); end if;

  select * into c from study_certificates where completion_id = k.id for update;
  if c.status = 'issued' then
    return jsonb_build_object('ok', true, 'state', 'issued', 'certificate', public.study_certificate_json(c));
  end if;
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
    -- Pending (an earlier attempt failed or timed out): same certificate code, the name may still change.
    update study_certificates set name_on_certificate = v_name, claim_token = v_token, claimed_at = now(), attempts = attempts + 1
     where id = c.id returning * into c;
  end if;
  perform public.write_audit('study_certificate_claimed', 'study_certificate', c.certificate_code,
                             jsonb_build_object('attempt', c.attempts));
  return jsonb_build_object('ok', true, 'state', 'claimed', 'claim_token', v_token,
    'certificate', public.study_certificate_json(c) || jsonb_build_object(
      'id', c.id, 'user_id', c.user_id, 'short_title', c.short_title, 'categories', c.categories, 'wording', c.wording,
      'template', c.template, 'issuer', pr.issuer, 'signatory_name', pr.signatory_name, 'signatory_title', pr.signatory_title));
end $$;

-- Step 2 (service role only): the PDF is stored; mark the certificate issued.
create or replace function public.service_finalize_study_certificate(p_certificate uuid, p_claim_token uuid,
  p_storage_key text, p_sha256 text, p_bytes int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c study_certificates;
begin
  select * into c from study_certificates where id = p_certificate for update;
  if c.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if c.status = 'issued' then
    return jsonb_build_object('ok', c.file_sha256 = p_sha256 or c.claim_token is null, 'state', 'issued', 'certificate', public.study_certificate_json(c));
  end if;
  if c.claim_token is distinct from p_claim_token then return jsonb_build_object('ok', false, 'error', 'claim_lost'); end if;
  update study_certificates set status = 'issued', issued_at = now(), storage_key = p_storage_key, file_sha256 = p_sha256,
         file_bytes = p_bytes, claim_token = null
   where id = c.id returning * into c;
  insert into audit_logs (actor_id, action, entity, entity_id, details)
  values (c.user_id, 'study_certificate_issued', 'study_certificate', c.certificate_code,
          jsonb_build_object('bytes', p_bytes, 'sha256', p_sha256, 'course', c.course_code));
  return jsonb_build_object('ok', true, 'state', 'issued', 'certificate', public.study_certificate_json(c));
end $$;

-- Failure path (service role only): free the claim so the learner can retry straight away.
create or replace function public.service_release_study_certificate_claim(p_certificate uuid, p_claim_token uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  update study_certificates set claim_token = null, claimed_at = null
   where id = p_certificate and status = 'pending' and claim_token = p_claim_token;
  return jsonb_build_object('ok', found);
end $$;

-- Download lookup: the owner (or an admin) gets the stored file's key; everyone else gets not_found.
create or replace function public.study_certificate_file(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_build_object('ok', true, 'storage_key', c.storage_key, 'sha256', c.file_sha256, 'bytes', c.file_bytes,
                              'certificate_code', c.certificate_code, 'course_code', c.course_code)
      from study_certificates c
     where c.certificate_code = upper(p_code) and c.status = 'issued'
       and public.is_active_user() and (c.user_id = auth.uid() or public.is_admin())),
    jsonb_build_object('ok', false, 'error', 'not_found'));
$$;

-- The signed-in learner's issued certificates (Certificates area).
create or replace function public.study_my_certificates() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(public.study_certificate_json(c) order by c.issued_at desc), '[]'::jsonb)
    from study_certificates c where c.user_id = auth.uid() and c.status = 'issued' and public.is_active_user();
$$;

-- ---------- seed: PMP® Exam Prep Course ----------
insert into public.study_certificate_programs (course_code, template, certificate_title, short_title, hours, categories, wording,
                                               signatory_name, signatory_title)
values ('PMP-SPS', 'pmp-a4-landscape-v1', 'PMP® Exam Prep Course', 'PMP® Exam Prep Course', 35,
        '{"businessAcumen": 8, "waysOfWorking": 19, "powerSkills": 8}'::jsonb, 'hours',
        'Imran Parkar, PMP, CIT', 'Course instructor, iParkar Learning')
on conflict (course_code) do nothing;

-- ---------- RLS and grants ----------
alter table public.study_certificate_programs enable row level security;
alter table public.study_certificates enable row level security;
revoke all on public.study_certificate_programs, public.study_certificates from anon, authenticated;
grant select on public.study_certificate_programs, public.study_certificates to authenticated;
drop policy if exists study_certificate_programs_admin on public.study_certificate_programs;
create policy study_certificate_programs_admin on public.study_certificate_programs for select to authenticated using (public.is_admin());
drop policy if exists study_certificates_admin on public.study_certificates;
create policy study_certificates_admin on public.study_certificates for select to authenticated using (public.is_admin());

revoke all on function public.study_certificates_guard(), public.study_certificate_name_ok(text),
  public.study_certificate_json(public.study_certificates), public.study_certificate_status(text),
  public.study_claim_certificate(text, text), public.service_finalize_study_certificate(uuid, uuid, text, text, int),
  public.service_release_study_certificate_claim(uuid, uuid), public.study_certificate_file(text),
  public.study_my_certificates() from public, anon, authenticated;
grant execute on function public.study_certificate_status(text), public.study_claim_certificate(text, text),
  public.study_certificate_file(text), public.study_my_certificates() to authenticated;
grant execute on function public.service_finalize_study_certificate(uuid, uuid, text, text, int),
  public.service_release_study_certificate_claim(uuid, uuid) to service_role;
