-- =====================================================================
-- iParkar LMS — 0003 admin & service functions, integrity triggers
-- =====================================================================

-- ---------- blueprint immutability once used ----------
create or replace function public.blueprint_in_use(p_blueprint uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from exam_attempts where blueprint_id = p_blueprint);
$$;

create or replace function public.guard_blueprint_children() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.blueprint_in_use(coalesce(old.blueprint_id, new.blueprint_id)) then
    raise exception 'Blueprint % is used by exam attempts; create a new version instead.',
      coalesce(old.blueprint_id, new.blueprint_id) using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;

create trigger blueprint_domains_guard before insert or update or delete on public.blueprint_domains
  for each row execute function public.guard_blueprint_children();
create trigger blueprint_tasks_guard before insert or update or delete on public.blueprint_tasks
  for each row execute function public.guard_blueprint_children();

create or replace function public.guard_blueprint_row() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if public.blueprint_in_use(old.id) then
      raise exception 'Blueprint % is used by exam attempts and cannot be deleted.', old.id using errcode = 'P0001';
    end if;
    return old;
  end if;
  -- metadata (verification, review date, current flag, notes) may change;
  -- identity fields may not once attempts reference the blueprint
  if public.blueprint_in_use(old.id) and (new.course_id <> old.course_id or new.version <> old.version) then
    raise exception 'Blueprint % is used by exam attempts; its identity cannot change.', old.id using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger blueprints_guard before update or delete on public.blueprints
  for each row execute function public.guard_blueprint_row();

-- finalized attempts are read-only
create or replace function public.guard_finalized_answers() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_status attempt_status;
begin
  select status into v_status from exam_attempts where id = coalesce(new.attempt_id, old.attempt_id);
  if v_status <> 'in_progress' and (tg_op = 'DELETE' or new.selected_option_id is distinct from old.selected_option_id) then
    raise exception 'Attempt is finalized; answers cannot change.' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;

create trigger attempt_answers_guard before update or delete on public.attempt_answers
  for each row execute function public.guard_finalized_answers();

-- ---------- question publication rules ----------
create or replace function public.question_publish_problems(p_question uuid) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare
  q questions%rowtype;
  v_problems text[] := '{}';
  v_opts int;
begin
  select * into q from questions where id = p_question;
  if not found then return array['question not found']; end if;
  select count(*) into v_opts from question_options where question_id = q.id;
  if v_opts < 2 then v_problems := v_problems || 'needs at least 2 options'; end if;
  if not exists (select 1 from question_keys where question_id = q.id) then
    v_problems := v_problems || 'missing answer key';
  end if;
  if coalesce(trim(q.explanation), '') = '' then v_problems := v_problems || 'missing explanation'; end if;
  if not exists (select 1 from question_versions where question_id = q.id and version = q.version) then
    v_problems := v_problems || 'missing version snapshot';
  end if;
  return v_problems;
end $$;

create or replace function public.guard_question_publish() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_problems text[];
begin
  if new.status = 'published' and (tg_op = 'INSERT' or old.status <> 'published') then
    v_problems := public.question_publish_problems(new.id);
    if array_length(v_problems, 1) > 0 then
      raise exception 'Question % cannot be published: %', coalesce(new.external_ref, new.id::text), array_to_string(v_problems, '; ')
        using errcode = 'P0001';
    end if;
  end if;
  if tg_op = 'UPDATE' and new.course_id <> old.course_id then
    raise exception 'A question cannot move to another course.' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger questions_publish_guard before insert or update on public.questions
  for each row execute function public.guard_question_publish();

