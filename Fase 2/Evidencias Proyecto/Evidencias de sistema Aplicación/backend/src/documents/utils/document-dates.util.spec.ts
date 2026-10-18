import {
  addDays,
  addYears,
  businessDateOf,
  computeDocumentDeadlines,
  formatDbDate,
  isRetentionExpired,
} from './document-dates.util.js';

describe('Plazos de documentos (SPRINT-2-T05)', () => {
  it('toma la fecha de carga en hora de Chile, no en UTC', () => {
    // 02:30 UTC del 18-10 son las 23:30 del 17-10 en Chile (UTC-3).
    expect(businessDateOf(new Date('2026-10-18T02:30:00.000Z'))).toEqual({
      year: 2026,
      month: 10,
      day: 17,
    });
  });

  it('suma años como PostgreSQL: el 29 de febrero pasa al 28', () => {
    expect(addYears({ year: 2024, month: 2, day: 29 }, 5)).toEqual({
      year: 2029,
      month: 2,
      day: 28,
    });
    expect(addYears({ year: 2026, month: 10, day: 17 }, 5)).toEqual({
      year: 2031,
      month: 10,
      day: 17,
    });
  });

  it('suma días corridos cruzando meses y años', () => {
    expect(addDays({ year: 2026, month: 12, day: 20 }, 15)).toEqual({
      year: 2027,
      month: 1,
      day: 4,
    });
  });

  it('cuenta ambos plazos desde la fecha de celebración si se indicó', () => {
    const deadlines = computeDocumentDeadlines({
      issuedAt: { year: 2026, month: 10, day: 1 },
      uploadedAt: new Date('2026-10-17T15:00:00.000Z'),
      retentionYears: 5,
      requiresDtRegistration: true,
    });
    expect(deadlines.issuedAt && formatDbDate(deadlines.issuedAt)).toBe(
      '2026-10-01',
    );
    expect(formatDbDate(deadlines.retainUntil)).toBe('2031-10-01');
    expect(
      deadlines.dtRegistrationDueAt &&
        formatDbDate(deadlines.dtRegistrationDueAt),
    ).toBe('2026-10-16');
  });

  it('sin fecha de celebración usa el día de carga y omite el plazo DT si el tipo no lo exige', () => {
    const deadlines = computeDocumentDeadlines({
      issuedAt: null,
      uploadedAt: new Date('2026-10-17T15:00:00.000Z'),
      retentionYears: 5,
      requiresDtRegistration: false,
    });
    expect(deadlines.issuedAt).toBeNull();
    expect(formatDbDate(deadlines.retainUntil)).toBe('2031-10-17');
    expect(deadlines.dtRegistrationDueAt).toBeNull();
  });
});

describe('Vencimiento del plazo de conservación (SPRINT-2-T07)', () => {
  const retainUntil = new Date('2031-10-17T00:00:00.000Z');

  it('se conserva hasta retain_until inclusive', () => {
    expect(
      isRetentionExpired(retainUntil, new Date('2031-10-16T15:00:00.000Z')),
    ).toBe(false);
    expect(
      isRetentionExpired(retainUntil, new Date('2031-10-17T15:00:00.000Z')),
    ).toBe(false);
  });

  it('vence desde el día siguiente', () => {
    expect(
      isRetentionExpired(retainUntil, new Date('2031-10-18T15:00:00.000Z')),
    ).toBe(true);
  });

  it('cuenta el día en hora de Chile, no en UTC', () => {
    // 02:30 UTC del 18-10 son las 23:30 del 17-10 en Chile: aún no vence.
    expect(
      isRetentionExpired(retainUntil, new Date('2031-10-18T02:30:00.000Z')),
    ).toBe(false);
    // 03:30 UTC del 18-10 ya son las 00:30 del 18-10 en Chile.
    expect(
      isRetentionExpired(retainUntil, new Date('2031-10-18T03:30:00.000Z')),
    ).toBe(true);
  });
});
