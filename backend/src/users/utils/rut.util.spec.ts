import { computeRutCheckDigit, isValidRut, normalizeRut } from './rut.util.js';

describe('Utilidades de RUT (SPRINT-1-T08)', () => {
  it('normaliza quitando puntos y espacios, con DV en mayúscula', () => {
    expect(normalizeRut('12.345.678-5')).toBe('12345678-5');
    expect(normalizeRut(' 10.000.013-k ')).toBe('10000013-K');
  });

  it('calcula el dígito verificador con módulo 11', () => {
    expect(computeRutCheckDigit('12345678')).toBe('5');
    expect(computeRutCheckDigit('10000013')).toBe('K');
    expect(computeRutCheckDigit('11111111')).toBe('1');
    expect(computeRutCheckDigit('10000004')).toBe('0');
  });

  it('acepta RUT válidos con o sin puntos', () => {
    expect(isValidRut('12345678-5')).toBe(true);
    expect(isValidRut('12.345.678-5')).toBe(true);
    expect(isValidRut('10000013-k')).toBe(true);
    expect(isValidRut('10000004-0')).toBe(true);
  });

  it('rechaza dígito verificador incorrecto o formato inválido', () => {
    expect(isValidRut('12345678-9')).toBe(false);
    expect(isValidRut('12345678')).toBe(false);
    expect(isValidRut('123456-7')).toBe(false);
    expect(isValidRut('abc')).toBe(false);
    expect(isValidRut('')).toBe(false);
  });
});
