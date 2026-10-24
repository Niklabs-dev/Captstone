import { normalizeStoreName, normalizeStoreText } from './store-name.util.js';

describe('Normalización de locales', () => {
  it('recorta los extremos y colapsa los espacios repetidos', () => {
    expect(normalizeStoreText('  Santa\t  María\n  Centro  ')).toBe(
      'Santa María Centro',
    );
  });

  it('normaliza el nombre para comparar duplicados sin alterar su presentación', () => {
    expect(normalizeStoreName('  santa   maría  ')).toBe('SANTA MARÍA');
    expect(normalizeStoreText('  santa   maría  ')).toBe('santa maría');
  });
});
