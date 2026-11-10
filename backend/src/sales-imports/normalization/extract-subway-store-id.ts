import { normalizeExternalLabel } from './normalize-external-label.js';

// ID Subway del local dentro del encabezado del reporte de MrComanda
// (SPRINT-4A-T17). El encabezado trae «Local: 208 - 72597»: 208 es un número
// interno de MrComanda que no identifica al local (se ignora) y 72597 es el ID
// Subway, el mismo de stores.subway_store_id (SPRINT-4A-T15). Se reconocen:
// - «208 - 72597» y sus variantes de espacios («208-72597», «208  -  72597»);
// - el ID Subway solo («72597»).
// El ID Subway tiene de 1 a 10 dígitos (CHECK de stores). Cualquier otro texto
// («Santa María», «72597 Centro», más de 10 dígitos) no trae un ID reconocible
// y devuelve null: el local queda como no identificado, sin bloquear la
// lectura del reporte.
const LABEL_WITH_SUBWAY_ID = /^(?:\d+ ?[-–] ?)?(\d{1,10})$/;

export function extractSubwayStoreId(label: string): string | null {
  // La normalización colapsa los espacios (incluidos saltos de línea).
  const match = LABEL_WITH_SUBWAY_ID.exec(normalizeExternalLabel(label));
  return match?.[1] ?? null;
}
