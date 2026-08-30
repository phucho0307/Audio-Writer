-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');

-- AlterTable
ALTER TABLE "stories" ALTER COLUMN "allowForks" DROP NOT NULL,
ALTER COLUMN "allowForks" DROP DEFAULT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "role" "Role" NOT NULL DEFAULT 'USER';
