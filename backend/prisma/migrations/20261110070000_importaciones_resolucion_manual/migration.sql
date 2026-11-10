-- SPRINT-4A-T18: resolución manual del local y de los medios de pago que el
-- sistema no identificó al importar el Excel de ventas de MrComanda.
--
-- Decisión del PO (10/11/2026): un dato no reconocido no se adivina, pero
-- tampoco bloquea la carga. El ADMINISTRADOR lo elige a mano en la vista
-- previa (y puede «recordarlo» para próximas cargas):
-- - Local: si el ID Subway del encabezado no identifica a un local activo,
--   elige un local activo. «Recordar» asigna ese ID Subway al local elegido
--   (stores.subway_store_id) solo si el local no tenía uno; nunca lo
--   sobrescribe. Sin «recordar», la importación queda con el local elegido y
--   el ID Subway leído del archivo, aunque no coincidan.
-- - Medios: cada etiqueta sin alias se asocia a un medio activo del catálogo
--   («recordar» crea el alias en payment_method_aliases) o, solo si su monto
--   es 0, se omite (ej. «N.de Créd.» en 0).
--
-- Cambios:
-- - sales_imports.store_resolution (AUTOMATIC | MANUAL) indica si el local se
--   identificó por su ID Subway o lo eligió el administrador; resolved_by_id
--   y resolved_at registran quién resolvió a mano algún dato y cuándo. Los
--   tres son inmutables desde el INSERT, como el resto de los datos del
--   archivo. CHECK: resolved_by_id y resolved_at van juntos, y un local
--   MANUAL exige resolved_by_id.
-- - sales_import_lines.resolution (AUTOMATIC | MANUAL) indica si el medio de
--   la línea salió de un alias o lo eligió el administrador.
-- - sales_import_skipped_lines guarda las líneas omitidas a mano, con su
--   etiqueta original y monto (siempre 0, CHECK). No son líneas de venta: los
--   reportes y el panel no las leen.
--
-- La base sigue sin abrir huecos (triggers, para cualquier vía de escritura):
-- - Cabecera AUTOMATIC: igual que en 20261110020000 (exige el ID Subway del
--   local de la importación).
-- - Cabecera MANUAL: el local debe existir y estar activo, y si el archivo
--   trae un ID Subway que ya identifica a OTRO local activo se rechaza: la
--   elección manual nunca contradice una identificación automática.
-- - Línea AUTOMATIC: igual que antes (alias configurado hacia ese medio).
-- - Línea MANUAL: la cabecera debe registrar quién resolvió a mano, el medio
--   debe estar activo y la etiqueta no puede tener un alias hacia otro medio.
-- - Línea omitida: solo en una cabecera PENDING resuelta a mano, con monto 0,
--   sin alias configurado para su etiqueta y sin repetir el número ni la
--   etiqueta de una línea de venta de la misma importación. Es inmutable y
--   solo se elimina junto con su cabecera PENDING (descarte).
-- Las importaciones existentes quedan AUTOMATIC (valor por defecto): todas
-- se identificaron por equivalencias configuradas.
--
-- La reversa está en down.sql (misma carpeta; Prisma solo aplica
-- migration.sql).

-- CreateEnum
CREATE TYPE "SalesImportResolution" AS ENUM ('AUTOMATIC', 'MANUAL');

-- AlterTable
ALTER TABLE "sales_imports" ADD COLUMN     "resolved_at" TIMESTAMPTZ(6),
ADD COLUMN     "resolved_by_id" UUID,
ADD COLUMN     "store_resolution" "SalesImportResolution" NOT NULL DEFAULT 'AUTOMATIC';

-- AlterTable
ALTER TABLE "sales_import_lines" ADD COLUMN     "resolution" "SalesImportResolution" NOT NULL DEFAULT 'AUTOMATIC';

-- CreateTable
CREATE TABLE "sales_import_skipped_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "line_number" INTEGER NOT NULL,
    "original_label" VARCHAR(100) NOT NULL,
    "normalized_label" VARCHAR(100) NOT NULL,
    "amount" BIGINT NOT NULL,
    "percentage" DECIMAL(5,2),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "import_id" UUID NOT NULL,

    CONSTRAINT "sales_import_skipped_lines_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "sales_imports"
