CREATE TABLE "TrialSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "role" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "TrialRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "taskCode" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "seconds" INTEGER NOT NULL DEFAULT 0,
    "comment" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TrialRun_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TrialSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TrialRun_sessionId_taskCode_key" ON "TrialRun"("sessionId", "taskCode");

CREATE TABLE "TrialSus" (
    "sessionId" TEXT NOT NULL PRIMARY KEY,
    "answers" TEXT NOT NULL,
    "score" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TrialSus_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TrialSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "TrialEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrialEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "TrialEvent_userId_kind_idx" ON "TrialEvent"("userId", "kind");
