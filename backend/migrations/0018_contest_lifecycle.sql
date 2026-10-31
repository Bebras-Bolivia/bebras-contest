ALTER TABLE "Contest" ADD COLUMN "stoppedAt" DATETIME;
ALTER TABLE "Contest" ADD COLUMN "trashedAt" DATETIME;
CREATE INDEX "Contest_trashedAt_idx" ON "Contest"("trashedAt");
