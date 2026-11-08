import { normalizeExternalLabel } from './normalize-external-label.js';

describe('normalizeExternalLabel (SPRINT-4R-T08)', () => {
  it('conserva las etiquetas de MrComanda que ya vienen normalizadas', () => {
    expect(normalizeExternalLabel('T. DEBITO')).toBe('T. DEBITO');
    expect(normalizeExternalLabel('EFECTIVO')).toBe('EFECTIVO');
    expect(normalizeExternalLabel('T. CREDITO')).toBe('T. CREDITO');
  });

  it('quita tildes y pasa a mayúsculas sin perder la puntuación', () => {
    expect(normalizeExternalLabel('N.de Créd.')).toBe('N.DE CRED.');
    expect(normalizeExternalLabel('Tarjeta de crédito')).toBe(
      'TARJETA DE CREDITO',
    );
    expect(normalizeExternalLabel('Señal Única')).toBe('SENAL UNICA');
  });

  it('colapsa espacios internos y recorta los extremos', () => {
    expect(normalizeExternalLabel('  t.   debito \t')).toBe('T. DEBITO');
    expect(normalizeExternalLabel('208  -\n72597')).toBe('208 - 72597');
  });

  it('distingue etiquetas que solo difieren en la puntuación', () => {
    expect(normalizeExternalLabel('T. DEBITO')).not.toBe(
      normalizeExternalLabel('T DEBITO'),
    );
  });

  it('devuelve vacío para una etiqueta en blanco', () => {
    expect(normalizeExternalLabel('   ')).toBe('');
  });
});
