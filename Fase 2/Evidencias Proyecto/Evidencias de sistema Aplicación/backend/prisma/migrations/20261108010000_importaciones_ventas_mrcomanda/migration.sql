-- SPRINT-4R-T08: importaciones diarias de ventas MrComanda y equivalencias
-- externas de locales y medios de pago.
--
-- Las ventas del día pasan a salir del reporte Excel de MrComanda (la
-- lectura del archivo es SPRINT-4R-T09 y la API de previsualización y
-- confirmación es SPRINT-4R-T10). Este modelo guarda el archivo importado
-- (cabecera) y sus totales por medio de pago (líneas). NO escribe en sales:
-- las ventas MANUAL/MRCOMANDA anteriores quedan como historial y no se
-- duplican aquí. Tampoco guarda propinas ni diferencias de efectivo, que
-- siguen viniendo solo de la operación diaria (daily_operations).
--
-- La base garantiza (para cualquier rol y vía de escritura: Prisma, SQL
-- directo o cascadas; solo session_replication_role = replica las omite, y
-- esta migración NO la usa):
-- - Equivalencias explícitas: cada local se asocia a su identificador
--   externo en store_external_codes (uno por sistema y local, y un
--   identificador nunca apunta a dos locales). Un texto como «208 - 72597»
--   solo resuelve un local si alguien lo configuró: la cabecera se rechaza
--   (trigger) si su identificador externo no está configurado para ese
--   mismo local.
-- - Los medios de pago admiten alias externos normalizados en
--   payment_method_aliases («T. DEBITO», «EFECTIVO», «N.de Créd.», ...). El
--   código del catálogo no cambia, y cada línea conserva la etiqueta
--   original y el medio resuelto: borrar o cambiar un alias después no
--   reescribe importaciones pasadas. Una línea se rechaza (trigger) si su
--   etiqueta no tiene un alias configurado hacia ese medio.
-- - La normalización vive en una función SQL inmutable
--   (normalize_external_label): mayúsculas, sin tildes y con espacios
--   colapsados. Los CHECK exigen que los valores guardados ya estén
--   normalizados, de modo que la comparación es exacta.
-- - Versiones: una importación por archivo distinto (sha256_hash único por
--   local y fecha, lo que hace idempotente reimportar el mismo archivo) y un
--   número de versión único por local y fecha. Solo UNA versión vigente
--   (ACTIVE) por local y fecha: is_current es TRUE solo en ACTIVE y NULL en
--   los demás estados, y el índice único (store_id, business_date,
--   is_current) no hace colisionar los NULL. Así la nueva versión reemplaza a
--   la anterior en una misma transacción (ACTIVE → SUPERSEDED y luego
--   PENDING → ACTIVE) sin estados intermedios con dos vigentes.
-- - Ciclo de vida (trigger): se crea PENDING (previsualizada); solo una
--   PENDING se puede descartar (DELETE, con sus líneas en cascada);
--   PENDING → ACTIVE exige al menos una línea y que la suma de las líneas
--   sea exactamente total_amount; ACTIVE → SUPERSEDED es la única salida de
--   una vigente; SUPERSEDED es terminal. Los datos del archivo (local, fecha,
--   período, total, nombre, ruta, hash, usuario y fecha de carga) son
--   inmutables desde el INSERT, y las líneas solo cambian mientras la
--   cabecera está PENDING. TRUNCATE se rechaza en ambas tablas.
-- - Montos CLP enteros en BIGINT. Las líneas aceptan signo porque una nota
--   de crédito puede restar; el porcentaje es opcional (0 a 100).
-- - El archivo vive en el volumen privado de almacenamiento (file_path), con
--   nombre físico aleatorio y su SHA-256: nunca se sirve de forma pública.
--
-- La reversa está en down.sql (misma carpeta; Prisma solo aplica
-- migration.sql).

-- CreateEnum
CREATE TYPE "ExternalSystem" AS ENUM ('MRCOMANDA');

-- CreateEnum
CREATE TYPE "SalesImportStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUPERSEDED');

