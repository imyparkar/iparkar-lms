-- =====================================================================
-- iParkar LMS — 0001 schema
-- Courses, blueprints (versioned), question bank, attempts, entitlements,
-- payments and audit. Course isolation is enforced with composite foreign
-- keys: every row that names a question/domain/attempt also names its
-- course, and the FK pairs (id, course_id) must match.
-- =====================================================================

-- ---------- enums ----------
create type public.app_role         as enum ('student', 'admin');
create type public.account_status   as enum ('active', 'suspended');
create type public.question_status  as enum ('draft', 'in_review', 'published', 'archived');
create type public.exam_mode        as enum ('mixed', 'domain');
create type public.attempt_status   as enum ('in_progress', 'submitted', 'expired');
create type public.feedback_policy  as enum ('immediate', 'after_submit', 'delayed', 'restricted');
create type public.entitlement_source as enum ('purchase', 'subscription', 'complimentary', 'admin_grant');
create type public.verification_status as enum ('unverified', 'verified');

-- ---------- helpers ----------
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------- profiles ----------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  username    text not null check (username ~ '^[A-Za-z0-9._-]{3,32}$'),
  full_name   text check (full_name is null or length(full_name) <= 120),
  role        public.app_role not null default 'student',
  status      public.account_status not null default 'active',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index profiles_username_lower_key on public.profiles (lower(username));
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------- courses ----------
create table public.courses (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique check (code ~ '^[A-Z]{2,8}$'),
  name           text not null,
  description    text,
  is_visible     boolean not null default true,   -- shown on dashboards
  exams_enabled  boolean not null default false,  -- admin approval gate for exams
  sort_order     int not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger courses_touch before update on public.courses
  for each row execute function public.touch_updated_at();

-- Stable domain identities per course (blueprint versions attach weights).
create table public.course_domains (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references public.courses (id) on delete restrict,
  code        text not null check (code ~ '^[A-Za-z0-9-]{1,12}$'),
  number      int  not null,
  name        text not null,
  unique (course_id, code),
  unique (course_id, number),
  unique (id, course_id)
);

-- Task statements (CIH tasks; ASP/CSP task codes from item banks).
create table public.course_tasks (
  id           uuid primary key default gen_random_uuid(),
  course_id    uuid not null,
  domain_id    uuid not null,
  code         text not null check (code ~ '^[A-Za-z0-9-]{1,16}$'),
  name         text not null,
  sort_order   int not null default 0,
  unique (course_id, code),
  unique (id, course_id),
  unique (id, domain_id),
  foreign key (domain_id, course_id) references public.course_domains (id, course_id) on delete restrict
);

-- ---------- blueprints (versioned) ----------
create table public.blueprints (
  id                   uuid primary key default gen_random_uuid(),
  course_id            uuid not null references public.courses (id) on delete restrict,
  name                 text not null,
  source               text not null,
  version              text not null,
  effective_date       date,
  verification_status  public.verification_status not null default 'unverified',
  last_reviewed        date,
  is_current           boolean not null default false,
  notes                text,
  created_by           uuid,
  created_at           timestamptz not null default now(),
  unique (course_id, version),
  unique (id, course_id)
);
create unique index blueprints_one_current_per_course
  on public.blueprints (course_id) where is_current;

create table public.blueprint_domains (
  blueprint_id  uuid not null,
  domain_id     uuid not null,
  course_id     uuid not null,
  domain_name   text not null,          -- name as printed in this blueprint version
  weight        numeric(6,3) not null check (weight > 0 and weight <= 100),
  sort_order    int not null default 0,
  primary key (blueprint_id, domain_id),
  foreign key (blueprint_id, course_id) references public.blueprints (id, course_id) on delete cascade,
  foreign key (domain_id, course_id)    references public.course_domains (id, course_id) on delete restrict
);

create table public.blueprint_tasks (
  blueprint_id  uuid not null,
  task_id       uuid not null,
  course_id     uuid not null,
  task_name     text not null,
  sort_order    int not null default 0,
  primary key (blueprint_id, task_id),
  foreign key (blueprint_id, course_id) references public.blueprints (id, course_id) on delete cascade,
  foreign key (task_id, course_id)      references public.course_tasks (id, course_id) on delete restrict
);

-- ---------- exam configuration (one row per course × mode) ----------
create table public.exams (
  id                  uuid primary key default gen_random_uuid(),
  course_id           uuid not null references public.courses (id) on delete cascade,
  mode                public.exam_mode not null,
  title               text not null,
  question_count      int not null check (question_count between 1 and 300),
  duration_minutes    int not null check (duration_minutes between 1 and 600),
  feedback_policy     public.feedback_policy not null default 'after_submit',
  review_delay_hours  int not null default 0 check (review_delay_hours between 0 and 720),
  shuffle_options     boolean not null default false,
  is_active           boolean not null default true,
  updated_at          timestamptz not null default now(),
  unique (course_id, mode),
  unique (id, course_id)
);
create trigger exams_touch before update on public.exams
  for each row execute function public.touch_updated_at();

-- ---------- question bank ----------
create table public.questions (
  id                    uuid primary key default gen_random_uuid(),
  course_id             uuid not null references public.courses (id) on delete restrict,
  domain_id             uuid not null,
  task_id               uuid,
  external_ref          text check (external_ref is null or length(external_ref) <= 40),
  topic                 text check (topic is null or length(topic) <= 200),
  learning_objective    text,
  cognitive_level       text check (cognitive_level is null or cognitive_level in ('Recall','Application','Analysis')),
  question_type         text not null default 'single_best_answer'
                          check (question_type in ('single_best_answer')),
  stem                  text not null check (length(stem) between 10 and 6000),
  explanation           text,
  reference_text        text,
  difficulty            numeric(5,2) check (difficulty is null or difficulty between 0 and 100),
  status                public.question_status not null default 'draft',
  allow_option_shuffle  boolean not null default false,
  version               int not null default 1,
  reviewed_by           uuid,
  reviewed_at           timestamptz,
  created_by            uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (course_id, external_ref),
  unique (id, course_id),
  foreign key (domain_id, course_id) references public.course_domains (id, course_id) on delete restrict,
  foreign key (task_id, domain_id)   references public.course_tasks (id, domain_id) on delete restrict
);
create index questions_selection_idx on public.questions (course_id, domain_id, status);
create trigger questions_touch before update on public.questions
  for each row execute function public.touch_updated_at();

create table public.question_options (
  id           uuid primary key default gen_random_uuid(),
  question_id  uuid not null references public.questions (id) on delete cascade,
  label        text not null check (label ~ '^[A-H]$'),
  body         text not null check (length(body) between 1 and 2000),
  sort_order   int not null,
  unique (question_id, label),
  unique (id, question_id)
);

-- Authoritative scoring key: admin-only table, never exposed to students.
create table public.question_keys (
  question_id        uuid primary key references public.questions (id) on delete cascade,
  correct_option_id  uuid not null,
  foreign key (correct_option_id, question_id)
    references public.question_options (id, question_id) on delete cascade
    deferrable initially deferred
);

-- Immutable snapshots: every content change writes a new version.
-- Attempts reference (question_id, version) so history never drifts.
create table public.question_versions (
  question_id  uuid not null references public.questions (id) on delete restrict,
  version      int  not null,
  snapshot     jsonb not null,
  changed_by   uuid,
  change_note  text,
  created_at   timestamptz not null default now(),
  primary key (question_id, version)
);

-- ---------- attempts ----------
create table public.exam_attempts (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references public.profiles (id) on delete cascade,
  course_id            uuid not null references public.courses (id) on delete restrict,
  blueprint_id         uuid not null,
  exam_id              uuid not null,
  mode                 public.exam_mode not null,
  domain_id            uuid,
  feedback_policy      public.feedback_policy not null,
  review_available_at  timestamptz,
  question_count       int not null,
  duration_seconds     int not null,
  status               public.attempt_status not null default 'in_progress',
  started_at           timestamptz not null default now(),
  expires_at           timestamptz not null,
  submitted_at         timestamptz,
  finalized_reason     text check (finalized_reason is null or finalized_reason in ('student','timeout','admin')),
  correct_count        int,
  incorrect_count      int,
  unanswered_count     int,
  score_pct            numeric(5,2),
  time_used_seconds    int,
  unique (id, course_id),
  foreign key (blueprint_id, course_id) references public.blueprints (id, course_id) on delete restrict,
  foreign key (exam_id, course_id)      references public.exams (id, course_id) on delete restrict,
  foreign key (domain_id, course_id)    references public.course_domains (id, course_id) on delete restrict,
  check ((mode = 'domain') = (domain_id is not null)),
  check (expires_at > started_at)
);
create unique index exam_attempts_one_active
  on public.exam_attempts (user_id, course_id) where status = 'in_progress';
create index exam_attempts_user_course on public.exam_attempts (user_id, course_id, submitted_at desc);
create index exam_attempts_expiry on public.exam_attempts (expires_at) where status = 'in_progress';

create table public.attempt_questions (
  attempt_id        uuid not null,
  position          int  not null check (position >= 1),
  question_id       uuid not null,
  question_version  int  not null,
  course_id         uuid not null,
  domain_id         uuid not null,
  task_id           uuid,
  option_order      uuid[] not null,
  primary key (attempt_id, position),
  unique (attempt_id, question_id),
  foreign key (attempt_id, course_id)        references public.exam_attempts (id, course_id) on delete cascade,
  foreign key (question_id, course_id)       references public.questions (id, course_id) on delete restrict,
  foreign key (question_id, question_version) references public.question_versions (question_id, version) on delete restrict,
  foreign key (domain_id, course_id)         references public.course_domains (id, course_id) on delete restrict
);

create table public.attempt_answers (
  attempt_id          uuid not null,
  question_id         uuid not null,
  selected_option_id  uuid,
  flagged             boolean not null default false,
  locked              boolean not null default false,
  is_correct          boolean,
  client_seq          bigint not null default 0,
  answered_at         timestamptz,
  updated_at          timestamptz not null default now(),
  primary key (attempt_id, question_id),
  foreign key (attempt_id, question_id) references public.attempt_questions (attempt_id, question_id) on delete cascade
);

create table public.domain_performance (
  attempt_id    uuid not null,
  domain_id     uuid not null,
  course_id     uuid not null,
  blueprint_id  uuid not null,
  user_id       uuid not null,
  total         int not null,
  answered      int not null,
  correct       int not null,
  pct           numeric(5,2) not null,
  primary key (attempt_id, domain_id),
  foreign key (attempt_id, course_id) references public.exam_attempts (id, course_id) on delete cascade,
  foreign key (domain_id, course_id)  references public.course_domains (id, course_id) on delete restrict
);
create index domain_performance_user_course on public.domain_performance (user_id, course_id);

create table public.task_performance (
  attempt_id    uuid not null,
  task_id       uuid not null,
  course_id     uuid not null,
  blueprint_id  uuid not null,
  user_id       uuid not null,
  total         int not null,
  correct       int not null,
  primary key (attempt_id, task_id),
  foreign key (attempt_id, course_id) references public.exam_attempts (id, course_id) on delete cascade,
  foreign key (task_id, course_id)    references public.course_tasks (id, course_id) on delete restrict
);

-- ---------- commerce & access ----------
create table public.course_products (
  id                 uuid primary key default gen_random_uuid(),
  course_id          uuid not null references public.courses (id) on delete cascade,
  provider           text not null default 'paddle',
  provider_price_id  text not null,
  access_days        int check (access_days is null or access_days > 0),  -- null = subscription-managed
  kind               text not null default 'one_time' check (kind in ('one_time','subscription')),
  is_active          boolean not null default true,
  unique (provider, provider_price_id)
);

create table public.payments (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid references public.profiles (id) on delete set null,
  course_id          uuid references public.courses (id) on delete set null,
  provider           text not null,
  provider_event_id  text not null,
  provider_txn_id    text,
  event_type         text not null,
  status             text not null,
  amount_minor       bigint,
  currency           text,
  payload            jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  unique (provider, provider_event_id)
);

create table public.course_entitlements (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  course_id       uuid not null references public.courses (id) on delete cascade,
  source          public.entitlement_source not null,
  starts_at       timestamptz not null default now(),
  expires_at      timestamptz,
  revoked_at      timestamptz,
  revoked_reason  text,
  payment_id      uuid references public.payments (id) on delete set null,
  provider_subscription_id text,
  granted_by      uuid,
  note            text,
  created_at      timestamptz not null default now(),
  check (expires_at is null or expires_at > starts_at)
);
create index course_entitlements_lookup on public.course_entitlements (user_id, course_id);

-- ---------- settings, audit, rate limiting ----------
create table public.app_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

create table public.audit_logs (
  id          bigserial primary key,
  actor_id    uuid,
  action      text not null,
  entity      text,
  entity_id   text,
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index audit_logs_created on public.audit_logs (created_at desc);
create index audit_logs_action on public.audit_logs (action, created_at desc);

create table public.rate_limits (
  bucket        text not null,
  window_start  timestamptz not null,
  hits          int not null default 0,
  primary key (bucket, window_start)
);
