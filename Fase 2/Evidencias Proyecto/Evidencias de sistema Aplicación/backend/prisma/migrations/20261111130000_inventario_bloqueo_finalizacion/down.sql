-- Reversa de 20261111130000_inventario_bloqueo_finalizacion (SPRINT-5-T01).
-- Restaura inventory_count_lines_require_open tal como la dejó
-- 20261111120000_inventario_catalogo_toma: la toma vuelve a leerse con
-- FOR SHARE (dos finalizaciones simultáneas de la misma toma pueden terminar
-- en deadlock) y saved_at deja de asignarse solo (queda el valor que informe
-- el servicio o el default al insertar). No modifica filas.

BEGIN;

CREATE OR REPLACE FUNCTION "inventory_count_lines_require_open"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  "target" UUID;
  "count_status" "InventoryCountStatus";
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    IF EXISTS (
      SELECT 1 FROM "inventory_count_lines" AS l
      JOIN "inventory_counts" AS c ON c."id" = l."count_id"
      WHERE c."status" = 'CONFIRMED'
    ) THEN
      RAISE EXCEPTION 'Hay líneas de tomas de inventario finalizadas: no se permite TRUNCATE sobre inventory_count_lines'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NULL;
  END IF;

  IF TG_OP = 'UPDATE' AND (NEW."id", NEW."count_id", NEW."product_id")
    IS DISTINCT FROM (OLD."id", OLD."count_id", OLD."product_id") THEN
    RAISE EXCEPTION 'La línea % no puede cambiar de toma ni de producto', OLD."id"
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'DELETE' THEN
    "target" := OLD."count_id";
  ELSE
    "target" := NEW."count_id";
  END IF;

  SELECT c."status" INTO "count_status"
    FROM "inventory_counts" AS c
    WHERE c."id" = "target"
    FOR SHARE;

  IF "count_status" = 'CONFIRMED' THEN
    RAISE EXCEPTION 'La toma de inventario % está finalizada: no se permite % sobre sus líneas', "target", TG_OP
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- Registro de la migración (manual): permite que migrate deploy la reaplique.
DELETE FROM "_prisma_migrations"
  WHERE "migration_name" = '20261111130000_inventario_bloqueo_finalizacion';

COMMIT;