-- Normalización de etiquetas e identificadores externos: sin tildes,
-- mayúsculas y espacios colapsados (la puntuación se conserva: «T. DEBITO»
-- y «T DEBITO» son etiquetas distintas). IMMUTABLE para poder usarla en
-- CHECK. La misma regla está en
-- src/sales-imports/normalization/normalize-external-label.ts, y una prueba
-- de integración compara ambas.
CREATE FUNCTION "normalize_external_label"("label" TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT btrim(
    regexp_replace(
      upper(
        translate(
          "label",
          'áàäâéèëêíìïîóòöôúùüûñÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑ',
          'aaaaeeeeiiiioooouuuunAAAAEEEEIIIIOOOOUUUUN'
        )
      ),
      '\s+',
      ' ',
      'g'
    )
  )
$$;

-- CreateTable
CREATE TABLE "store_external_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "system" "ExternalSystem" NOT NULL,
    "external_code" VARCHAR(100) NOT NULL,
    "external_name" VARCHAR(150),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "store_id" UUID NOT NULL,

    CONSTRAINT "store_external_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_method_aliases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "system" "ExternalSystem" NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "normalized_label" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "payment_method_id" UUID NOT NULL,

    CONSTRAINT "payment_method_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_imports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "system" "ExternalSystem" NOT NULL DEFAULT 'MRCOMANDA',
    "business_date" DATE NOT NULL,
    "period_start" TIMESTAMPTZ(6) NOT NULL,
    "period_end" TIMESTAMPTZ(6) NOT NULL,
    "external_store_code" VARCHAR(100) NOT NULL,
    "external_store_name" VARCHAR(150),
    "version" INTEGER NOT NULL,
    "status" "SalesImportStatus" NOT NULL DEFAULT 'PENDING',
    "is_current" BOOLEAN,
    "total_amount" BIGINT NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "file_path" VARCHAR(500) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "sha256_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMPTZ(6),
    "superseded_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "store_id" UUID NOT NULL,
    "uploaded_by_id" UUID NOT NULL,
    "confirmed_by_id" UUID,

    CONSTRAINT "sales_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_import_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "line_number" INTEGER NOT NULL,
    "original_label" VARCHAR(100) NOT NULL,
    "normalized_label" VARCHAR(100) NOT NULL,
    "amount" BIGINT NOT NULL,
    "percentage" DECIMAL(5,2),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "import_id" UUID NOT NULL,
    "payment_method_id" UUID NOT NULL,

    CONSTRAINT "sales_import_lines_pkey" PRIMARY KEY ("id")
);

-- Reglas de integridad de las equivalencias (CHECK): los valores guardados
-- ya vienen normalizados y no quedan vacíos.
ALTER TABLE "store_external_codes"
ADD CONSTRAINT "store_external_codes_code_normalized" CHECK ("external_code" = "normalize_external_label"("external_code") AND "external_code" <> '');

ALTER TABLE "payment_method_aliases"
ADD CONSTRAINT "payment_method_aliases_label_not_blank" CHECK (btrim("label") <> ''),
ADD CONSTRAINT "payment_method_aliases_label_normalized" CHECK ("normalized_label" = "normalize_external_label"("label"));

