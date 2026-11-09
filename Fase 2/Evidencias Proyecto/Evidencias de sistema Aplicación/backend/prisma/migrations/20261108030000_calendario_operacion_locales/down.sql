-- Reversa de 20261108030000_calendario_operacion_locales (SPRINT-4R-T12).
-- Solo retira las dos tablas nuevas (sus índices, CHECK y FKs se eliminan con
-- ellas); la migración no tocó ninguna tabla existente. Se pierden los
-- calendarios y excepciones configurados; las importaciones de ventas no se
-- ven afectadas.

DROP TABLE "store_closures";
DROP TABLE "store_operating_schedules";
