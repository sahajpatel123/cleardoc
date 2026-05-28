-- Step 1: add nullable columns and indexes (quick, brief lock)
ALTER TABLE "Analysis" ADD COLUMN "parentId" TEXT,
ADD COLUMN "caseId" TEXT,
ADD COLUMN "chatMessages" JSONB;

-- Step 2: create indexes concurrently to avoid locking the table
CREATE INDEX CONCURRENTLY "Analysis_caseId_idx" ON "Analysis"("caseId");
CREATE INDEX CONCURRENTLY "Analysis_parentId_idx" ON "Analysis"("parentId");

-- Step 3: add FK with NOT VALID (doesn't lock the table for validation)
ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "Analysis"("id")
  ON DELETE SET NULL ON UPDATE CASCADE
  NOT VALID;
