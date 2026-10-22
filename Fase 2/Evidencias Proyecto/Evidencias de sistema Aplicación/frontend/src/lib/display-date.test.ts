import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatCalendarDate, formatChileDate } from './display-date';
test('Fechas visibles con año completo y día calendario estable en Chile', () => {
  assert.equal(formatCalendarDate('2031-10-15'), '15-10-2031');
  assert.equal(formatCalendarDate('2026-10-22'), '22-10-2026');
  assert.equal(formatChileDate('2026-10-22T01:00:00.000Z'), '21-10-2026');
});
