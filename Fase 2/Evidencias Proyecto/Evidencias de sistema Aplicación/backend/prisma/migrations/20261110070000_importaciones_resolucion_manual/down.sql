-- Reversa de 20261110070000_importaciones_resolucion_manual (SPRINT-4A-T18).
-- Retira la tabla de líneas omitidas (con su trigger y función), restaura
-- sales_imports_enforce tal como la dejó 20261110020000_importaciones_id_subway
-- y sales_import_lines_enforce tal como la dejó
-- 20261108010000_importaciones_ventas_mrcomanda, y retira las columnas de
-- resolución y su tipo. Se pierde el registro de qué datos se resolvieron a
-- mano y quién lo hizo (la auditoría lo conserva). Ojo: si existen
-- importaciones con local MANUAL cuyo ID Subway no es el del local, siguen
-- guardadas tal cual (la regla antigua solo se revisa al insertar).

DROP TABLE "sales_import_skipped_lines";

DROP FUNCTION "sales_import_skipped_lines_enforce"();

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

  -- UPDATE: los datos del archivo son inmutables en cualquier estado.
  IF (NEW."id", NEW."system", NEW."store_id", NEW."business_date",
      NEW."period_start", NEW."period_end", NEW."external_store_code",
      NEW."external_store_name", NEW."version", NEW."total_amount",
      NEW."file_name", NEW."file_path", NEW."mime_type", NEW."size_bytes",
      NEW."sha256_hash", NEW."uploaded_by_id", NEW."created_at",
      NEW."issued_at", NEW."subway_store_id")
    IS DISTINCT FROM
     (OLD."id", OLD."system", OLD."store_id", OLD."business_date",
      OLD."period_start", OLD."period_end", OLD."external_store_code",
      OLD."external_store_name", OLD."version", OLD."total_amount",
      OLD."file_name", OLD."file_path", OLD."mime_type", OLD."size_bytes",
      OLD."sha256_hash", OLD."uploaded_by_id", OLD."created_at",
      OLD."issued_at", OLD."subway_store_id") THEN
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

CREATE OR REPLACE FUNCTION "sales_import_lines_enforce"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  "header_status" "SalesImportStatus";
  "header_system" "ExternalSystem";
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

  SELECT i."status", i."system" INTO "header_status", "header_system"
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
  IF NOT EXISTS (
    SELECT 1 FROM "payment_method_aliases" AS a
    WHERE a."system" = "header_system"
      AND a."normalized_label" = NEW."normalized_label"
      AND a."payment_method_id" = NEW."payment_method_id"
  ) THEN
    RAISE EXCEPTION 'La etiqueta «%» no tiene un alias configurado hacia el medio de pago indicado', NEW."original_label"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE "sales_import_lines" DROP COLUMN "resolution";

ALTER TABLE "sales_imports" DROP CONSTRAINT "sales_imports_resolved_by_id_fkey";

ALTER TABLE "sales_imports" DROP COLUMN "resolved_at",
DROP COLUMN "resolved_by_id",
DROP COLUMN "store_resolution";

DROP TYPE "SalesImportResolution";
