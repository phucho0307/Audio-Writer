-- Reading progress (resume across devices), story follows (new-chapter
-- badges by comparison, no fan-out), and chapter comments. Additive only.

CREATE TABLE IF NOT EXISTS "reading_progress" (
    "userId" UUID NOT NULL,
    "storyId" UUID NOT NULL,
    "branchId" UUID,
    "depth" INTEGER NOT NULL,
    "positionSec" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "reading_progress_pkey" PRIMARY KEY ("userId", "storyId")
);
CREATE INDEX IF NOT EXISTS "reading_progress_userId_updatedAt_idx" ON "reading_progress"("userId", "updatedAt");
ALTER TABLE "reading_progress" ADD CONSTRAINT "reading_progress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reading_progress" ADD CONSTRAINT "reading_progress_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "story_follows" (
    "userId" UUID NOT NULL,
    "storyId" UUID NOT NULL,
    "seenChapters" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "story_follows_pkey" PRIMARY KEY ("userId", "storyId")
);
CREATE INDEX IF NOT EXISTS "story_follows_storyId_idx" ON "story_follows"("storyId");
ALTER TABLE "story_follows" ADD CONSTRAINT "story_follows_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "story_follows" ADD CONSTRAINT "story_follows_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "comments" (
    "id" UUID NOT NULL,
    "contributionId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "comments_contributionId_createdAt_idx" ON "comments"("contributionId", "createdAt");
CREATE INDEX IF NOT EXISTS "comments_userId_createdAt_idx" ON "comments"("userId", "createdAt");
ALTER TABLE "comments" ADD CONSTRAINT "comments_contributionId_fkey" FOREIGN KEY ("contributionId") REFERENCES "contributions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "comments" ADD CONSTRAINT "comments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
