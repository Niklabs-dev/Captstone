-- SPRINT-5-T01 (revisión del PR #88): bloqueo de la toma sin deadlock y
-- saved_at asignado por la base.
--
-- 1. Deadlock con dos finalizaciones simultáneas. En
--    20261111120000_inventario_catalogo_toma el trigger de las líneas leía la
--    toma con FOR SHARE. Dos transacciones que finalizaban la misma toma
--    insertaban cada una sus líneas vacías (las dos obtenían el FOR SHARE,
--    que es compartido) y luego hacían el UPDATE a CONFIRMED: cada UPDATE
--    esperaba el FOR SHARE de la otra y PostgreSQL cancelaba una con
--    «deadlock detected» (40P01). Lo mismo pasaría con un guardado de línea
--    que además actualizara la toma mientras otra transacción la finaliza.
--
--    Ahora el trigger lee la toma con FOR NO KEY UPDATE, el mismo bloqueo que
--    toma el UPDATE de la toma. Es exclusivo entre escritores (dos
--    escrituras sobre las líneas de una misma toma se serializan) pero
--    compatible con el FOR KEY SHARE de la FK count_id, así que la propia FK
--    no lo estorba. La segunda finalización espera en su primera línea, la
--    vuelve a leer cuando la primera confirma (READ COMMITTED) y, como ya
--    está CONFIRMED, se rechaza con el error del trigger (SQLSTATE 42501,
--    insufficient_privilege, «La toma de inventario … está finalizada: no se
--    permite INSERT sobre sus líneas»), sin deadlock. Quien escribe líneas y
--    luego actualiza la toma ya tiene su bloqueo y no espera a nadie.
--
-- 2. saved_at («fecha-hora del último guardado») lo asigna ahora el trigger:
--    NEW."saved_at" := now() en cada INSERT y UPDATE permitido. saved_by_id
--    lo sigue informando el servicio.
--
-- Solo se reemplaza la función; los triggers que la usan no cambian. La
-- reversa está en down.sql (misma carpeta; Prisma solo aplica
-- migration.sql).

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

  -- Bloqueo de escritor sobre la toma (ver encabezado): serializa las
  -- escrituras de líneas de una toma entre sí y con su finalización.
  SELECT c."status" INTO "count_status"
    FROM "inventory_counts" AS c
    WHERE c."id" = "target"
    FOR NO KEY UPDATE;

  IF "count_status" = 'CONFIRMED' THEN
    RAISE EXCEPTION 'La toma de inventario % está finalizada: no se permite % sobre sus líneas', "target", TG_OP
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  NEW."saved_at" := now();
  RETURN NEW;
END;
$$;
