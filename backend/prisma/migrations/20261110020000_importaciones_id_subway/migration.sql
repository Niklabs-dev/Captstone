-- SPRINT-4A-T17: el local del Excel de ventas se identifica por su ID Subway.
--
-- El encabezado del «Informe de Ventas Diario» de MrComanda trae el local
-- como «Local: 208 - 72597»: 208 es un número interno de MrComanda y 72597 es
-- el ID Subway, que desde SPRINT-4A-T15 vive en stores.subway_store_id. El
-- parser extrae el ID Subway del encabezado y el resolver busca el local
-- activo con ese ID; el 208 se ignora y solo queda como parte del texto
-- original (external_store_code, sin cambios).
--
-- Cambios:
-- - sales_imports.subway_store_id guarda el ID Subway con que se identificó
--   el local (solo dígitos, 1 a 10, CHECK). Es NULL solo en las importaciones
--   anteriores a esta migración (no hay backfill: su texto original sigue en
--   external_store_code) y, como el resto de los datos del archivo, es
--   inmutable desde el INSERT.
-- - sales_imports_enforce exige al insertar que subway_store_id no sea NULL y
--   que sea el ID Subway del local de la importación. Ya no consulta
--   store_external_codes: el local nunca se asigna por suposición, ahora por
--   el ID Subway configurado en el local. El resto de la función no cambia.
-- - store_external_codes queda sin uso (no la leen la API ni los triggers).
--   No se elimina en esta migración: se conserva por compatibilidad y para no
--   perder datos configurados a mano; su retiro, si corresponde, irá en una
--   migración nueva.
--
-- La reversa está en down.sql (misma carpeta; Prisma solo aplica
-- migration.sql).

-- AlterTable
ALTER TABLE "sales_imports" ADD COLUMN "subway_store_id" VARCHAR(10);

ALTER TABLE "sales_imports"
ADD CONSTRAINT "sales_imports_subway_store_id_digits" CHECK ("subway_store_id" ~ '^[0-9]{1,10}$');

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

