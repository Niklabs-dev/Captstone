-- AlterTable
ALTER TABLE "tip_pools" ADD COLUMN     "paid_at" TIMESTAMPTZ(6),
ADD COLUMN     "paid_by_id" UUID,
ADD COLUMN     "payment_date" DATE,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "tip_pool_receipts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "worker_name" VARCHAR(161) NOT NULL,
    "store_name" VARCHAR(100) NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "hours_worked" DECIMAL(6,2) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "payment_date" DATE NOT NULL,
    "paid_by_name" VARCHAR(161) NOT NULL,
    "detail" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pool_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "paid_by_id" UUID NOT NULL,

    CONSTRAINT "tip_pool_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tip_pool_receipts_user_id_idx" ON "tip_pool_receipts"("user_id");

-- CreateIndex
CREATE INDEX "tip_pool_receipts_store_id_idx" ON "tip_pool_receipts"("store_id");

-- CreateIndex
CREATE INDEX "tip_pool_receipts_paid_by_id_idx" ON "tip_pool_receipts"("paid_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "tip_pool_receipts_pool_id_user_id_key" ON "tip_pool_receipts"("pool_id", "user_id");

-- AddForeignKey
ALTER TABLE "tip_pools" ADD CONSTRAINT "tip_pools_paid_by_id_fkey" FOREIGN KEY ("paid_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tip_pool_receipts" ADD CONSTRAINT "tip_pool_receipts_pool_id_fkey" FOREIGN KEY ("pool_id") REFERENCES "tip_pools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tip_pool_receipts" ADD CONSTRAINT "tip_pool_receipts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tip_pool_receipts" ADD CONSTRAINT "tip_pool_receipts_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tip_pool_receipts" ADD CONSTRAINT "tip_pool_receipts_paid_by_id_fkey" FOREIGN KEY ("paid_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- SPRINT-3-T13: confirmación, observaciones y pago del reparto de propinas.
-- El reparto sigue DRAFT → CONFIRMED → PAID y version es el bloqueo optimista
-- (la API lo compara con expectedVersion y lo sube en cada cambio). Igual que
-- en payslips (SPRINT-2-T14), los triggers garantizan las reglas para
-- cualquier rol y vía (Prisma, SQL directo o cascadas); solo se omiten con
-- session_replication_role = replica, que exige privilegios de superusuario.

-- Coherencia entre el estado y los datos de confirmación y pago. El pago no
-- puede ser anterior al último día del período.
ALTER TABLE "tip_pools"
  ADD CONSTRAINT "tip_pools_version_positive" CHECK ("version" >= 1),
  ADD CONSTRAINT "tip_pools_status_consistency" CHECK (
    ("status" = 'DRAFT'
      AND "confirmed_at" IS NULL AND "confirmed_by_id" IS NULL
      AND "paid_at" IS NULL AND "paid_by_id" IS NULL AND "payment_date" IS NULL)
    OR ("status" = 'CONFIRMED'
      AND "confirmed_at" IS NOT NULL AND "confirmed_by_id" IS NOT NULL
      AND "paid_at" IS NULL AND "paid_by_id" IS NULL AND "payment_date" IS NULL)
    OR ("status" = 'PAID'
      AND "confirmed_at" IS NOT NULL AND "confirmed_by_id" IS NOT NULL
      AND "paid_at" IS NOT NULL AND "paid_by_id" IS NOT NULL
      AND "payment_date" IS NOT NULL AND "payment_date" >= "period_end")
  );

ALTER TABLE "tip_pool_receipts"
  ADD CONSTRAINT "tip_pool_receipts_amount_nonnegative" CHECK ("amount" >= 0);

-- tip_pools:
-- - TRUNCATE siempre se rechaza; DELETE solo se permite en DRAFT.
-- - No se vuelve atrás ni se salta CONFIRMED: un DRAFT solo pasa a CONFIRMED.
-- - CONFIRMED: no vuelve a DRAFT; el total, el local, el período, el pacto,
--   el cálculo, la confirmación y las observaciones no cambian, y el único
--   cambio posible es pasar a PAID con los datos del pago y version + 1.
-- - PAID: se rechaza todo UPDATE.
CREATE FUNCTION "tip_pools_enforce_status"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'Los repartos de propinas no se pueden eliminar: no se permite TRUNCATE sobre tip_pools'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'El reparto % está en estado % y no se puede eliminar', OLD."id", OLD."status"
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD."status" = 'PAID' THEN
    RAISE EXCEPTION 'El reparto pagado % es inmutable: no se permite UPDATE sobre tip_pools', OLD."id"
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF OLD."status" = 'DRAFT' THEN
    IF NEW."status" = 'PAID' THEN
      RAISE EXCEPTION 'El reparto % debe confirmarse antes de marcarlo como pagado', OLD."id"
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  -- OLD."status" = 'CONFIRMED'
  IF NEW."status" = 'DRAFT' THEN
    RAISE EXCEPTION 'El reparto confirmado % no puede volver a DRAFT', OLD."id"
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW."total_amount" <> OLD."total_amount"
    OR NEW."store_id" <> OLD."store_id"
    OR NEW."period_start" <> OLD."period_start"
    OR NEW."period_end" <> OLD."period_end"
    OR NEW."agreement_id" IS DISTINCT FROM OLD."agreement_id"
    OR NEW."agreement_snapshot" IS DISTINCT FROM OLD."agreement_snapshot"
    OR NEW."calculated_by_id" <> OLD."calculated_by_id"
    OR NEW."confirmed_at" IS DISTINCT FROM OLD."confirmed_at"
    OR NEW."confirmed_by_id" IS DISTINCT FROM OLD."confirmed_by_id"
    OR NEW."notes" IS DISTINCT FROM OLD."notes"
    OR NEW."created_at" <> OLD."created_at" THEN
    RAISE EXCEPTION 'No se pueden cambiar los montos ni los datos del reparto confirmado %', OLD."id"
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW."status" <> 'PAID' THEN
    RAISE EXCEPTION 'El reparto confirmado % solo puede pasar a PAID', OLD."id"
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW."version" <> OLD."version" + 1 THEN
    RAISE EXCEPTION 'El pago del reparto % debe subir su versión en 1', OLD."id"
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "tip_pools_status_rows"
  BEFORE UPDATE OR DELETE ON "tip_pools"
  FOR EACH ROW EXECUTE FUNCTION "tip_pools_enforce_status"();

-- TRUNCATE no dispara los triggers por fila: se bloquea por sentencia.
CREATE TRIGGER "tip_pools_status_truncate"
  BEFORE TRUNCATE ON "tip_pools"
  FOR EACH STATEMENT EXECUTE FUNCTION "tip_pools_enforce_status"();

-- tip_pool_lines y tip_pool_sources: la foto del reparto solo cambia en DRAFT.
-- Al eliminar un DRAFT, la cascada ya no encuentra el reparto y se permite.
CREATE FUNCTION "tip_pool_children_require_draft"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    IF EXISTS (SELECT 1 FROM "tip_pools" AS p WHERE p."status" <> 'DRAFT') THEN
      RAISE EXCEPTION 'Hay repartos confirmados o pagados: no se permite TRUNCATE sobre %', TG_TABLE_NAME
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NULL;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') AND EXISTS (
    SELECT 1 FROM "tip_pools" AS p
    WHERE p."id" = OLD."pool_id" AND p."status" <> 'DRAFT'
  ) THEN
    RAISE EXCEPTION 'El reparto % ya no está en DRAFT: no se permite % sobre %', OLD."pool_id", TG_OP, TG_TABLE_NAME
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') AND EXISTS (
    SELECT 1 FROM "tip_pools" AS p
    WHERE p."id" = NEW."pool_id" AND p."status" <> 'DRAFT'
  ) THEN
    RAISE EXCEPTION 'El reparto % ya no está en DRAFT: no se permite % sobre %', NEW."pool_id", TG_OP, TG_TABLE_NAME
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "tip_pool_lines_require_draft"
  BEFORE INSERT OR UPDATE OR DELETE ON "tip_pool_lines"
  FOR EACH ROW EXECUTE FUNCTION "tip_pool_children_require_draft"();

CREATE TRIGGER "tip_pool_lines_require_draft_truncate"
  BEFORE TRUNCATE ON "tip_pool_lines"
  FOR EACH STATEMENT EXECUTE FUNCTION "tip_pool_children_require_draft"();

CREATE TRIGGER "tip_pool_sources_require_draft"
  BEFORE INSERT OR UPDATE OR DELETE ON "tip_pool_sources"
  FOR EACH ROW EXECUTE FUNCTION "tip_pool_children_require_draft"();

CREATE TRIGGER "tip_pool_sources_require_draft_truncate"
  BEFORE TRUNCATE ON "tip_pool_sources"
  FOR EACH STATEMENT EXECUTE FUNCTION "tip_pool_children_require_draft"();

-- tip_pool_receipts: la constancia se inserta en la misma transacción que
-- pasa el reparto a PAID (después del UPDATE) y debe coincidir con su reparto
-- y con la línea del trabajador. Después es inmutable.
CREATE FUNCTION "tip_pool_receipts_enforce_immutability"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Las constancias de pago son inmutables: no se permite % sobre tip_pool_receipts', TG_OP
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "tip_pools" AS p
    WHERE p."id" = NEW."pool_id" AND p."status" = 'PAID'
  ) THEN
    RAISE EXCEPTION 'Solo se emiten constancias de un reparto pagado (reparto %)', NEW."pool_id"
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "tip_pools" AS p
    INNER JOIN "tip_pool_lines" AS l ON l."pool_id" = p."id"
    WHERE p."id" = NEW."pool_id"
      AND l."user_id" = NEW."user_id"
      AND l."amount" = NEW."amount"
      AND l."hours_worked" = NEW."hours_worked"
      AND p."store_id" = NEW."store_id"
      AND p."period_start" = NEW."period_start"
      AND p."period_end" = NEW."period_end"
      AND p."payment_date" = NEW."payment_date"
      AND p."paid_by_id" = NEW."paid_by_id"
  ) THEN
    RAISE EXCEPTION 'La constancia no coincide con el reparto % ni con la línea del trabajador %', NEW."pool_id", NEW."user_id"
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "tip_pool_receipts_immutability_rows"
  BEFORE INSERT OR UPDATE OR DELETE ON "tip_pool_receipts"
  FOR EACH ROW EXECUTE FUNCTION "tip_pool_receipts_enforce_immutability"();

CREATE TRIGGER "tip_pool_receipts_immutability_truncate"
  BEFORE TRUNCATE ON "tip_pool_receipts"
  FOR EACH STATEMENT EXECUTE FUNCTION "tip_pool_receipts_enforce_immutability"();
