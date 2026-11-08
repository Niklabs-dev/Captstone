// Normalización de etiquetas e identificadores de sistemas externos
// (SPRINT-4R-T08). Es la misma regla de la función SQL
// normalize_external_label (migración 20261108010000_importaciones_ventas_mrcomanda),
// que los CHECK de la base exigen sobre los valores guardados: sin tildes,
// mayúsculas y espacios colapsados, conservando la puntuación («T. DEBITO» y
// «T DEBITO» son etiquetas distintas). Una prueba de integración compara
// ambas implementaciones contra PostgreSQL.

const ACCENTED = 'áàäâéèëêíìïîóòöôúùüûñÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑ';
const PLAIN = 'aaaaeeeeiiiioooouuuunAAAAEEEEIIIIOOOOUUUUN';

// Los mismos caracteres que \s en las expresiones regulares de PostgreSQL.
const WHITESPACE_RUN = /[ \t\n\r\f\v]+/g;

export function normalizeExternalLabel(label: string): string {
  let plain = '';
  for (const char of label) {
    const index = ACCENTED.indexOf(char);
    plain += index >= 0 ? PLAIN[index] : char;
  }
  return plain.toUpperCase().replace(WHITESPACE_RUN, ' ').trim();
}
