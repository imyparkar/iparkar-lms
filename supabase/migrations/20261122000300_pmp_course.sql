-- =====================================================================
-- iParkar LMS — PMP® practice examinations (PMI PMP ECO, July 2026)
--
-- Source: PMI PMP® Examination Content Outline effective July 2026
-- (New-PMP-Examination-Content-Outline-2026.pdf, user-provided).
-- Three domains with the published weights: People 33%, Process 41%,
-- Business Environment 26%. Each of the 26 ECO tasks is a course task, coded
-- I-1 … III-8 (the ECO task number with a hyphen).
--
-- Exams follow the other courses (100-question mixed / 20-question domain,
-- answers and explanations after submit). The PMP exam is taken without a
-- calculator, so the calculator button is hidden for this course.
--
-- The course starts hidden with exams disabled. Load the iParkar PMP26 bank with
-- scripts/import-pmp-bank.mjs (admin_import_rich_questions), publish it, then
-- make the course visible and enable exams in Admin → Courses.
-- iParkar Learning practice material; not affiliated with or endorsed by PMI.
-- =====================================================================

insert into public.courses (code, name, description, sort_order, exams_enabled, is_visible, calculator_enabled)
values ('PMP', 'Project Management Professional (PMP®)',
        'Practice examinations for the PMI Project Management Professional (PMP®) credential, aligned to the July 2026 Examination Content Outline.',
        7, false, false, false)
on conflict (code) do nothing;

-- ---------- domains ----------
insert into public.course_domains (course_id, code, number, name)
select c.id, d.code, d.number, d.name
from public.courses c
join (values
  ('D1', 1, 'People'),
  ('D2', 2, 'Process'),
  ('D3', 3, 'Business Environment')
) as d(code, number, name) on c.code = 'PMP'
on conflict (course_id, code) do nothing;

-- ---------- tasks = ECO tasks ----------
insert into public.course_tasks (course_id, domain_id, code, name, sort_order)
select c.id, cd.id, t.code, t.name, t.sort_order
from public.courses c
join (values
  ('D1', 'I-1', 'I.1 Develop a common vision', 1),
  ('D1', 'I-2', 'I.2 Manage conflicts', 2),
  ('D1', 'I-3', 'I.3 Lead the project team', 3),
  ('D1', 'I-4', 'I.4 Engage stakeholders', 4),
  ('D1', 'I-5', 'I.5 Align stakeholder expectations', 5),
  ('D1', 'I-6', 'I.6 Manage stakeholder expectations', 6),
  ('D1', 'I-7', 'I.7 Help ensure knowledge transfer', 7),
  ('D1', 'I-8', 'I.8 Plan and manage communication', 8),
  ('D2', 'II-1', 'II.1 Develop an integrated project management plan and plan delivery', 9),
  ('D2', 'II-2', 'II.2 Develop and manage project scope', 10),
  ('D2', 'II-3', 'II.3 Help ensure value-based delivery', 11),
  ('D2', 'II-4', 'II.4 Plan and manage resources', 12),
  ('D2', 'II-5', 'II.5 Plan and manage procurement', 13),
  ('D2', 'II-6', 'II.6 Plan and manage finance', 14),
  ('D2', 'II-7', 'II.7 Plan and optimize quality of products/deliverables', 15),
  ('D2', 'II-8', 'II.8 Plan and manage schedule', 16),
  ('D2', 'II-9', 'II.9 Evaluate project status', 17),
  ('D2', 'II-10', 'II.10 Manage project closure', 18),
  ('D3', 'III-1', 'III.1 Define and establish project governance', 19),
  ('D3', 'III-2', 'III.2 Plan and manage project compliance', 20),
  ('D3', 'III-3', 'III.3 Manage and control changes', 21),
  ('D3', 'III-4', 'III.4 Remove impediments and manage issues', 22),
  ('D3', 'III-5', 'III.5 Plan and manage risk', 23),
  ('D3', 'III-6', 'III.6 Continuous improvement', 24),
  ('D3', 'III-7', 'III.7 Support organizational change', 25),
  ('D3', 'III-8', 'III.8 Evaluate external business environment changes', 26)
) as t(domain_code, code, name, sort_order) on c.code = 'PMP'
join public.course_domains cd on cd.course_id = c.id and cd.code = t.domain_code
on conflict (course_id, code) do nothing;

-- ---------- blueprint ----------
insert into public.blueprints (course_id, name, source, version, effective_date, verification_status,
                               last_reviewed, is_current, notes)
select c.id, 'PMP Examination Content Outline (July 2026)',
       'PMI Project Management Professional (PMP)® Examination Content Outline, effective July 2026 (user-provided).',
       'ECO-2026-07', date '2026-07-01', 'verified', date '2026-11-22', true,
       'Three domains and 26 tasks transcribed from the ECO. Task codes (I-1 …) mirror the ECO task numbers.'
from public.courses c
where c.code = 'PMP' and not exists (select 1 from public.blueprints x where x.course_id = c.id);

insert into public.blueprint_domains (blueprint_id, domain_id, course_id, domain_name, weight, sort_order)
select b.id, cd.id, cd.course_id, cd.name, w.weight, cd.number
from public.blueprints b
join public.courses c on c.id = b.course_id and c.code = 'PMP'
join public.course_domains cd on cd.course_id = c.id
join (values ('D1', 33.0), ('D2', 41.0), ('D3', 26.0)) as w(domain_code, weight) on w.domain_code = cd.code
where b.is_current
on conflict do nothing;

insert into public.blueprint_tasks (blueprint_id, task_id, course_id, task_name, sort_order)
select b.id, ct.id, ct.course_id, ct.name, ct.sort_order
from public.blueprints b
join public.courses c on c.id = b.course_id and c.code = 'PMP'
join public.course_tasks ct on ct.course_id = c.id
where b.is_current
on conflict do nothing;

-- ---------- exam configurations (same as the other courses) ----------
insert into public.exams (course_id, mode, title, question_count, duration_minutes, feedback_policy)
select c.id, m.mode::public.exam_mode, m.title, m.n, m.minutes, 'after_submit'
from public.courses c
cross join (values
  ('mixed',  'Full mixed practice examination', 100, 150),
  ('domain', 'Domain practice examination',      20,  30)
) as m(mode, title, n, minutes)
where c.code = 'PMP'
on conflict (course_id, mode) do nothing;
