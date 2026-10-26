-- CreateEnum
CREATE TYPE "TipAgreementRule" AS ENUM ('PROPORTIONAL_TO_HOURS');

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "tip_entry_id" UUID;

-- AlterTable
ALTER TABLE "tip_pool_lines" ADD COLUMN     "work_hours_record_id" UUID;

-- AlterTable
ALTER TABLE "tip_pools" ADD COLUMN     "agreement_id" UUID,
ADD COLUMN     "agreement_snapshot" JSONB;

-- CreateTable
CREATE TABLE "tip_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_date" DATE NOT NULL,
    "payment_method" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "store_id" UUID NOT NULL,
    "responsible_id" UUID NOT NULL,

    CONSTRAINT "tip_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tip_agreements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(160) NOT NULL,
    "rule" "TipAgreementRule" NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "store_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,

    CONSTRAINT "tip_agreements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_hours_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "hours_worked" DECIMAL(6,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "store_id" UUID NOT NULL,
    "worker_id" UUID NOT NULL,
    "recorded_by_id" UUID NOT NULL,

    CONSTRAINT "work_hours_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tip_pool_sources" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "amount" DECIMAL(12,2) NOT NULL,
    "pool_id" UUID NOT NULL,
    "tip_entry_id" UUID NOT NULL,

    CONSTRAINT "tip_pool_sources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tip_entries_store_id_business_date_idx" ON "tip_entries"("store_id", "business_date");

-- CreateIndex
CREATE UNIQUE INDEX "tip_entries_store_id_business_date_payment_method_key" ON "tip_entries"("store_id", "business_date", "payment_method");

-- CreateIndex
CREATE INDEX "tip_agreements_store_id_valid_to_idx" ON "tip_agreements"("store_id", "valid_to");

-- CreateIndex
CREATE UNIQUE INDEX "tip_agreements_store_id_valid_from_key" ON "tip_agreements"("store_id", "valid_from");

-- CreateIndex
CREATE INDEX "work_hours_records_store_id_period_start_period_end_idx" ON "work_hours_records"("store_id", "period_start", "period_end");

-- CreateIndex
CREATE UNIQUE INDEX "work_hours_records_store_id_worker_id_period_start_period_e_key" ON "work_hours_records"("store_id", "worker_id", "period_start", "period_end");

-- CreateIndex
CREATE UNIQUE INDEX "tip_pool_sources_tip_entry_id_key" ON "tip_pool_sources"("tip_entry_id");

-- CreateIndex
CREATE INDEX "tip_pool_sources_pool_id_idx" ON "tip_pool_sources"("pool_id");

-- CreateIndex
CREATE INDEX "sales_tip_entry_id_idx" ON "sales"("tip_entry_id");

-- CreateIndex
CREATE INDEX "tip_pool_lines_work_hours_record_id_idx" ON "tip_pool_lines"("work_hours_record_id");

-- CreateIndex
CREATE INDEX "tip_pools_agreement_id_idx" ON "tip_pools"("agreement_id");

