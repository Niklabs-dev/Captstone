-- SPRINT-4R-T02: participantes de la operación diaria y reparto equitativo.
--
-- Complementa la operación diaria de SPRINT-4R-T01 (daily_operations) con:
-- 1. La selección de trabajadores que participan del reparto de cada
--    operación diaria (daily_operation_participants). Como la operación ya es
--    única por local y fecha y acumula la propina de tarjeta y la de efectivo
--    en un solo fondo, UNA selección cubre ambos medios: no hay selecciones
--    paralelas que diverjan y la consulta/corrección siempre recupera la misma
--    selección de ese local/día.
-- 2. La fuente de reparto alimentada por la operación diaria
--    (tip_pool_daily_operation_sources), separada de tip_pool_sources, que
--    sigue ligada a los tip_entries históricos: cada operación alimenta un
--    solo reparto (operation_id único) y amount BIGINT en CLP entero iguala el
--    tip_fund_amount de la operación (conciliación exacta).
-- 3. La regla equitativa explícita EQUAL_SHARES en el enum de pactos: convive
--    con PROPORTIONAL_TO_HOURS sin reinterpretarlo (no se toca ninguna fila
--    existente) y habilita que las líneas y constancias de los repartos
--    equitativos guarden el monto final sin horas inventadas.
--
-- La base garantiza (para cualquier rol y vía de escritura: Prisma, SQL
-- directo o cascadas; solo session_replication_role = replica las omite, y
-- esta migración NO la usa):
-- - Sin duplicados: única (operation_id, worker_id) por participación.
-- - Solo trabajadores del mismo local/rol TRABAJADOR activos AL INSERTAR o
--   cambiar la participación (trigger). Una baja lógica, un cambio de rol o
--   de local posteriores NO borran ni alteran la selección: la FK al
--   trabajador es Restrict y la validación solo corre al escribir la
--   participación, así el historial sobrevive (art. 9 bis CT, Ley N°21.719).
-- - Una operación alimentada por un reparto CONFIRMED o PAID no puede
--   cambiar sus montos/fecha/local ni su selección de participantes (los
--   cambios solo se permiten con el reparto en DRAFT): corregir participantes
--   o fondos nunca reinterpreta repartos cerrados.
-- - hours_worked de tip_pool_lines y tip_pool_receipts queda NULLable solo
--   para repartos cuya regla aplicada es EQUAL_SHARES (se resuelve primero
--   desde el snapshot del reparto y solo si no hay, desde el pacto vigente):
--   la regla equitativa no usa horas y no se inventan; los repartos
--   proporcionales e históricos siguen exigiéndolas. Los valores existentes
--   no se alteran: solo cae el NOT NULL. El cliente de Prisma mantiene el
--   campo requerido (las vistas históricas lo asumen no nulo); se vuelve
--   opcional junto con esos ajustes de visualización en SPRINT-4R-T04.
-- - La constancia de un reparto equitativo compara sus horas NULL con las de
--   su línea usando IS NOT DISTINCT FROM: la foto pagada cuadra consigo misma.
--
-- La reversa está en down.sql (misma carpeta; Prisma solo aplica
-- migration.sql).

-- Regla equitativa explícita: convive con la proporcional sin tocarla.
-- PostgreSQL 12+ admite ADD VALUE dentro de la transacción de la migración.
ALTER TYPE "TipAgreementRule" ADD VALUE 'EQUAL_SHARES';

-- Las horas quedan opcionales SOLO para los repartos equitativos (trigger más
-- abajo). No se reescribe ninguna fila: los valores históricos se conservan.
ALTER TABLE "tip_pool_lines" ALTER COLUMN "hours_worked" DROP NOT NULL;
ALTER TABLE "tip_pool_receipts" ALTER COLUMN "hours_worked" DROP NOT NULL;

-- CreateTable
CREATE TABLE "daily_operation_participants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "operation_id" UUID NOT NULL,
    "worker_id" UUID NOT NULL,

    CONSTRAINT "daily_operation_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tip_pool_daily_operation_sources" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "amount" BIGINT NOT NULL,
    "pool_id" UUID NOT NULL,
    "operation_id" UUID NOT NULL,

    CONSTRAINT "tip_pool_daily_operation_sources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "daily_operation_participants_operation_id_worker_id_key" ON "daily_operation_participants"("operation_id", "worker_id");

-- CreateIndex
CREATE INDEX "daily_operation_participants_worker_id_idx" ON "daily_operation_participants"("worker_id");

-- CreateIndex
CREATE INDEX "tip_pool_daily_operation_sources_pool_id_idx" ON "tip_pool_daily_operation_sources"("pool_id");

-- CreateIndex: cada operación diaria alimenta como máximo un reparto (evita el
-- doble reparto del mismo fondo y da la conciliación por unicidad).
CREATE UNIQUE INDEX "tip_pool_daily_operation_sources_operation_id_key" ON "tip_pool_daily_operation_sources"("operation_id");

