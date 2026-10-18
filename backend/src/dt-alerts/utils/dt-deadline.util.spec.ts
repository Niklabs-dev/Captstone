import {
  daysUntilDeadline,
  documentRevision,
  dtAlertStatus,
} from './dt-deadline.util.js';

describe('Plazo de registro en la DT (SPRINT-2-T08)', () => {
  const deadline = new Date('2026-10-16T00:00:00.000Z');

  it('cuenta los días corridos hasta el vencimiento', () => {
    expect(daysUntilDeadline(deadline, new Date('2026-10-01T15:00:00Z'))).toBe(
      15,
    );
    expect(daysUntilDeadline(deadline, new Date('2026-10-15T15:00:00Z'))).toBe(
      1,
    );
  });

  it('el día del vencimiento quedan 0 días y luego es negativo', () => {
    expect(daysUntilDeadline(deadline, new Date('2026-10-16T15:00:00Z'))).toBe(
      0,
    );
    expect(daysUntilDeadline(deadline, new Date('2026-10-20T15:00:00Z'))).toBe(
      -4,
    );
  });

  it('usa el día en hora de Chile, no en UTC', () => {
    // 02:30 UTC del 17-10 todavía es el 16-10 en Chile (UTC-3).
    expect(daysUntilDeadline(deadline, new Date('2026-10-17T02:30:00Z'))).toBe(
      0,
    );
    expect(daysUntilDeadline(deadline, new Date('2026-10-17T03:30:00Z'))).toBe(
      -1,
    );
  });

  it('el cambio de horario no altera la cuenta de días', () => {
    // Chile adelanta la hora el 06-09-2026: siguen siendo días enteros.
    const afterDst = new Date('2026-09-10T00:00:00.000Z');
    expect(daysUntilDeadline(afterDst, new Date('2026-09-04T12:00:00Z'))).toBe(
      6,
    );
  });

  it('solo es OVERDUE con días negativos', () => {
    expect(dtAlertStatus(3)).toBe('UPCOMING');
    expect(dtAlertStatus(0)).toBe('UPCOMING');
    expect(dtAlertStatus(-1)).toBe('OVERDUE');
  });

  it('la revisión cambia con updated_at', () => {
    const before = documentRevision(new Date('2026-10-17T15:00:00.000Z'));
    const after = documentRevision(new Date('2026-10-17T15:00:00.001Z'));
    expect(before).not.toBe(after);
  });
});
