// JPEG mínimo estructuralmente válido para los tests de cargas
// (SPRINT-4R-T18): inicio FF D8, segmento APP0 «JFIF» con su largo real,
// SOS (FF DA) con su encabezado, datos de imagen y fin FF D9. El chequeo
// estructural recorre los segmentos por su largo, así que un JPEG «falso»
// (largo declarado mayor que el archivo o sin SOS) se rechaza como truncado.
// `scanData` permite variar el contenido (y el hash) entre archivos; no debe
// contener la secuencia FF D9.

const SOI = [0xff, 0xd8];
// APP0: largo 16 = 2 del largo + «JFIF\0» + versión, unidades y densidades.
const APP0_JFIF = [
  0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00,
  0x01, 0x00, 0x01, 0x00, 0x00,
];
// SOS: largo 8 = 2 del largo + 1 componente (2 bytes) + Ss, Se y Ah/Al.
const SOS = [0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00];
const EOI = [0xff, 0xd9];

export function minimalJpeg(scanData: Buffer | string = 'datos'): Buffer {
  return Buffer.concat([
    Buffer.from([...SOI, ...APP0_JFIF, ...SOS]),
    Buffer.from(scanData),
    Buffer.from(EOI),
  ]);
}

// El mismo JPEG sin el fin de imagen (carga cortada).
export function truncatedJpeg(scanData: Buffer | string = 'datos'): Buffer {
  const complete = minimalJpeg(scanData);
  return complete.subarray(0, complete.length - EOI.length);
}
