-- Reader ratings (1-5 stars, one per reader per story) and the record of who
-- has opened a story, which rating requires. Additive only.

ALTER TABLE "stories" ADD COLUMN IF NOT EXISTS "ratingCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "stories" ADD COLUMN IF NOT EXISTS "ratingSum" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "story_ratings" (
    "id" UUID NOT NULL,
    "storyId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "stars" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "story_ratings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "story_ratings_stars_check" CHECK ("stars" BETWEEN 1 AND 5)
);
CREATE UNIQUE INDEX IF NOT EXISTS "story_ratings_storyId_userId_key" ON "story_ratings"("storyId", "userId");
CREATE INDEX IF NOT EXISTS "story_ratings_userId_idx" ON "story_ratings"("userId");
ALTER TABLE "story_ratings" ADD CONSTRAINT "story_ratings_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "story_ratings" ADD CONSTRAINT "story_ratings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "story_readers" (
    "storyId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "firstReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "story_readers_pkey" PRIMARY KEY ("storyId", "userId")
);
CREATE INDEX IF NOT EXISTS "story_readers_userId_idx" ON "story_readers"("userId");
ALTER TABLE "story_readers" ADD CONSTRAINT "story_readers_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "story_readers" ADD CONSTRAINT "story_readers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
