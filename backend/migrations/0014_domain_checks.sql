CREATE TABLE "_cleanup_sequence" AS SELECT * FROM sqlite_sequence WHERE name = 'User';

CREATE TABLE "_cleanup_User" AS SELECT * FROM "User";

CREATE TABLE "_cleanup_TeacherSchool" AS SELECT * FROM "TeacherSchool";

CREATE TABLE "_cleanup_Contest" AS SELECT * FROM "Contest";

CREATE TABLE "_cleanup_ContestTask" AS SELECT * FROM "ContestTask";

CREATE TABLE "_cleanup_RosterImportLock" AS SELECT * FROM "RosterImportLock";

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

DROP TABLE "RosterImportLock";

DROP TABLE "ContestTask";

DROP TABLE "Contest";

DROP TABLE "TeacherSchool";

DROP TABLE "User";

CREATE TABLE "User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "passwordHash" TEXT NOT NULL DEFAULT '',
    "role" TEXT NOT NULL DEFAULT 'admin' CHECK ("role" IN ('admin', 'maestro')),
    "status" TEXT NOT NULL DEFAULT 'approved' CHECK ("status" IN ('pending', 'approved', 'rejected', 'suspended')),
    "schoolCodUe" TEXT,
    "schoolName" TEXT,
    "institutionType" TEXT,
    "phone" TEXT,
    "letterFilename" TEXT,
    "idFrontFilename" TEXT,
    "idBackFilename" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "firebaseUid" TEXT,
    "department" TEXT,
    "city" TEXT
);

INSERT INTO "User" ("id", "email", "name", "firstName", "lastName", "passwordHash", "role", "status", "schoolCodUe", "schoolName", "institutionType", "phone", "letterFilename", "idFrontFilename", "idBackFilename", "createdAt", "updatedAt", "firebaseUid", "department", "city") SELECT "id", "email", "name", "firstName", "lastName", "passwordHash", "role", "status", "schoolCodUe", "schoolName", "institutionType", "phone", "letterFilename", "idFrontFilename", "idBackFilename", "createdAt", "updatedAt", "firebaseUid", "department", "city" FROM "_cleanup_User";

CREATE TABLE "TeacherSchool" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" INTEGER NOT NULL,
    "schoolCodUe" TEXT,
    "schoolName" TEXT NOT NULL,
    "letterFilename" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'approved', 'rejected')),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TeacherSchool_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "TeacherSchool" ("id", "userId", "schoolCodUe", "schoolName", "letterFilename", "status", "createdAt", "updatedAt") SELECT "id", "userId", "schoolCodUe", "schoolName", "letterFilename", "status", "createdAt", "updatedAt" FROM "_cleanup_TeacherSchool";

