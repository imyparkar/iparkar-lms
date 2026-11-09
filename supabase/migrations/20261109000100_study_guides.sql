-- Study guides: private PDF storage, served only to signed-in users.
-- The app's download route verifies the session, logs the download with the
-- service role, then redirects to a short-lived signed URL. No storage policies
-- are created, so anon/authenticated clients cannot list or read the bucket.

-- Guarded so local/test databases without the Supabase storage schema still migrate.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('study-guides', 'study-guides', false, 52428800, array['application/pdf'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
  end if;
end $$;

create table if not exists public.study_guide_downloads (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  guide text not null,
  downloaded_at timestamptz not null default now()
);
create index if not exists study_guide_downloads_guide_idx on public.study_guide_downloads (guide, downloaded_at desc);
create index if not exists study_guide_downloads_user_idx on public.study_guide_downloads (user_id);

alter table public.study_guide_downloads enable row level security;
revoke all on public.study_guide_downloads from anon, authenticated;

-- Admins can read the log (inserts happen only via the service role).
drop policy if exists "admins read study guide downloads" on public.study_guide_downloads;
create policy "admins read study guide downloads" on public.study_guide_downloads
  for select to authenticated using (public.is_admin());
grant select on public.study_guide_downloads to authenticated;
