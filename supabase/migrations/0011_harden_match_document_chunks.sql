-- ── 0011_harden_match_document_chunks.sql ───────────────────────────────────
-- Hardens the retrieval RPC without changing its contract:
--
--  * `set search_path = ''` — a function without a pinned search_path can be
--    hijacked by a caller-controlled schema resolving `document_chunks` to a
--    different table. All references are now schema-qualified.
--  * `security invoker` (explicit) — retrieval must run as the calling user so
--    the RLS policy on document_chunks continues to scope results to documents
--    the user owns. This function must never become security definer.
--  * `stable` — it performs no writes, so Postgres may cache results within a
--    statement.
--  * empty/NULL filter_document_ids returns no rows instead of scanning.

create or replace function public.match_document_chunks (
  query_embedding vector,
  match_count int,
  filter_document_ids uuid[]
) returns table (
  chunk_id uuid,
  document_id uuid,
  content text,
  similarity float
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if filter_document_ids is null or cardinality(filter_document_ids) = 0 then
    return;
  end if;

  return query
  select
    c.chunk_id,
    c.document_id,
    c.content,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.document_chunks c
  where c.document_id = any(filter_document_ids)
    and c.embedding is not null
  order by c.embedding <=> query_embedding
  limit greatest(match_count, 1);
end;
$$;

notify pgrst, 'reload schema';
