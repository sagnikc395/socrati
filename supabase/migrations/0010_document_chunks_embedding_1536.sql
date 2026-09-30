-- ── 0010_document_chunks_embedding_1536.sql ──────────────────────────────────
-- Fixes an unappliable schema: 0003 widened document_chunks.embedding to
-- vector(3072), but 0005 then tries to build an ivfflat index on it. pgvector
-- rejects that — ivfflat and hnsw both support at most 2000 dimensions — so
-- 0005 fails and the table is left with no vector index at all, making every
-- retrieval a sequential scan.
--
-- gemini-embedding-001 supports outputDimensionality, so the application now
-- requests 1536-dimension vectors (see apps/web/lib/embedder.ts). This
-- migration brings the column in line and builds the index that 0005 could not.
--
-- Existing 3072-dim rows cannot be meaningfully truncated here, and they were
-- embedded by a different configuration, so they are deleted and the affected
-- documents are reset to 'pending' for re-ingestion.

-- ── 1. Drop the index if a previous run managed to create one ────────────────
drop index if exists public.document_chunks_embedding_idx;

-- ── 2. Reset documents whose chunks are about to be discarded ────────────────
do $$
declare
    current_dim int;
begin
    select atttypmod
      into current_dim
      from pg_attribute
     where attrelid = 'public.document_chunks'::regclass
       and attname = 'embedding'
       and not attisdropped;

    if current_dim is distinct from 1536 then
        update public.documents d
           set parse_status = 'pending',
               error_message = null
         where exists (
                   select 1
                     from public.document_chunks c
                    where c.document_id = d.document_id
               );

        delete from public.document_chunks;
    end if;
end $$;

-- ── 3. Align the column with the embedder ────────────────────────────────────
alter table public.document_chunks
    alter column embedding type vector(1536)
    using embedding::vector(1536);

-- ── 4. Build the index pgvector will actually accept ────────────────────────
-- lists = 100 suits tables up to roughly 1M rows. Rebuild after a bulk load:
--   reindex index public.document_chunks_embedding_idx;
-- Tune recall at query time with:
--   set ivfflat.probes = 10;
create index if not exists document_chunks_embedding_idx
    on public.document_chunks
    using ivfflat (embedding vector_cosine_ops)
    with (lists = 100);

notify pgrst, 'reload schema';
