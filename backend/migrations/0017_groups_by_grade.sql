ALTER TABLE "ContestGroup" ADD COLUMN "grade" TEXT
  CHECK ("grade" IS NULL OR "grade" IN ('P1','P2','P3','P4','P5','P6','S1','S2','S3','S4','S5','S6'));
ALTER TABLE "ContestGroup" ADD COLUMN "autoKey" TEXT;
CREATE UNIQUE INDEX "ContestGroup_autoKey_key" ON "ContestGroup"("autoKey");
CREATE INDEX "ContestGroup_contestId_createdById_grade_idx"
  ON "ContestGroup"("contestId", "createdById", "grade");

UPDATE "ContestGroup"
SET "grade" = (SELECT MIN("grade") FROM "Team" WHERE "groupId" = "ContestGroup"."id")
WHERE "id" IN (
  SELECT "groupId" FROM "Team" GROUP BY "groupId"
  HAVING COUNT(*) = COUNT("grade") AND COUNT(DISTINCT "grade") = 1
    AND MIN("grade") IN ('P1','P2','P3','P4','P5','P6','S1','S2','S3','S4','S5','S6')
);

UPDATE "ContestGroup" SET "category" = CASE "grade"
  WHEN 'P1' THEN 'Guacamayo' WHEN 'P2' THEN 'Guacamayo'
  WHEN 'P3' THEN 'Capibara' WHEN 'P4' THEN 'Capibara'
  WHEN 'P5' THEN 'Titi' WHEN 'P6' THEN 'Titi'
  WHEN 'S1' THEN 'Jucumari' WHEN 'S2' THEN 'Jucumari'
  WHEN 'S3' THEN 'Yaguareté' WHEN 'S4' THEN 'Yaguareté'
  WHEN 'S5' THEN 'Kuntur' WHEN 'S6' THEN 'Kuntur'
END WHERE "grade" IS NOT NULL AND "category" IS NULL;

UPDATE "ContestGroup"
SET "autoKey" = "createdById" || ':' || "contestId" || ':' || "grade"
WHERE "grade" IS NOT NULL AND "createdById" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "ContestGroup" AS earlier
    WHERE earlier."contestId" = "ContestGroup"."contestId"
      AND earlier."createdById" = "ContestGroup"."createdById"
      AND earlier."grade" = "ContestGroup"."grade"
      AND (earlier."createdAt" < "ContestGroup"."createdAt"
        OR (earlier."createdAt" = "ContestGroup"."createdAt" AND earlier."id" < "ContestGroup"."id"))
  );
