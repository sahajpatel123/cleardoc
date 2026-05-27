-- AlterTable
ALTER TABLE "Analysis" ADD COLUMN "parentId" TEXT,
ADD COLUMN "caseId" TEXT,
ADD COLUMN "chatMessages" JSONB;

-- CreateIndex
CREATE INDEX "Analysis_caseId_idx" ON "Analysis"("caseId");

-- CreateIndex
CREATE INDEX "Analysis_parentId_idx" ON "Analysis"("parentId");

-- AddForeignKey
ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Analysis"("id") ON DELETE SET NULL ON UPDATE CASCADE;
