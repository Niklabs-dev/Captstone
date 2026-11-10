import { isRecord } from './auth';
import {
  calendarError,
  parseOperatingCalendar,
  parseStoreClosure,
  type CalendarInput,
  type ClosureInput,
  type OperatingCalendar,
  type StoreClosure,
} from './sales-overview';

// Cliente del BFF del calendario de operación (SPRINT-4R-T14).
export class CalendarRequestError extends Error {
  constructor(
    public readonly status: number,
    message?: string,
  ) {
    super(message ?? calendarError(status));
    this.name = 'CalendarRequestError';
  }
}

async function request<T>(
  path: string,
  init: RequestInit,
  parse: (value: unknown) => T | null,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch('/api/operating-calendars/' + path, init);
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError')
      throw cause;
    throw new CalendarRequestError(503);
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok)
    throw new CalendarRequestError(
      response.status,
      isRecord(body) && typeof body.message === 'string'
        ? body.message
        : undefined,
    );
  const parsed = parse(body);
  if (parsed === null) throw new CalendarRequestError(502);
  return parsed;
}
function json(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export function loadOperatingCalendar(
  storeId: string,
  signal: AbortSignal,
): Promise<OperatingCalendar> {
  return request(storeId, { signal }, parseOperatingCalendar);
}
export function saveOperatingCalendar(
  storeId: string,
  input: CalendarInput,
): Promise<OperatingCalendar> {
  return request(storeId, json('PUT', input), parseOperatingCalendar);
}
export function addStoreClosure(
  storeId: string,
  input: ClosureInput,
): Promise<StoreClosure> {
  return request(`${storeId}/closures`, json('POST', input), parseStoreClosure);
}
export function removeStoreClosure(
  storeId: string,
  closureId: string,
): Promise<StoreClosure> {
  return request(
    `${storeId}/closures/${closureId}`,
    { method: 'DELETE' },
    parseStoreClosure,
  );
}
