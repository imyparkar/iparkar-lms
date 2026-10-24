-- =====================================================================
-- iParkar LMS — 0007 admin user search (joins auth.users for email)
-- =====================================================================
create or replace function public.admin_search_users(p_query text default '', p_limit int default 50)
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;
  return jsonb_build_object('ok', true, 'users', coalesce((
    select jsonb_agg(u order by u ->> 'created_at' desc) from (
      select jsonb_build_object(
        'id', p.id, 'username', p.username, 'full_name', p.full_name, 'email', au.email,
        'role', p.role, 'status', p.status, 'created_at', p.created_at,
        'entitlements', coalesce((select jsonb_agg(jsonb_build_object(
            'id', e.id, 'course_code', c.code, 'source', e.source, 'starts_at', e.starts_at,
            'expires_at', e.expires_at, 'revoked_at', e.revoked_at,
            'active', e.revoked_at is null and e.starts_at <= now() and (e.expires_at is null or e.expires_at > now()))
            order by e.created_at desc)
          from course_entitlements e join courses c on c.id = e.course_id where e.user_id = p.id), '[]'::jsonb),
        'attempts', (select count(*) from exam_attempts x where x.user_id = p.id)) u
      from profiles p join auth.users au on au.id = p.id
      where coalesce(p_query, '') = ''
         or p.username ilike '%' || p_query || '%'
         or p.full_name ilike '%' || p_query || '%'
         or au.email ilike '%' || p_query || '%'
      order by p.created_at desc
      limit least(greatest(p_limit, 1), 200)) s), '[]'::jsonb));
end $$;

revoke execute on function public.admin_search_users(text, int) from public, anon;
grant execute on function public.admin_search_users(text, int) to authenticated;
