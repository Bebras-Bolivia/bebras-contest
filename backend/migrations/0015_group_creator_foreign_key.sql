CREATE TABLE "_cleanup_ContestGroup" AS SELECT * FROM "ContestGroup";

CREATE TABLE "_cleanup_Team" AS SELECT * FROM "Team";

CREATE TABLE "_cleanup_Attempt" AS SELECT * FROM "Attempt";

CREATE TABLE "_cleanup_AttemptAnswer" AS SELECT * FROM "AttemptAnswer";

CREATE TABLE "_cleanup_Result" AS SELECT * FROM "Result";

DROP TABLE "Result";

DROP TABLE "AttemptAnswer";

DROP TABLE "Attempt";

DROP TABLE "Team";

DROP TABLE "ContestGroup";

CREATE TABLE "ContestGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contestId" TEXT NOT NULL,
    "createdById" INTEGER,
    "name" TEXT NOT NULL,
    "accessCode" TEXT NOT NULL,
    "recoveryCode" TEXT NOT NULL,
    "firstUsedAt" DATETIME,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "category" TEXT,
    CONSTRAINT "ContestGroup_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ContestGroup_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "ContestGroup" ("id", "contestId", "createdById", "name", "accessCode", "recoveryCode", "firstUsedAt", "expiresAt", "createdAt", "updatedAt", "category") SELECT "id", "contestId", "createdById", "name", "accessCode", "recoveryCode", "firstUsedAt", "expiresAt", "createdAt", "updatedAt", "category" FROM "_cleanup_ContestGroup";

CREATE TABLE "Team" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "participationMode" TEXT NOT NULL DEFAULT 'individual' CHECK ("participationMode" IN ('individual', 'pareja')),
    "grade" TEXT,
    "memberOneFirstName" TEXT NOT NULL,
    "memberOneLastName" TEXT NOT NULL,
    "memberTwoFirstName" TEXT,
    "memberTwoLastName" TEXT,
    "personalCode" TEXT NOT NULL,
    "sessionToken" TEXT,
    "sessionSeenAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'registered' CHECK ("status" IN ('registered')),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Team_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ContestGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "Team" ("id", "groupId", "participationMode", "grade", "memberOneFirstName", "memberOneLastName", "memberTwoFirstName", "memberTwoLastName", "personalCode", "sessionToken", "sessionSeenAt", "status", "createdAt", "updatedAt") SELECT "id", "groupId", "participationMode", "grade", "memberOneFirstName", "memberOneLastName", "memberTwoFirstName", "memberTwoLastName", "personalCode", "sessionToken", "sessionSeenAt", "status", "createdAt", "updatedAt" FROM "_cleanup_Team";

CREATE TABLE "Attempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teamId" TEXT NOT NULL,
    "startedAt" DATETIME,
    "endsAt" DATETIME,
    "finishedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'in_progress', 'finished')),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'online' CHECK ("mode" IN ('online', 'paper')),
    CONSTRAINT "Attempt_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "Attempt" ("id", "teamId", "startedAt", "endsAt", "finishedAt", "status", "createdAt", "updatedAt", "mode") SELECT "id", "teamId", "startedAt", "endsAt", "finishedAt", "status", "createdAt", "updatedAt", "mode" FROM "_cleanup_Attempt";

CREATE TABLE "AttemptAnswer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "attemptId" TEXT NOT NULL,
    "taskDraftId" TEXT NOT NULL,
    "responsePayload" TEXT NOT NULL,
    "isCorrect" BOOLEAN,
    "score" INTEGER NOT NULL DEFAULT 0,
    "answeredAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AttemptAnswer_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AttemptAnswer_taskDraftId_fkey" FOREIGN KEY ("taskDraftId") REFERENCES "TaskDraft" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "AttemptAnswer" ("id", "attemptId", "taskDraftId", "responsePayload", "isCorrect", "score", "answeredAt", "createdAt", "updatedAt") SELECT "id", "attemptId", "taskDraftId", "responsePayload", "isCorrect", "score", "answeredAt", "createdAt", "updatedAt" FROM "_cleanup_AttemptAnswer";

CREATE TABLE "Result" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "attemptId" TEXT NOT NULL,
    "totalScore" INTEGER NOT NULL DEFAULT 0,
    "correctCount" INTEGER NOT NULL DEFAULT 0,
    "answeredCount" INTEGER NOT NULL DEFAULT 0,
    "rankPosition" INTEGER,
    "calculatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Result_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "Result" ("id", "attemptId", "totalScore", "correctCount", "answeredCount", "rankPosition", "calculatedAt", "createdAt", "updatedAt") SELECT "id", "attemptId", "totalScore", "correctCount", "answeredCount", "rankPosition", "calculatedAt", "createdAt", "updatedAt" FROM "_cleanup_Result";

CREATE UNIQUE INDEX "ContestGroup_accessCode_key" ON "ContestGroup"("accessCode");

CREATE INDEX "ContestGroup_contestId_idx" ON "ContestGroup"("contestId");

CREATE INDEX "Team_groupId_idx" ON "Team"("groupId");

CREATE UNIQUE INDEX "Team_personalCode_key" ON "Team"("personalCode");

CREATE UNIQUE INDEX "Team_sessionToken_key" ON "Team"("sessionToken");

CREATE UNIQUE INDEX "Attempt_teamId_key" ON "Attempt"("teamId");

CREATE INDEX "AttemptAnswer_attemptId_idx" ON "AttemptAnswer"("attemptId");

CREATE UNIQUE INDEX "AttemptAnswer_attemptId_taskDraftId_key" ON "AttemptAnswer"("attemptId", "taskDraftId");

CREATE UNIQUE INDEX "Result_attemptId_key" ON "Result"("attemptId");

DROP TABLE "_cleanup_Result";

DROP TABLE "_cleanup_AttemptAnswer";

DROP TABLE "_cleanup_Attempt";

DROP TABLE "_cleanup_Team";

DROP TABLE "_cleanup_ContestGroup";
CREATE INDEX "ContestGroup_createdById_idx" ON "ContestGroup"("createdById");
