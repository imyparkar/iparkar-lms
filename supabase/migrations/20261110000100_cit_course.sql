-- =====================================================================
-- iParkar LMS — CIT (Certified Instructional Trainer) course
--
-- Source: BCSP CIT2 Examination Blueprint, V.2024.05.01 (user-provided).
-- Seven domains with the published weights (total 100%). Each of the 74
-- knowledge (K) and skill (S) statements is a course task, coded D1-K1 …
-- D7-S4 (iParkar tracking codes: domain, K/S, statement number).
-- Mixed exams take the published percentage from each domain using the
-- existing largest-remainder allocation.
--
-- The course starts with exams disabled. Import the CIT bank in
-- Admin → Questions → Import (course CIT), publish it, then enable exams
-- in Admin → Courses.
-- =====================================================================

insert into public.courses (code, name, description, sort_order, exams_enabled)
values ('CIT', 'Certified Instructional Trainer (CIT)',
        'Practice examinations for the BCSP Certified Instructional Trainer (CIT) credential.', 6, false)
on conflict (code) do nothing;

-- ---------- domains ----------
insert into public.course_domains (course_id, code, number, name)
select c.id, d.code, d.number, d.name
from public.courses c
join (values
  ('D1', 1, 'Communication and Facilitation Skills'),
  ('D2', 2, 'Needs Assessment'),
  ('D3', 3, 'Course Design'),
  ('D4', 4, 'Course Development'),
  ('D5', 5, 'Course Implementation'),
  ('D6', 6, 'Trainee Assessment'),
  ('D7', 7, 'Course Evaluation')
) as d(code, number, name) on c.code = 'CIT'
on conflict (course_id, code) do nothing;

