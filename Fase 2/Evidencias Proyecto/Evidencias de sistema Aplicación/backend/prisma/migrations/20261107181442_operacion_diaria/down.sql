-- Reversa de 20261107181442_operacion_diaria (SPRINT-4R-T01).
-- Solo deshace el esquema nuevo; los históricos de cierres y propinas
-- anteriores no se ven afectados porque esta migración jamás los tocó.

ALTER TABLE "daily_operations" DROP CONSTRAINT "daily_operations_voucher_id_fkey";
ALTER TABLE "daily_operations" DROP CONSTRAINT "daily_operations_responsible_id_fkey";
ALTER TABLE "daily_operations" DROP CONSTRAINT "daily_operations_store_id_fkey";

DROP TABLE "daily_operations";
DROP TABLE "daily_operation_vouchers";
