-- SPRINT-2-T12: modelo de liquidaciones de sueldo (E2-H1).
-- Una liquidación es un documento de tipo LIQUIDACION del gestor documental
-- (versionado inmutable, hash SHA-256 y conservación de 5 años) con un estado
-- de publicación: PENDING_SIGNATURE mientras el contador la valida y PUBLISHED
-- cuando queda visible en el portal del trabajador. Una sola liquidación por
-- trabajador y período.

-- CreateEnum
CREATE TYPE "PayslipStatus" AS ENUM ('PENDING_SIGNATURE', 'PUBLISHED');

-- CreateTable
CREATE TABLE "payslips" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "period" DATE NOT NULL,
    "status" "PayslipStatus" NOT NULL DEFAULT 'PENDING_SIGNATURE',
    "signed_at" DATE,
    "published_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "document_id" UUID NOT NULL,
    "worker_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,
    "published_by_id" UUID,

    CONSTRAINT "payslips_pkey" PRIMARY KEY ("id"),
    -- El período es un mes: se guarda como su primer día.
    CONSTRAINT "payslips_period_first_day_check" CHECK (EXTRACT(DAY FROM "period") = 1),
    -- Pendiente: sin datos de publicación. Publicada: con fecha de firma,
    -- fecha de publicación y responsable.
    CONSTRAINT "payslips_status_publication_check" CHECK (
      ("status" = 'PENDING_SIGNATURE'
        AND "signed_at" IS NULL
        AND "published_at" IS NULL
        AND "published_by_id" IS NULL)
      OR ("status" = 'PUBLISHED'
        AND "signed_at" IS NOT NULL
        AND "published_at" IS NOT NULL
        AND "published_by_id" IS NOT NULL)
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "payslips_document_id_key" ON "payslips"("document_id");

-- CreateIndex
CREATE INDEX "payslips_status_period_idx" ON "payslips"("status", "period");

-- CreateIndex
CREATE UNIQUE INDEX "payslips_worker_id_period_key" ON "payslips"("worker_id", "period");

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_published_by_id_fkey" FOREIGN KEY ("published_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- El documento de la liquidación debe ser de tipo LIQUIDACION y pertenecer al
-- mismo trabajador: worker_id repite documents.subject_user_id para poder
-- exigir una liquidación por trabajador y período con un índice único.
CREATE FUNCTION "payslips_check_document"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "documents" AS d
    JOIN "document_types" AS t ON t."id" = d."document_type_id"
    WHERE d."id" = NEW."document_id"
      AND t."code" = 'LIQUIDACION'
      AND d."subject_user_id" = NEW."worker_id"
  ) THEN
    RAISE EXCEPTION 'La liquidación debe apuntar a un documento LIQUIDACION del mismo trabajador (documento %, trabajador %)', NEW."document_id", NEW."worker_id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "payslips_check_document_rows"
  BEFORE INSERT OR UPDATE OF "document_id", "worker_id" ON "payslips"
  FOR EACH ROW EXECUTE FUNCTION "payslips_check_document"();