CREATE TABLE "Contest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "registrationStartsAt" DATETIME,
    "registrationEndsAt" DATETIME,
    "startsAt" DATETIME,
    "endsAt" DATETIME,
    "scoring" TEXT,
    "questionDisplayMode" TEXT NOT NULL DEFAULT 'one_by_one' CHECK ("questionDisplayMode" IN ('one_by_one', 'all')),
    "allowPairs" BOOLEAN NOT NULL DEFAULT false,
    "showFeedback" BOOLEAN NOT NULL DEFAULT false,
    "showSolutions" BOOLEAN NOT NULL DEFAULT false,
    "showTotalScore" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" DATETIME,
    "suspendedAt" DATETIME,
    "consolidatedAt" DATETIME,
    "resultsPublishedAt" DATETIME,
    "isPractice" BOOLEAN NOT NULL DEFAULT false,
    "createdById" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "shuffleOptions" BOOLEAN NOT NULL DEFAULT false,
    "categories" TEXT NOT NULL DEFAULT '[]',
    "showScoreOnSubmit" BOOLEAN NOT NULL DEFAULT false,
    "showFeedbackOnSubmit" BOOLEAN NOT NULL DEFAULT false,
    "showSolutionsOnSubmit" BOOLEAN NOT NULL DEFAULT false,
    "resultsAt" DATETIME,
    "resultsReleasedAt" DATETIME,
    "resultsUntil" DATETIME,
    CONSTRAINT "Contest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "Contest" ("id", "title", "durationMinutes", "registrationStartsAt", "registrationEndsAt", "startsAt", "endsAt", "scoring", "questionDisplayMode", "allowPairs", "showFeedback", "showSolutions", "showTotalScore", "publishedAt", "suspendedAt", "consolidatedAt", "resultsPublishedAt", "isPractice", "createdById", "createdAt", "updatedAt", "shuffleOptions", "categories", "showScoreOnSubmit", "showFeedbackOnSubmit", "showSolutionsOnSubmit", "resultsAt", "resultsReleasedAt", "resultsUntil") SELECT "id", "title", "durationMinutes", "registrationStartsAt", "registrationEndsAt", "startsAt", "endsAt", "scoring", "questionDisplayMode", "allowPairs", "showFeedback", "showSolutions", "showTotalScore", "publishedAt", "suspendedAt", "consolidatedAt", "resultsPublishedAt", "isPractice", "createdById", "createdAt", "updatedAt", "shuffleOptions", "categories", "showScoreOnSubmit", "showFeedbackOnSubmit", "showSolutionsOnSubmit", "resultsAt", "resultsReleasedAt", "resultsUntil" FROM "_cleanup_Contest";

CREATE TABLE "ContestTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contestId" TEXT NOT NULL,
    "taskDraftId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "difficulty" TEXT NOT NULL,
    "minScore" INTEGER NOT NULL,
    "noAnswerScore" INTEGER NOT NULL,
    "maxScore" INTEGER NOT NULL,
    "options" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "category" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "ContestTask_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ContestTask_taskDraftId_fkey" FOREIGN KEY ("taskDraftId") REFERENCES "TaskDraft" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "ContestTask" ("id", "contestId", "taskDraftId", "position", "difficulty", "minScore", "noAnswerScore", "maxScore", "options", "createdAt", "category") SELECT "id", "contestId", "taskDraftId", "position", "difficulty", "minScore", "noAnswerScore", "maxScore", "options", "createdAt", "category" FROM "_cleanup_ContestTask";

CREATE TABLE "RosterImportLock" (
    "contestId" TEXT NOT NULL PRIMARY KEY,
    "owner" TEXT NOT NULL,
    "acquiredAt" DATETIME NOT NULL,
    CONSTRAINT "RosterImportLock_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "RosterImportLock" ("contestId", "owner", "acquiredAt") SELECT "contestId", "owner", "acquiredAt" FROM "_cleanup_RosterImportLock";

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
    CONSTRAINT "ContestGroup_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

CREATE UNIQUE INDEX "User_firebaseUid_key" ON "User"("firebaseUid");

CREATE INDEX "TeacherSchool_userId_idx" ON "TeacherSchool"("userId");

CREATE INDEX "Contest_createdById_idx" ON "Contest"("createdById");

CREATE INDEX "ContestTask_contestId_category_position_idx" ON "ContestTask"("contestId", "category", "position");

CREATE UNIQUE INDEX "ContestTask_contestId_category_position_key" ON "ContestTask"("contestId", "category", "position");

CREATE UNIQUE INDEX "ContestTask_contestId_category_taskDraftId_key" ON "ContestTask"("contestId", "category", "taskDraftId");

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

DROP TABLE "_cleanup_RosterImportLock";

DROP TABLE "_cleanup_ContestTask";

DROP TABLE "_cleanup_Contest";

DROP TABLE "_cleanup_TeacherSchool";

DROP TABLE "_cleanup_User";

UPDATE sqlite_sequence SET seq = max(seq, coalesce((SELECT seq FROM "_cleanup_sequence" WHERE name = 'User'), seq)) WHERE name = 'User';

DROP TABLE "_cleanup_sequence";