-- AddForeignKey: la participación muere con su operación (Cascade)...
ALTER TABLE "daily_operation_participants" ADD CONSTRAINT "daily_operation_participants_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "daily_operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ...pero el trabajador con historial no se borra (Restrict): la baja lógica
-- (is_active) nunca destruye la selección.
ALTER TABLE "daily_operation_participants" ADD CONSTRAINT "daily_operation_participants_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tip_pool_daily_operation_sources" ADD CONSTRAINT "tip_pool_daily_operation_sources_pool_id_fkey" FOREIGN KEY ("pool_id") REFERENCES "tip_pools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: la operación usada por un reparto no se borra (Restrict).
ALTER TABLE "tip_pool_daily_operation_sources" ADD CONSTRAINT "tip_pool_daily_operation_sources_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "daily_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- La fuente guarda un monto CLP entero aplicado.
ALTER TABLE "tip_pool_daily_operation_sources"
ADD CONSTRAINT "tip_pool_daily_operation_sources_amount_nonnegative" CHECK ("amount" >= 0);

-- Participantes: la base valida AL ESCRIBIR la participación que el
-- trabajador sea del mismo local de la operación, con rol TRABAJADOR y
-- activo. Validar al insertar (y no de forma diferida) es lo que permite que
-- una baja lógica o un cambio de rol/local posteriores dejen el historial
-- intacto: esos UPDATE sobre users/users+roles no reevalúan esta fila.
CREATE FUNCTION "daily_operation_participants_validate_worker"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "daily_operations" AS o
    INNER JOIN "users" AS u ON u."id" = NEW."worker_id"
    INNER JOIN "roles" AS r ON r."id" = u."role_id"
    WHERE o."id" = NEW."operation_id"
      AND u."store_id" = o."store_id"
      AND u."is_active" = true
      AND r."code" = 'TRABAJADOR'
  ) THEN
    RAISE EXCEPTION 'El participante % debe ser un trabajador activo del local de la operación %', NEW."worker_id", NEW."operation_id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "daily_operation_participants_validate_worker_rows"
  BEFORE INSERT OR UPDATE ON "daily_operation_participants"
  FOR EACH ROW EXECUTE FUNCTION "daily_operation_participants_validate_worker"();

-- Participantes: la selección de una operación que alimentó un reparto
-- CONFIRMED o PAID ya no cambia. Con el reparto en DRAFT se permite ajustarla
-- (el recálculo vuelve a leerla). Al eliminar el reparto DRAFT, la cascada ya
-- no encuentra la fuente y se permite (mismo patrón que
-- tip_pool_children_require_draft).
CREATE FUNCTION "daily_operation_participants_require_draft_pool"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    IF EXISTS (
      SELECT 1
      FROM "tip_pool_daily_operation_sources" AS s
      INNER JOIN "tip_pools" AS p ON p."id" = s."pool_id"
      WHERE p."status" <> 'DRAFT'
    ) THEN
      RAISE EXCEPTION 'Hay repartos confirmados o pagados alimentados por operaciones diarias: no se permite TRUNCATE sobre %', TG_TABLE_NAME
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NULL;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') AND EXISTS (
    SELECT 1
    FROM "tip_pool_daily_operation_sources" AS s
    INNER JOIN "tip_pools" AS p ON p."id" = s."pool_id"
    WHERE s."operation_id" = OLD."operation_id" AND p."status" <> 'DRAFT'
  ) THEN
    RAISE EXCEPTION 'La operación % alimenta un reparto confirmado o pagado: no se permite % sobre participantes', OLD."operation_id", TG_OP
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') AND EXISTS (
    SELECT 1
    FROM "tip_pool_daily_operation_sources" AS s
    INNER JOIN "tip_pools" AS p ON p."id" = s."pool_id"
    WHERE s."operation_id" = NEW."operation_id" AND p."status" <> 'DRAFT'
  ) THEN
    RAISE EXCEPTION 'La operación % alimenta un reparto confirmado o pagado: no se permite % sobre participantes', NEW."operation_id", TG_OP
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "daily_operation_participants_require_draft_pool_rows"
  BEFORE INSERT OR UPDATE OR DELETE ON "daily_operation_participants"
  FOR EACH ROW EXECUTE FUNCTION "daily_operation_participants_require_draft_pool"();

CREATE TRIGGER "daily_operation_participants_require_draft_pool_truncate"
  BEFORE TRUNCATE ON "daily_operation_participants"
  FOR EACH STATEMENT EXECUTE FUNCTION "daily_operation_participants_require_draft_pool"();

-- Operación diaria: sus montos, fecha y local tampoco se corrigen cuando ya
-- alimentó un reparto CONFIRMED o PAID (la fuente conserva el monto aplicado
-- y la foto del reparto no se reinterpreta). El resto de la fila —motivo de
-- la diferencia, voucher, updated_at— sigue siendo corregible: no afectan el
-- reparto.
CREATE FUNCTION "daily_operations_require_draft_pool"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."store_id" <> OLD."store_id"
      OR NEW."business_date" <> OLD."business_date"
      OR NEW."card_tip_amount" <> OLD."card_tip_amount"
      OR NEW."cash_tip_amount" <> OLD."cash_tip_amount"
      OR NEW."tip_fund_amount" <> OLD."tip_fund_amount")
     AND EXISTS (
       SELECT 1
       FROM "tip_pool_daily_operation_sources" AS s
       INNER JOIN "tip_pools" AS p ON p."id" = s."pool_id"
       WHERE s."operation_id" = OLD."id" AND p."status" <> 'DRAFT'
     ) THEN
    RAISE EXCEPTION 'La operación % alimenta un reparto confirmado o pagado: no se pueden corregir sus montos, fecha o local', OLD."id"
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "daily_operations_require_draft_pool_rows"
  BEFORE UPDATE ON "daily_operations"
  FOR EACH ROW EXECUTE FUNCTION "daily_operations_require_draft_pool"();

