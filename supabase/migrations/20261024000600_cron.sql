-- =====================================================================
-- iParkar LMS — 0006 scheduled finalization of expired attempts
-- Requires the pg_cron extension (Supabase: Database → Extensions → pg_cron).
-- Expired attempts are also finalized lazily whenever they are read,
-- so the app stays correct even if this job is not installed.
-- =====================================================================
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('iparkar-finalize-expired-attempts', '* * * * *',
                          'select public.finalize_expired_attempts();');
  else
    raise notice 'pg_cron not available; relying on lazy finalization.';
  end if;
end $$;
