-- Working copies, visible only to their owner. Existing branches are all
-- either roots or forks, both of which are public, so false is correct.
ALTER TABLE "branches" ADD COLUMN     "isDraft" BOOLEAN NOT NULL DEFAULT false;
