import { randomInt } from 'node:crypto';

// ID Subway ficticio de 10 dígitos para los tests (SPRINT-4A-T17): no choca
// con los de los locales base (74413, 72597, 69132) ni, en la práctica, con
// los de otras suites que corren en paralelo contra la misma base.
export function fakeSubwayStoreId(): string {
  return String(randomInt(1_000_000_000, 10_000_000_000));
}
