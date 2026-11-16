-- Email sign-up arrived with password accounts; their address is unproven
-- until a link we send is clicked.
ALTER TABLE "users" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);

-- Google only hands over verified addresses (sign-in refuses the others).
UPDATE "users" SET "emailVerifiedAt" = "createdAt" WHERE "googleSub" IS NOT NULL;
