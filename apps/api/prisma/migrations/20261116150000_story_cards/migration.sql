-- AI story search: one descriptive card per story, embedded and full-text
-- indexed. Additive only; rag_chunks is left in place.

CREATE TABLE IF NOT EXISTS "story_cards" (
    "storyId" UUID NOT NULL,
    "summary" TEXT NOT NULL,
    "tropes" TEXT[],
    "moods" TEXT[],
    "ending" TEXT NOT NULL,
    "keywords" TEXT[],
    "document" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "stale" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "embedding" vector(768),
    "search" tsvector GENERATED ALWAYS AS (to_tsvector('simple', immutable_unaccent(coalesce("document", '')))) STORED,
    CONSTRAINT "story_cards_pkey" PRIMARY KEY ("storyId")
);
ALTER TABLE "story_cards" ADD CONSTRAINT "story_cards_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "story_cards_embedding_idx" ON "story_cards" USING hnsw ("embedding" vector_cosine_ops);
CREATE INDEX IF NOT EXISTS "story_cards_search_idx" ON "story_cards" USING gin ("search");
