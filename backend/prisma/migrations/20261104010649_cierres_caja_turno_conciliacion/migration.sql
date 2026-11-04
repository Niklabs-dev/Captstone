-- SPRINT-4-T08: cierres de caja por local, día y turno, con conciliación
-- MrComanda / Mercado Pago, vouchers de respaldo y vínculo de solo referencia
-- al registro diario de propinas (tip_entries). La reversa está en down.sql
-- (misma carpeta; Prisma solo aplica migration.sql).
--
-- Reglas que garantiza la base (para cualquier rol y vía: Prisma, SQL directo
-- o cascadas). Solo se omiten con session_replication_role = replica, que
-- exige privilegios de superusuario:
-- - Un cierre por local, día y turno.
-- - Montos no negativos; diferencia por línea = contado - esperado.
-- - Conciliación: reconciliation_difference = mercado_pago_gross_amount
--   - mercado_pago_tip_amount - mrcomanda_net_sales. SUPUESTO pendiente de
--   confirmar con el PO: la venta neta MrComanda es solo la porción cobrada
--   por Mercado Pago y los montos incluyen IVA.
-- - CLOSED si y solo si closed_at y closed_by_id están informados; el cierre
--   se crea en OPEN y solo puede pasar a CLOSED, exigiendo motivo si hay
--   diferencias y totales de conciliación iguales a la suma de sus vouchers.
-- - Un cierre CLOSED es inmutable, igual que sus líneas, vouchers, vínculos a
--   propinas y ventas asociadas.

-- CreateEnum
CREATE TYPE "CashClosingVoucherSource" AS ENUM ('MRCOMANDA', 'MERCADO_PAGO');

-- DropIndex
DROP INDEX "cash_closings_store_id_business_date_key";

-- AlterTable
-- Editado a mano: los cierres existentes quedan en el turno 1 y luego se
-- quita el default para que la API siempre indique el turno.
ALTER TABLE "cash_closings" ADD COLUMN     "closed_by_id" UUID,
ADD COLUMN     "difference_reason" VARCHAR(500),
ADD COLUMN     "mercado_pago_gross_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "mercado_pago_tip_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "mrcomanda_net_sales" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "reconciliation_difference" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "shift" SMALLINT NOT NULL DEFAULT 1;

ALTER TABLE "cash_closings" ALTER COLUMN "shift" DROP DEFAULT;

-- CreateTable
CREATE TABLE "cash_closing_vouchers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source" "CashClosingVoucherSource" NOT NULL,
    "period_start" TIMESTAMPTZ(6) NOT NULL,
    "period_end" TIMESTAMPTZ(6) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "tip_included_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "reference" VARCHAR(100),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closing_id" UUID NOT NULL,

    CONSTRAINT "cash_closing_vouchers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_closing_tip_entries" (
    "closing_id" UUID NOT NULL,
    "tip_entry_id" UUID NOT NULL,

    CONSTRAINT "cash_closing_tip_entries_pkey" PRIMARY KEY ("closing_id","tip_entry_id")
);

-- CreateIndex
CREATE INDEX "cash_closing_vouchers_closing_id_source_idx" ON "cash_closing_vouchers"("closing_id", "source");

-- CreateIndex
CREATE INDEX "cash_closing_tip_entries_tip_entry_id_idx" ON "cash_closing_tip_entries"("tip_entry_id");

