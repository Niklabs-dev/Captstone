-- SPRINT-2-T14: una liquidación publicada no se puede editar ni eliminar
-- (criterio 1 de E2-H1). La API solo ofrece el paso de PENDING_SIGNATURE a
-- PUBLISHED (POST /payroll/:id/publish) y estos triggers lo garantizan para
-- cualquier rol y vía (Prisma, SQL directo o cascadas), igual que la
-- inmutabilidad de audit_logs (SPRINT-1-T15) y de document_versions
-- (SPRINT-2-T05). Solo se omiten con session_replication_role = replica, que
-- exige privilegios de superusuario (mantenimiento, no un camino de la
-- aplicación).

-- payslips:
-- - TRUNCATE siempre se rechaza.
-- - Publicada: se rechaza todo UPDATE, y DELETE mientras no venza el plazo
--   de conservación de su documento (el día se cuenta en hora de Chile, igual
--   que en SPRINT-2-T07).
-- - Pendiente: el trabajador, el período, el documento y quién la cargó no
--   cambian, y el único cambio de estado posible es a PUBLISHED.
CREATE FUNCTION "payslips_enforce_publication"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'Las liquidaciones no se pueden eliminar: no se permite TRUNCATE sobre payslips'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'DELETE' AND OLD."status" = 'PUBLISHED' AND EXISTS (
    SELECT 1 FROM "documents" AS d
    WHERE d."id" = OLD."document_id"
      AND d."retain_until" < (now() AT TIME ZONE 'America/Santiago')::date
  ) THEN
    RETURN OLD;
  END IF;

  IF OLD."status" = 'PUBLISHED' THEN
    RAISE EXCEPTION 'La liquidación publicada % es inmutable: no se permite % sobre payslips', OLD."id", TG_OP
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF NEW."worker_id" <> OLD."worker_id"
    OR NEW."period" <> OLD."period"
    OR NEW."document_id" <> OLD."document_id"
    OR NEW."created_by_id" <> OLD."created_by_id"
    OR NEW."created_at" <> OLD."created_at" THEN
    RAISE EXCEPTION 'No se puede cambiar el trabajador, el período, el documento ni la carga de la liquidación %', OLD."id"
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "payslips_publication_rows"
  BEFORE UPDATE OR DELETE ON "payslips"
  FOR EACH ROW EXECUTE FUNCTION "payslips_enforce_publication"();

-- TRUNCATE no dispara los triggers por fila: se bloquea por sentencia.
CREATE TRIGGER "payslips_publication_truncate"
  BEFORE TRUNCATE ON "payslips"
  FOR EACH STATEMENT EXECUTE FUNCTION "payslips_enforce_publication"();

-- documents y document_versions: el archivo de una liquidación publicada
-- tampoco cambia. Se rechaza agregarle versiones y modificar los datos del
-- documento que la identifican (la conservación y su eliminación siguen las
-- reglas de SPRINT-2-T07).
CREATE FUNCTION "payslip_documents_prevent_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  "target_document_id" UUID;
BEGIN
  IF TG_TABLE_NAME = 'document_versions' THEN
    "target_document_id" := NEW."document_id";
  ELSE
    "target_document_id" := OLD."id";
  END IF;

  IF EXISTS (
    SELECT 1 FROM "payslips" AS p
    WHERE p."document_id" = "target_document_id"
      AND p."status" = 'PUBLISHED'
  ) THEN
    RAISE EXCEPTION 'El documento % es de una liquidación publicada: no se permite % sobre %', "target_document_id", TG_OP, TG_TABLE_NAME
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "payslip_document_versions_insert"
  BEFORE INSERT ON "document_versions"
  FOR EACH ROW EXECUTE FUNCTION "payslip_documents_prevent_change"();

CREATE TRIGGER "payslip_documents_update"
  BEFORE UPDATE OF "title", "description", "issued_at", "store_id", "subject_user_id", "document_type_id", "current_version_id" ON "documents"
  FOR EACH ROW EXECUTE FUNCTION "payslip_documents_prevent_change"();
