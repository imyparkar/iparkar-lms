-- Course-wide search for self-paced study courses (CSP-SPS, ASP-SPS).
-- Searches the learner's own pinned course version: section text and the course resources
-- (glossary, bibliography, formula sheets). Same gate as get_study_chapter: active enrollment
-- with current access. Activities (prompts, options, keys) are never searched. Queries are not
-- stored or logged. Additive and re-runnable.
-- Rollback: drop function public.study_search(text, text);  (then the columns below, then
--           study_blocks_text(jsonb) and study_block_text(jsonb))
--           alter table public.study_sections drop column search_text, drop column search_tsv;
--           alter table public.study_resources drop column search_text, drop column search_tsv;

-- Readable text of one block, fields in reading order: no TeX, image keys or type names.
create or replace function public.study_block_text(b jsonb) returns text
language sql immutable set search_path = public as $$
  select concat_ws(' ',
    b ->> 'title', b ->> 'label', b ->> 'caption', b ->> 'text', b ->> 'md', b ->> 'body', b ->> 'decision', b ->> 'given',
    (select string_agg(x #>> '{}', ' ') from jsonb_array_elements(case when jsonb_typeof(b -> 'columns') = 'array' then b -> 'columns' else '[]' end) x),
    (select string_agg(c #>> '{}', ' ') from jsonb_array_elements(case when jsonb_typeof(b -> 'rows') = 'array' then b -> 'rows' else '[]' end) r,
            jsonb_array_elements(case when jsonb_typeof(r) = 'array' then r else '[]' end) c),
    (select string_agg(x #>> '{}', ' ') from jsonb_array_elements(case when jsonb_typeof(b -> 'items') = 'array' then b -> 'items' else '[]' end) x
      where jsonb_typeof(x) = 'string'),
    (select string_agg(concat_ws(' ', st ->> 'label', st ->> 'md',
              (select string_agg(c #>> '{}', ' ') from jsonb_array_elements(coalesce(st #> '{table,rows}', '[]')) r,
                      jsonb_array_elements(case when jsonb_typeof(r) = 'array' then r else '[]' end) c)), ' ')
       from jsonb_array_elements(case when jsonb_typeof(b -> 'steps') = 'array' then b -> 'steps' else '[]' end) st),
    b ->> 'answer',
    (select string_agg(concat_ws(': ', t ->> 'term', t ->> 'definition'), ' ') from jsonb_array_elements(case when jsonb_typeof(b -> 'terms') = 'array' then b -> 'terms' else '[]' end) t),
    (select string_agg(c ->> 'code' || ' ' || (c ->> 'title'), ' ') from jsonb_array_elements(case when jsonb_typeof(b -> 'chapters') = 'array' then b -> 'chapters' else '[]' end) c),
    b ->> 'description');
$$;

create or replace function public.study_blocks_text(p jsonb) returns text
language sql immutable set search_path = public as $$
  select regexp_replace(regexp_replace(coalesce(string_agg(public.study_block_text(b), ' ' order by n), ''),
           '\*+|\\\(|\\\)', '', 'g'), '\s+', ' ', 'g')
  from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]' end) with ordinality as t(b, n);
$$;

-- Searchable text is stored with the content (generated, so every import keeps it current).
alter table public.study_sections
  add column if not exists search_text text generated always as (public.study_blocks_text(blocks)) stored;
alter table public.study_sections
  add column if not exists search_tsv tsvector generated always as (to_tsvector('english', public.study_blocks_text(blocks))) stored;
alter table public.study_resources
  add column if not exists search_text text generated always as (public.study_blocks_text(blocks)) stored;
alter table public.study_resources
  add column if not exists search_tsv tsvector generated always as (to_tsvector('english', public.study_blocks_text(blocks))) stored;
create index if not exists study_sections_search_idx on public.study_sections using gin (search_tsv);
create index if not exists study_resources_search_idx on public.study_resources using gin (search_tsv);

create or replace function public.study_search(p_course_code text, p_query text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  e study_enrollments; q text; tsq tsquery; pat text;
begin
  e := public.study_my_enrollment(p_course_code);
  if e.id is null then return jsonb_build_object('ok', false, 'error', 'not_enrolled'); end if;
  if not public.study_has_access(e) then return jsonb_build_object('ok', false, 'error', 'access_expired'); end if;
  q := btrim(left(coalesce(p_query, ''), 200));
  if char_length(q) < 2 then return jsonb_build_object('ok', true, 'query', q, 'results', '[]'::jsonb, 'resources', '[]'::jsonb); end if;
  tsq := websearch_to_tsquery('english', q);
  pat := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return jsonb_build_object('ok', true, 'query', q,
    'results', (select coalesce(jsonb_agg(z.r order by z.rk desc, z.so), '[]'::jsonb) from (
      select jsonb_build_object(
               'chapter', ch.code, 'chapter_title', ch.title, 'domain', d.number,
               'section', s.code, 'section_title', s.title,
               'snippet', ts_headline('english', t.txt, tsq,
                            'StartSel=[[, StopSel=]], MaxWords=28, MinWords=12, MaxFragments=1, ShortWord=2')) r,
             m.rk, ch.sort_order * 1000 + s.sort_order so
        from study_sections s
        join study_chapters ch on ch.id = s.chapter_id
        join study_domains d on d.id = ch.domain_id
        cross join lateral (select s.search_text txt) t
        cross join lateral (select ts_rank(s.search_tsv, tsq) + case when s.search_text ilike pat then 1 else 0 end rk) m
       where s.version_id = e.version_id
         and (s.search_tsv @@ tsq or s.search_text ilike pat)
       order by m.rk desc, ch.sort_order, s.sort_order limit 40) z),
    'glossary', (select coalesce(jsonb_agg(g order by g ->> 'term'), '[]'::jsonb) from (
      select jsonb_build_object('term', t ->> 'term', 'definition', regexp_replace(t ->> 'definition', '\*+', '', 'g')) g
        from study_resources x
        cross join lateral jsonb_array_elements(case when jsonb_typeof(x.blocks) = 'array' then x.blocks else '[]' end) bl
        cross join lateral jsonb_array_elements(case when bl ->> 'type' = 'glossary' and jsonb_typeof(bl -> 'terms') = 'array'
                                                     then bl -> 'terms' else '[]' end) t
       where x.version_id = e.version_id and x.kind = 'glossary'
         and (to_tsvector('english', concat_ws(' ', t ->> 'term', t ->> 'definition')) @@ tsq
              or concat_ws(' ', t ->> 'term', t ->> 'definition') ilike pat)
       order by (t ->> 'term') ilike pat desc, char_length(t ->> 'term') limit 8) gz),
    'resources', (select coalesce(jsonb_agg(jsonb_build_object(
               'code', x.code, 'kind', x.kind, 'domain', x.domain_number, 'title', x.title,
               'snippet', ts_headline('english', t.txt, tsq,
                            'StartSel=[[, StopSel=]], MaxWords=28, MinWords=12, MaxFragments=1, ShortWord=2'))
               order by x.kind, x.domain_number), '[]'::jsonb)
        from study_resources x
        cross join lateral (select x.search_text txt) t
       where x.version_id = e.version_id
         and (x.search_tsv @@ tsq or x.search_text ilike pat)));
end $$;

revoke all on function public.study_search(text, text), public.study_blocks_text(jsonb), public.study_block_text(jsonb) from public, anon;
grant execute on function public.study_search(text, text) to authenticated;