-- CreateIndex
CREATE INDEX "cash_closings_closed_by_id_idx" ON "cash_closings"("closed_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "cash_closings_store_id_business_date_shift_key" ON "cash_closings"("store_id", "business_date", "shift");

-- AddForeignKey
ALTER TABLE "cash_closings" ADD CONSTRAINT "cash_closings_closed_by_id_fkey" FOREIGN KEY ("closed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_closing_vouchers" ADD CONSTRAINT "cash_closing_vouchers_closing_id_fkey" FOREIGN KEY ("closing_id") REFERENCES "cash_closings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_closing_tip_entries" ADD CONSTRAINT "cash_closing_tip_entries_closing_id_fkey" FOREIGN KEY ("closing_id") REFERENCES "cash_closings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_closing_tip_entries" ADD CONSTRAINT "cash_closing_tip_entries_tip_entry_id_fkey" FOREIGN KEY ("tip_entry_id") REFERENCES "tip_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill para que los cierres existentes cumplan la regla de estado. Antes
-- no existía closed_by: se asume que cerró el responsable del cierre.
UPDATE "cash_closings"
  SET "closed_by_id" = "responsible_id",
      "closed_at" = COALESCE("closed_at", "updated_at")
  WHERE "status" = 'CLOSED';

UPDATE "cash_closings"
  SET "closed_at" = NULL
  WHERE "status" = 'OPEN' AND "closed_at" IS NOT NULL;

-- Restricciones por fila (CHECK).
ALTER TABLE "cash_closings"
  ADD CONSTRAINT "cash_closings_shift_positive" CHECK ("shift" >= 1),
  ADD CONSTRAINT "cash_closings_opening_cash_nonnegative" CHECK ("opening_cash" >= 0),
  ADD CONSTRAINT "cash_closings_status_consistency" CHECK (
    ("status" = 'OPEN' AND "closed_at" IS NULL AND "closed_by_id" IS NULL)
    OR ("status" = 'CLOSED' AND "closed_at" IS NOT NULL AND "closed_by_id" IS NOT NULL)
  ),
  ADD CONSTRAINT "cash_closings_difference_reason_not_blank" CHECK (
    "difference_reason" IS NULL OR btrim("difference_reason") <> ''
  ),
  ADD CONSTRAINT "cash_closings_reconciliation_amounts_nonnegative" CHECK (
    "mrcomanda_net_sales" >= 0
    AND "mercado_pago_gross_amount" >= 0
    AND "mercado_pago_tip_amount" >= 0
    AND "mercado_pago_tip_amount" <= "mercado_pago_gross_amount"
  ),
  ADD CONSTRAINT "cash_closings_reconciliation_difference_consistent" CHECK (
    "reconciliation_difference" = "mercado_pago_gross_amount"
      - "mercado_pago_tip_amount" - "mrcomanda_net_sales"
  );

ALTER TABLE "cash_closing_lines"
  ADD CONSTRAINT "cash_closing_lines_amounts_nonnegative" CHECK (
    "expected_amount" >= 0 AND "counted_amount" >= 0
  ),
  ADD CONSTRAINT "cash_closing_lines_difference_consistent" CHECK (
    "difference" = "counted_amount" - "expected_amount"
  );

ALTER TABLE "cash_closing_vouchers"
  ADD CONSTRAINT "cash_closing_vouchers_valid_period" CHECK ("period_end" > "period_start"),
  ADD CONSTRAINT "cash_closing_vouchers_amounts_nonnegative" CHECK (
    "amount" >= 0 AND "tip_included_amount" >= 0 AND "tip_included_amount" <= "amount"
  ),
  ADD CONSTRAINT "cash_closing_vouchers_tip_only_mercado_pago" CHECK (
    "source" = 'MERCADO_PAGO' OR "tip_included_amount" = 0
  );

-- cash_closings:
-- - TRUNCATE siempre se rechaza; DELETE solo en OPEN.
-- - INSERT solo en OPEN: las líneas y vouchers se agregan después, así todo
--   cierre pasa por la validación de la transición a CLOSED.
-- - CLOSED: se rechaza todo UPDATE (no hay vuelta a OPEN).
-- - OPEN: el local, el día y el turno no cambian. Al pasar a CLOSED, los
--   totales de conciliación deben coincidir con la suma de los vouchers y, si
--   alguna línea o la conciliación tienen diferencia, el motivo es obligatorio
--   (el CHECK difference_reason_not_blank impide un motivo en blanco).
CREATE FUNCTION "cash_closings_enforce_status"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  "voucher_mrcomanda" NUMERIC;
  "voucher_mp_gross" NUMERIC;
  "voucher_mp_tip" NUMERIC;
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'Los cierres de caja no se pueden eliminar: no se permite TRUNCATE sobre cash_closings'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'OPEN' THEN
      RAISE EXCEPTION 'El cierre de caja debe crearse en estado OPEN y cerrarse después'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" = 'CLOSED' THEN
    RAISE EXCEPTION 'El cierre de caja % está cerrado y es inmutable: no se permite % sobre cash_closings', OLD."id", TG_OP
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF NEW."store_id" <> OLD."store_id"
    OR NEW."business_date" <> OLD."business_date"
    OR NEW."shift" <> OLD."shift" THEN
    RAISE EXCEPTION 'No se puede cambiar el local, el día ni el turno del cierre de caja %', OLD."id"
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW."status" = 'CLOSED' THEN
    SELECT
      COALESCE(SUM(v."amount") FILTER (WHERE v."source" = 'MRCOMANDA'), 0),
      COALESCE(SUM(v."amount") FILTER (WHERE v."source" = 'MERCADO_PAGO'), 0),
      COALESCE(SUM(v."tip_included_amount"), 0)
    INTO "voucher_mrcomanda", "voucher_mp_gross", "voucher_mp_tip"
    FROM "cash_closing_vouchers" AS v
    WHERE v."closing_id" = NEW."id";

    IF "voucher_mrcomanda" <> NEW."mrcomanda_net_sales"
      OR "voucher_mp_gross" <> NEW."mercado_pago_gross_amount"
      OR "voucher_mp_tip" <> NEW."mercado_pago_tip_amount" THEN
      RAISE EXCEPTION 'Los totales de conciliación del cierre de caja % no coinciden con la suma de sus vouchers', NEW."id"
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW."difference_reason" IS NULL AND (
      NEW."reconciliation_difference" <> 0
      OR EXISTS (
        SELECT 1 FROM "cash_closing_lines" AS l
        WHERE l."closing_id" = NEW."id" AND l."difference" <> 0
      )
    ) THEN
      RAISE EXCEPTION 'El cierre de caja % tiene diferencias: el motivo es obligatorio para cerrarlo', NEW."id"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "cash_closings_status_rows"
  BEFORE INSERT OR UPDATE OR DELETE ON "cash_closings"
  FOR EACH ROW EXECUTE FUNCTION "cash_closings_enforce_status"();

-- TRUNCATE no dispara los triggers por fila: se bloquea por sentencia.
CREATE TRIGGER "cash_closings_status_truncate"
  BEFORE TRUNCATE ON "cash_closings"
  FOR EACH STATEMENT EXECUTE FUNCTION "cash_closings_enforce_status"();

-- cash_closing_lines, cash_closing_vouchers y cash_closing_tip_entries: solo
-- cambian mientras su cierre está en OPEN. Al eliminar un cierre OPEN, la
-- cascada ya no encuentra el cierre y se permite.
CREATE FUNCTION "cash_closing_children_require_open"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    IF EXISTS (SELECT 1 FROM "cash_closings" AS c WHERE c."status" = 'CLOSED') THEN
      RAISE EXCEPTION 'Hay cierres de caja cerrados: no se permite TRUNCATE sobre %', TG_TABLE_NAME
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NULL;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') AND EXISTS (
    SELECT 1 FROM "cash_closings" AS c
    WHERE c."id" = OLD."closing_id" AND c."status" = 'CLOSED'
  ) THEN
    RAISE EXCEPTION 'El cierre de caja % está cerrado: no se permite % sobre %', OLD."closing_id", TG_OP, TG_TABLE_NAME
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') AND EXISTS (
    SELECT 1 FROM "cash_closings" AS c
    WHERE c."id" = NEW."closing_id" AND c."status" = 'CLOSED'
  ) THEN
    RAISE EXCEPTION 'El cierre de caja % está cerrado: no se permite % sobre %', NEW."closing_id", TG_OP, TG_TABLE_NAME
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "cash_closing_lines_require_open"
  BEFORE INSERT OR UPDATE OR DELETE ON "cash_closing_lines"
  FOR EACH ROW EXECUTE FUNCTION "cash_closing_children_require_open"();