-- Reglas de integridad de la cabecera (CHECK):
-- - El período es un rango válido de un solo día de operación (hasta 24 h,
--   para admitir horarios que cruzan la medianoche) y la fecha de negocio es
--   la fecha de inicio del período en hora de Chile.
-- - Versión positiva, archivo no vacío, hash SHA-256 hexadecimal en
--   minúsculas e identificador externo normalizado.
-- - Estado coherente: PENDING sin confirmación; ACTIVE confirmada y vigente
--   (is_current TRUE); SUPERSEDED confirmada y reemplazada después de su
--   confirmación. is_current es NULL fuera de ACTIVE.
ALTER TABLE "sales_imports"
ADD CONSTRAINT "sales_imports_valid_period" CHECK ("period_end" > "period_start" AND "period_end" - "period_start" <= INTERVAL '24 hours'),
ADD CONSTRAINT "sales_imports_business_date_matches_period" CHECK ("business_date" = ("period_start" AT TIME ZONE 'America/Santiago')::date),
ADD CONSTRAINT "sales_imports_version_positive" CHECK ("version" >= 1),
ADD CONSTRAINT "sales_imports_size_positive" CHECK ("size_bytes" > 0),
ADD CONSTRAINT "sales_imports_sha256_format" CHECK ("sha256_hash" ~ '^[0-9a-f]{64}$'),
ADD CONSTRAINT "sales_imports_external_code_normalized" CHECK ("external_store_code" = "normalize_external_label"("external_store_code") AND "external_store_code" <> ''),
ADD CONSTRAINT "sales_imports_status_consistency" CHECK (
  ("status" = 'PENDING' AND "is_current" IS NULL AND "confirmed_at" IS NULL AND "confirmed_by_id" IS NULL AND "superseded_at" IS NULL)
  OR ("status" = 'ACTIVE' AND "is_current" = true AND "confirmed_at" IS NOT NULL AND "confirmed_by_id" IS NOT NULL AND "superseded_at" IS NULL)
  OR ("status" = 'SUPERSEDED' AND "is_current" IS NULL AND "confirmed_at" IS NOT NULL AND "confirmed_by_id" IS NOT NULL AND "superseded_at" IS NOT NULL AND "superseded_at" >= "confirmed_at")
);

-- Reglas de integridad de las líneas (CHECK): número de línea positivo,
-- etiqueta original no vacía y normalizada de forma exacta, y porcentaje
-- opcional entre 0 y 100.
ALTER TABLE "sales_import_lines"
ADD CONSTRAINT "sales_import_lines_line_number_positive" CHECK ("line_number" >= 1),
ADD CONSTRAINT "sales_import_lines_label_not_blank" CHECK (btrim("original_label") <> ''),
ADD CONSTRAINT "sales_import_lines_label_normalized" CHECK ("normalized_label" = "normalize_external_label"("original_label")),
ADD CONSTRAINT "sales_import_lines_percentage_range" CHECK ("percentage" IS NULL OR ("percentage" >= 0 AND "percentage" <= 100));

-- CreateIndex
CREATE UNIQUE INDEX "store_external_codes_system_external_code_key" ON "store_external_codes"("system", "external_code");

-- CreateIndex
CREATE UNIQUE INDEX "store_external_codes_system_store_id_key" ON "store_external_codes"("system", "store_id");

