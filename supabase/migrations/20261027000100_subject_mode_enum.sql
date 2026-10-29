-- Subject-area practice: add the exam mode.
-- Kept in its own migration because a new enum value cannot be used in the
-- same transaction that adds it.
alter type public.exam_mode add value if not exists 'subject';