CREATE TRIGGER "cash_closing_lines_require_open_truncate"
  BEFORE TRUNCATE ON "cash_closing_lines"
  FOR EACH STATEMENT EXECUTE FUNCTION "cash_closing_children_require_open"();

CREATE TRIGGER "cash_closing_vouchers_require_open"
  BEFORE INSERT OR UPDATE OR DELETE ON "cash_closing_vouchers"
  FOR EACH ROW EXECUTE FUNCTION "cash_closing_children_require_open"();

CREATE TRIGGER "cash_closing_vouchers_require_open_truncate"
  BEFORE TRUNCATE ON "cash_closing_vouchers"
  FOR EACH STATEMENT EXECUTE FUNCTION "cash_closing_children_require_open"();

CREATE TRIGGER "cash_closing_tip_entries_require_open"
  BEFORE INSERT OR UPDATE OR DELETE ON "cash_closing_tip_entries"
  FOR EACH ROW EXECUTE FUNCTION "cash_closing_children_require_open"();

CREATE TRIGGER "cash_closing_tip_entries_require_open_truncate"
  BEFORE TRUNCATE ON "cash_closing_tip_entries"
  FOR EACH STATEMENT EXECUTE FUNCTION "cash_closing_children_require_open"();

-- El vínculo con propinas es solo referencia y exige el mismo local y día de
-- negocio que el cierre.
CREATE FUNCTION "cash_closing_tip_entries_check_entry"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "cash_closings" AS c
    INNER JOIN "tip_entries" AS e ON e."id" = NEW."tip_entry_id"
    WHERE c."id" = NEW."closing_id"
      AND c."store_id" = e."store_id"
      AND c."business_date" = e."business_date"
  ) THEN
    RAISE EXCEPTION 'El registro de propinas debe ser del mismo local y día que el cierre de caja'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "cash_closing_tip_entries_entry_consistency"
  BEFORE INSERT OR UPDATE ON "cash_closing_tip_entries"
  FOR EACH ROW EXECUTE FUNCTION "cash_closing_tip_entries_check_entry"();

