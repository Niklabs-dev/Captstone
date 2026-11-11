-- SPRINT-5-T01: amplía el modelo de inventario de la migración inicial para
-- el catálogo de productos con formato y la toma de inventario digital.
--
-- Alcance definido por el PO (10/11/2026 y 11/11/2026): products,
-- inventory_counts e inventory_count_lines existen desde 20260924183514_init,
-- están vacías y ningún módulo las usa, así que se amplían en vez de crear
-- tablas nuevas. inventory_movements no se toca. La tabla nueva
-- inventory_template_rows guarda la estructura fija de la plantilla impresa;
-- su carga es el seed de SPRINT-5-T02.
--
-- Cambios:
-- - UnitOfMeasure queda en UNIT, KG y L. Se RECREA el enum (no un CHECK) para
--   que el cliente Prisma y la API solo conozcan valores válidos; G, ML y
--   PACK no tienen filas que convertir (si las hubiera, la migración se
--   detiene con un mensaje explícito en vez de convertirlas a ciegas).
-- - products: sku opcional y único cuando existe (el UNIQUE existente admite
--   varios NULL); nombres alternativos (VARCHAR[]); nombre del paquete;
--   contenido por caja y por paquete (DECIMAL(12,3), independientes entre
--   sí); paquetes por caja (entero, solo informativo) y «solo cantidad
--   suelta».
-- - inventory_template_rows: posición (= número de fila de la hoja Excel),
--   tipo, texto impreso, sección y producto opcional y único.
-- - inventory_counts: fecha de la toma, usuario y fecha-hora de finalización
--   y copia de la estructura de la plantilla (JSONB) al finalizar. OPEN es
--   «En curso» y CONFIRMED es «Finalizado».
-- - inventory_count_lines: cajas, paquetes y cantidad suelta; usuario y
--   fecha-hora del último guardado; copia del SKU, nombre, unidad y formato
--   del producto. counted_quantity guarda el total; system_quantity y
--   difference pasan a opcionales (reservadas para comparar contra el stock).
--
-- La base garantiza (para cualquier vía de escritura; solo
-- session_replication_role = replica omite los triggers y esta migración NO
-- la usa):
-- - CHECK: cajas y paquetes >= 0; cantidad suelta >= 0; contenidos > 0 y
--   paquetes por caja >= 1 cuando existen; en UNIT los contenidos y la
--   cantidad suelta son enteros; total = cajas × contenido por caja +
--   paquetes × contenido por paquete + suelta, sobre la copia del formato de
--   la línea; una línea vacía (no contada) no tiene cantidades.
-- - Como máximo una toma OPEN por local (índice único parcial).
-- - La toma nace OPEN; una toma CONFIRMED es inmutable y no se borra, y sus
--   líneas no se insertan, modifican ni borran. La finalización (SPRINT-5-T06)
--   inserta las líneas vacías ANTES de pasar la toma a CONFIRMED, en la misma
--   transacción, y el trigger lo permite.
-- - La posición de una fila de la plantilla no se actualiza y las filas no se
--   borran: el Excel descargado se copia y se pega en otro cuadre.
--
-- La reversa está en down.sql (misma carpeta; Prisma solo aplica
-- migration.sql).

-- Unidad: KG, L o UNIT. Un producto con G, ML o PACK detiene la migración.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "products" WHERE "unit"::text IN ('G', 'ML', 'PACK')) THEN
    RAISE EXCEPTION 'Hay productos con unidad G, ML o PACK: conviértalos a KG, L o UNIT antes de aplicar 20261111120000_inventario_catalogo_toma'
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

-- AlterEnum
CREATE TYPE "UnitOfMeasure_new" AS ENUM ('UNIT', 'KG', 'L');
ALTER TABLE "products" ALTER COLUMN "unit" TYPE "UnitOfMeasure_new" USING ("unit"::text::"UnitOfMeasure_new");
ALTER TYPE "UnitOfMeasure" RENAME TO "UnitOfMeasure_old";
ALTER TYPE "UnitOfMeasure_new" RENAME TO "UnitOfMeasure";
DROP TYPE "UnitOfMeasure_old";

