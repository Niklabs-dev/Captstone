-- SPRINT-4A-T01: el supervisor también participa del reparto de propinas.
--
-- Decisión del Product Owner (10/11/2026): el supervisor también es
-- trabajador del local y recibe su parte de las propinas del día. Hasta ahora
-- el trigger de 20261107200000_participantes_diarios_reparto_equitativo solo
-- aceptaba participantes con rol TRABAJADOR; esta migración reemplaza SOLO la
-- función de ese trigger (la migración original no se edita) para aceptar a
-- TRABAJADOR y SUPERVISOR activos del mismo local de la operación.
-- ADMINISTRADOR y CONTADOR (roles globales, sin local) siguen rechazados.
--
-- No se toca ninguna fila: las operaciones, selecciones y repartos
-- históricos quedan tal cual. Igual que antes, la validación corre solo al
-- escribir la participación: una baja lógica o un cambio de rol/local
-- posteriores no alteran el historial. El trigger
-- daily_operation_participants_validate_worker_rows sigue apuntando a esta
-- función, así que no se recrea.
--
-- La reversa está en down.sql (misma carpeta; Prisma solo aplica
-- migration.sql).

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
      AND r."code" IN ('TRABAJADOR', 'SUPERVISOR')
  ) THEN
    RAISE EXCEPTION 'El participante % debe ser un trabajador activo del local de la operación % (rol TRABAJADOR o SUPERVISOR)', NEW."worker_id", NEW."operation_id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
