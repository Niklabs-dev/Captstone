-- Reversa de 20261110010000_locales_id_subway (SPRINT-4A-T15).
-- Retira la columna (su índice único y su CHECK se eliminan con ella). Se
-- pierden los ID Subway configurados en los locales.

ALTER TABLE "stores" DROP COLUMN "subway_store_id";
