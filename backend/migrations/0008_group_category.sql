-- Cada grupo es de una categoría: sus estudiantes solo eligen entre los cursos de ella.
ALTER TABLE "ContestGroup" ADD COLUMN "category" TEXT;