-- ---------- admin: upsert one question (validates, versions, snapshots) ----------
-- payload: {course_code|course_id, external_ref, domain_code, task_code?, topic?, cognitive_level?,
--           stem, options:[{label, body}], key (label), explanation, reference?, difficulty?,
--           allow_option_shuffle?, status?, change_note?, auto_create_task?}
create or replace function public.admin_upsert_question(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_course courses%rowtype;
  v_domain course_domains%rowtype;
  v_task_id uuid;
  v_qid uuid;
  v_existing questions%rowtype;
  v_status question_status := coalesce(nullif(p ->> 'status', ''), 'draft')::question_status;
  v_errors text[] := '{}';
  v_opt jsonb;
  v_labels text[] := '{}';
  v_key text := upper(trim(coalesce(p ->> 'key', '')));
  v_old_snapshot jsonb;
  v_new_snapshot jsonb;
  v_version int;
  v_task_code text := nullif(trim(coalesce(p ->> 'task_code', '')), '');
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('admin role required'));
  end if;

  select * into v_course from courses
  where id = nullif(p ->> 'course_id', '')::uuid or code = upper(nullif(p ->> 'course_code', ''));
  if not found then v_errors := v_errors || 'unknown course'; end if;

  if v_course.id is not null then
    select * into v_domain from course_domains
    where course_id = v_course.id and (code = p ->> 'domain_code' or id = nullif(p ->> 'domain_id', '')::uuid);
    if not found then v_errors := v_errors || format('domain "%s" does not belong to course %s', p ->> 'domain_code', v_course.code); end if;
  end if;

  if v_domain.id is not null and v_task_code is not null then
    select id into v_task_id from course_tasks where course_id = v_course.id and code = v_task_code;
    if v_task_id is null then
      if coalesce((p ->> 'auto_create_task')::boolean, false) and v_task_code like v_domain.code || '-%' then
        insert into course_tasks (course_id, domain_id, code, name, sort_order)
        values (v_course.id, v_domain.id, v_task_code, 'Task ' || v_task_code, 0)
        returning id into v_task_id;
      else
        v_errors := v_errors || format('task "%s" is not defined for course %s', v_task_code, v_course.code);
      end if;
    elsif not exists (select 1 from course_tasks where id = v_task_id and domain_id = v_domain.id) then
      v_errors := v_errors || format('task "%s" belongs to a different domain', v_task_code);
      v_task_id := null;
    end if;
  end if;

  if length(coalesce(trim(p ->> 'stem'), '')) < 10 then v_errors := v_errors || 'stem is missing or too short'; end if;
  if jsonb_typeof(p -> 'options') <> 'array' or jsonb_array_length(p -> 'options') < 2
     or jsonb_array_length(p -> 'options') > 8 then
    v_errors := v_errors || 'options must be an array of 2–8 items';
  else
    for v_opt in select * from jsonb_array_elements(p -> 'options') loop
      if coalesce(trim(v_opt ->> 'body'), '') = '' then v_errors := v_errors || format('option %s is empty', v_opt ->> 'label'); end if;
      if upper(v_opt ->> 'label') !~ '^[A-H]$' then v_errors := v_errors || format('invalid option label "%s"', v_opt ->> 'label'); end if;
      if upper(v_opt ->> 'label') = any (v_labels) then v_errors := v_errors || format('duplicate option label %s', v_opt ->> 'label'); end if;
      v_labels := v_labels || upper(v_opt ->> 'label');
    end loop;
    if not (v_key = any (v_labels)) then v_errors := v_errors || format('answer key "%s" does not match an option', v_key); end if;
  end if;
  if (p ->> 'difficulty') is not null and ((p ->> 'difficulty') !~ '^\d+(\.\d+)?$' or (p ->> 'difficulty')::numeric > 100) then
    v_errors := v_errors || 'difficulty must be 0–100';
  end if;
  if (p ->> 'cognitive_level') is not null and (p ->> 'cognitive_level') not in ('Recall','Application','Analysis') then
    v_errors := v_errors || 'cognitive_level must be Recall, Application or Analysis';
  end if;

  if array_length(v_errors, 1) > 0 then
    return jsonb_build_object('ok', false, 'errors', to_jsonb(v_errors));
  end if;

  -- find existing by id or (course, external_ref)
  select * into v_existing from questions
  where id = nullif(p ->> 'id', '')::uuid
     or (course_id = v_course.id and external_ref = nullif(p ->> 'external_ref', ''));
  if v_existing.id is not null and v_existing.course_id <> v_course.id then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('question belongs to another course'));
  end if;

  if v_existing.id is null then
    insert into questions (course_id, domain_id, task_id, external_ref, topic, learning_objective, cognitive_level,
                           stem, explanation, reference_text, difficulty, status, allow_option_shuffle, created_by)
    values (v_course.id, v_domain.id, v_task_id, nullif(p ->> 'external_ref', ''), nullif(p ->> 'topic', ''),
            nullif(p ->> 'learning_objective', ''), nullif(p ->> 'cognitive_level', ''),
            trim(p ->> 'stem'), nullif(trim(p ->> 'explanation'), ''), nullif(trim(p ->> 'reference'), ''),
            nullif(p ->> 'difficulty', '')::numeric, 'draft', coalesce((p ->> 'allow_option_shuffle')::boolean, false), auth.uid())
    returning id into v_qid;
    v_version := 1;
  else
    v_qid := v_existing.id;
    v_old_snapshot := public.build_question_snapshot(v_qid);
    update questions set
      domain_id = v_domain.id, task_id = v_task_id, topic = nullif(p ->> 'topic', ''),
      learning_objective = nullif(p ->> 'learning_objective', ''), cognitive_level = nullif(p ->> 'cognitive_level', ''),
      stem = trim(p ->> 'stem'), explanation = nullif(trim(p ->> 'explanation'), ''),
      reference_text = nullif(trim(p ->> 'reference'), ''), difficulty = nullif(p ->> 'difficulty', '')::numeric,
      allow_option_shuffle = coalesce((p ->> 'allow_option_shuffle')::boolean, allow_option_shuffle),
      status = case when status = 'published' then 'published' else status end
    where id = v_qid;
  end if;

  -- options: upsert by label, drop removed labels
  delete from question_keys where question_id = v_qid;
  delete from question_options where question_id = v_qid and label <> all (v_labels);
  insert into question_options (question_id, label, body, sort_order)
  select v_qid, upper(o ->> 'label'), trim(o ->> 'body'), (ord - 1)::int
  from jsonb_array_elements(p -> 'options') with ordinality as t(o, ord)
  on conflict (question_id, label) do update set body = excluded.body, sort_order = excluded.sort_order;
  insert into question_keys (question_id, correct_option_id)
  select v_qid, id from question_options where question_id = v_qid and label = v_key;

  v_new_snapshot := public.build_question_snapshot(v_qid);
  if v_existing.id is not null then
    if (v_old_snapshot - 'id') is distinct from (v_new_snapshot - 'id') then
      v_version := v_existing.version + 1;
      update questions set version = v_version where id = v_qid;
      v_new_snapshot := public.build_question_snapshot(v_qid);
    else
      v_version := v_existing.version;
    end if;
  end if;
  insert into question_versions (question_id, version, snapshot, changed_by, change_note)
  values (v_qid, v_version, v_new_snapshot, auth.uid(), nullif(p ->> 'change_note', ''))
  on conflict (question_id, version) do nothing;

  -- requested status (publish validates via trigger)
  if v_status is distinct from (select status from questions where id = v_qid) then
    update questions set status = v_status,
      reviewed_by = case when v_status = 'published' then auth.uid() else reviewed_by end,
      reviewed_at = case when v_status = 'published' then now() else reviewed_at end
    where id = v_qid;
  end if;

  return jsonb_build_object('ok', true, 'id', v_qid, 'version', v_version,
                            'created', v_existing.id is null);
