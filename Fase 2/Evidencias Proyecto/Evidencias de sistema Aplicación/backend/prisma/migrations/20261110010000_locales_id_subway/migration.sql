-- SPRINT-4A-T15: ID de local Subway en los locales.
--
-- Cada local de la franquicia tiene un número asignado por Subway (ej. 72597
-- para Santa María). Es el dato que identifica al local en el encabezado del
-- «Informe de Ventas Diario» de MrComanda («Local: 208 - 72597»): el 208 es
-- un número interno de MrComanda, que NO se guarda ni se pide.
--
-- La base garantiza:
-- - El ID Subway es opcional (NULL para locales nuevos sin asignar).
-- - Solo dígitos, de 1 a 10 (CHECK): sin espacios, signos ni letras.
-- - Único: un ID Subway nunca apunta a dos locales (los NULL no colisionan).
--
-- No hay backfill: el seed asigna de forma idempotente los IDs de los tres
-- locales base sin pisar un valor ya configurado.
--
-- La reversa está en down.sql (misma carpeta; Prisma solo aplica
-- migration.sql).

-- AlterTable
ALTER TABLE "stores" ADD COLUMN "subway_store_id" VARCHAR(10);

ALTER TABLE "stores"
ADD CONSTRAINT "stores_subway_store_id_digits" CHECK ("subway_store_id" ~ '^[0-9]{1,10}$');

-- CreateIndex
CREATE UNIQUE INDEX "stores_subway_store_id_key" ON "stores"("subway_store_id");
