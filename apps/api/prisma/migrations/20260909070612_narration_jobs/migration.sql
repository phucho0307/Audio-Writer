-- DropForeignKey
ALTER TABLE "render_jobs" DROP CONSTRAINT "render_jobs_userId_fkey";

-- AlterTable
ALTER TABLE "render_jobs" ADD COLUMN     "contributionId" UUID,
ADD COLUMN     "voice" TEXT,
ALTER COLUMN "userId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "render_jobs" ADD CONSTRAINT "render_jobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
