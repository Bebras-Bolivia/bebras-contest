ALTER TABLE "User" ADD COLUMN "trialSessionId" TEXT;
ALTER TABLE "TaskDraft" ADD COLUMN "trialSessionId" TEXT;
ALTER TABLE "Contest" ADD COLUMN "trialSessionId" TEXT;
CREATE INDEX "User_trialSessionId_idx" ON "User"("trialSessionId");
CREATE INDEX "TaskDraft_trialSessionId_idx" ON "TaskDraft"("trialSessionId");
CREATE INDEX "Contest_trialSessionId_idx" ON "Contest"("trialSessionId");

UPDATE "User" SET "trialSessionId" = (
  SELECT "id" FROM "TrialSession"
  WHERE "User"."email" IN (
    'ensayo.' || lower(substr("TrialSession"."id", -8)) || '@prueba.bo',
    'ensayo.p' || lower(substr("TrialSession"."id", -8)) || '@prueba.bo'
  ) LIMIT 1
) WHERE "email" LIKE 'ensayo.%@prueba.bo';

UPDATE "Contest" SET "trialSessionId" = (
  SELECT "id" FROM "TrialSession"
  WHERE "Contest"."title" LIKE '[Ensayo]% · ' || "firstName" || ' ' || "lastName" || ' #' || substr("TrialSession"."id", -4)
  LIMIT 1
) WHERE "title" LIKE '[Ensayo]%';
