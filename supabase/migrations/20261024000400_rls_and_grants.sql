-- =====================================================================
-- iParkar LMS — 0004 Row Level Security and execute grants
-- Principle: students never read the question bank, keys or snapshots
-- directly. They get question content only through RPCs that check
-- ownership of an attempt. All writes go through RPCs.
-- =====================================================================

alter table public.profiles             enable row level security;
alter table public.courses              enable row level security;
alter table public.course_domains       enable row level security;
alter table public.course_tasks         enable row level security;
alter table public.blueprints           enable row level security;
alter table public.blueprint_domains    enable row level security;
alter table public.blueprint_tasks      enable row level security;
alter table public.exams                enable row level security;
alter table public.questions            enable row level security;
alter table public.question_options     enable row level security;
alter table public.question_keys        enable row level security;
alter table public.question_versions    enable row level security;
alter table public.exam_attempts        enable row level security;
alter table public.attempt_questions    enable row level security;
alter table public.attempt_answers      enable row level security;
alter table public.domain_performance   enable row level security;
alter table public.task_performance     enable row level security;
alter table public.course_products      enable row level security;
alter table public.payments             enable row level security;
alter table public.course_entitlements  enable row level security;
alter table public.app_settings         enable row level security;
alter table public.audit_logs           enable row level security;
alter table public.rate_limits          enable row level security;

-- Table privileges: read-only for signed-in users; nothing for anon.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant select on public.profiles, public.courses, public.course_domains, public.course_tasks,
                public.blueprints, public.blueprint_domains, public.blueprint_tasks, public.exams,
                public.questions, public.question_options, public.question_keys, public.question_versions,
                public.exam_attempts, public.attempt_questions, public.attempt_answers,
                public.domain_performance, public.task_performance, public.course_products,
                public.payments, public.course_entitlements, public.app_settings, public.audit_logs
  to authenticated;

-- profiles
create policy profiles_self_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());

-- catalogue metadata (no question content)
create policy courses_read on public.courses for select to authenticated
  using (is_visible or public.is_admin());
create policy course_domains_read on public.course_domains for select to authenticated using (true);
create policy course_tasks_read on public.course_tasks for select to authenticated using (true);
create policy blueprints_read on public.blueprints for select to authenticated using (true);
create policy blueprint_domains_read on public.blueprint_domains for select to authenticated using (true);
create policy blueprint_tasks_read on public.blueprint_tasks for select to authenticated using (true);
create policy exams_read on public.exams for select to authenticated using (true);
create policy course_products_read on public.course_products for select to authenticated using (true);
create policy app_settings_read on public.app_settings for select to authenticated using (true);

-- question bank: admins only
create policy questions_admin on public.questions for select to authenticated using (public.is_admin());
create policy question_options_admin on public.question_options for select to authenticated using (public.is_admin());
create policy question_keys_admin on public.question_keys for select to authenticated using (public.is_admin());
create policy question_versions_admin on public.question_versions for select to authenticated using (public.is_admin());

-- attempts: own rows (attempt_questions exposes ids only, never content)
create policy exam_attempts_own on public.exam_attempts for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy attempt_questions_own on public.attempt_questions for select to authenticated
  using (public.is_admin() or exists (select 1 from public.exam_attempts a where a.id = attempt_id and a.user_id = auth.uid()));
create policy attempt_answers_own on public.attempt_answers for select to authenticated
  using (public.is_admin() or exists (select 1 from public.exam_attempts a where a.id = attempt_id and a.user_id = auth.uid()));
create policy domain_performance_own on public.domain_performance for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy task_performance_own on public.task_performance for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- commerce
create policy payments_own on public.payments for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy entitlements_own on public.course_entitlements for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- audit: admins only
create policy audit_admin on public.audit_logs for select to authenticated using (public.is_admin());

-- ---------- function execute grants ----------
-- Supabase grants EXECUTE to anon/authenticated by default; lock everything
-- down, then open only the student and admin RPCs (admin RPCs self-check).
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function
  public.is_admin(),
  public.is_active_user(),
  public.has_course_access(uuid),
  public.start_attempt(uuid, uuid, public.exam_mode, uuid),
  public.get_attempt(uuid),
  public.get_attempt_clock(uuid),
  public.save_answer(uuid, uuid, uuid, bigint),
  public.set_flag(uuid, uuid, boolean),
  public.submit_attempt(uuid),
  public.get_attempt_result(uuid),
  public.get_my_courses(),
  public.get_course_analytics(uuid, uuid),
  public.get_recent_activity(int),
  public.admin_upsert_question(jsonb),
  public.admin_import_questions(text, jsonb, text, boolean),
  public.admin_set_question_status(uuid[], text),
  public.admin_create_blueprint_version(uuid, text, text, text, date, jsonb, text),
  public.admin_set_current_blueprint(uuid),
  public.admin_update_blueprint_meta(uuid, text, date, text),
  public.admin_update_blueprint_weights(uuid, jsonb),
  public.admin_grant_entitlement(uuid, uuid, text, timestamptz, text),
  public.admin_revoke_entitlement(uuid, text),
  public.admin_set_user_status(uuid, text, text),
  public.admin_finalize_attempt(uuid),
  public.admin_course_overview(),
  public.allocate_question_counts(uuid, int)
to authenticated;

-- service-role-only helpers (webhooks, login resolution, cron)
grant execute on function
  public.resolve_login_email(text),
  public.hit_rate_limit(text, int, int),
  public.service_apply_purchase(uuid, uuid, int, uuid, text, text),
  public.service_revoke_for_payment(uuid, uuid, text),
  public.finalize_expired_attempts()
to service_role;

grant usage on schema public to anon, authenticated, service_role;
