CREATE TABLE "PracticeResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contestId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "totalScore" INTEGER NOT NULL,
    "correctCount" INTEGER NOT NULL,
    "answeredCount" INTEGER NOT NULL,
    "taskCount" INTEGER NOT NULL,
    "marks" TEXT NOT NULL DEFAULT '',
    "finishedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PracticeResult_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PracticeResult_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PracticeResult_contestId_teamId_key" ON "PracticeResult"("contestId", "teamId");
CREATE INDEX "PracticeResult_teamId_idx" ON "PracticeResult"("teamId");
