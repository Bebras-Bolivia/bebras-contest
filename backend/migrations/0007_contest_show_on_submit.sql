-- Lo que el equipo ve apenas entrega, aparte de lo que ve al publicarse los resultados.
ALTER TABLE "Contest" ADD COLUMN "showScoreOnSubmit" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Contest" ADD COLUMN "showFeedbackOnSubmit" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Contest" ADD COLUMN "showSolutionsOnSubmit" BOOLEAN NOT NULL DEFAULT false;