ADD CONSTRAINT "sales_imports_resolution_consistency" CHECK (
  ("resolved_by_id" IS NULL) = ("resolved_at" IS NULL)
  AND ("store_resolution" = 'AUTOMATIC' OR "resolved_by_id" IS NOT NULL)
);

ALTER TABLE "sales_import_skipped_lines"
ADD CONSTRAINT "sales_import_skipped_lines_line_number_positive" CHECK ("line_number" >= 1),
ADD CONSTRAINT "sales_import_skipped_lines_label_not_blank" CHECK (btrim("original_label") <> ''),
ADD CONSTRAINT "sales_import_skipped_lines_label_normalized" CHECK ("normalized_label" = "normalize_external_label"("original_label")),
ADD CONSTRAINT "sales_import_skipped_lines_amount_zero" CHECK ("amount" = 0),
ADD CONSTRAINT "sales_import_skipped_lines_percentage_range" CHECK ("percentage" IS NULL OR ("percentage" >= 0 AND "percentage" <= 100));

-- CreateIndex
CREATE UNIQUE INDEX "sales_import_skipped_lines_import_id_line_number_key" ON "sales_import_skipped_lines"("import_id", "line_number");

-- CreateIndex
CREATE UNIQUE INDEX "sales_import_skipped_lines_import_id_normalized_label_key" ON "sales_import_skipped_lines"("import_id", "normalized_label");

-- AddForeignKey
ALTER TABLE "sales_imports" ADD CONSTRAINT "sales_imports_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_import_skipped_lines" ADD CONSTRAINT "sales_import_skipped_lines_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "sales_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Ciclo de vida de la cabecera: se reemplaza sales_imports_enforce
-- (20261110020000) agregando la regla del local MANUAL al insertar y las
-- columnas de resolución a la comparación de inmutabilidad. El resto de la
-- función no cambia.
CREATE OR REPLACE FUNCTION "sales_imports_enforce"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  "line_count" BIGINT;
  "line_total" NUMERIC;
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'Las importaciones de ventas no se pueden eliminar: no se permite TRUNCATE sobre sales_imports'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'PENDING' THEN
      RAISE EXCEPTION 'La importación de ventas debe crearse en estado PENDING y confirmarse después'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."store_resolution" = 'MANUAL' THEN
      -- Local elegido a mano (SPRINT-4A-T18): activo y sin contradecir un ID
      -- Subway que ya identifica a otro local activo.
      IF NOT EXISTS (
        SELECT 1 FROM "stores" AS s
        WHERE s."id" = NEW."store_id" AND s."is_active"
      ) THEN
        RAISE EXCEPTION 'El local elegido a mano para la importación de ventas debe estar activo'
          USING ERRCODE = 'check_violation';
      END IF;
      IF NEW."subway_store_id" IS NOT NULL AND EXISTS (
        SELECT 1 FROM "stores" AS s
        WHERE s."subway_store_id" = NEW."subway_store_id"
          AND s."id" <> NEW."store_id"
          AND s."is_active"
      ) THEN
        RAISE EXCEPTION 'El ID Subway «%» ya identifica a otro local activo: no se puede elegir otro local a mano', NEW."subway_store_id"
          USING ERRCODE = 'check_violation';
      END IF;
      RETURN NEW;
    END IF;
    IF NEW."subway_store_id" IS NULL THEN
      RAISE EXCEPTION 'La importación de ventas debe indicar el ID Subway del local («%» no trae uno reconocible)', NEW."external_store_code"
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM "stores" AS s
      WHERE s."id" = NEW."store_id"
        AND s."subway_store_id" = NEW."subway_store_id"
    ) THEN
      RAISE EXCEPTION 'El ID Subway «%» no está asignado al local de la importación', NEW."subway_store_id"
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'PENDING' THEN
      RAISE EXCEPTION 'La importación de ventas % está en estado % y no se puede eliminar: solo se descartan importaciones PENDING', OLD."id", OLD."status"
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE: los datos del archivo y su resolución son inmutables en
  -- cualquier estado.
  IF (NEW."id", NEW."system", NEW."store_id", NEW."business_date",
      NEW."period_start", NEW."period_end", NEW."external_store_code",
      NEW."external_store_name", NEW."version", NEW."total_amount",
      NEW."file_name", NEW."file_path", NEW."mime_type", NEW."size_bytes",
      NEW."sha256_hash", NEW."uploaded_by_id", NEW."created_at",
      NEW."issued_at", NEW."subway_store_id", NEW."store_resolution",
      NEW."resolved_by_id", NEW."resolved_at")
    IS DISTINCT FROM
     (OLD."id", OLD."system", OLD."store_id", OLD."business_date",
      OLD."period_start", OLD."period_end", OLD."external_store_code",
      OLD."external_store_name", OLD."version", OLD."total_amount",
      OLD."file_name", OLD."file_path", OLD."mime_type", OLD."size_bytes",
      OLD."sha256_hash", OLD."uploaded_by_id", OLD."created_at",
      OLD."issued_at", OLD."subway_store_id", OLD."store_resolution",
      OLD."resolved_by_id", OLD."resolved_at") THEN
    RAISE EXCEPTION 'Los datos del archivo de la importación de ventas % son inmutables', OLD."id"
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW."status" = OLD."status" THEN
    IF (NEW."is_current", NEW."confirmed_at", NEW."confirmed_by_id", NEW."superseded_at")
      IS DISTINCT FROM
       (OLD."is_current", OLD."confirmed_at", OLD."confirmed_by_id", OLD."superseded_at") THEN
      RAISE EXCEPTION 'La confirmación y el reemplazo de la importación de ventas % solo cambian junto con su estado', OLD."id"
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" = 'PENDING' AND NEW."status" = 'ACTIVE' THEN
    SELECT count(*), COALESCE(sum(l."amount"), 0)
      INTO "line_count", "line_total"
      FROM "sales_import_lines" AS l
      WHERE l."import_id" = NEW."id";
    IF "line_count" = 0 THEN
      RAISE EXCEPTION 'La importación de ventas % no tiene líneas por medio de pago: no se puede confirmar', NEW."id"
        USING ERRCODE = 'check_violation';
    END IF;
    IF "line_total" <> NEW."total_amount" THEN
      RAISE EXCEPTION 'La suma de las líneas (%) no coincide con el total del reporte (%) en la importación de ventas %', "line_total", NEW."total_amount", NEW."id"
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" = 'ACTIVE' AND NEW."status" = 'SUPERSEDED' THEN
    IF (NEW."confirmed_at", NEW."confirmed_by_id")
      IS DISTINCT FROM (OLD."confirmed_at", OLD."confirmed_by_id") THEN
      RAISE EXCEPTION 'No se puede cambiar la confirmación de la importación de ventas % al reemplazarla', OLD."id"
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Transición de estado no permitida en la importación de ventas %: % → %', OLD."id", OLD."status", NEW."status"
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

