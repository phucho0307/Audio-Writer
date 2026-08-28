-- CreateEnum
CREATE TYPE "LedgerKind" AS ENUM ('UNLOCK_EARNING', 'PAYOUT', 'ADJUSTMENT');

-- AlterEnum
ALTER TYPE "EntitlementKind" ADD VALUE 'READ_CREDITS';

-- AlterTable
ALTER TABLE "stories" ADD COLUMN     "freeChapters" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "unlockPrice" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "viewCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "story_unlocks" (
    "id" UUID NOT NULL,
    "storyId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "pricePaid" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "story_unlocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" "LedgerKind" NOT NULL,
    "amount" INTEGER NOT NULL,
    "storyId" UUID,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "story_unlocks_userId_createdAt_idx" ON "story_unlocks"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "story_unlocks_storyId_userId_key" ON "story_unlocks"("storyId", "userId");

-- CreateIndex
CREATE INDEX "ledger_entries_userId_createdAt_idx" ON "ledger_entries"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "story_unlocks" ADD CONSTRAINT "story_unlocks_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_unlocks" ADD CONSTRAINT "story_unlocks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
