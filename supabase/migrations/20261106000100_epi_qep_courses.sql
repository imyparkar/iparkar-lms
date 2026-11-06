-- =====================================================================
-- iParkar LMS — GES/EPI and QEP courses (BGC environmental credentials)
--
-- Sources (user-provided, Board-approved documents):
--   * "Board for Global EHS Credentialing – General Environmental
--     Science/EPI Exam Blueprint", July 2023
--   * "BGC QEP Exam Blueprint", approved April 2023
--
-- Each course's domains are the blueprint's 16 scored topics (1.1 … 4.0).
-- The parent headings 1.0, 2.0 and 3.0 are groupings, not domains; their
-- percentages are the sums of their topics. Communication 4.0 is a topic.
-- Weights total 100 in both blueprints, so the 100-question mixed exam
-- takes exactly the published percentage from each topic.
--
-- Courses start with exams disabled; enable them in Admin → Courses once
-- the question banks are imported and published.
-- =====================================================================

-- Blueprint topic numbers contain a dot (1.1, 3.6). Allow dots in domain
-- and task codes; every existing code still matches.
alter table public.course_domains drop constraint if exists course_domains_code_check;
alter table public.course_domains add constraint course_domains_code_check
  check (code ~ '^[A-Za-z0-9.-]{1,12}$');
alter table public.course_tasks drop constraint if exists course_tasks_code_check;
alter table public.course_tasks add constraint course_tasks_code_check
  check (code ~ '^[A-Za-z0-9.-]{1,16}$');

-- ---------- courses ----------
insert into public.courses (code, name, description, sort_order, exams_enabled)
values
  ('EPI', 'General Environmental Science / Environmental Professional Intern (GES/EPI)',
   'Practice examinations for the BGC General Environmental Science (GES) exam and the EPI credential.', 4, false),
  ('QEP', 'Qualified Environmental Professional (QEP)',
   'Practice examinations for the BGC Qualified Environmental Professional (QEP) credential.', 5, false)
on conflict (code) do nothing;

-- ---------- domains = blueprint topics ----------
insert into public.course_domains (course_id, code, number, name)
select c.id, d.code, d.number, d.name
from public.courses c
join (values
  ('EPI', '1.1',  1, 'Basic Sciences'),
  ('EPI', '1.2',  2, 'Air'),
  ('EPI', '1.3',  3, 'Soil'),
  ('EPI', '1.4',  4, 'Water'),
  ('EPI', '1.5',  5, 'Waste'),
  ('EPI', '2.1',  6, 'Compliance'),
  ('EPI', '2.2',  7, 'Management'),
  ('EPI', '2.3',  8, 'Ethics'),
  ('EPI', '3.1',  9, 'Evaluation'),
  ('EPI', '3.2', 10, 'Treatment'),
  ('EPI', '3.3', 11, 'Remediation'),
  ('EPI', '3.4', 12, 'Monitoring'),
  ('EPI', '3.5', 13, 'Risk Assessment'),
  ('EPI', '3.6', 14, 'Environmental Math & Statistical Analysis'),
  ('EPI', '3.7', 15, 'Health and Safety'),
  ('EPI', '4.0', 16, 'Communication'),
  ('QEP', '1.1',  1, 'Air'),
  ('QEP', '1.2',  2, 'Soil'),
  ('QEP', '1.3',  3, 'Water'),
  ('QEP', '1.4',  4, 'Waste'),
  ('QEP', '2.1',  5, 'Management'),
  ('QEP', '2.2',  6, 'Environmental Capacity Building'),
  ('QEP', '2.3',  7, 'Compliance'),
  ('QEP', '2.4',  8, 'Ethics'),
  ('QEP', '3.1',  9, 'Critical Thinking'),
  ('QEP', '3.2', 10, 'Evaluation'),
  ('QEP', '3.3', 11, 'Treatment'),
  ('QEP', '3.4', 12, 'Remediation'),
  ('QEP', '3.5', 13, 'Monitoring'),
  ('QEP', '3.6', 14, 'Risk Assessment'),
  ('QEP', '3.7', 15, 'Env. Math & Statistical Analysis'),
  ('QEP', '4.0', 16, 'Communication')
) as d(course_code, code, number, name) on d.course_code = c.code
on conflict (course_id, code) do nothing;