-- Líneas de venta: se reemplaza sales_import_lines_enforce
-- (20261108010000). Una línea AUTOMATIC sigue exigiendo su alias; una MANUAL
-- exige cabecera resuelta a mano, medio activo y que ningún alias apunte la
-- etiqueta a otro medio. Ninguna repite una línea omitida de la importación.
CREATE OR REPLACE FUNCTION "sales_import_lines_enforce"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  "header_status" "SalesImportStatus";
  "header_system" "ExternalSystem";
  "header_resolved_by" UUID;
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'Las líneas de importación de ventas no se pueden eliminar: no se permite TRUNCATE sobre sales_import_lines'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT i."status" INTO "header_status"
      FROM "sales_imports" AS i
      WHERE i."id" = OLD."import_id"
      FOR SHARE;
    IF FOUND AND "header_status" <> 'PENDING' THEN
      RAISE EXCEPTION 'La importación de ventas % está en estado % y sus líneas son inmutables', OLD."import_id", "header_status"
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
  END IF;

  SELECT i."status", i."system", i."resolved_by_id"
    INTO "header_status", "header_system", "header_resolved_by"
    FROM "sales_imports" AS i
    WHERE i."id" = NEW."import_id"
    FOR SHARE;
  IF NOT FOUND THEN
    -- La FK rechaza la fila con su propio error.
    RETURN NEW;
  END IF;
  IF "header_status" <> 'PENDING' THEN
    RAISE EXCEPTION 'La importación de ventas % está en estado % y sus líneas son inmutables', NEW."import_id", "header_status"
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW."resolution" = 'MANUAL' THEN
    IF "header_resolved_by" IS NULL THEN
      RAISE EXCEPTION 'La línea «%» se resolvió a mano, pero la importación no registra quién la resolvió', NEW."original_label"
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM "payment_methods" AS m
      WHERE m."id" = NEW."payment_method_id" AND m."is_active"
    ) THEN
      RAISE EXCEPTION 'El medio de pago elegido a mano para «%» debe estar activo', NEW."original_label"
        USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (
      SELECT 1 FROM "payment_method_aliases" AS a
      WHERE a."system" = "header_system"
        AND a."normalized_label" = NEW."normalized_label"
        AND a."payment_method_id" <> NEW."payment_method_id"
    ) THEN
      RAISE EXCEPTION 'La etiqueta «%» ya tiene un alias hacia otro medio de pago: no se puede elegir otro a mano', NEW."original_label"
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1 FROM "payment_method_aliases" AS a
    WHERE a."system" = "header_system"
      AND a."normalized_label" = NEW."normalized_label"
      AND a."payment_method_id" = NEW."payment_method_id"
  ) THEN
    RAISE EXCEPTION 'La etiqueta «%» no tiene un alias configurado hacia el medio de pago indicado', NEW."original_label"
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "sales_import_skipped_lines" AS k
    WHERE k."import_id" = NEW."import_id"
      AND (k."line_number" = NEW."line_number"
        OR k."normalized_label" = NEW."normalized_label")
  ) THEN
    RAISE EXCEPTION 'La línea «%» ya se omitió en esta importación', NEW."original_label"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- Líneas omitidas a mano (ver encabezado). La cabecera se lee con FOR SHARE,
