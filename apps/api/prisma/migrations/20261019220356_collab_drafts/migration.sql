-- CreateEnum
CREATE TYPE "CollabRole" AS ENUM ('EDITOR', 'VIEWER');

-- CreateTable
CREATE TABLE "branch_collaborators" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "CollabRole" NOT NULL DEFAULT 'EDITOR',
    "invitedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "branch_collaborators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "draft_docs" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "state" BYTEA NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT,
    "wordCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "draft_docs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "branch_collaborators_userId_idx" ON "branch_collaborators"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "branch_collaborators_branchId_userId_key" ON "branch_collaborators"("branchId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "draft_docs_branchId_key" ON "draft_docs"("branchId");

-- AddForeignKey
ALTER TABLE "branch_collaborators" ADD CONSTRAINT "branch_collaborators_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_collaborators" ADD CONSTRAINT "branch_collaborators_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draft_docs" ADD CONSTRAINT "draft_docs_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