-- CreateEnum
CREATE TYPE "InventoryTemplateRowKind" AS ENUM ('ITEM', 'BLANK', 'SECTION');

-- Nombres alternativos válidos: sin elementos NULL ni vacíos. Función
-- inmutable para poder usarla en el CHECK (un CHECK no admite subconsultas).
CREATE FUNCTION "inventory_names_are_valid"("names" VARCHAR[]) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT COALESCE(bool_and("name" IS NOT NULL AND btrim("name") <> ''), true)
  FROM unnest("names") AS "name"
$$;

-- AlterTable: products
ALTER TABLE "products" ADD COLUMN     "alternative_names" VARCHAR(120)[] NOT NULL DEFAULT ARRAY[]::VARCHAR(120)[],
ADD COLUMN     "box_content" DECIMAL(12,3),
ADD COLUMN     "loose_only" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "package_content" DECIMAL(12,3),
ADD COLUMN     "package_name" VARCHAR(30),
ADD COLUMN     "packages_per_box" INTEGER,
ALTER COLUMN "sku" DROP NOT NULL;

ALTER TABLE "products"
  ADD CONSTRAINT "products_sku_not_blank" CHECK ("sku" IS NULL OR btrim("sku") <> ''),
  ADD CONSTRAINT "products_name_not_blank" CHECK (btrim("name") <> ''),
  ADD CONSTRAINT "products_alternative_names_valid" CHECK ("inventory_names_are_valid"("alternative_names")),
  ADD CONSTRAINT "products_package_name_not_blank" CHECK ("package_name" IS NULL OR btrim("package_name") <> ''),
  ADD CONSTRAINT "products_box_content_positive" CHECK ("box_content" IS NULL OR "box_content" > 0),
  ADD CONSTRAINT "products_package_content_positive" CHECK ("package_content" IS NULL OR "package_content" > 0),
  ADD CONSTRAINT "products_packages_per_box_positive" CHECK ("packages_per_box" IS NULL OR "packages_per_box" >= 1),
  ADD CONSTRAINT "products_unit_contents_integer" CHECK (
    "unit" <> 'UNIT'
    OR (("box_content" IS NULL OR "box_content" = trunc("box_content"))
        AND ("package_content" IS NULL OR "package_content" = trunc("package_content")))
  );

-- CreateTable: filas fijas de la plantilla impresa.
CREATE TABLE "inventory_template_rows" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "position" INTEGER NOT NULL,
    "kind" "InventoryTemplateRowKind" NOT NULL,
    "printed_text" VARCHAR(120),
    "section" VARCHAR(120) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "product_id" UUID,

    CONSTRAINT "inventory_template_rows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inventory_template_rows_position_key" ON "inventory_template_rows"("position");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_template_rows_product_id_key" ON "inventory_template_rows"("product_id");

-- AddForeignKey
ALTER TABLE "inventory_template_rows" ADD CONSTRAINT "inventory_template_rows_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- La fila 1 de la hoja es el encabezado; BLANK no lleva texto y ITEM/SECTION
-- sí; solo un ITEM lleva producto.
ALTER TABLE "inventory_template_rows"
  ADD CONSTRAINT "inventory_template_rows_position_after_header" CHECK ("position" >= 2),
  ADD CONSTRAINT "inventory_template_rows_text_by_kind" CHECK (
    ("kind" = 'BLANK' AND "printed_text" IS NULL)
    OR ("kind" <> 'BLANK' AND "printed_text" IS NOT NULL AND btrim("printed_text") <> '')
  ),
  ADD CONSTRAINT "inventory_template_rows_section_not_blank" CHECK (btrim("section") <> ''),
  ADD CONSTRAINT "inventory_template_rows_product_only_item" CHECK ("product_id" IS NULL OR "kind" = 'ITEM');

