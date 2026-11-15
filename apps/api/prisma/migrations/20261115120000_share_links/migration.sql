-- Link sharing for draft rooms (Google Docs style).
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "shareToken" TEXT;
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "linkAccess" "CollabRole";
CREATE UNIQUE INDEX IF NOT EXISTS "branches_shareToken_key" ON "branches"("shareToken");
ALTER TABLE "branch_collaborators" ADD COLUMN IF NOT EXISTS "viaLink" BOOLEAN NOT NULL DEFAULT false;
