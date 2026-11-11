-- SPRINT-4A-T21: las líneas en 0 sin medio reconocido se omiten solas al
-- importar el Excel de ventas de MrComanda.
--
-- Decisión del PO (10/11/2026): una línea del informe sin alias configurado
-- y con monto 0 (ej. «N.de Créd.» en 0) se omite sin pedir nada al
-- administrador y queda registrada como omitida; no bloquea la carga ni
-- cuenta como dato por resolver. Una línea con valor nunca se omite: se
-- asocia a un medio del catálogo o a uno nuevo creado desde la vista previa.
--
-- Hasta ahora (20261110070000) solo una importación resuelta a mano
-- (resolved_by_id) podía guardar líneas omitidas. Con la omisión automática,
-- un archivo cuyo único dato sin alias es una línea en 0 se importa por el
-- flujo normal (vista previa PENDING → confirmar), con la cabecera AUTOMATIC
-- y sin resolved_by_id.
--
-- Cambios:
-- - sales_import_skipped_lines.resolution (AUTOMATIC | MANUAL) indica si la
--   línea se omitió sola o la omitió el administrador. Las filas existentes
--   se omitieron a mano en SPRINT-4A-T18 (MANUAL); las nuevas son AUTOMATIC
--   por defecto. Se agrega con DEFAULT 'MANUAL' para rellenar las existentes
--   sin UPDATE (el trigger las hace inmutables) y luego se cambia el default.
-- - sales_import_skipped_lines_enforce: una omisión AUTOMATIC ya no exige
--   cabecera resuelta a mano; una MANUAL la sigue exigiendo. Todo lo demás
--   se mantiene, de modo que no se abre ningún hueco:
--   * monto siempre 0 (CHECK sales_import_skipped_lines_amount_zero): una
--     línea con valor no se puede omitir por ninguna vía;
--   * la etiqueta no puede tener un alias configurado (se asocia a su medio);
--   * solo en una cabecera PENDING, sin repetir el número ni la etiqueta de
--     una línea de venta de la misma importación;
--   * inmutable y eliminable solo junto con su cabecera PENDING (descarte).
--
-- La reversa está en down.sql (misma carpeta; Prisma solo aplica
-- migration.sql).

-- AlterTable
ALTER TABLE "sales_import_skipped_lines" ADD COLUMN "resolution" "SalesImportResolution" NOT NULL DEFAULT 'MANUAL';

ALTER TABLE "sales_import_skipped_lines" ALTER COLUMN "resolution" SET DEFAULT 'AUTOMATIC';

-- Líneas omitidas: se reemplaza sales_import_skipped_lines_enforce
-- (20261110070000). Solo cambia la exigencia de cabecera resuelta a mano,
-- que ahora aplica únicamente a las omisiones MANUAL.
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
  IF NEW."resolution" = 'MANUAL' AND "header_resolved_by" IS NULL THEN
    RAISE EXCEPTION 'Solo una importación resuelta a mano puede omitir a mano la línea «%»', NEW."original_label"
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
