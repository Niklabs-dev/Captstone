-- SPRINT-2-T05: versiones de documentos inmutables (criterio 1 de E1-H3).
-- Cada carga de un documento laboral crea una fila nueva en document_versions;
-- las versiones anteriores quedan consultables pero no se pueden modificar ni
-- eliminar, para que el hash SHA-256 registrado siga correspondiendo al
-- archivo original (art. 9 bis del Código del Trabajo).

-- Rechaza toda modificación de una versión. Igual que en audit_logs
-- (SPRINT-1-T15), aplica a cualquier rol y vía (Prisma, SQL directo o
-- cascadas) y solo se omite con session_replication_role = replica, que exige
-- privilegios de superusuario (mantenimiento, no un camino de la aplicación).
CREATE FUNCTION "document_versions_prevent_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Las versiones de documentos son inmutables: no se permite % sobre document_versions', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

-- UPDATE y DELETE fila a fila.
CREATE TRIGGER "document_versions_immutable_rows"
  BEFORE UPDATE OR DELETE ON "document_versions"
  FOR EACH ROW EXECUTE FUNCTION "document_versions_prevent_change"();

-- TRUNCATE no dispara los triggers por fila: se bloquea por sentencia.
CREATE TRIGGER "document_versions_immutable_truncate"
  BEFORE TRUNCATE ON "document_versions"
  FOR EACH STATEMENT EXECUTE FUNCTION "document_versions_prevent_change"();
