import {
  isValidSubwayStoreId,
  SUBWAY_STORE_ID_UNIQUE_INDEX,
  violatedUniqueIndex,
} from './subway-store-id.util.js';

describe('ID Subway del local (SPRINT-4A-T15)', () => {
  it('acepta solo dígitos, de 1 a 10', () => {
    for (const value of ['7', '72597', '0001234567', '1234567890']) {
      expect(isValidSubwayStoreId(value)).toBe(true);
    }
    for (const value of [
      '',
      ' 72597',
      '72597 ',
      '208 - 72597',
      '72.597',
      '-72597',
      '7259a',
      '12345678901',
      '７２５９７',
    ]) {
      expect(isValidSubwayStoreId(value)).toBe(false);
    }
  });

  it('obtiene el índice único violado desde los metadatos del adaptador', () => {
    expect(
      violatedUniqueIndex({
        driverAdapterError: {
          cause: { constraint: { index: SUBWAY_STORE_ID_UNIQUE_INDEX } },
        },
        modelName: 'Store',
      }),
    ).toBe(SUBWAY_STORE_ID_UNIQUE_INDEX);
    expect(violatedUniqueIndex(undefined)).toBeNull();
    expect(
      violatedUniqueIndex({ driverAdapterError: { cause: {} } }),
    ).toBeNull();
    expect(violatedUniqueIndex({ target: ['name'] })).toBeNull();
  });
});
