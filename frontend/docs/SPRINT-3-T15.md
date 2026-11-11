# SPRINT-3-T15 — Reparto de propinas del contador (retirado)

> **Flujo retirado en SPRINT-4A-T08.** La vista `/propinas/repartos` ya no
> existe (redirige a `/propinas`) y las acciones de escritura de la API
> (`POST /tip-pools/preview`, `/observations`, `/confirm` y `/pay`) responden
> `410 Gone`. El flujo vigente está en la
> [guía de propinas y ventas](../../docs/guia-propinas-y-ventas.md): la
> propina se reparte sola al guardar la operación diaria y el ADMINISTRADOR o
> el CONTADOR la paga por período en `/propinas`.

## Qué entregó esta tarea (histórico)

En el Sprint 3 el contador consultaba, calculaba, revisaba y pagaba un reparto
de propinas por local y período, con constancias PDF por trabajador; el
administrador solo lo consultaba. Se retiró porque pagar un reparto por período
dejaba las propinas diarias del período sin pagar y permitía pagarlas dos veces.

## Qué se conserva

- Los repartos guardados, sus líneas, fuentes y constancias, sin cambios.
  Se consultan en solo lectura en **Repartos anteriores**
  (`/propinas/historico` y `/propinas/historico/<id>`), con
  `GET /tip-pools`, `GET /tip-pools/:id` y las constancias PDF de los repartos
  pagados.
- Los repartos pagados quedaron como lotes de pago históricos: sus propinas
  diarias figuran como Pagadas. Los que nunca se pagaron no tienen efecto.
- Pruebas del histórico: `npm run test:tip-pools` y
  `TEST_REAL_DISPOSABLE=true COMPOSE_PROJECT_NAME=<stack> npm run test:tip-pools:real`
  (ver el [README del frontend](../README.md#repartos-anteriores-histórico-de-solo-lectura-sprint-4a-t08)).

El contenido original de esta guía (contrato del BFF, validación y pruebas del
flujo retirado) se conserva en el historial de git, en el commit `48823e5`.