-- igual que en las líneas de venta, para no competir con una confirmación.
CREATE FUNCTION "sales_import_skipped_lines_enforce"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  "header_status" "SalesImportStatus";
  "header_system" "ExternalSystem";
  "header_resolved_by" UUID;
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'Las líneas omitidas de importación de ventas no se pueden eliminar: no se permite TRUNCATE sobre sales_import_skipped_lines'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Las líneas omitidas de la importación de ventas % son inmutables', OLD."import_id"
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'DELETE' THEN
    SELECT i."status" INTO "header_status"
      FROM "sales_imports" AS i
      WHERE i."id" = OLD."import_id"
      FOR SHARE;
    IF FOUND AND "header_status" <> 'PENDING' THEN
      RAISE EXCEPTION 'La importación de ventas % está en estado % y sus líneas omitidas son inmutables', OLD."import_id", "header_status"
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;

  SELECT i."status", i."system", i."resolved_by_id"
    INTO "header_status", "header_system", "header_resolved_by"
    FROM "sales_imports" AS i
    WHERE i."id" = NEW."import_id"
    FOR SHARE;
  IF NOT FOUND THEN
    -- La FK rechaza la fila con su propio error.
    RETURN NEW;
  END IF;
  IF "header_status" <> 'PENDING' THEN
    RAISE EXCEPTION 'La importación de ventas % está en estado % y sus líneas omitidas son inmutables', NEW."import_id", "header_status"
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF "header_resolved_by" IS NULL THEN
    RAISE EXCEPTION 'Solo una importación resuelta a mano puede omitir la línea «%»', NEW."original_label"
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "payment_method_aliases" AS a
    WHERE a."system" = "header_system"
      AND a."normalized_label" = NEW."normalized_label"
  ) THEN
    RAISE EXCEPTION 'La etiqueta «%» tiene un alias configurado: se asocia a su medio de pago y no se puede omitir', NEW."original_label"
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "sales_import_lines" AS l
    WHERE l."import_id" = NEW."import_id"
      AND (l."line_number" = NEW."line_number"
        OR l."normalized_label" = NEW."normalized_label")
  ) THEN
    RAISE EXCEPTION 'La línea «%» ya está asociada a un medio de pago en esta importación', NEW."original_label"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "sales_import_skipped_lines_enforce_rows"
  BEFORE INSERT OR UPDATE OR DELETE ON "sales_import_skipped_lines"
  FOR EACH ROW EXECUTE FUNCTION "sales_import_skipped_lines_enforce"();

CREATE TRIGGER "sales_import_skipped_lines_enforce_truncate"
  BEFORE TRUNCATE ON "sales_import_skipped_lines"
  FOR EACH STATEMENT EXECUTE FUNCTION "sales_import_skipped_lines_enforce"();