-- CreateIndex
CREATE INDEX "store_external_codes_store_id_idx" ON "store_external_codes"("store_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_method_aliases_system_normalized_label_key" ON "payment_method_aliases"("system", "normalized_label");

-- CreateIndex
CREATE INDEX "payment_method_aliases_payment_method_id_idx" ON "payment_method_aliases"("payment_method_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_imports_store_id_business_date_version_key" ON "sales_imports"("store_id", "business_date", "version");

-- CreateIndex
CREATE UNIQUE INDEX "sales_imports_store_id_business_date_sha256_hash_key" ON "sales_imports"("store_id", "business_date", "sha256_hash");

-- CreateIndex
CREATE UNIQUE INDEX "sales_imports_store_id_business_date_is_current_key" ON "sales_imports"("store_id", "business_date", "is_current");

-- CreateIndex
CREATE INDEX "sales_imports_business_date_idx" ON "sales_imports"("business_date");

-- CreateIndex
CREATE UNIQUE INDEX "sales_import_lines_import_id_line_number_key" ON "sales_import_lines"("import_id", "line_number");

-- CreateIndex
CREATE UNIQUE INDEX "sales_import_lines_import_id_normalized_label_key" ON "sales_import_lines"("import_id", "normalized_label");

-- CreateIndex
CREATE INDEX "sales_import_lines_payment_method_id_idx" ON "sales_import_lines"("payment_method_id");

-- AddForeignKey
ALTER TABLE "store_external_codes" ADD CONSTRAINT "store_external_codes_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_method_aliases" ADD CONSTRAINT "payment_method_aliases_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_imports" ADD CONSTRAINT "sales_imports_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_imports" ADD CONSTRAINT "sales_imports_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_imports" ADD CONSTRAINT "sales_imports_confirmed_by_id_fkey" FOREIGN KEY ("confirmed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_import_lines" ADD CONSTRAINT "sales_import_lines_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "sales_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_import_lines" ADD CONSTRAINT "sales_import_lines_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Ciclo de vida de la cabecera de importación (ver encabezado).
CREATE FUNCTION "sales_imports_enforce"() RETURNS trigger
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
    IF NOT EXISTS (
      SELECT 1 FROM "store_external_codes" AS c
      WHERE c."system" = NEW."system"
        AND c."external_code" = NEW."external_store_code"
        AND c."store_id" = NEW."store_id"
    ) THEN
      RAISE EXCEPTION 'El identificador externo «%» no está configurado para el local de la importación', NEW."external_store_code"
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
      NEW."sha256_hash", NEW."uploaded_by_id", NEW."created_at")
    IS DISTINCT FROM
     (OLD."id", OLD."system", OLD."store_id", OLD."business_date",
      OLD."period_start", OLD."period_end", OLD."external_store_code",
      OLD."external_store_name", OLD."version", OLD."total_amount",
      OLD."file_name", OLD."file_path", OLD."mime_type", OLD."size_bytes",
      OLD."sha256_hash", OLD."uploaded_by_id", OLD."created_at") THEN
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

CREATE TRIGGER "sales_imports_enforce_rows"
  BEFORE INSERT OR UPDATE OR DELETE ON "sales_imports"
  FOR EACH ROW EXECUTE FUNCTION "sales_imports_enforce"();

CREATE TRIGGER "sales_imports_enforce_truncate"
  BEFORE TRUNCATE ON "sales_imports"
  FOR EACH STATEMENT EXECUTE FUNCTION "sales_imports_enforce"();

-- Las líneas solo cambian mientras la cabecera está PENDING, y cada etiqueta
-- debe resolver al medio indicado mediante un alias configurado. La cabecera
-- se lee con FOR SHARE: una confirmación concurrente (que toma FOR NO KEY
-- UPDATE sobre la cabecera) espera a que termine la escritura de líneas, y
-- viceversa, así la suma comprobada al confirmar es la definitiva. Si la
-- cabecera ya no existe en un DELETE es la cascada del descarte de una
-- importación PENDING (lo único que el trigger de cabecera permite borrar).
CREATE FUNCTION "sales_import_lines_enforce"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  "header_status" "SalesImportStatus";
  "header_system" "ExternalSystem";
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'Las líneas de importación de ventas no se pueden eliminar: no se permite TRUNCATE sobre sales_import_lines'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT i."status" INTO "header_status"
      FROM "sales_imports" AS i
      WHERE i."id" = OLD."import_id"
      FOR SHARE;
    IF FOUND AND "header_status" <> 'PENDING' THEN
      RAISE EXCEPTION 'La importación de ventas % está en estado % y sus líneas son inmutables', OLD."import_id", "header_status"
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
  END IF;

  SELECT i."status", i."system" INTO "header_status", "header_system"
    FROM "sales_imports" AS i
    WHERE i."id" = NEW."import_id"
    FOR SHARE;
  IF NOT FOUND THEN
    -- La FK rechaza la fila con su propio error.
    RETURN NEW;
  END IF;
  IF "header_status" <> 'PENDING' THEN
    RAISE EXCEPTION 'La importación de ventas % está en estado % y sus líneas son inmutables', NEW."import_id", "header_status"
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "payment_method_aliases" AS a
    WHERE a."system" = "header_system"
      AND a."normalized_label" = NEW."normalized_label"
      AND a."payment_method_id" = NEW."payment_method_id"
  ) THEN
    RAISE EXCEPTION 'La etiqueta «%» no tiene un alias configurado hacia el medio de pago indicado', NEW."original_label"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "sales_import_lines_enforce_rows"
  BEFORE INSERT OR UPDATE OR DELETE ON "sales_import_lines"
  FOR EACH ROW EXECUTE FUNCTION "sales_import_lines_enforce"();

CREATE TRIGGER "sales_import_lines_enforce_truncate"
  BEFORE TRUNCATE ON "sales_import_lines"
  FOR EACH STATEMENT EXECUTE FUNCTION "sales_import_lines_enforce"();
