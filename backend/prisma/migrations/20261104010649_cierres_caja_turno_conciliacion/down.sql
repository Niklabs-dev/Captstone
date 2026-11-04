-- Reversa de 20261104010649_cierres_caja_turno_conciliacion (SPRINT-4-T08).
-- Prisma no ejecuta este archivo: solo aplica migration.sql. Uso (en backend/):
--   npx prisma db execute --file prisma/migrations/20261104010649_cierres_caja_turno_conciliacion/down.sql
-- Al final borra el registro de la migración en _prisma_migrations para que
-- `prisma migrate deploy` la vuelva a aplicar (`migrate resolve --rolled-back`
-- solo sirve para migraciones fallidas, P3012). Todo corre en una sola
-- transacción: si algo falla, no queda nada a medias.
--
-- ADVERTENCIA: elimina los turnos, vouchers, vínculos a propinas, motivos de
-- diferencia, quién cerró y los montos de conciliación. Falla a propósito si
-- hay dos turnos del mismo local y día (no se puede recrear la unicidad por
-- local y día): hay que consolidarlos antes de revertir.
--
-- La parte de esquema se generó con `prisma migrate diff` (del esquema nuevo
-- al anterior, --script); los triggers, funciones y CHECK se agregaron a mano
-- porque Prisma no los conoce.

BEGIN;

-- Triggers y funciones (manual).
DROP TRIGGER "sales_cash_closing_require_open_truncate" ON "sales";
DROP TRIGGER "sales_cash_closing_require_open" ON "sales";
DROP FUNCTION "sales_require_open_cash_closing"();

DROP TRIGGER "cash_closing_tip_entries_entry_consistency" ON "cash_closing_tip_entries";
DROP FUNCTION "cash_closing_tip_entries_check_entry"();

DROP TRIGGER "cash_closing_tip_entries_require_open_truncate" ON "cash_closing_tip_entries";
DROP TRIGGER "cash_closing_tip_entries_require_open" ON "cash_closing_tip_entries";
DROP TRIGGER "cash_closing_vouchers_require_open_truncate" ON "cash_closing_vouchers";
DROP TRIGGER "cash_closing_vouchers_require_open" ON "cash_closing_vouchers";
DROP TRIGGER "cash_closing_lines_require_open_truncate" ON "cash_closing_lines";
DROP TRIGGER "cash_closing_lines_require_open" ON "cash_closing_lines";
DROP FUNCTION "cash_closing_children_require_open"();

DROP TRIGGER "cash_closings_status_truncate" ON "cash_closings";
DROP TRIGGER "cash_closings_status_rows" ON "cash_closings";
DROP FUNCTION "cash_closings_enforce_status"();

-- CHECK sobre columnas que se conservan (manual). Los demás CHECK caen junto
-- con sus columnas y tablas.
ALTER TABLE "cash_closing_lines"
  DROP CONSTRAINT "cash_closing_lines_amounts_nonnegative",
  DROP CONSTRAINT "cash_closing_lines_difference_consistent";

ALTER TABLE "cash_closings"
  DROP CONSTRAINT "cash_closings_opening_cash_nonnegative",
  DROP CONSTRAINT "cash_closings_status_consistency";

-- DropForeignKey
ALTER TABLE "cash_closings" DROP CONSTRAINT "cash_closings_closed_by_id_fkey";

-- DropForeignKey
ALTER TABLE "cash_closing_vouchers" DROP CONSTRAINT "cash_closing_vouchers_closing_id_fkey";

-- DropForeignKey
ALTER TABLE "cash_closing_tip_entries" DROP CONSTRAINT "cash_closing_tip_entries_closing_id_fkey";

-- DropForeignKey
ALTER TABLE "cash_closing_tip_entries" DROP CONSTRAINT "cash_closing_tip_entries_tip_entry_id_fkey";

-- DropIndex
DROP INDEX "cash_closings_closed_by_id_idx";

-- DropIndex
DROP INDEX "cash_closings_store_id_business_date_shift_key";

-- AlterTable
ALTER TABLE "cash_closings" DROP COLUMN "closed_by_id",
DROP COLUMN "difference_reason",
DROP COLUMN "mercado_pago_gross_amount",
DROP COLUMN "mercado_pago_tip_amount",
DROP COLUMN "mrcomanda_net_sales",
DROP COLUMN "reconciliation_difference",
DROP COLUMN "shift";

-- DropTable
DROP TABLE "cash_closing_vouchers";

-- DropTable
DROP TABLE "cash_closing_tip_entries";

-- DropEnum
DROP TYPE "CashClosingVoucherSource";

-- CreateIndex
CREATE UNIQUE INDEX "cash_closings_store_id_business_date_key" ON "cash_closings"("store_id", "business_date");

-- Registro de la migración (manual): permite que migrate deploy la reaplique.
DELETE FROM "_prisma_migrations"
  WHERE "migration_name" = '20261104010649_cierres_caja_turno_conciliacion';

COMMIT;
