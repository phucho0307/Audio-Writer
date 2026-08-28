-- CreateTable
CREATE TABLE "audio_clips" (
    "id" UUID NOT NULL,
    "contributionId" UUID NOT NULL,
    "voice" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "durationMs" INTEGER,
    "bytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audio_clips_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audio_clips_contributionId_idx" ON "audio_clips"("contributionId");

-- CreateIndex
CREATE UNIQUE INDEX "audio_clips_contributionId_voice_key" ON "audio_clips"("contributionId", "voice");

-- AddForeignKey
ALTER TABLE "audio_clips" ADD CONSTRAINT "audio_clips_contributionId_fkey" FOREIGN KEY ("contributionId") REFERENCES "contributions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