-- ---------- blueprints ----------
insert into public.blueprints (course_id, name, source, version, effective_date, verification_status,
                               last_reviewed, is_current, notes)
select c.id, b.name, b.source, b.version, b.effective_date::date, 'verified', date '2026-11-06', true, b.notes
from public.courses c
join (values
  ('EPI', 'General Environmental Science/EPI Exam Blueprint',
          'Board for Global EHS Credentialing – General Environmental Science/EPI Exam Blueprint, July 2023 (user-provided).',
          'GES-2023.07', '2023-07-01',
          'Sixteen scored topics transcribed from the blueprint. Parent groupings: 1.0 Basic and Media Specific Science 40%, 2.0 EMS and Programs 10%, 3.0 Applying Environmental Technical and Related Skills 47%, 4.0 Communication 3%.'),
  ('QEP', 'BGC QEP Exam Blueprint',
          'BGC QEP Exam Blueprint, approved April 2023 (user-provided).',
          'QEP-2023.04', '2023-04-01',
          'Sixteen scored topics transcribed from the blueprint. Parent groupings: 1.0 Area of Specialization 25%, 2.0 EMS and Programs 16%, 3.0 Applying Environmental Technical and Related Skills 52%, 4.0 Communication 7%.')
) as b(course_code, name, source, version, effective_date, notes) on b.course_code = c.code
where not exists (select 1 from public.blueprints x where x.course_id = c.id);

insert into public.blueprint_domains (blueprint_id, domain_id, course_id, domain_name, weight, sort_order)
select b.id, cd.id, cd.course_id, cd.name, w.weight, cd.number
from public.blueprints b
join public.courses c on c.id = b.course_id
join public.course_domains cd on cd.course_id = c.id
join (values
  ('EPI', '1.1', 16), ('EPI', '1.2', 6), ('EPI', '1.3', 6), ('EPI', '1.4', 6), ('EPI', '1.5', 6),
  ('EPI', '2.1', 5), ('EPI', '2.2', 3), ('EPI', '2.3', 2),
  ('EPI', '3.1', 5), ('EPI', '3.2', 11), ('EPI', '3.3', 3), ('EPI', '3.4', 7), ('EPI', '3.5', 4),
  ('EPI', '3.6', 13), ('EPI', '3.7', 4), ('EPI', '4.0', 3),
  ('QEP', '1.1', 7), ('QEP', '1.2', 5), ('QEP', '1.3', 7), ('QEP', '1.4', 6),
  ('QEP', '2.1', 7), ('QEP', '2.2', 2), ('QEP', '2.3', 6), ('QEP', '2.4', 1),
  ('QEP', '3.1', 11), ('QEP', '3.2', 10), ('QEP', '3.3', 8), ('QEP', '3.4', 7), ('QEP', '3.5', 6),
  ('QEP', '3.6', 5), ('QEP', '3.7', 5), ('QEP', '4.0', 7)
) as w(course_code, domain_code, weight) on w.course_code = c.code and w.domain_code = cd.code
where b.is_current and c.code in ('EPI', 'QEP')
on conflict do nothing;

-- ---------- exam configurations (same as the other courses) ----------
insert into public.exams (course_id, mode, title, question_count, duration_minutes, feedback_policy)
select c.id, m.mode::public.exam_mode, m.title, m.n, m.minutes, 'after_submit'
from public.courses c
cross join (values
  ('mixed',  'Full mixed practice examination', 100, 150),
  ('domain', 'Domain practice examination',      20,  30)
) as m(mode, title, n, minutes)
where c.code in ('EPI', 'QEP')
on conflict (course_id, mode) do nothing;