-- ---------- tasks = blueprint knowledge and skill statements ----------
insert into public.course_tasks (course_id, domain_id, code, name, sort_order)
select c.id, cd.id, t.code, t.name, t.sort_order
from public.courses c
join (values
  ('D1', 'D1-K1', 'Communication techniques, styles, verbal and nonverbal cues, and feedback', 1),
  ('D1', 'D1-K2', 'Literacy considerations (read and write) for the learner', 2),
  ('D1', 'D1-K3', 'Technology applications appropriate for both the learner and the instructor', 3),
  ('D1', 'D1-K4', 'Instructional leadership methods (e.g., adult learning theory and audience engagement)', 4),
  ('D1', 'D1-S1', 'Apply appropriate communication/facilitation techniques', 5),
  ('D1', 'D1-S2', 'Apply conflict resolution techniques', 6),
  ('D1', 'D1-S3', 'Given a scenario, recognize, understand, and respond to nonverbal communication cues', 7),
  ('D1', 'D1-S4', 'Articulate administrative items associated with a training environment', 8),
  ('D1', 'D1-S5', 'Use language that is clear and concise for an audience', 9),
  ('D1', 'D1-S6', 'Identify and use proper styles of feedback (e.g., positive constructive, and corrective feedback)', 10),
  ('D2', 'D2-K1', 'Identifying performance outcome or changes', 11),
  ('D2', 'D2-K2', 'Defining target audience', 12),
  ('D2', 'D2-K3', 'Stakeholder needs (e.g., stakeholder objectives, organizational culture, target audience needs, and special needs)', 13),
  ('D2', 'D2-K4', 'Techniques for job and task analysis/gap analysis', 14),
  ('D2', 'D2-K5', 'Identifying aspects of trainee diversity (e.g., cultural, geographic, individual, organizational, generational, gender, accommodations for persons with disabilities, etc.)', 15),
  ('D2', 'D2-S1', 'Analyze training criteria (e.g., prerequisite course(s) and delivery strategies appropriate for the audience and environment)', 16),
  ('D2', 'D2-S2', 'Evaluate job description, knowledge, and performance', 17),
  ('D2', 'D2-S3', 'Evaluate existing training', 18),
  ('D2', 'D2-S4', 'Assess resources to determine if training is necessary', 19),
  ('D2', 'D2-S5', 'Perform gap analysis', 20),
  ('D2', 'D2-S6', 'Verify training topics needed (e.g., per organization policies or regulatory requirements)', 21),
  ('D2', 'D2-S7', 'Verify knowledge, skills, and abilities required for the jobs being reviewed', 22),
  ('D2', 'D2-S8', 'Develop and perform a task analysis of work performed', 23),
  ('D3', 'D3-K1', 'Adult learning strategies (e.g., collective learning, dynamic learning, interactive learning, experiential learning, etc.)', 24),
  ('D3', 'D3-K2', 'Instructional systems design (e.g., the ADDIE model [analysis, design, development, implementation, evaluation], systematic approach to training [SAT], Successive Approximation Model [SAM], AGILE, etc.)', 25),
  ('D3', 'D3-K3', 'Minimum requirements for training to meet applicable regulatory, consensus, and performance standards, if and when required', 26),
  ('D3', 'D3-K4', 'Learning objective hierarchy (e.g., Bloom''s taxonomy)', 27),
  ('D3', 'D3-K5', 'Techniques for determining target audience baseline knowledge level', 28),
  ('D3', 'D3-K6', 'Resources management', 29),
  ('D3', 'D3-K7', 'Cost-benefit analysis techniques (e.g., direct and indirect costs)', 30),
  ('D3', 'D3-S1', 'Apply the Instructional Systems Design process (e.g., the ADDIE model, etc.)', 31),
  ('D3', 'D3-S2', 'Establish training goals and learning objectives (criterion, condition, and action, e.g., Specific, Measurable, Actionable, Realistic, Time-oriented [SMART] or Terminal Learning Objective [TLO], and Enabling Learning Objective [ELO])', 32),
  ('D3', 'D3-S3', 'Define expected participant learning outcomes (e.g., behavior change, transfer of knowledge, and skill development)', 33),
  ('D3', 'D3-S4', 'Prioritize tasks/topics to be trained', 34),
  ('D3', 'D3-S5', 'Use appropriate teaching strategy (e.g., blended learning strategies, audiovisual aids, simulators, video demonstrations, instructor-led classroom, instructor-led online, electronic learning [eLearning], and mobile learning [mLearning])', 35),
  ('D3', 'D3-S6', 'Validate credibility of information', 36),
  ('D3', 'D3-S7', 'Build consensus with stakeholders about objectives', 37),
  ('D4', 'D4-K1', 'Lesson plan components (e.g., trainee materials, instructor manuals, handouts, job aids, group activities/simulations, etc.)', 38),
  ('D4', 'D4-K2', 'Available training delivery modalities (e.g., blended learning, distributed learning, electronic learning [eLearning], mobile learning [mLearning], instructor-led online training, computer-based training, classroom training, and on-the-job training [OJT])', 39),
  ('D4', 'D4-K3', 'Validation criteria (e.g., references, regulations, and consensus standards)', 40),
  ('D4', 'D4-K4', 'Subject matter expert requirements and selection, planning, and coordination', 41),
  ('D4', 'D4-K5', 'Implementation of instructional development plan', 42),
  ('D4', 'D4-K6', 'Representative training sample for pilot (beta) test', 43),
  ('D4', 'D4-K7', 'Recordkeeping requirements (e.g., record retention, hardcopy, digital, onsite and offsite storage, information security, privacy laws, recoverability, regulatory, and stakeholder)', 44),
  ('D4', 'D4-S1', 'Develop lesson plan components', 45),
  ('D4', 'D4-S2', 'Determine when to outsource development', 46),
  ('D4', 'D4-S3', 'Develop checklists for review, comment, consensus, and validation', 47),
  ('D4', 'D4-S4', 'Analyze and use results of pilot evaluation to improve the course (e.g., clarity of lesson plan, effectiveness of activities, flow, and timing)', 48),
  ('D5', 'D5-K1', 'Learning environment impacts on student experience', 49),
  ('D5', 'D5-K2', 'Learning environment selection and set-up options (e.g., classroom, field, and online)', 50),
  ('D5', 'D5-K3', 'Logistical considerations (e.g., scheduling, resources, online deployment, travel, registration, communication, and creating learning environments [distractions, temperature, lighting, and noise])', 51),
  ('D5', 'D5-S1', 'Implement a plan to achieve learning outcomes and objectives', 52),
  ('D5', 'D5-S2', 'Adapt instructional delivery to an audience as needed', 53),
  ('D5', 'D5-S3', 'Recognize and apply opportunities for collective learning', 54),
  ('D5', 'D5-S4', 'Manage course time effectively', 55),
  ('D5', 'D5-S5', 'Maintain trainee engagement and recognize indicators of trainee disengagement (e.g., trainee confusion, browsing the internet during the training, sending email, texting on the phone, boredom, hostility, principles of adult learning, etc.)', 56),
  ('D5', 'D5-S6', 'Create and maintain a record-keeping system that is recoverable', 57),
  ('D5', 'D5-S7', 'Verify prerequisite(s) (e.g., licensure, medical fitness, physical, knowledge, regulatory, best practices, corporate/internal, etc.)', 58),
  ('D5', 'D5-S8', 'Anticipate and respond to technical challenges of online training', 59),
  ('D6', 'D6-K1', 'Performance standards (e.g., stakeholder expectations, regulatory and other requirements, standard operating procedures and guidelines)', 60),
  ('D6', 'D6-K2', 'Assessment tools (e.g., materials, tests, activities, management observations, surveys, and quality and time comparisons [before and after])', 61),
  ('D6', 'D6-S1', 'Relate standards (e.g., regulatory, best practices, and organization) and specifications to Assessement criteria', 62),
  ('D6', 'D6-S2', 'Implement assessment tools (e.g., test questions and skill checklists)', 63),
  ('D6', 'D6-S3', 'Align assessment to the learning objectives and outcomes', 64),
  ('D6', 'D6-S4', 'Re-train and/or re-test trainee(s) as appropriate', 65),
  ('D6', 'D6-S5', 'Document and report behavior changes', 66),
  ('D7', 'D7-K1', 'Course evaluation techniques (e.g., Kirkpatrick Evaluation Model, etc.)', 67),
  ('D7', 'D7-K2', 'Feedback, including surveys', 68),
  ('D7', 'D7-K3', 'Post-course behavior evaluation techniques', 69),
  ('D7', 'D7-K4', 'Data collection and analysis', 70),
  ('D7', 'D7-S1', 'Develop and administer course evaluation instruments (e.g., classroom feedback sheet, self-evaluation, etc.)', 71),
  ('D7', 'D7-S2', 'Evaluate course outcomes (e.g., course objectives; jobsite observations to assess and evaluate on-the-job performance; workplace audits and management observation; job performance reports)', 72),
  ('D7', 'D7-S3', 'Use results of an evaluation to recommend/implement improvements', 73),
  ('D7', 'D7-S4', 'Prepare training reports', 74)
) as t(domain_code, code, name, sort_order) on c.code = 'CIT'
join public.course_domains cd on cd.course_id = c.id and cd.code = t.domain_code
on conflict (course_id, code) do nothing;

