-- AlterTable
ALTER TABLE "Analysis" ADD COLUMN IF NOT EXISTS "parentId" TEXT;
ALTER TABLE "Analysis" ADD COLUMN IF NOT EXISTS "caseId" TEXT;
ALTER TABLE "Analysis" ADD COLUMN IF NOT EXISTS "chatMessages" JSONB;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Analysis_caseId_idx" ON "Analysis"("caseId");
CREATE INDEX IF NOT EXISTS "Analysis_parentId_idx" ON "Analysis"("parentId");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Analysis_parentId_fkey'
  ) THEN
    ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_parentId_fkey"
      FOREIGN KEY ("parentId") REFERENCES "Analysis"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
