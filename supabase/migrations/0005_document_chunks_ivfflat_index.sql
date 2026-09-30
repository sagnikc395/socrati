-- ── 0005_document_chunks_ivfflat_index.sql ──────────────────────────────────
-- SUPERSEDED BY 0010_document_chunks_embedding_1536.sql — intentionally a no-op.
--
-- This migration originally created an ivfflat index on document_chunks.embedding
-- while 0003 had widened that column to vector(3072). pgvector caps ivfflat (and
-- hnsw) at 2000 dimensions, so the statement always failed with:
--
--   ERROR: column cannot have more than 2000 dimensions for ivfflat index
--
-- which aborted the migration run. It is left in place, empty, so that databases
-- which already recorded 0005 as applied stay consistent with fresh ones. 0010
-- sets the column to vector(1536) and creates the index.

select 1;