-- ---------- blueprint ----------
insert into public.blueprints (course_id, name, source, version, effective_date, verification_status,
                               last_reviewed, is_current, notes)
select c.id, 'CIT2 Examination Blueprint',
       'BCSP Certified Instructional Trainer (CIT2) Examination Blueprint, V.2024.05.01 (user-provided).',
       'CIT2-2024.05.01', date '2024-05-01', 'verified', date '2026-11-10', true,
       'Seven domains and 74 knowledge/skill statements transcribed from the blueprint. Statement codes (D1-K1 …) are iParkar tracking codes.'
from public.courses c
where c.code = 'CIT' and not exists (select 1 from public.blueprints x where x.course_id = c.id);

insert into public.blueprint_domains (blueprint_id, domain_id, course_id, domain_name, weight, sort_order)
select b.id, cd.id, cd.course_id, cd.name, w.weight, cd.number
from public.blueprints b
join public.courses c on c.id = b.course_id and c.code = 'CIT'
join public.course_domains cd on cd.course_id = c.id
join (values ('D1', 18.6), ('D2', 13.8), ('D3', 14.4), ('D4', 15.6), ('D5', 15.7), ('D6', 11.9), ('D7', 10.0)) as w(domain_code, weight) on w.domain_code = cd.code
where b.is_current
on conflict do nothing;

insert into public.blueprint_tasks (blueprint_id, task_id, course_id, task_name, sort_order)
select b.id, ct.id, ct.course_id, ct.name, ct.sort_order
from public.blueprints b
join public.courses c on c.id = b.course_id and c.code = 'CIT'
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
where c.code = 'CIT'
on conflict (course_id, mode) do nothing;
