-- CSP Self Paced Study Course: course-wide reference resources.
-- Adds the guide's global glossary and bibliography as protected study resources, alongside
-- the per-domain formula sheets. Additive and re-runnable; no data changes.
-- Rollback: delete from study_resources where kind in ('glossary','bibliography');
--           then restore the original check (kind in ('formula_sheet')).

alter table public.study_resources drop constraint if exists study_resources_kind_check;
alter table public.study_resources
  add constraint study_resources_kind_check check (kind in ('formula_sheet', 'glossary', 'bibliography'));