-- AddForeignKey
ALTER TABLE "tip_entries" ADD CONSTRAINT "tip_entries_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tip_entries" ADD CONSTRAINT "tip_entries_responsible_id_fkey" FOREIGN KEY ("responsible_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tip_agreements" ADD CONSTRAINT "tip_agreements_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tip_agreements" ADD CONSTRAINT "tip_agreements_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_hours_records" ADD CONSTRAINT "work_hours_records_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_hours_records" ADD CONSTRAINT "work_hours_records_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_hours_records" ADD CONSTRAINT "work_hours_records_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tip_pools" ADD CONSTRAINT "tip_pools_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "tip_agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tip_pool_lines" ADD CONSTRAINT "tip_pool_lines_work_hours_record_id_fkey" FOREIGN KEY ("work_hours_record_id") REFERENCES "work_hours_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tip_pool_sources" ADD CONSTRAINT "tip_pool_sources_pool_id_fkey" FOREIGN KEY ("pool_id") REFERENCES "tip_pools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tip_pool_sources" ADD CONSTRAINT "tip_pool_sources_tip_entry_id_fkey" FOREIGN KEY ("tip_entry_id") REFERENCES "tip_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_tip_entry_id_fkey" FOREIGN KEY ("tip_entry_id") REFERENCES "tip_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Restricciones de negocio que Prisma no representa en el schema.
ALTER TABLE "tip_entries"
  ADD CONSTRAINT "tip_entries_amount_nonnegative" CHECK ("amount" >= 0);

ALTER TABLE "tip_agreements"
  ADD CONSTRAINT "tip_agreements_valid_range" CHECK ("valid_to" IS NULL OR "valid_to" >= "valid_from");

ALTER TABLE "work_hours_records"
  ADD CONSTRAINT "work_hours_records_hours_nonnegative" CHECK ("hours_worked" >= 0),
  ADD CONSTRAINT "work_hours_records_valid_period" CHECK ("period_end" >= "period_start");

ALTER TABLE "tip_pool_sources"
  ADD CONSTRAINT "tip_pool_sources_amount_nonnegative" CHECK ("amount" >= 0);

-- Convierte las ventas históricas con propina en registros diarios agregados.
-- El responsable es quien registró la primera venta del grupo y el día se
-- calcula en hora de Chile, igual que los demás días de negocio del sistema.
WITH aggregated_sales AS (
  SELECT
    "store_id",
    ("sold_at" AT TIME ZONE 'America/Santiago')::date AS "business_date",
    "payment_method",
    SUM("tip_amount") AS "amount",
    (ARRAY_AGG("registered_by_id" ORDER BY "sold_at", "id"))[1] AS "responsible_id"
  FROM "sales"
  WHERE "tip_amount" > 0
  GROUP BY
    "store_id",
    ("sold_at" AT TIME ZONE 'America/Santiago')::date,
    "payment_method"
), inserted_entries AS (
  INSERT INTO "tip_entries" (
    "id", "business_date", "payment_method", "amount", "created_at",
    "updated_at", "store_id", "responsible_id"
  )
  SELECT
    gen_random_uuid(), "business_date", "payment_method", "amount",
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, "store_id", "responsible_id"
  FROM aggregated_sales
  RETURNING "id", "store_id", "business_date", "payment_method"
)
UPDATE "sales" AS s
SET "tip_entry_id" = e."id"
FROM inserted_entries AS e
WHERE s."store_id" = e."store_id"
  AND s."payment_method" = e."payment_method"
  AND (s."sold_at" AT TIME ZONE 'America/Santiago')::date = e."business_date"
  AND s."tip_amount" > 0;

-- Conserva las horas históricas solo cuando no existen períodos solapados para
-- el mismo trabajador. Los casos ambiguos mantienen hours_worked como snapshot,
-- sin crear una referencia que infringa la nueva regla de no solapamiento.
WITH nonoverlapping_hours AS (
  SELECT
    l."id" AS "line_id", p."store_id", l."user_id", p."period_start",
    p."period_end", l."hours_worked", p."calculated_by_id"
  FROM "tip_pool_lines" AS l
  INNER JOIN "tip_pools" AS p ON p."id" = l."pool_id"
  WHERE NOT EXISTS (
    SELECT 1
    FROM "tip_pool_lines" AS other
    INNER JOIN "tip_pools" AS other_pool ON other_pool."id" = other."pool_id"
    WHERE other."id" <> l."id"
      AND other."user_id" = l."user_id"
      AND daterange(other_pool."period_start", other_pool."period_end", '[]')
        && daterange(p."period_start", p."period_end", '[]')
  )
), inserted_hours AS (
  INSERT INTO "work_hours_records" (
    "id", "period_start", "period_end", "hours_worked", "created_at",
    "updated_at", "store_id", "worker_id", "recorded_by_id"
  )
  SELECT
    gen_random_uuid(), "period_start", "period_end", "hours_worked",
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, "store_id", "user_id",
    "calculated_by_id"
  FROM nonoverlapping_hours
  RETURNING "id", "store_id", "worker_id", "period_start", "period_end"
)
UPDATE "tip_pool_lines" AS l
SET "work_hours_record_id" = w."id"
FROM "tip_pools" AS p, inserted_hours AS w
WHERE l."pool_id" = p."id"
  AND p."store_id" = w."store_id"
  AND p."period_start" = w."period_start"
  AND p."period_end" = w."period_end"
  AND l."user_id" = w."worker_id";

-- Vincula un reparto histórico solo si TODOS sus registros son inequívocos y
-- la suma concilia exactamente. Si uno cabe en varios repartos, ninguno de sus
-- registros se asocia parcialmente: se preserva el total sin inventar fuentes.
WITH candidates AS (
  SELECT
    p."id" AS "pool_id",
    e."id" AS "tip_entry_id",
    e."amount",
    p."total_amount",
    COUNT(*) OVER (PARTITION BY e."id") AS "pool_matches"
  FROM "tip_entries" AS e
  INNER JOIN "tip_pools" AS p
    ON p."store_id" = e."store_id"
    AND e."business_date" BETWEEN p."period_start" AND p."period_end"
), evaluated AS (
  SELECT
    candidates.*,
    MAX("pool_matches") OVER (PARTITION BY "pool_id") AS "max_pool_matches",
    SUM("amount") OVER (PARTITION BY "pool_id") AS "sources_total"
  FROM candidates
)
INSERT INTO "tip_pool_sources" ("id", "amount", "pool_id", "tip_entry_id")
SELECT gen_random_uuid(), "amount", "pool_id", "tip_entry_id"
FROM evaluated
WHERE "max_pool_matches" = 1
  AND "sources_total" = "total_amount";

-- Impide que el pacto vigente o las horas de un trabajador sean ambiguos.
-- Los rangos incluyen ambos extremos y un pacto sin término queda abierto.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "tip_agreements"
  ADD CONSTRAINT "tip_agreements_no_overlap" EXCLUDE USING gist (
    "store_id" WITH =,
    daterange("valid_from", COALESCE("valid_to", 'infinity'::date), '[]') WITH &&
  );

ALTER TABLE "work_hours_records"
  ADD CONSTRAINT "work_hours_records_no_overlap" EXCLUDE USING gist (
    "worker_id" WITH =,
    daterange("period_start", "period_end", '[]') WITH &&
  );

-- Una venta solo puede reconciliarse con un registro del mismo local, medio y
-- día de negocio. La FK ya impide que una venta apunte a más de un registro.
CREATE FUNCTION "sales_check_tip_entry"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."tip_entry_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "tip_entries" AS e
    WHERE e."id" = NEW."tip_entry_id"
      AND e."store_id" = NEW."store_id"
      AND e."payment_method" = NEW."payment_method"
      AND e."business_date" = (NEW."sold_at" AT TIME ZONE 'America/Santiago')::date
  ) THEN
    RAISE EXCEPTION 'La venta y su registro de propinas deben coincidir en local, fecha y medio de pago'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "sales_tip_entry_consistency"
  BEFORE INSERT OR UPDATE OF "tip_entry_id", "store_id", "payment_method", "sold_at" ON "sales"
  FOR EACH ROW EXECUTE FUNCTION "sales_check_tip_entry"();

-- Una fuente debe pertenecer al mismo local y estar dentro del período del
-- reparto. Su monto queda copiado en tip_pool_sources como snapshot.
CREATE FUNCTION "tip_pool_sources_check_entry"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "tip_pools" AS p
    INNER JOIN "tip_entries" AS e ON e."id" = NEW."tip_entry_id"
    WHERE p."id" = NEW."pool_id"
      AND p."store_id" = e."store_id"
      AND e."business_date" BETWEEN p."period_start" AND p."period_end"
  ) THEN
    RAISE EXCEPTION 'La fuente de propinas debe coincidir con el local y el período del reparto'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "tip_pool_sources_entry_consistency"
  BEFORE INSERT OR UPDATE OF "pool_id", "tip_entry_id" ON "tip_pool_sources"
  FOR EACH ROW EXECUTE FUNCTION "tip_pool_sources_check_entry"();
