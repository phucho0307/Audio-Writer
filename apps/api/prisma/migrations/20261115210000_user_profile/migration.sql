-- Profile settings: a short bio, and when the handle was last changed.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "bio" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "handleChangedAt" TIMESTAMP(3);