-- sales: una venta asociada a un cierre CLOSED no se crea, modifica, desliga
-- ni elimina (cambiaría la base de lo esperado), y una venta solo puede
-- asociarse a un cierre de su mismo local. Si el cierre no existe, la FK
-- reporta el error.
CREATE FUNCTION "sales_require_open_cash_closing"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  "closing_status" "CashClosingStatus";
  "closing_store_id" UUID;
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    IF EXISTS (
      SELECT 1 FROM "sales" AS s
      INNER JOIN "cash_closings" AS c ON c."id" = s."cash_closing_id"
      WHERE c."status" = 'CLOSED'
    ) THEN
      RAISE EXCEPTION 'Hay ventas de cierres de caja cerrados: no se permite TRUNCATE sobre sales'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NULL;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD."cash_closing_id" IS NOT NULL AND EXISTS (
    SELECT 1 FROM "cash_closings" AS c
    WHERE c."id" = OLD."cash_closing_id" AND c."status" = 'CLOSED'
  ) THEN
    RAISE EXCEPTION 'La venta % pertenece al cierre de caja cerrado %: no se permite % sobre sales', OLD."id", OLD."cash_closing_id", TG_OP
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF NEW."cash_closing_id" IS NOT NULL THEN
    SELECT c."status", c."store_id" INTO "closing_status", "closing_store_id"
    FROM "cash_closings" AS c
    WHERE c."id" = NEW."cash_closing_id";

    IF FOUND THEN
      IF "closing_status" = 'CLOSED' THEN
        RAISE EXCEPTION 'El cierre de caja % está cerrado: no se permite asociarle ventas', NEW."cash_closing_id"
          USING ERRCODE = 'insufficient_privilege';
      END IF;
      IF "closing_store_id" <> NEW."store_id" THEN
        RAISE EXCEPTION 'La venta y su cierre de caja deben ser del mismo local'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "sales_cash_closing_require_open"
  BEFORE INSERT OR UPDATE OR DELETE ON "sales"
  FOR EACH ROW EXECUTE FUNCTION "sales_require_open_cash_closing"();

CREATE TRIGGER "sales_cash_closing_require_open_truncate"
  BEFORE TRUNCATE ON "sales"
  FOR EACH STATEMENT EXECUTE FUNCTION "sales_require_open_cash_closing"();
