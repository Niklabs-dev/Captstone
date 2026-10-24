DROP INDEX "stores_name_normalized_key";

CREATE UNIQUE INDEX "stores_name_normalized_key"
ON "stores" (upper(translate(regexp_replace(btrim("name"), '\s+', ' ', 'g'), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')));
