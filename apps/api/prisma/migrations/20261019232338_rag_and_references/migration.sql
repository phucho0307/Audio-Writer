-- CreateEnum
CREATE TYPE "Genre" AS ENUM ('HORROR', 'THRILLER', 'ROMANCE', 'ACTION', 'INFIDELITY');

-- CreateEnum
CREATE TYPE "SourceKind" AS ENUM ('AUDIO_SITE', 'CHANNEL', 'APP', 'PUBLIC_DOMAIN');

-- CreateEnum
CREATE TYPE "CraftKind" AS ENUM ('TROPE', 'BEAT', 'OPENING', 'TWIST', 'SETTING');

-- CreateEnum
CREATE TYPE "ChunkKind" AS ENUM ('CRAFT', 'CHAPTER');

-- CreateTable
CREATE TABLE "reference_sources" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "kind" "SourceKind" NOT NULL,
    "genres" "Genre"[],
    "note" TEXT NOT NULL,
    "scale" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reference_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "craft_notes" (
    "id" UUID NOT NULL,
    "kind" "CraftKind" NOT NULL,
    "genre" "Genre" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sourceId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "craft_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rag_chunks" (
    "id" UUID NOT NULL,
    "kind" "ChunkKind" NOT NULL,
    "craftNoteId" UUID,
    "contributionId" UUID,
    "storyId" UUID,
    "genre" "Genre",
    "text" TEXT NOT NULL,
    "length" INTEGER NOT NULL,
    "embeddedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rag_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reference_sources_slug_key" ON "reference_sources"("slug");

-- CreateIndex
CREATE INDEX "craft_notes_genre_kind_idx" ON "craft_notes"("genre", "kind");

-- CreateIndex
CREATE INDEX "rag_chunks_kind_genre_idx" ON "rag_chunks"("kind", "genre");

-- CreateIndex
CREATE INDEX "rag_chunks_storyId_idx" ON "rag_chunks"("storyId");

-- AddForeignKey
ALTER TABLE "craft_notes" ADD CONSTRAINT "craft_notes_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "reference_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rag_chunks" ADD CONSTRAINT "rag_chunks_craftNoteId_fkey" FOREIGN KEY ("craftNoteId") REFERENCES "craft_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rag_chunks" ADD CONSTRAINT "rag_chunks_contributionId_fkey" FOREIGN KEY ("contributionId") REFERENCES "contributions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
