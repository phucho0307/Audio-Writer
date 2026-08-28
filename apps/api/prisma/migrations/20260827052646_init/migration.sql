-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "StoryStatus" AS ENUM ('DRAFTING', 'COMPLETE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "Visibility" AS ENUM ('PUBLIC', 'UNLISTED', 'PRIVATE');

-- CreateEnum
CREATE TYPE "AuthorType" AS ENUM ('HUMAN', 'AI');

-- CreateEnum
CREATE TYPE "RenderKind" AS ENUM ('AUDIO', 'VIDEO_PREVIEW', 'VIDEO_FULL');

-- CreateEnum
CREATE TYPE "RenderStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETE', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EntitlementKind" AS ENUM ('VIDEO_EXPORT', 'NEURAL_VOICE');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT,
    "googleSub" TEXT,
    "avatarUrl" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'vi',
    "byokProvider" TEXT,
    "byokKeyCipher" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "refreshHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "rotatedFrom" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stories" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "synopsis" TEXT,
    "genres" TEXT[],
    "language" TEXT NOT NULL DEFAULT 'vi',
    "status" "StoryStatus" NOT NULL DEFAULT 'DRAFTING',
    "visibility" "Visibility" NOT NULL DEFAULT 'PUBLIC',
    "contributionCount" INTEGER NOT NULL DEFAULT 0,
    "branchCount" INTEGER NOT NULL DEFAULT 1,
    "wordCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" UUID NOT NULL,
    "storyId" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'main',
    "isRoot" BOOLEAN NOT NULL DEFAULT false,
    "forkedFromBranchId" UUID,
    "forkedAtDepth" INTEGER,
    "lineage" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "headContributionId" UUID,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contributions" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "parentId" UUID,
    "depth" INTEGER NOT NULL,
    "authorId" UUID,
    "authorType" "AuthorType" NOT NULL,
    "content" JSONB NOT NULL,
    "textPlain" TEXT NOT NULL,
    "wordCount" INTEGER NOT NULL,
    "modelProvider" TEXT,
    "modelName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scenes" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "ord" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "imagePrompt" TEXT,
    "imageUrl" TEXT,
    "audioUrl" TEXT,
    "durationMs" INTEGER,
    "cues" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scenes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "render_jobs" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" "RenderKind" NOT NULL,
    "status" "RenderStatus" NOT NULL DEFAULT 'QUEUED',
    "stage" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT NOT NULL,
    "outputUrl" TEXT,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "render_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entitlements" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" "EntitlementKind" NOT NULL,
    "granted" INTEGER NOT NULL,
    "consumed" INTEGER NOT NULL DEFAULT 0,
    "orderId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" BIGSERIAL NOT NULL,
    "aggregateId" UUID NOT NULL,
    "topic" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_handle_key" ON "users"("handle");

-- CreateIndex
CREATE UNIQUE INDEX "users_googleSub_key" ON "users"("googleSub");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refreshHash_key" ON "sessions"("refreshHash");

-- CreateIndex
CREATE INDEX "sessions_userId_revokedAt_idx" ON "sessions"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "stories_visibility_status_updatedAt_idx" ON "stories"("visibility", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "stories_genres_idx" ON "stories" USING GIN ("genres");

-- CreateIndex
CREATE INDEX "branches_storyId_idx" ON "branches"("storyId");

-- CreateIndex
CREATE INDEX "branches_lineage_idx" ON "branches" USING GIN ("lineage");

-- CreateIndex
CREATE INDEX "contributions_branchId_depth_idx" ON "contributions"("branchId", "depth");

-- CreateIndex
CREATE UNIQUE INDEX "contributions_branchId_depth_key" ON "contributions"("branchId", "depth");

-- CreateIndex
CREATE UNIQUE INDEX "scenes_branchId_ord_key" ON "scenes"("branchId", "ord");

-- CreateIndex
CREATE UNIQUE INDEX "render_jobs_idempotencyKey_key" ON "render_jobs"("idempotencyKey");

-- CreateIndex
CREATE INDEX "render_jobs_userId_createdAt_idx" ON "render_jobs"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "render_jobs_status_updatedAt_idx" ON "render_jobs"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "entitlements_userId_kind_idx" ON "entitlements"("userId", "kind");

-- CreateIndex
CREATE INDEX "outbox_events_publishedAt_id_idx" ON "outbox_events"("publishedAt", "id");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stories" ADD CONSTRAINT "stories_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_forkedFromBranchId_fkey" FOREIGN KEY ("forkedFromBranchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "contributions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "render_jobs" ADD CONSTRAINT "render_jobs_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "render_jobs" ADD CONSTRAINT "render_jobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
