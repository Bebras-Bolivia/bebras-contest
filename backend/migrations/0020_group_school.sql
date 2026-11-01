ALTER TABLE "ContestGroup" ADD COLUMN "schoolId" TEXT REFERENCES "TeacherSchool" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "ContestGroup_schoolId_idx" ON "ContestGroup"("schoolId");
