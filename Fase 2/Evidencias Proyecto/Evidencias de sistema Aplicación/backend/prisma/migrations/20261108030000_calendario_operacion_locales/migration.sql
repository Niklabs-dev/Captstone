-- SPRINT-4R-T12: calendario de operación por local para detectar ventas sin
-- importar.
--
-- No todos los días exigen ventas: cada local abre ciertos días de la semana
-- y puede cerrar días puntuales por excepción (con motivo). Con esto la API
-- calcula, al consultar y sin guardar alertas, el estado de cada día:
-- IMPORTADO, PENDIENTE, ATRASADO o CERRADO. Es independiente del módulo de
-- horarios de trabajadores (work_hours_records) y no toca ninguna tabla
-- existente.
--
-- La base garantiza:
-- - Un solo calendario por local (store_id único). Los siete días de la
--   semana van como columnas booleanas explícitas, con al menos un día
--   abierto (un local que no abre ningún día se desactiva, no se modela
--   así). tracking_start_date es desde cuándo se exigen ventas: los días
--   anteriores nunca se informan.
-- - Una sola excepción de cierre por local y fecha, siempre con motivo no
--   vacío. Una excepción se puede quitar (la API lo audita con su motivo).
-- - Quién configuró el calendario y quién registró cada excepción (FK
--   Restrict: los usuarios no se borran, se anonimizan).
--
-- La reversa está en down.sql (misma carpeta; Prisma solo aplica
-- migration.sql).

-- CreateTable
CREATE TABLE "store_operating_schedules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "opens_monday" BOOLEAN NOT NULL,
    "opens_tuesday" BOOLEAN NOT NULL,
    "opens_wednesday" BOOLEAN NOT NULL,
    "opens_thursday" BOOLEAN NOT NULL,
    "opens_friday" BOOLEAN NOT NULL,
    "opens_saturday" BOOLEAN NOT NULL,
    "opens_sunday" BOOLEAN NOT NULL,
    "tracking_start_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "store_id" UUID NOT NULL,
    "updated_by_id" UUID NOT NULL,

    CONSTRAINT "store_operating_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_closures" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "closure_date" DATE NOT NULL,
    "reason" VARCHAR(300) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "store_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,

    CONSTRAINT "store_closures_pkey" PRIMARY KEY ("id")
);

-- Al menos un día de la semana abierto.
ALTER TABLE "store_operating_schedules"
ADD CONSTRAINT "store_operating_schedules_opens_some_day" CHECK (
  "opens_monday" OR "opens_tuesday" OR "opens_wednesday" OR "opens_thursday"
  OR "opens_friday" OR "opens_saturday" OR "opens_sunday"
);

-- El motivo del cierre es obligatorio y no puede quedar en blanco.
ALTER TABLE "store_closures"
ADD CONSTRAINT "store_closures_reason_not_blank" CHECK (btrim("reason") <> '');

-- CreateIndex
CREATE UNIQUE INDEX "store_operating_schedules_store_id_key" ON "store_operating_schedules"("store_id");

-- CreateIndex
CREATE UNIQUE INDEX "store_closures_store_id_closure_date_key" ON "store_closures"("store_id", "closure_date");

-- AddForeignKey
ALTER TABLE "store_operating_schedules" ADD CONSTRAINT "store_operating_schedules_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_operating_schedules" ADD CONSTRAINT "store_operating_schedules_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_closures" ADD CONSTRAINT "store_closures_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_closures" ADD CONSTRAINT "store_closures_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