exception when others then
  return jsonb_build_object('ok', false, 'errors', jsonb_build_array(sqlerrm));
end $$;

-- ---------- admin: bulk import (per-item accept/reject report) ----------
create or replace function public.admin_import_questions(p_course_code text, p_items jsonb, p_status text default 'draft',
                                                         p_auto_create_tasks boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_item jsonb;
  v_res jsonb;
  v_accepted jsonb := '[]'::jsonb;
  v_rejected jsonb := '[]'::jsonb;
  v_idx int := 0;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;
  if not exists (select 1 from courses where code = upper(p_course_code)) then
    return jsonb_build_object('ok', false, 'error', 'UNKNOWN_COURSE');
  end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_idx := v_idx + 1;
    -- the course always comes from the import target, never from the row
    v_res := public.admin_upsert_question(
      (v_item - 'course_id' - 'id') || jsonb_build_object('course_code', upper(p_course_code), 'status', p_status,
                                                          'auto_create_task', p_auto_create_tasks));
    if (v_res ->> 'ok')::boolean then
      v_accepted := v_accepted || jsonb_build_object('row', v_idx, 'external_ref', v_item ->> 'external_ref',
                                                     'id', v_res ->> 'id', 'created', v_res -> 'created');
    else
      v_rejected := v_rejected || jsonb_build_object('row', v_idx, 'external_ref', v_item ->> 'external_ref',
                                                     'errors', v_res -> 'errors');
    end if;
  end loop;
  perform public.write_audit('questions.import', 'course', upper(p_course_code),
    jsonb_build_object('accepted', jsonb_array_length(v_accepted), 'rejected', jsonb_array_length(v_rejected), 'status', p_status));
  return jsonb_build_object('ok', true, 'accepted', v_accepted, 'rejected', v_rejected);
end $$;

-- ---------- admin: change question status in bulk ----------
create or replace function public.admin_set_question_status(p_ids uuid[], p_status text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_ok int := 0;
  v_failed jsonb := '[]'::jsonb;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;
  foreach v_id in array p_ids loop
    begin
      update questions set status = p_status::question_status,
        reviewed_by = case when p_status in ('published','in_review') then auth.uid() else reviewed_by end,
        reviewed_at = case when p_status = 'published' then now() else reviewed_at end
      where id = v_id;
      if found then v_ok := v_ok + 1; end if;
    exception when others then
      v_failed := v_failed || jsonb_build_object('id', v_id, 'error', sqlerrm);
    end;
  end loop;
  perform public.write_audit('questions.status', 'question', null,
    jsonb_build_object('status', p_status, 'updated', v_ok, 'failed', jsonb_array_length(v_failed)));
  return jsonb_build_object('ok', true, 'updated', v_ok, 'failed', v_failed);
end $$;

-- ---------- admin: blueprints ----------
-- Create a new (non-current) version, optionally copying another version.
-- p_domains: [{domain_id|domain_code, weight, name?}]
create or replace function public.admin_create_blueprint_version(
  p_course uuid, p_version text, p_name text, p_source text, p_effective date, p_domains jsonb, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_bp uuid;
  v_sum numeric;
  d jsonb;
  v_domain course_domains%rowtype;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  insert into blueprints (course_id, name, source, version, effective_date, notes, created_by)
  values (p_course, p_name, p_source, p_version, p_effective, p_notes, auth.uid())
  returning id into v_bp;
  for d in select * from jsonb_array_elements(p_domains) loop
    select * into v_domain from course_domains
     where course_id = p_course and (id = nullif(d ->> 'domain_id', '')::uuid or code = d ->> 'domain_code');
    if not found then
      raise exception 'Domain % does not belong to this course', coalesce(d ->> 'domain_code', d ->> 'domain_id');
    end if;
    insert into blueprint_domains (blueprint_id, domain_id, course_id, domain_name, weight, sort_order)
    values (v_bp, v_domain.id, p_course, coalesce(nullif(d ->> 'name', ''), v_domain.name), (d ->> 'weight')::numeric, v_domain.number);
  end loop;
  -- carry tasks of the current version forward
  insert into blueprint_tasks (blueprint_id, task_id, course_id, task_name, sort_order)
  select v_bp, bt.task_id, bt.course_id, bt.task_name, bt.sort_order
  from blueprint_tasks bt join blueprints b on b.id = bt.blueprint_id
  where b.course_id = p_course and b.is_current;
  select sum(weight) into v_sum from blueprint_domains where blueprint_id = v_bp;
  perform public.write_audit('blueprint.created', 'blueprint', v_bp::text, jsonb_build_object('version', p_version, 'weight_sum', v_sum));
  return jsonb_build_object('ok', true, 'blueprint_id', v_bp, 'weight_sum', v_sum);
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end $$;

create or replace function public.admin_set_current_blueprint(p_blueprint uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_course uuid; v_sum numeric;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  select course_id into v_course from blueprints where id = p_blueprint;
  if v_course is null then return jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); end if;
  select sum(weight) into v_sum from blueprint_domains where blueprint_id = p_blueprint;
  if v_sum is null or abs(v_sum - 100) > 0.001 then
    return jsonb_build_object('ok', false, 'error', 'WEIGHTS_MUST_TOTAL_100', 'weight_sum', v_sum);
  end if;
  update blueprints set is_current = false where course_id = v_course and is_current and id <> p_blueprint;
  update blueprints set is_current = true where id = p_blueprint;
  perform public.write_audit('blueprint.set_current', 'blueprint', p_blueprint::text, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_update_blueprint_meta(p_blueprint uuid, p_verification text, p_last_reviewed date, p_notes text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  update blueprints set verification_status = p_verification::verification_status,
                        last_reviewed = p_last_reviewed, notes = p_notes
  where id = p_blueprint;
  perform public.write_audit('blueprint.meta', 'blueprint', p_blueprint::text,
    jsonb_build_object('verification', p_verification, 'last_reviewed', p_last_reviewed));
  return jsonb_build_object('ok', true);
end $$;

-- Update weights of a version that has never been used (otherwise: new version).
create or replace function public.admin_update_blueprint_weights(p_blueprint uuid, p_domains jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d jsonb; v_sum numeric;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  if public.blueprint_in_use(p_blueprint) then
    return jsonb_build_object('ok', false, 'error', 'BLUEPRINT_IN_USE');
  end if;
  for d in select * from jsonb_array_elements(p_domains) loop
    update blueprint_domains set weight = (d ->> 'weight')::numeric,
                                 domain_name = coalesce(nullif(d ->> 'name', ''), domain_name)
    where blueprint_id = p_blueprint and domain_id = (d ->> 'domain_id')::uuid;
  end loop;
  select sum(weight) into v_sum from blueprint_domains where blueprint_id = p_blueprint;
  perform public.write_audit('blueprint.weights', 'blueprint', p_blueprint::text, jsonb_build_object('weight_sum', v_sum));
  return jsonb_build_object('ok', true, 'weight_sum', v_sum);
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end $$;

-- ---------- admin: entitlements ----------
create or replace function public.admin_grant_entitlement(p_user uuid, p_course uuid, p_source text,
                                                          p_expires_at timestamptz, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  insert into course_entitlements (user_id, course_id, source, expires_at, granted_by, note)
  values (p_user, p_course, p_source::entitlement_source, p_expires_at, auth.uid(), p_note)
  returning id into v_id;
  perform public.write_audit('entitlement.granted', 'course_entitlement', v_id::text,
    jsonb_build_object('user_id', p_user, 'course_id', p_course, 'source', p_source, 'expires_at', p_expires_at));
  return jsonb_build_object('ok', true, 'id', v_id);
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end $$;

create or replace function public.admin_revoke_entitlement(p_entitlement uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  update course_entitlements set revoked_at = now(), revoked_reason = p_reason
  where id = p_entitlement and revoked_at is null;
  perform public.write_audit('entitlement.revoked', 'course_entitlement', p_entitlement::text,
    jsonb_build_object('reason', p_reason));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_set_user_status(p_user uuid, p_status text, p_role text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  if p_user = auth.uid() and (p_status <> 'active' or coalesce(p_role, 'admin') <> 'admin') then
    return jsonb_build_object('ok', false, 'error', 'CANNOT_DEMOTE_SELF');
  end if;
  update profiles set status = p_status::account_status, role = coalesce(p_role::app_role, role) where id = p_user;
  perform public.write_audit('user.status', 'profile', p_user::text, jsonb_build_object('status', p_status, 'role', p_role));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_finalize_attempt(p_attempt uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  return jsonb_build_object('ok', true, 'finalized', public.finalize_attempt_internal(p_attempt, 'admin'));
end $$;

-- ---------- admin: aggregate stats ----------
create or replace function public.admin_course_overview() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not public.is_admin() then jsonb_build_object('ok', false, 'error', 'FORBIDDEN') else
  jsonb_build_object('ok', true, 'courses', coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'code', c.code, 'name', c.name, 'exams_enabled', c.exams_enabled, 'is_visible', c.is_visible,
    'blueprint', (select jsonb_build_object('id', b.id, 'version', b.version, 'verification_status', b.verification_status,
                    'last_reviewed', b.last_reviewed) from blueprints b where b.course_id = c.id and b.is_current),
    'questions', (select jsonb_object_agg(s.status, s.n) from (select status, count(*) n from questions q
                    where q.course_id = c.id group by status) s),
    'published_by_domain', (select jsonb_agg(jsonb_build_object('code', cd.code, 'name', cd.name,
                    'published', (select count(*) from questions q where q.domain_id = cd.id and q.status = 'published'),
                    'required_mixed', (select a.question_count from blueprints b
                        cross join lateral public.allocate_question_counts(b.id, coalesce((select question_count from exams e where e.course_id = c.id and e.mode = 'mixed'), 100)) a
                        where b.course_id = c.id and b.is_current and a.domain_id = cd.id)) order by cd.number)
                    from course_domains cd where cd.course_id = c.id),
    'active_entitlements', (select count(distinct user_id) from course_entitlements e where e.course_id = c.id and e.revoked_at is null
                    and (e.expires_at is null or e.expires_at > now())),
    'attempts', (select count(*) from exam_attempts a where a.course_id = c.id and a.status <> 'in_progress'),
    'avg_score', (select round(avg(score_pct), 1) from exam_attempts a where a.course_id = c.id and a.status <> 'in_progress')
  ) order by c.sort_order), '[]'::jsonb)) end
  from courses c;
$$;

-- ---------- service role: payments → entitlements ----------
-- Extends an active entitlement for the same course instead of stacking rows.
create or replace function public.service_apply_purchase(p_user uuid, p_course uuid, p_access_days int,
                                                         p_payment uuid, p_source text, p_subscription text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_current course_entitlements%rowtype;
  v_base timestamptz;
  v_id uuid;
begin
  select * into v_current from course_entitlements
  where user_id = p_user and course_id = p_course and revoked_at is null and source in ('purchase','subscription')
    and (expires_at is null or expires_at > now())
  order by expires_at desc nulls first limit 1;

  if found and v_current.expires_at is null then
    return jsonb_build_object('ok', true, 'id', v_current.id, 'note', 'already unlimited');
  end if;
  v_base := greatest(now(), coalesce(v_current.expires_at, now()));
  if found then
    update course_entitlements
       set expires_at = case when p_access_days is null then null else v_base + make_interval(days => p_access_days) end,
           payment_id = p_payment, provider_subscription_id = coalesce(p_subscription, provider_subscription_id)
     where id = v_current.id returning id into v_id;
  else
    insert into course_entitlements (user_id, course_id, source, expires_at, payment_id, provider_subscription_id, note)
    values (p_user, p_course, p_source::entitlement_source,
            case when p_access_days is null then null else now() + make_interval(days => p_access_days) end,
            p_payment, p_subscription, 'Granted by verified payment webhook')
    returning id into v_id;
  end if;
  insert into audit_logs (actor_id, action, entity, entity_id, details)
  values (null, 'entitlement.purchase', 'course_entitlement', v_id::text,
          jsonb_build_object('user_id', p_user, 'course_id', p_course, 'payment_id', p_payment, 'days', p_access_days));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.service_revoke_for_payment(p_user uuid, p_course uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  update course_entitlements set revoked_at = now(), revoked_reason = p_reason
  where user_id = p_user and course_id = p_course and revoked_at is null and source in ('purchase','subscription');
  insert into audit_logs (actor_id, action, entity, entity_id, details)
  values (null, 'entitlement.revoked_by_payment', 'course', p_course::text, jsonb_build_object('user_id', p_user, 'reason', p_reason));
  return jsonb_build_object('ok', true);
end $$;