-- AlterTable: inventory_counts. count_date se rellena desde counted_at (hora
-- de Chile) antes de exigirla; las tomas CONFIRMED heredadas se finalizan con
-- su creador, su updated_at y una plantilla vacía para cumplir el CHECK.
ALTER TABLE "inventory_counts" ADD COLUMN     "count_date" DATE,
ADD COLUMN     "finalized_at" TIMESTAMPTZ(6),
ADD COLUMN     "finalized_by_id" UUID,
ADD COLUMN     "template_snapshot" JSONB;

UPDATE "inventory_counts"
  SET "count_date" = ("counted_at" AT TIME ZONE 'America/Santiago')::date;

UPDATE "inventory_counts"
  SET "finalized_at" = "updated_at",
      "finalized_by_id" = "created_by_id",
      "template_snapshot" = '[]'::jsonb
  WHERE "status" = 'CONFIRMED';

ALTER TABLE "inventory_counts" ALTER COLUMN "count_date" SET NOT NULL;

-- CreateIndex
CREATE INDEX "inventory_counts_store_id_count_date_idx" ON "inventory_counts"("store_id", "count_date");

-- CreateIndex
CREATE INDEX "inventory_counts_finalized_by_id_idx" ON "inventory_counts"("finalized_by_id");

-- Como máximo una toma En curso por local. Índice parcial: Prisma no lo
-- expresa en el schema, por eso va solo en SQL.
CREATE UNIQUE INDEX "inventory_counts_store_id_open_key" ON "inventory_counts"("store_id")
  WHERE "status" = 'OPEN';

-- AddForeignKey
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_finalized_by_id_fkey" FOREIGN KEY ("finalized_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- OPEN sin datos de finalización; CONFIRMED con usuario, fecha-hora y copia
-- de la plantilla.
ALTER TABLE "inventory_counts"
  ADD CONSTRAINT "inventory_counts_status_consistency" CHECK (
    ("status" = 'OPEN' AND "finalized_at" IS NULL AND "finalized_by_id" IS NULL AND "template_snapshot" IS NULL)
    OR ("status" = 'CONFIRMED' AND "finalized_at" IS NOT NULL AND "finalized_by_id" IS NOT NULL AND "template_snapshot" IS NOT NULL)
  );

-- AlterTable: inventory_count_lines. Las columnas obligatorias nuevas se
-- rellenan desde el producto y la toma antes de exigirlas; la cantidad
-- contada heredada se interpreta como cantidad suelta, para cumplir el CHECK
-- del total.
ALTER TABLE "inventory_count_lines" ADD COLUMN     "box_content" DECIMAL(12,3),
ADD COLUMN     "boxes" INTEGER,
ADD COLUMN     "loose_only" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "loose_quantity" DECIMAL(12,3),
ADD COLUMN     "package_content" DECIMAL(12,3),
ADD COLUMN     "package_name" VARCHAR(30),
ADD COLUMN     "packages" INTEGER,
ADD COLUMN     "packages_per_box" INTEGER,
ADD COLUMN     "product_name" VARCHAR(120),
ADD COLUMN     "product_sku" VARCHAR(40),
ADD COLUMN     "saved_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "saved_by_id" UUID,
ADD COLUMN     "unit" "UnitOfMeasure",
ALTER COLUMN "system_quantity" DROP NOT NULL,
ALTER COLUMN "counted_quantity" DROP NOT NULL,
ALTER COLUMN "difference" DROP NOT NULL;

UPDATE "inventory_count_lines" AS l
  SET "product_name" = p."name",
      "product_sku" = p."sku",
      "unit" = p."unit",
      "saved_by_id" = c."created_by_id",
      "loose_quantity" = l."counted_quantity"
  FROM "products" AS p, "inventory_counts" AS c
  WHERE p."id" = l."product_id" AND c."id" = l."count_id";

