import { parseDurationToMs } from './duration.util.js';

describe('parseDurationToMs', () => {
  it('convierte segundos, minutos, horas y días a milisegundos', () => {
    expect(parseDurationToMs('45s')).toBe(45_000);
    expect(parseDurationToMs('30m')).toBe(1_800_000);
    expect(parseDurationToMs('12h')).toBe(43_200_000);
    expect(parseDurationToMs('7d')).toBe(604_800_000);
    expect(parseDurationToMs('1d')).toBe(86_400_000);
  });

  it('tolera espacios alrededor del número', () => {
    expect(parseDurationToMs('  10m ')).toBe(600_000);
  });

  it('rechaza formatos inválidos', () => {
    for (const invalido of ['', 'abc', '10', '10w', '-5d', '1.5h']) {
      expect(() => parseDurationToMs(invalido)).toThrow('Duración inválida');
    }
  });
});