-- Fuente del reparto alimentada por la operación diaria: solo cambia en DRAFT
-- (mismo patrón que tip_pool_children_require_draft) y, al insertar o
-- cambiarla, la base exige la conciliación exacta: el monto aplicado es el
-- fondo completo de la operación y ambas filas son del mismo local. Así el
-- total del reparto cuadra con el fondo que lo originó, en CLP entero.
CREATE FUNCTION "tip_pool_daily_operation_sources_enforce"() RETURNS trigger
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
    RAISE EXCEPTION 'El reparto % ya no está en DRAFT: no se permite % sobre tip_pool_daily_operation_sources', OLD."pool_id", TG_OP
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    IF EXISTS (
      SELECT 1 FROM "tip_pools" AS p
      WHERE p."id" = NEW."pool_id" AND p."status" <> 'DRAFT'
    ) THEN
      RAISE EXCEPTION 'El reparto % ya no está en DRAFT: no se permite % sobre tip_pool_daily_operation_sources', NEW."pool_id", TG_OP
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM "tip_pools" AS p
      INNER JOIN "daily_operations" AS o ON o."id" = NEW."operation_id"
      WHERE p."id" = NEW."pool_id"
        AND p."store_id" = o."store_id"
        AND NEW."amount" = o."tip_fund_amount"
    ) THEN
      RAISE EXCEPTION 'La fuente del reparto % no concilia: amount debe ser el tip_fund_amount de la operación % y ambas del mismo local', NEW."pool_id", NEW."operation_id"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "tip_pool_daily_operation_sources_enforce_rows"
  BEFORE INSERT OR UPDATE OR DELETE ON "tip_pool_daily_operation_sources"
  FOR EACH ROW EXECUTE FUNCTION "tip_pool_daily_operation_sources_enforce"();

CREATE TRIGGER "tip_pool_daily_operation_sources_enforce_truncate"
  BEFORE TRUNCATE ON "tip_pool_daily_operation_sources"
  FOR EACH STATEMENT EXECUTE FUNCTION "tip_pool_daily_operation_sources_enforce"();

-- Horas de líneas y constancias: NULL solo cuando la regla aplicada del
-- reparto es equitativa (EQUAL_SHARES); obligatorias en cualquier otro caso,
-- incluidos los repartos históricos sin pacto ni snapshot. La regla aplicada
-- se resuelve primero desde el snapshot (la foto del pacto al calcular, que
-- los cambios del pacto vigente no alteran) y solo si no hay, desde el pacto.
CREATE FUNCTION "tip_pool_children_hours_consistent"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  applied_rule text;
BEGIN
  SELECT COALESCE(p."agreement_snapshot"->>'rule', a."rule"::text)
  INTO applied_rule
  FROM "tip_pools" AS p
  LEFT JOIN "tip_agreements" AS a ON a."id" = p."agreement_id"
  WHERE p."id" = NEW."pool_id";

  IF applied_rule = 'EQUAL_SHARES' THEN
    IF NEW."hours_worked" IS NOT NULL THEN
      RAISE EXCEPTION 'El % del reparto equitativo % no lleva horas trabajadas: la regla reparte en partes iguales', TG_TABLE_NAME, NEW."pool_id"
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF NEW."hours_worked" IS NULL THEN
      RAISE EXCEPTION 'El % del reparto % requiere horas trabajadas (regla %)', TG_TABLE_NAME, NEW."pool_id", COALESCE(applied_rule, 'desconocida')
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "tip_pool_lines_hours_consistent_rows"
  BEFORE INSERT OR UPDATE ON "tip_pool_lines"
  FOR EACH ROW EXECUTE FUNCTION "tip_pool_children_hours_consistent"();

CREATE TRIGGER "tip_pool_receipts_hours_consistent_rows"
  BEFORE INSERT OR UPDATE ON "tip_pool_receipts"
  FOR EACH ROW EXECUTE FUNCTION "tip_pool_children_hours_consistent"();

-- La constancia debe coincidir con la línea del trabajador. Con horas NULL en
-- los repartos equitativos la igualdad se compara con IS NOT DISTINCT FROM:
-- NULL = NULL no sería verdadero y rechazaría la foto correcta. El resto de
-- la regla queda igual que en SPRINT-3-T13.
CREATE OR REPLACE FUNCTION "tip_pool_receipts_enforce_immutability"() RETURNS trigger
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
      AND l."hours_worked" IS NOT DISTINCT FROM NEW."hours_worked"
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