ALTER TABLE "inventory_count_lines" ALTER COLUMN "product_name" SET NOT NULL,
ALTER COLUMN "unit" SET NOT NULL,
ALTER COLUMN "saved_by_id" SET NOT NULL;

-- CreateIndex
CREATE INDEX "inventory_count_lines_product_id_idx" ON "inventory_count_lines"("product_id");

-- CreateIndex
CREATE INDEX "inventory_count_lines_saved_by_id_idx" ON "inventory_count_lines"("saved_by_id");

-- AddForeignKey
ALTER TABLE "inventory_count_lines" ADD CONSTRAINT "inventory_count_lines_saved_by_id_fkey" FOREIGN KEY ("saved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inventory_count_lines"
  ADD CONSTRAINT "inventory_count_lines_boxes_nonnegative" CHECK ("boxes" IS NULL OR "boxes" >= 0),
  ADD CONSTRAINT "inventory_count_lines_packages_nonnegative" CHECK ("packages" IS NULL OR "packages" >= 0),
  ADD CONSTRAINT "inventory_count_lines_loose_quantity_nonnegative" CHECK ("loose_quantity" IS NULL OR "loose_quantity" >= 0),
  -- Copia del formato: mismas reglas que el producto.
  ADD CONSTRAINT "inventory_count_lines_box_content_positive" CHECK ("box_content" IS NULL OR "box_content" > 0),
  ADD CONSTRAINT "inventory_count_lines_package_content_positive" CHECK ("package_content" IS NULL OR "package_content" > 0),
  ADD CONSTRAINT "inventory_count_lines_packages_per_box_positive" CHECK ("packages_per_box" IS NULL OR "packages_per_box" >= 1),
  ADD CONSTRAINT "inventory_count_lines_snapshot_texts_not_blank" CHECK (
    btrim("product_name") <> ''
    AND ("product_sku" IS NULL OR btrim("product_sku") <> '')
    AND ("package_name" IS NULL OR btrim("package_name") <> '')
  ),
  -- En UNIT los contenidos y la cantidad suelta son enteros (un pack de 6
  -- bebidas son 6 unidades).
  ADD CONSTRAINT "inventory_count_lines_unit_integer" CHECK (
    "unit" <> 'UNIT'
    OR (("loose_quantity" IS NULL OR "loose_quantity" = trunc("loose_quantity"))
        AND ("box_content" IS NULL OR "box_content" = trunc("box_content"))
        AND ("package_content" IS NULL OR "package_content" = trunc("package_content")))
  ),
  -- Cajas o paquetes contados exigen su contenido; «solo cantidad suelta» no
  -- admite cajas ni paquetes.
  ADD CONSTRAINT "inventory_count_lines_boxes_require_content" CHECK (COALESCE("boxes", 0) = 0 OR "box_content" IS NOT NULL),
  ADD CONSTRAINT "inventory_count_lines_packages_require_content" CHECK (COALESCE("packages", 0) = 0 OR "package_content" IS NOT NULL),
  ADD CONSTRAINT "inventory_count_lines_loose_only" CHECK (
    NOT "loose_only" OR (COALESCE("boxes", 0) = 0 AND COALESCE("packages", 0) = 0)
  ),
  -- Línea vacía (no contada): sin cantidades ni total. Línea contada: total
  -- exacto sobre la copia del formato.
  ADD CONSTRAINT "inventory_count_lines_counted_state" CHECK (
    ("counted_quantity" IS NULL) = ("boxes" IS NULL AND "packages" IS NULL AND "loose_quantity" IS NULL)
  ),
  ADD CONSTRAINT "inventory_count_lines_counted_quantity_consistent" CHECK (
    "counted_quantity" IS NULL
    OR "counted_quantity" = COALESCE("boxes", 0) * COALESCE("box_content", 0)
                            + COALESCE("packages", 0) * COALESCE("package_content", 0)
                            + COALESCE("loose_quantity", 0)
  );

-- Plantilla: la posición y el tipo (y el id) no se actualizan y las filas no
-- se borran: solo cambian el texto impreso, la sección y el producto.
CREATE FUNCTION "inventory_template_rows_enforce_fixed"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'Las filas de la plantilla de inventario son fijas: no se permite TRUNCATE sobre inventory_template_rows'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'La fila % de la plantilla de inventario es fija: no se puede eliminar', OLD."position"
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF (NEW."id", NEW."position", NEW."kind", NEW."created_at")
    IS DISTINCT FROM (OLD."id", OLD."position", OLD."kind", OLD."created_at") THEN
    RAISE EXCEPTION 'La fila % de la plantilla de inventario es fija: no puede cambiar de posición ni de tipo', OLD."position"
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "inventory_template_rows_fixed_rows"
  BEFORE UPDATE OR DELETE ON "inventory_template_rows"
  FOR EACH ROW EXECUTE FUNCTION "inventory_template_rows_enforce_fixed"();

CREATE TRIGGER "inventory_template_rows_fixed_truncate"
  BEFORE TRUNCATE ON "inventory_template_rows"
  FOR EACH STATEMENT EXECUTE FUNCTION "inventory_template_rows_enforce_fixed"();

-- Toma: nace OPEN, no cambia de local ni de creador y, una vez CONFIRMED, es
-- inmutable y no se borra.
CREATE FUNCTION "inventory_counts_enforce_status"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    IF EXISTS (SELECT 1 FROM "inventory_counts" WHERE "status" = 'CONFIRMED') THEN
      RAISE EXCEPTION 'Hay tomas de inventario finalizadas: no se permite TRUNCATE sobre inventory_counts'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NULL;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD."status" = 'CONFIRMED' THEN
      RAISE EXCEPTION 'La toma de inventario % está finalizada: no se puede eliminar', OLD."id"
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD."status" = 'CONFIRMED' THEN
      RAISE EXCEPTION 'La toma de inventario % está finalizada: es inmutable', OLD."id"
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF (NEW."id", NEW."store_id", NEW."created_by_id", NEW."created_at")
      IS DISTINCT FROM (OLD."id", OLD."store_id", OLD."created_by_id", OLD."created_at") THEN
      RAISE EXCEPTION 'La toma de inventario % no puede cambiar de local ni de creador', OLD."id"
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  -- INSERT
  IF NEW."status" <> 'OPEN' THEN
    RAISE EXCEPTION 'La toma de inventario nace En curso (OPEN): se finaliza después'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "inventory_counts_status_rows"
  BEFORE INSERT OR UPDATE OR DELETE ON "inventory_counts"
  FOR EACH ROW EXECUTE FUNCTION "inventory_counts_enforce_status"();

CREATE TRIGGER "inventory_counts_status_truncate"
  BEFORE TRUNCATE ON "inventory_counts"
  FOR EACH STATEMENT EXECUTE FUNCTION "inventory_counts_enforce_status"();

-- Líneas: solo se escriben mientras su toma está OPEN. El FOR SHARE sobre la
-- toma serializa cada escritura con la finalización (UPDATE a CONFIRMED): un
-- guardado concurrente espera a que la finalización confirme y entonces ve
-- la toma CONFIRMED. La finalización inserta las líneas vacías en su propia
-- transacción con la toma aún OPEN, así que el trigger las admite. Una toma
-- OPEN eliminada borra sus líneas en cascada (la toma ya no existe).
CREATE FUNCTION "inventory_count_lines_require_open"() RETURNS trigger
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

CREATE TRIGGER "inventory_count_lines_require_open_rows"
  BEFORE INSERT OR UPDATE OR DELETE ON "inventory_count_lines"
  FOR EACH ROW EXECUTE FUNCTION "inventory_count_lines_require_open"();

CREATE TRIGGER "inventory_count_lines_require_open_truncate"
  BEFORE TRUNCATE ON "inventory_count_lines"
  FOR EACH STATEMENT EXECUTE FUNCTION "inventory_count_lines_require_open"();
