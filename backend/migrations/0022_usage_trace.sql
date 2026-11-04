ALTER TABLE "Contest" ADD COLUMN "collectUsage" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "TestTrace" (
    "attemptId" TEXT NOT NULL PRIMARY KEY,
    "device" TEXT NOT NULL DEFAULT '{}',
    "stars" INTEGER,
    "comment" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TestTrace_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
