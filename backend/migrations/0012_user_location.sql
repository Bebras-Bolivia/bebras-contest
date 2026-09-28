-- Departamento y ciudad del maestro cuyo colegio no está en el catálogo (o que enseña en casa).
ALTER TABLE "User" ADD COLUMN "department" TEXT;
ALTER TABLE "User" ADD COLUMN "city" TEXT;
