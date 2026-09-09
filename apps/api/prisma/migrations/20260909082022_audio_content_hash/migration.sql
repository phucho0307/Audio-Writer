-- AlterTable
ALTER TABLE "audio_clips" ADD COLUMN     "contentHash" TEXT;

-- CreateIndex
CREATE INDEX "audio_clips_contentHash_idx" ON "audio_clips"("contentHash");
