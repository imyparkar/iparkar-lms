-- =====================================================================
-- Admin: grant or extend study-course (My learning) access from
-- Students & access, whether or not the learner has enrolled before.
--
-- * No enrollment yet: enrolls the learner on the course's published
--   default version.
-- * Existing enrollment (trial ended, purchase lapsed, revoked): reactivates
--   it on its own version, so progress, notes and bookmarks are kept.
-- * p_days > 0 → access until now() + p_days; p_days = 0 → no time limit.
--
-- Additive and re-runnable.
-- =====================================================================

create or replace function public.admin_study_grant_access(p_user uuid, p_course_code text, p_days int, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c study_courses; v study_course_versions; e study_enrollments; v_until timestamptz;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if p_days is null or p_days < 0 or p_days > 3650 then return jsonb_build_object('ok', false, 'error', 'bad_days'); end if;
  select * into c from study_courses where code = upper(p_course_code);
  if c.id is null then return jsonb_build_object('ok', false, 'error', 'course_not_found'); end if;
  if not exists (select 1 from profiles where id = p_user) then return jsonb_build_object('ok', false, 'error', 'user_not_found'); end if;

  v_until := case when p_days = 0 then null else now() + make_interval(days => p_days) end;

  select * into e from study_enrollments where user_id = p_user and course_id = c.id for update;
  if e.id is null then
    select * into v from study_course_versions where course_id = c.id and is_enrollment_default and status = 'published';
    if v.id is null then return jsonb_build_object('ok', false, 'error', 'no_published_version'); end if;
    insert into study_enrollments (user_id, course_id, version_id, enrolled_by, access_source, access_expires_at)
    values (p_user, c.id, v.id, auth.uid(), 'admin', v_until)
    returning * into e;
  else
    update study_enrollments
       set status = 'active', revoked_at = null, access_source = 'admin', access_expires_at = v_until
     where id = e.id
    returning * into e;
  end if;

  perform public.write_audit('study_grant_access', 'study_enrollment', e.id::text,
    jsonb_build_object('user', p_user, 'course', c.code, 'days', p_days, 'until', v_until, 'note', nullif(btrim(p_note), '')));
  return jsonb_build_object('ok', true, 'enrollment_id', e.id, 'access_until', v_until);
end $$;

revoke all on function public.admin_study_grant_access(uuid, text, int, text) from public, anon;
grant execute on function public.admin_study_grant_access(uuid, text, int, text) to authenticated;
