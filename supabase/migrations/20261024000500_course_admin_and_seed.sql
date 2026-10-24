-- =====================================================================
-- iParkar LMS — 0005 course/exam admin RPCs and course configuration seed
-- ASP and CSP weightings are INITIAL configurations (unverified).
-- CIH is transcribed from "CIH Exam Blueprint — Based on the 2021 Job
-- Analysis (Effective April 1, 2022)", user-provided document.
-- =====================================================================

create or replace function public.admin_update_course(p_course uuid, p_is_visible boolean, p_exams_enabled boolean,
                                                      p_description text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_shortage jsonb;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  -- enabling exams requires a valid current blueprint with weights totalling 100
  if p_exams_enabled and not exists (
      select 1 from blueprints b where b.course_id = p_course and b.is_current
        and abs((select sum(weight) from blueprint_domains where blueprint_id = b.id) - 100) < 0.001) then
    return jsonb_build_object('ok', false, 'error', 'NO_VALID_CURRENT_BLUEPRINT');
  end if;
  update courses set is_visible = p_is_visible, exams_enabled = p_exams_enabled, description = p_description
  where id = p_course;
  perform public.write_audit('course.updated', 'course', p_course::text,
    jsonb_build_object('is_visible', p_is_visible, 'exams_enabled', p_exams_enabled));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_update_exam(p_exam uuid, p_question_count int, p_duration_minutes int,
                                                    p_feedback_policy text, p_review_delay_hours int,
                                                    p_shuffle_options boolean, p_is_active boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  update exams set question_count = p_question_count, duration_minutes = p_duration_minutes,
                   feedback_policy = p_feedback_policy::feedback_policy, review_delay_hours = p_review_delay_hours,
                   shuffle_options = p_shuffle_options, is_active = p_is_active
  where id = p_exam;
  perform public.write_audit('exam.config_updated', 'exam', p_exam::text,
    jsonb_build_object('question_count', p_question_count, 'duration_minutes', p_duration_minutes,
                       'feedback_policy', p_feedback_policy));
  return jsonb_build_object('ok', true);
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end $$;

create or replace function public.admin_update_setting(p_key text, p_value jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  insert into app_settings (key, value, updated_at) values (p_key, p_value, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  perform public.write_audit('settings.updated', 'app_settings', p_key, p_value);
  return jsonb_build_object('ok', true);
end $$;

revoke execute on function public.admin_update_course(uuid, boolean, boolean, text) from public, anon;
revoke execute on function public.admin_update_exam(uuid, int, int, text, int, boolean, boolean) from public, anon;
revoke execute on function public.admin_update_setting(text, jsonb) from public, anon;
grant execute on function public.admin_update_course(uuid, boolean, boolean, text) to authenticated;
grant execute on function public.admin_update_exam(uuid, int, int, text, int, boolean, boolean) to authenticated;
grant execute on function public.admin_update_setting(text, jsonb) to authenticated;

-- ---------- settings ----------
insert into public.app_settings (key, value) values
  ('study_indicators', '{"strong": 80, "developing": 60, "min_questions": 20}');

-- ---------- courses ----------
insert into public.courses (code, name, description, sort_order, exams_enabled) values
  ('ASP', 'Associate Safety Professional', 'Practice examinations for the BCSP ASP credential.', 1, false),
  ('CSP', 'Certified Safety Professional', 'Practice examinations for the BCSP CSP credential.', 2, false),
  ('CIH', 'Certified Industrial Hygienist', 'Practice examinations for the BGC CIH credential.', 3, false);

-- ---------- domains ----------
insert into public.course_domains (course_id, code, number, name)
select c.id, d.code, d.number, d.name
from public.courses c
join (values
  ('ASP', 'D1', 1, 'Mathematical Calculations'),
  ('ASP', 'D2', 2, 'Safety Programs and Concepts'),
  ('ASP', 'D3', 3, 'Ergonomics'),
  ('ASP', 'D4', 4, 'Fire Prevention and Protection'),
  ('ASP', 'D5', 5, 'Emergency Preparedness and Response'),
  ('ASP', 'D6', 6, 'Industrial Hygiene and Occupational Health'),
  ('ASP', 'D7', 7, 'Environmental Management'),
  ('ASP', 'D8', 8, 'Training, Education, and Communication'),
  ('ASP', 'D9', 9, 'Legal'),
  ('CSP', 'D1', 1, 'Advanced Application of Safety Principles'),
  ('CSP', 'D2', 2, 'Program Management'),
  ('CSP', 'D3', 3, 'Risk Management'),
  ('CSP', 'D4', 4, 'Emergency Management'),
  ('CSP', 'D5', 5, 'Environmental Management'),
  ('CSP', 'D6', 6, 'Occupational Health and Applied Science'),
  ('CSP', 'D7', 7, 'Training'),
  ('CIH', 'I',   1, 'Exposure Assessment Principles and Practice'),
  ('CIH', 'II',  2, 'Control Selection, Recommendation/Implementation, and Validation'),
  ('CIH', 'III', 3, 'Risk Management')
) as d(course_code, code, number, name) on d.course_code = c.code;

-- ---------- CIH tasks (verbatim from the supplied blueprint) ----------
insert into public.course_tasks (course_id, domain_id, code, name, sort_order)
select cd.course_id, cd.id, t.code, t.name, t.sort_order
from public.course_domains cd
join public.courses c on c.id = cd.course_id and c.code = 'CIH'
join (values
  ('I',   'I-T1',   1, 'Anticipate and recognize potential health hazards by studying environments, tasks, and people to identify risks associated with stressors, products, and processes.'),
  ('I',   'I-T2',   2, 'Assess the relationship between exposure and the potential adverse health effects to determine if further action is warranted using recognized scientific principles, literature, standards, and guidelines.'),
  ('I',   'I-T3',   3, 'Design and recommend/implement an exposure assessment strategy (qualitative and/or quantitative) to determine the extent and magnitude of exposure using principles to ensure scientific validity.'),
  ('I',   'I-T4',   4, 'Formulate conclusions, prioritize risks, and communicate findings and recommendations based on analysis and evaluation of data using literature, standards, guidelines, and ethical professional judgment.'),
  ('II',  'II-T1',  1, 'Assess and select options to eliminate or mitigate exposure using the hierarchy of controls and recognized scientific principles, literature, standards, guidelines, and design and performance criteria.'),
  ('II',  'II-T2',  2, 'Develop and recommend/implement appropriate controls designed to eliminate or mitigate exposure using literature, standards, guidelines, and ethical professional judgement.'),
  ('II',  'II-T3',  3, 'Validate the effectiveness of controls to eliminate or mitigate exposure using recognized scientific principles, literature, standards, guidelines, and design and performance criteria.'),
  ('III', 'III-T1', 1, 'Develop and recommend/implement programs/systems that address health risks using recognized risk-based methods, ethical professional judgment, and effective communication strategies.'),
  ('III', 'III-T2', 2, 'Evaluate and maintain the effectiveness of programs/systems designed to eliminate or mitigate risk using recognized scientific principles, literature, standards, and guidelines.')
) as t(domain_code, code, sort_order, name) on t.domain_code = cd.code;

-- ---------- blueprints ----------
insert into public.blueprints (course_id, name, source, version, effective_date, verification_status, is_current, notes)
select c.id, b.name, b.source, b.version, b.effective_date::date, 'unverified', true, b.notes
from public.courses c
join (values
  ('ASP', 'ASP examination blueprint — initial configuration',
          'iParkar project instructions (initial weightings). Item bank built for BCSP ASP11 blueprint V.2024.04.24.',
          'ASP-initial-2026.10', null,
          'Verify domain names and weightings against the current official BCSP ASP blueprint before public release.'),
  ('CSP', 'CSP examination blueprint — initial configuration',
          'iParkar project instructions (initial weightings).',
          'CSP-initial-2026.10', null,
          'Verify domain names and weightings against the current official BCSP CSP blueprint before public release.'),
  ('CIH', 'CIH Exam Blueprint — Based on the 2021 Job Analysis',
          'User-provided document: CIH Exam Blueprint, based on the 2021 Job Analysis, effective April 1, 2022.',
          'CIH-2021JA', '2022-04-01',
          'Three domains and nine tasks transcribed verbatim. The blueprint gives domain weightings only; no task-level weightings exist. Confirm no newer official blueprint applies before commercial launch.')
) as b(course_code, name, source, version, effective_date, notes) on b.course_code = c.code;

insert into public.blueprint_domains (blueprint_id, domain_id, course_id, domain_name, weight, sort_order)
select b.id, cd.id, cd.course_id, cd.name, w.weight, cd.number
from public.blueprints b
join public.courses c on c.id = b.course_id
join public.course_domains cd on cd.course_id = c.id
join (values
  ('ASP', 'D1', 10), ('ASP', 'D2', 25), ('ASP', 'D3', 8), ('ASP', 'D4', 12), ('ASP', 'D5', 10),
  ('ASP', 'D6', 12), ('ASP', 'D7', 7), ('ASP', 'D8', 11), ('ASP', 'D9', 5),
  ('CSP', 'D1', 25), ('CSP', 'D2', 25), ('CSP', 'D3', 15), ('CSP', 'D4', 9), ('CSP', 'D5', 6),
  ('CSP', 'D6', 10), ('CSP', 'D7', 10),
  ('CIH', 'I', 50), ('CIH', 'II', 35), ('CIH', 'III', 15)
) as w(course_code, domain_code, weight) on w.course_code = c.code and w.domain_code = cd.code
where b.is_current;

insert into public.blueprint_tasks (blueprint_id, task_id, course_id, task_name, sort_order)
select b.id, ct.id, ct.course_id, ct.name, ct.sort_order
from public.blueprints b
join public.course_tasks ct on ct.course_id = b.course_id
join public.courses c on c.id = b.course_id and c.code = 'CIH'
where b.is_current;

-- ---------- exam configurations ----------
insert into public.exams (course_id, mode, title, question_count, duration_minutes, feedback_policy)
select c.id, m.mode::public.exam_mode, m.title, m.n, m.minutes, 'after_submit'
from public.courses c
cross join (values
  ('mixed',  'Full mixed practice examination', 100, 150),
  ('domain', 'Domain practice examination',      20,  30)
) as m(mode, title, n, minutes);
