CREATE UNIQUE INDEX "stores_name_normalized_key"
ON "stores" (upper(regexp_replace(btrim("name"), '\s+', ' ', 'g')));
