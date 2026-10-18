-- SPRINT-2-T07: bloqueo de la eliminación de documentos antes de su plazo de
-- conservación (criterio 3 de E1-H3, art. 9 bis del Código del Trabajo).
-- Un documento laboral y sus versiones deben conservarse hasta retain_until
-- (fijado al crearlo en SPRINT-2-T05); solo desde el día siguiente pueden
-- eliminarse. La API aplica la misma regla (DELETE /documents/:id) y estos
-- triggers la garantizan para cualquier rol y vía (Prisma, SQL directo o
-- cascadas), igual que la inmutabilidad de audit_logs (SPRINT-1-T15). Solo se
-- omiten con session_replication_role = replica, que exige privilegios de
-- superusuario (mantenimiento, no un camino de la aplicación).
--
-- El día actual se toma en hora de Chile, igual que el día de carga con el que
-- se calculó retain_until.

-- documents: rechaza DELETE antes de que venza el plazo, que se acorte
-- retain_until (abriría la puerta a eliminar antes de tiempo) y TRUNCATE.
CREATE FUNCTION "documents_enforce_retention"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'Los documentos deben conservarse durante su plazo de conservación: no se permite TRUNCATE sobre documents'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD."retain_until" >= (now() AT TIME ZONE 'America/Santiago')::date THEN
      RAISE EXCEPTION 'No se puede eliminar el documento % antes de su plazo de conservación (debe conservarse hasta el %)', OLD."id", OLD."retain_until"
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW."retain_until" < OLD."retain_until" THEN
    RAISE EXCEPTION 'No se puede acortar el plazo de conservación del documento % (de % a %)', OLD."id", OLD."retain_until", NEW."retain_until"
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "documents_retention_rows"
  BEFORE DELETE OR UPDATE OF "retain_until" ON "documents"
  FOR EACH ROW EXECUTE FUNCTION "documents_enforce_retention"();

-- TRUNCATE no dispara los triggers por fila: se bloquea por sentencia.
CREATE TRIGGER "documents_retention_truncate"
  BEFORE TRUNCATE ON "documents"
  FOR EACH STATEMENT EXECUTE FUNCTION "documents_enforce_retention"();

-- document_versions: siguen siendo inmutables (UPDATE y TRUNCATE siempre se
-- rechazan, SPRINT-2-T05), pero una versión puede eliminarse una vez vencido
-- el plazo de conservación de su documento, para poder eliminarlo completo.
CREATE OR REPLACE FUNCTION "document_versions_prevent_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (
      SELECT 1 FROM "documents" AS d
      WHERE d."id" = OLD."document_id"
        AND d."retain_until" < (now() AT TIME ZONE 'America/Santiago')::date
    ) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'No se puede eliminar una versión del documento % antes de su plazo de conservación', OLD."document_id"
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RAISE EXCEPTION 'Las versiones de documentos son inmutables: no se permite % sobre document_versions', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
