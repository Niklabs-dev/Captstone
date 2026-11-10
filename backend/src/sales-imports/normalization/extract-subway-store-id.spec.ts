import { extractSubwayStoreId } from './extract-subway-store-id.js';

describe('extractSubwayStoreId (SPRINT-4A-T17)', () => {
  it('obtiene el ID Subway e ignora el número interno de MrComanda', () => {
    expect(extractSubwayStoreId('208 - 72597')).toBe('72597');
    expect(extractSubwayStoreId('901 - 12345')).toBe('12345');
  });

  it('acepta variantes de espacios y el ID Subway solo', () => {
    for (const label of [
      '208-72597',
      '208 -72597',
      '208-  72597',
      '  208   -   72597  ',
      '208\t-\n72597',
      '208 – 72597',
      '72597',
      ' 72597 ',
    ]) {
      expect(extractSubwayStoreId(label)).toBe('72597');
    }
    expect(extractSubwayStoreId('1')).toBe('1');
    expect(extractSubwayStoreId('1 - 1234567890')).toBe('1234567890');
  });

  it('devuelve null si el encabezado no trae un ID Subway reconocible', () => {
    for (const label of [
      '',
      'Santa María',
      'Local Centro 2',
      '72597 Santa María',
      'Santa María - 72597',
      '208 - ',
      '- 72597',
      '208 - 72597 - 1',
      '208 / 72597',
      '72.597',
      '12345678901',
      '208 - 12345678901',
      '７２５９７',
    ]) {
      expect(extractSubwayStoreId(label)).toBeNull();
    }
  });
});
