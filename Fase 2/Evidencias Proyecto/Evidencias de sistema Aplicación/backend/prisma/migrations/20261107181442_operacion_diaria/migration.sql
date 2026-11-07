-- SPRINT-4R-T01: operación diaria por local y fecha de negocio.
--
-- Un único registro por local y día (índice único compuesto) captura al
-- cierre del día la propina de tarjeta (con voucher fotográfico privado),
-- la propina en efectivo y la diferencia de efectivo declarada por el
-- supervisor. Reemplaza al flujo previo de cierres por turno con
-- conciliación (cash_closings y derivadas) y a la captura separada de
-- propinas (tip_entries): esas tablas NO se tocan; sus datos quedan
-- consultables solo de lectura y el catálogo payment_methods se conserva
-- para historial y futura importación Excel.
--
-- La base garantiza (para cualquier rol y vía de escritura: Prisma, SQL
-- directo o cascadas; solo session_replication_role = replica las omite, y
-- esta migración NO la usa):
-- - Montos CLP enteros en BIGINT (el tope de validación de la API supera
--   el entero de 32 bits): propinas de tarjeta y efectivo >= 0 y
--   tip_fund_amount = card_tip_amount + cash_tip_amount (CHECK).
-- - cash_difference lleva signo (positiva sobrante, negativa faltante) y
--   exige difference_reason cuando no es cero (CHECK).
-- - La relación con el voucher es 1:1 con la FK única en daily_operations,
--   lo que permite exigir voucher siempre que card_tip_amount > 0 (CHECK
--   sobre la misma fila). Los metadatos del archivo (nombre original, ruta
--   física en el volumen privado, tipo, tamaño y hash SHA-256) viven en
--   daily_operation_vouchers; el archivo nunca se sirve de forma pública.
--
-- La reversa está en down.sql (misma carpeta; Prisma solo aplica
-- migration.sql).

-- CreateTable
CREATE TABLE "daily_operation_vouchers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "file_name" VARCHAR(255) NOT NULL,
    "file_path" VARCHAR(500) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "sha256_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_operation_vouchers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_operations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_date" DATE NOT NULL,
    "card_tip_amount" BIGINT NOT NULL,
    "cash_tip_amount" BIGINT NOT NULL,
    "tip_fund_amount" BIGINT NOT NULL,
    "cash_difference" BIGINT NOT NULL,
    "difference_reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "store_id" UUID NOT NULL,
    "responsible_id" UUID NOT NULL,
    "voucher_id" UUID,

    CONSTRAINT "daily_operations_pkey" PRIMARY KEY ("id")
);

-- Reglas de integridad de la operación diaria (CHECK):
-- - Las propinas de tarjeta y de efectivo no son negativas.
-- - El fondo de propinas es exactamente la suma de ambas (una sola fuente).
-- - La diferencia de efectivo explica su motivo cuando no es cero. Ojo: un
--   CHECK satisfecho por NULL no rechaza, por eso el motivo se exige con
--   IS NOT NULL y no solo con btrim() <> ''.
-- - Con propina de tarjeta > 0 el voucher fotográfico es obligatorio.
ALTER TABLE "daily_operations"
ADD CONSTRAINT "daily_operations_card_tip_non_negative" CHECK ("card_tip_amount" >= 0),
ADD CONSTRAINT "daily_operations_cash_tip_non_negative" CHECK ("cash_tip_amount" >= 0),
ADD CONSTRAINT "daily_operations_tip_fund_consistent" CHECK ("tip_fund_amount" = "card_tip_amount" + "cash_tip_amount"),
ADD CONSTRAINT "daily_operations_difference_reason_required" CHECK ("cash_difference" = 0 OR ("difference_reason" IS NOT NULL AND btrim("difference_reason") <> '')),
ADD CONSTRAINT "daily_operations_voucher_required" CHECK ("card_tip_amount" = 0 OR "voucher_id" IS NOT NULL);

-- CreateIndex
CREATE UNIQUE INDEX "daily_operations_voucher_id_key" ON "daily_operations"("voucher_id");

-- CreateIndex
CREATE UNIQUE INDEX "daily_operations_store_id_business_date_key" ON "daily_operations"("store_id", "business_date");

-- AddForeignKey
ALTER TABLE "daily_operations" ADD CONSTRAINT "daily_operations_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_operations" ADD CONSTRAINT "daily_operations_responsible_id_fkey" FOREIGN KEY ("responsible_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_operations" ADD CONSTRAINT "daily_operations_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "daily_operation_vouchers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
