-- SPRINT-4R-T10: fecha de emisión del reporte de MrComanda.
--
-- El reporte trae su fecha y hora de emisión («Fecha 06/11/2026 -
-- 11:14:55», hora de Chile). Es solo informativa: la fecha de negocio sigue
-- saliendo del «Período» (business_date). Se guarda para que el detalle y la
-- auditoría la conserven después de importar. Es NULL cuando el reporte no la
-- trae y para filas anteriores (no hay backfill: la migración anterior es del
-- mismo sprint y no tiene datos productivos).
--
-- Como el resto de los datos del archivo, issued_at es inmutable desde el
-- INSERT: se reemplaza sales_imports_enforce agregando la columna a la
-- comparación de inmutabilidad (el resto de la función no cambia).
--
-- La reversa está en down.sql (misma carpeta; Prisma solo aplica
-- migration.sql).

-- AlterTable
ALTER TABLE "sales_imports" ADD COLUMN "issued_at" TIMESTAMPTZ(6);

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
    IF NOT EXISTS (
      SELECT 1 FROM "store_external_codes" AS c
      WHERE c."system" = NEW."system"
        AND c."external_code" = NEW."external_store_code"
        AND c."store_id" = NEW."store_id"
    ) THEN
      RAISE EXCEPTION 'El identificador externo «%» no está configurado para el local de la importación', NEW."external_store_code"
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
      NEW."issued_at")
    IS DISTINCT FROM
     (OLD."id", OLD."system", OLD."store_id", OLD."business_date",
      OLD."period_start", OLD."period_end", OLD."external_store_code",
      OLD."external_store_name", OLD."version", OLD."total_amount",
      OLD."file_name", OLD."file_path", OLD."mime_type", OLD."size_bytes",
      OLD."sha256_hash", OLD."uploaded_by_id", OLD."created_at",
      OLD."issued_at") THEN
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

