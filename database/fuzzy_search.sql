-- Typo-tolerant search for the admin portal's search boxes. A contains-match
-- still ranks first; failing that, pg_trgm's word similarity lets "Althex" find
-- Althea and "Batista" find Bautista. 0.6 is pg_trgm's own default threshold:
-- 0.5 let a two-word search match everyone sharing the first name.
-- Apply before the resident_health_page section of server_paging.sql, which calls search_score.
-- Applied to the live project as migration `fuzzy_search`.
create extension if not exists pg_trgm with schema extensions;

-- 2 for a contains-match, else the similarity of the closest word run. Under three
-- characters there are no trigrams worth comparing, so only a contains-match counts.
create or replace function public.search_score(haystack text, needle text)
returns real
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when strpos(lower(haystack), lower(needle)) > 0 then 2
    when length(needle) < 3 then 0
    else extensions.word_similarity(lower(needle), lower(haystack))
  end
$$;

-- ponytail: sequential scan with a per-row score; a GIN trigram index on the
-- haystack when the registry outgrows a few tens of thousands of rows.
create or replace function public.search_resident_rows(search_text text)
returns setof public.resident_rows
language sql
stable
security invoker
set search_path = ''
as $$
  select resident.*
  from public.resident_rows as resident
  cross join lateral (
    select public.search_score(concat_ws(' ', resident.first_name, resident.last_name, resident.household_number), search_text) as score
  ) as match
  where match.score >= 0.6
  order by match.score desc, resident.last_name, resident.resident_id
$$;

create or replace function public.search_inventory_item_rows(search_text text)
returns setof public.inventory_item_rows
language sql
stable
security invoker
set search_path = ''
as $$
  select item.*
  from public.inventory_item_rows as item
  cross join lateral (
    select public.search_score(concat_ws(' ', item.item_name, item.type, item.barangay_name), search_text) as score
  ) as match
  where match.score >= 0.6
  order by match.score desc, item.item_name, item.item_id
$$;

revoke execute on function public.search_score(text, text) from public, anon;
revoke execute on function public.search_resident_rows(text) from public, anon;
revoke execute on function public.search_inventory_item_rows(text) from public, anon;
grant execute on function public.search_score(text, text) to authenticated;
grant execute on function public.search_resident_rows(text) to authenticated;
grant execute on function public.search_inventory_item_rows(text) to authenticated;
