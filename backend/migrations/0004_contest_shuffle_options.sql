-- Mezclar las opciones pasa de cada tarea al desafío.
ALTER TABLE "Contest" ADD COLUMN "shuffleOptions" BOOLEAN NOT NULL DEFAULT false;
