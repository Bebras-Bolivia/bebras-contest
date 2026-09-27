-- Hasta cuándo el desafío muestra sus resultados en la portada; sin fecha, 7 días.
ALTER TABLE "Contest" ADD COLUMN "resultsUntil" DATETIME;
