-- Reversa de 20261108010000_importaciones_ventas_mrcomanda (SPRINT-4R-T08).
-- Solo deshace el esquema nuevo: la migración no tocó ninguna tabla
-- existente (sales, payment_methods, stores ni daily_operations), así que no
-- hay datos históricos que restaurar.
--
-- Advertencia: elimina las importaciones, sus líneas y las equivalencias
-- configuradas. Los archivos del volumen privado no se borran desde SQL.

-- Triggers y funciones nuevos.
DROP TRIGGER "sales_import_lines_enforce_truncate" ON "sales_import_lines";
DROP TRIGGER "sales_import_lines_enforce_rows" ON "sales_import_lines";
DROP TRIGGER "sales_imports_enforce_truncate" ON "sales_imports";
DROP TRIGGER "sales_imports_enforce_rows" ON "sales_imports";

DROP FUNCTION "sales_import_lines_enforce"();
DROP FUNCTION "sales_imports_enforce"();

-- Tablas nuevas (sus índices, CHECK y FKs se eliminan con ellas). Las líneas
-- primero, por su FK hacia la cabecera.
DROP TABLE "sales_import_lines";
DROP TABLE "sales_imports";
DROP TABLE "payment_method_aliases";
DROP TABLE "store_external_codes";

-- La función de normalización solo la usaban los CHECK de estas tablas.
DROP FUNCTION "normalize_external_label"(TEXT);

DROP TYPE "SalesImportStatus";
DROP TYPE "ExternalSystem";
