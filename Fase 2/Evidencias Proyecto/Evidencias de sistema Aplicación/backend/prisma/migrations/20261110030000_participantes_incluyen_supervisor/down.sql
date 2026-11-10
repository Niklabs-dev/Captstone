-- Reversa de 20261110030000_participantes_incluyen_supervisor
-- (SPRINT-4A-T01). Restaura la función tal como la dejó
-- 20261107200000_participantes_diarios_reparto_equitativo: solo acepta
-- participantes con rol TRABAJADOR.
--
-- No borra ni altera filas: las participaciones de supervisores ya guardadas
-- se conservan como historial (la validación solo corre al escribir la
-- participación), pero desde la reversa no se pueden agregar nuevas.

CREATE OR REPLACE FUNCTION "daily_operation_participants_validate_worker"() RETURNS trigger
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
