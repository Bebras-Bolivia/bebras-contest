-- Cómo se rindió: en línea o en papel (el maestro carga las respuestas).
ALTER TABLE "Attempt" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'online';
