-- Tres niveles de visibilidad de una tarea: práctica pública (isPractice),
-- solo para las prácticas de los maestros (forTeachers) o solo del administrador.
ALTER TABLE "TaskDraft" ADD COLUMN "forTeachers" BOOLEAN NOT NULL DEFAULT false;
