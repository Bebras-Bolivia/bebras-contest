-- Los resultados se publican solos: en resultsAt o, si no tiene, al cerrar la rendición.
-- resultsReleasedAt marca que esa publicación automática ya ocurrió.
ALTER TABLE "Contest" ADD COLUMN "resultsAt" DATETIME;
ALTER TABLE "Contest" ADD COLUMN "resultsReleasedAt" DATETIME;
