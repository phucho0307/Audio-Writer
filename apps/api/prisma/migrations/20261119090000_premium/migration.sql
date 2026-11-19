-- Premium by bank transfer: the user's premium end date, the orders a
-- transfer is matched against, and every transfer SePay reports. Additive only.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "premiumUntil" TIMESTAMP(3);

DO $$ BEGIN
  CREATE TYPE "PremiumOrderStatus" AS ENUM ('PENDING', 'PAID', 'UNDERPAID');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "premium_orders" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "days" INTEGER NOT NULL,
    "status" "PremiumOrderStatus" NOT NULL DEFAULT 'PENDING',
    "paidAmount" INTEGER NOT NULL DEFAULT 0,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "premium_orders_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "premium_orders_code_key" ON "premium_orders"("code");
CREATE INDEX IF NOT EXISTS "premium_orders_userId_createdAt_idx" ON "premium_orders"("userId", "createdAt");
ALTER TABLE "premium_orders" ADD CONSTRAINT "premium_orders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "bank_transfers" (
    "id" UUID NOT NULL,
    "sepayId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "reference" TEXT,
    "orderId" UUID,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bank_transfers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "bank_transfers_sepayId_key" ON "bank_transfers"("sepayId");
CREATE INDEX IF NOT EXISTS "bank_transfers_receivedAt_idx" ON "bank_transfers"("receivedAt");
ALTER TABLE "bank_transfers" ADD CONSTRAINT "bank_transfers_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "premium_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
