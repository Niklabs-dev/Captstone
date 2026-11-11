-- Reversa de 20261111120000_inventario_catalogo_toma (SPRINT-5-T01).
-- Devuelve products, inventory_counts e inventory_count_lines a la forma de
-- 20260924183514_init y retira inventory_template_rows. Se PIERDEN la
-- estructura de la plantilla, el formato de los productos, el desglose de
-- cada línea (cajas, paquetes y cantidad suelta), su copia del producto y los
-- datos de finalización de las tomas: antes de aplicarla, exportar las tomas
-- finalizadas si hay inventarios reales.
--
-- El modelo anterior exige sku, system_quantity, counted_quantity y
-- difference en todas las filas. Si hay productos sin SKU o líneas sin esas
-- cantidades (líneas vacías o sin comparación contra el stock), la reversa se
-- detiene con un mensaje explícito en vez de inventar valores: hay que
-- completarlas o eliminarlas a mano antes de aplicarla.

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "products" WHERE "sku" IS NULL) THEN
    RAISE EXCEPTION 'Hay productos sin SKU: complete el SKU o elimínelos antes de revertir 20261111120000_inventario_catalogo_toma';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "inventory_count_lines"
    WHERE "system_quantity" IS NULL OR "counted_quantity" IS NULL OR "difference" IS NULL
  ) THEN
    RAISE EXCEPTION 'Hay líneas de toma sin cantidad del sistema, contada o diferencia: complételas o elimínelas antes de revertir 20261111120000_inventario_catalogo_toma';
  END IF;
END;
$$;

-- Triggers y funciones de tablas que se conservan.
DROP TRIGGER "inventory_count_lines_require_open_truncate" ON "inventory_count_lines";
DROP TRIGGER "inventory_count_lines_require_open_rows" ON "inventory_count_lines";
DROP TRIGGER "inventory_counts_status_truncate" ON "inventory_counts";
DROP TRIGGER "inventory_counts_status_rows" ON "inventory_counts";
DROP FUNCTION "inventory_count_lines_require_open"();
DROP FUNCTION "inventory_counts_enforce_status"();

-- Tabla nueva (sus índices, FK, CHECK y triggers se eliminan con ella).
DROP TABLE "inventory_template_rows";
DROP FUNCTION "inventory_template_rows_enforce_fixed"();
DROP TYPE "InventoryTemplateRowKind";

-- Líneas de toma.
ALTER TABLE "inventory_count_lines"
  DROP CONSTRAINT "inventory_count_lines_boxes_nonnegative",
  DROP CONSTRAINT "inventory_count_lines_packages_nonnegative",
  DROP CONSTRAINT "inventory_count_lines_loose_quantity_nonnegative",
  DROP CONSTRAINT "inventory_count_lines_box_content_positive",
  DROP CONSTRAINT "inventory_count_lines_package_content_positive",
  DROP CONSTRAINT "inventory_count_lines_packages_per_box_positive",
  DROP CONSTRAINT "inventory_count_lines_snapshot_texts_not_blank",
  DROP CONSTRAINT "inventory_count_lines_unit_integer",
  DROP CONSTRAINT "inventory_count_lines_boxes_require_content",
  DROP CONSTRAINT "inventory_count_lines_packages_require_content",
  DROP CONSTRAINT "inventory_count_lines_loose_only",
  DROP CONSTRAINT "inventory_count_lines_counted_state",
  DROP CONSTRAINT "inventory_count_lines_counted_quantity_consistent",
  DROP CONSTRAINT "inventory_count_lines_saved_by_id_fkey";

DROP INDEX "inventory_count_lines_saved_by_id_idx";
DROP INDEX "inventory_count_lines_product_id_idx";

ALTER TABLE "inventory_count_lines" DROP COLUMN "box_content",
DROP COLUMN "boxes",
DROP COLUMN "loose_only",
DROP COLUMN "loose_quantity",
DROP COLUMN "package_content",
DROP COLUMN "package_name",
DROP COLUMN "packages",
DROP COLUMN "packages_per_box",
DROP COLUMN "product_name",
DROP COLUMN "product_sku",
DROP COLUMN "saved_at",
DROP COLUMN "saved_by_id",
DROP COLUMN "unit",
ALTER COLUMN "system_quantity" SET NOT NULL,
ALTER COLUMN "counted_quantity" SET NOT NULL,
ALTER COLUMN "difference" SET NOT NULL;

-- Tomas.
ALTER TABLE "inventory_counts"
  DROP CONSTRAINT "inventory_counts_status_consistency",
  DROP CONSTRAINT "inventory_counts_finalized_by_id_fkey";

DROP INDEX "inventory_counts_store_id_open_key";
DROP INDEX "inventory_counts_finalized_by_id_idx";
DROP INDEX "inventory_counts_store_id_count_date_idx";

ALTER TABLE "inventory_counts" DROP COLUMN "count_date",
DROP COLUMN "finalized_at",
DROP COLUMN "finalized_by_id",
DROP COLUMN "template_snapshot";

-- Productos.
ALTER TABLE "products"
  DROP CONSTRAINT "products_sku_not_blank",
  DROP CONSTRAINT "products_name_not_blank",
  DROP CONSTRAINT "products_alternative_names_valid",
  DROP CONSTRAINT "products_package_name_not_blank",
  DROP CONSTRAINT "products_box_content_positive",
  DROP CONSTRAINT "products_package_content_positive",
  DROP CONSTRAINT "products_packages_per_box_positive",
  DROP CONSTRAINT "products_unit_contents_integer";

ALTER TABLE "products" DROP COLUMN "alternative_names",
DROP COLUMN "box_content",
DROP COLUMN "loose_only",
DROP COLUMN "package_content",
DROP COLUMN "package_name",
DROP COLUMN "packages_per_box",
ALTER COLUMN "sku" SET NOT NULL;

DROP FUNCTION "inventory_names_are_valid"(VARCHAR[]);

-- Unidad: vuelven G, ML y PACK (los valores actuales existen en el enum
-- anterior, así que la conversión no pierde datos).
CREATE TYPE "UnitOfMeasure_old" AS ENUM ('UNIT', 'KG', 'G', 'L', 'ML', 'PACK');
ALTER TABLE "products" ALTER COLUMN "unit" TYPE "UnitOfMeasure_old" USING ("unit"::text::"UnitOfMeasure_old");
DROP TYPE "UnitOfMeasure";
ALTER TYPE "UnitOfMeasure_old" RENAME TO "UnitOfMeasure";

-- Registro de la migración (manual): permite que migrate deploy la reaplique.
DELETE FROM "_prisma_migrations"
  WHERE "migration_name" = '20261111120000_inventario_catalogo_toma';

COMMIT;
