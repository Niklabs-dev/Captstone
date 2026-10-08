-- SPRINT-2-T03: plazos del gestor documental (criterios 2 y 3 de E1-H3).
-- - Registro en la Dirección del Trabajo dentro de 15 días (alerta hasta
--   marcarlo como realizado).
-- - Fecha hasta la que el documento debe conservarse (art. 9 bis CT), base
--   del bloqueo de eliminación antes de 5 años (SPRINT-2-T07).

-- AlterTable
ALTER TABLE "document_types" ADD COLUMN     "requires_dt_registration" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
-- retain_until se agrega primero como NULL para poder completar los
-- documentos existentes antes de exigirlo.
ALTER TABLE "documents" ADD COLUMN     "dt_registered_at" TIMESTAMPTZ(6),
ADD COLUMN     "dt_registered_by_id" UUID,
ADD COLUMN     "dt_registration_due_at" DATE,
ADD COLUMN     "retain_until" DATE;

-- Documentos existentes: se conservan desde su fecha de celebración o, si no
-- la tienen, desde el día de carga en hora de Chile, más los años del tipo.
UPDATE "documents" AS d
SET "retain_until" = (
  COALESCE(d."issued_at", (d."created_at" AT TIME ZONE 'America/Santiago')::date)
  + make_interval(years => t."retention_years")
)::date
FROM "document_types" AS t
WHERE t."id" = d."document_type_id";

ALTER TABLE "documents" ALTER COLUMN "retain_until" SET NOT NULL;

-- Consistencia del registro en la DT: solo se marca como realizado un
-- documento que tiene plazo, y siempre con quién lo marcó.
ALTER TABLE "documents" ADD CONSTRAINT "documents_dt_registered_requires_due_at"
  CHECK ("dt_registered_at" IS NULL OR "dt_registration_due_at" IS NOT NULL);

ALTER TABLE "documents" ADD CONSTRAINT "documents_dt_registered_by_consistent"
  CHECK (("dt_registered_at" IS NULL) = ("dt_registered_by_id" IS NULL));

-- CreateIndex
CREATE INDEX "documents_dt_registration_due_at_idx" ON "documents"("dt_registration_due_at");

-- CreateIndex
CREATE INDEX "documents_retain_until_idx" ON "documents"("retain_until");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_dt_registered_by_id_fkey" FOREIGN KEY ("dt_registered_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
