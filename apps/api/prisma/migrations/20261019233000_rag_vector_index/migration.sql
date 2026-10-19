-- The retrieval index proper: the embedding column, its ANN index, and a
-- lexical index beside it. Prisma has no mapping for any of these, so they are
-- written by hand and read through raw SQL.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- 768 dimensions: gemini-embedding-001 asked for that width. The number is
-- fixed in the column, so changing model means a migration and a reindex,
-- which is the honest cost of changing it.
ALTER TABLE "rag_chunks" ADD COLUMN IF NOT EXISTS "embedding" vector(768);

-- HNSW rather than IVFFlat: it needs no training pass over existing rows, so an
-- index built on an empty table stays correct as the corpus grows - which is
-- the situation here, where chapters arrive one at a time forever.
--
-- Cosine distance, because the embeddings are normalised and only direction
-- carries meaning.
CREATE INDEX IF NOT EXISTS "rag_chunks_embedding_idx"
  ON "rag_chunks" USING hnsw ("embedding" vector_cosine_ops);

-- Lexical half of the hybrid search.
--
-- 'simple' rather than a language configuration: Postgres ships no Vietnamese
-- stemmer, and running English rules over Vietnamese mangles it. Unaccented, so
-- "ma quy" finds "ma quỷ" - which matters when readers type without tones.
-- unaccent() is only stable, not immutable: its result depends on a dictionary
-- that could in principle be reloaded, so Postgres refuses it in a generated
-- column. Pinning the dictionary by name makes the call deterministic, which is
-- what the immutable marker is promising.
CREATE OR REPLACE FUNCTION immutable_unaccent(text)
  RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

ALTER TABLE "rag_chunks"
  ADD COLUMN IF NOT EXISTS "search" tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', immutable_unaccent(coalesce("text", '')))) STORED;

CREATE INDEX IF NOT EXISTS "rag_chunks_search_idx"
  ON "rag_chunks" USING gin ("search");
