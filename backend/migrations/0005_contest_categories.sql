-- Un desafío abarca varias categorías y cada una tiene sus propias preguntas.
ALTER TABLE "Contest" ADD COLUMN "categories" TEXT NOT NULL DEFAULT '[]';
UPDATE "Contest" SET "categories" = json_array("category") WHERE "category" <> '';

ALTER TABLE "ContestTask" ADD COLUMN "category" TEXT NOT NULL DEFAULT '';
UPDATE "ContestTask" SET "category" = (
  SELECT "Contest"."category" FROM "Contest" WHERE "Contest"."id" = "ContestTask"."contestId"
);

DROP INDEX "ContestTask_contestId_taskDraftId_key";
DROP INDEX "ContestTask_contestId_position_key";
DROP INDEX "ContestTask_contestId_position_idx";
CREATE UNIQUE INDEX "ContestTask_contestId_category_taskDraftId_key" ON "ContestTask"("contestId", "category", "taskDraftId");
CREATE UNIQUE INDEX "ContestTask_contestId_category_position_key" ON "ContestTask"("contestId", "category", "position");
CREATE INDEX "ContestTask_contestId_category_position_idx" ON "ContestTask"("contestId", "category", "position");

-- El puntaje inicial depende de la categoría: se calcula con sus preguntas.
ALTER TABLE "Contest" DROP COLUMN "initialScore";
ALTER TABLE "Contest" DROP COLUMN "category";
