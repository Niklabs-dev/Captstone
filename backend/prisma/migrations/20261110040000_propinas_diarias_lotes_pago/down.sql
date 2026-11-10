-- Reversa de 20261110040000_propinas_diarias_lotes_pago (SPRINT-4A-T02).
-- Retira el modelo de propinas diarias por trabajador y los lotes de pago.
-- Se PIERDEN las asignaciones diarias y los lotes (incluidos los lotes
-- pagados desde SPRINT-4A-T06): antes de aplicarla, exportar
-- daily_tip_allocations y tip_payment_batches si hay pagos reales. Los
-- repartos históricos (tip_pools, líneas, fuentes y constancias) nunca se
-- tocaron y quedan intactos, igual que las operaciones diarias y sus
-- participantes.

-- Triggers sobre tablas que se conservan.
DROP TRIGGER "daily_operation_participants_require_unpaid_tips_truncate" ON "daily_operation_participants";
DROP TRIGGER "daily_operation_participants_require_unpaid_tips_rows" ON "daily_operation_participants";
DROP TRIGGER "daily_operation_participants_tip_allocations_balanced" ON "daily_operation_participants";
DROP TRIGGER "daily_operations_require_unpaid_tips_rows" ON "daily_operations";
DROP TRIGGER "daily_operations_tip_allocations_balanced" ON "daily_operations";

-- Tablas nuevas (sus índices, FKs, CHECK y triggers se eliminan con ellas).
-- Los triggers de inmutabilidad impiden borrar filas pagadas, no la tabla.
DROP TABLE "daily_tip_allocations";
DROP TABLE "tip_payment_batches";

DROP FUNCTION "tip_payment_batches_assert_totals"();
DROP FUNCTION "tip_payment_batches_check_totals"(uuid);
DROP FUNCTION "tip_payment_batches_enforce_immutability"();
DROP FUNCTION "daily_operation_participants_require_unpaid_tips"();
DROP FUNCTION "daily_operations_require_unpaid_tips"();
DROP FUNCTION "daily_tip_allocations_assert_balanced"();
DROP FUNCTION "daily_tip_allocations_check_operation"(uuid);
DROP FUNCTION "daily_tip_allocations_enforce"();

DROP TYPE "TipAllocationStatus";
