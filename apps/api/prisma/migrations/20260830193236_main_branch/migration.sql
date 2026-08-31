-- The branch readers land on. Null means the root branch, which is every
-- story until someone revises one, so existing rows need no backfill.
ALTER TABLE "stories" ADD COLUMN     "mainBranchId" UUID;

CREATE UNIQUE INDEX "stories_mainBranchId_key" ON "stories"("mainBranchId");

ALTER TABLE "stories" ADD CONSTRAINT "stories_mainBranchId_fkey" FOREIGN KEY ("mainBranchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
