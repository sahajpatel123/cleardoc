-- ── Case model: enforce per-user case ownership ──────────────────────
--
-- The previous schema stored Analysis.caseId as a free-form string with no
-- referential integrity. Any string could be written, so cross-user caseId
-- collisions and confused-deputy bugs in future cross-case features were
-- possible. This migration introduces a real Case model owned by a single
-- user, gives Analysis.caseId a real foreign key, and backfills existing
-- data so production deploys don't lose case grouping.
--
-- Design:
--   Case.id  = global cuid (the new Analysis.caseId value)
--   Case.userId = owner (FK to User)
--   Case.slug = the user-visible caseId string (unique per user, NOT global)
--   Analysis.caseId = Case.id (FK, ON DELETE SET NULL preserves analyses)
--
-- The backfill creates one Case per (userId, oldCaseId) tuple and rewrites
-- every Analysis with that oldCaseId to point at the new Case.id. The old
-- string is preserved as slug so the API can continue to accept a string
-- "case id" from the client and resolve it to a Case row.

-- Step 1: create the Case table.
CREATE TABLE "Case" (
  "id"        TEXT         NOT NULL,
  "userId"    TEXT         NOT NULL,
  "slug"      TEXT         NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Case_pkey" PRIMARY KEY ("id")
);

-- Step 2: indices — slug is unique per user, and we list cases by user+time.
CREATE UNIQUE INDEX "Case_userId_slug_key" ON "Case" ("userId", "slug");
CREATE INDEX        "Case_userId_createdAt_idx" ON "Case" ("userId", "createdAt" DESC);

-- Step 3: Case.userId → User.id with CASCADE so a deleted user drops their
-- cases (and the analyses in them via ON DELETE SET NULL below).
ALTER TABLE "Case"
  ADD CONSTRAINT "Case_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Step 4: backfill. For each distinct (caseId, userId) tuple that exists in
-- Analysis, mint a new Case row with that tuple preserved as (userId, slug),
-- then rewrite every matching Analysis.caseId to the new Case.id.
DO $$
DECLARE
  r            RECORD;
  new_case_id  TEXT;
  updated_at   TIMESTAMP(3);
BEGIN
  FOR r IN
    SELECT "caseId", "userId", MIN("createdAt") AS first_at
    FROM "Analysis"
    WHERE "caseId" IS NOT NULL
    GROUP BY "caseId", "userId"
  LOOP
    new_case_id := 'c' || substr(md5(random()::text), 1, 24);
    updated_at  := r.first_at;
    INSERT INTO "Case" ("id", "userId", "slug", "createdAt")
    VALUES (new_case_id, r."userId", r."caseId", updated_at);
    UPDATE "Analysis"
    SET    "caseId" = new_case_id
    WHERE  "userId" = r."userId"
      AND  "caseId" = r."caseId";
  END LOOP;
END $$;

-- Step 5: add the Analysis.caseId → Case.id FK. ON DELETE SET NULL so that
-- deleting a Case (e.g. via a future case-archive feature) keeps the
-- Analysis rows but unlinks them from any case. The legacy column already
-- had an index, so no new index is needed.
ALTER TABLE "Analysis"
  ADD CONSTRAINT "Analysis_caseId_fkey"
  FOREIGN KEY ("caseId") REFERENCES "Case" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
