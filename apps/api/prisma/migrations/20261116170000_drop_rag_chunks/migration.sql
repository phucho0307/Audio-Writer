-- The chapter-passage RAG index was retired on 2026-11-16 and its code
-- removed; AI search uses story_cards instead. Nothing reads this table.
DROP TABLE IF EXISTS "rag_chunks";
DROP TYPE IF EXISTS "ChunkKind";
