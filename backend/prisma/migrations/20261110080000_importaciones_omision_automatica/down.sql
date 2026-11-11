-- Reversa de 20261110080000_importaciones_omision_automatica (SPRINT-4A-T21).
-- Restaura sales_import_skipped_lines_enforce tal como la dejó
-- 20261110070000_importaciones_resolucion_manual (toda omisión exige cabecera
-- resuelta a mano) y retira la columna resolution de las líneas omitidas. Se
-- pierde el registro de qué líneas se omitieron solas (la auditoría de la
-- confirmación lo conserva). Ojo: las líneas omitidas automáticamente en
-- importaciones sin resolución manual siguen guardadas tal cual (la regla
-- antigua solo se revisa al insertar).

CREATE OR REPLACE FUNCTION "sales_import_skipped_lines_enforce"() RETURNS trigger
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

ALTER TABLE "sales_import_skipped_lines" DROP COLUMN "resolution";
