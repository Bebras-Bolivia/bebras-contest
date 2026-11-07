ALTER TABLE "Contest" ADD COLUMN "linkedContestId" TEXT;
ALTER TABLE "Team" ADD COLUMN "sourceTeamId" TEXT;
CREATE UNIQUE INDEX "Team_groupId_sourceTeamId_key" ON "Team"("groupId", "sourceTeamId");
CREATE INDEX "Contest_linkedContestId_idx" ON "Contest"("linkedContestId");
