import {
  parsePaymentMethod,
  parsePaymentMethods,
  paymentMethodErrorMessage,
  type PaymentMethod,
  type PaymentMethodCreateInput,
  type PaymentMethodOperation,
  type PaymentMethodUpdateInput,
} from './payment-methods';

export class PaymentMethodError extends Error {
  constructor(
    public readonly status: number,
    operation: PaymentMethodOperation = 'save',
  ) {
    super(paymentMethodErrorMessage(status, operation));
    this.name = 'PaymentMethodError';
  }
}
// Solo medios activos elegibles para propinas: el formulario decide su propio filtro.
export interface PaymentMethodQuery {
  isActive?: boolean;
  availableForTips?: boolean;
}
async function request(
  path: string,
  init: RequestInit,
  fetcher: typeof fetch,
): Promise<unknown> {
  const operation: PaymentMethodOperation =
    !init.method || init.method === 'GET'
      ? 'load'
      : path.endsWith('/deactivate') || path.endsWith('/reactivate')
        ? 'state'
        : 'save';
  let response: Response;
  try {
    response = await fetcher('/api/payment-methods' + path, {
      ...init,
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'error',
      signal: init.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new PaymentMethodError(503, operation);
  }
  if (!response.ok) throw new PaymentMethodError(response.status, operation);
  return response.json().catch(() => {
    throw new PaymentMethodError(502, operation);
  });
}
export async function loadPaymentMethods(
  query: PaymentMethodQuery = {},
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<PaymentMethod[]> {
  const params = new URLSearchParams();
  if (query.isActive !== undefined)
    params.set('isActive', String(query.isActive));
  if (query.availableForTips !== undefined)
    params.set('availableForTips', String(query.availableForTips));
  const path = params.size ? '?' + params.toString() : '';
  const methods = parsePaymentMethods(await request(path, { signal }, fetcher));
  if (!methods) throw new PaymentMethodError(502, 'load');
  return methods;
}
export async function createPaymentMethod(
  input: PaymentMethodCreateInput,
  fetcher: typeof fetch = fetch,
): Promise<PaymentMethod> {
  const result = parsePaymentMethod(
    await request(
      '',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
      fetcher,
    ),
  );
  if (
    !result ||
    !result.isActive ||
    result.code !== input.code ||
    result.name !== input.name ||
    result.sortOrder !== input.sortOrder ||
    result.behavior !== input.behavior ||
    result.availableForTips !== input.availableForTips
  )
    throw new PaymentMethodError(502);
  return result;
}
export async function updatePaymentMethod(
  previous: PaymentMethod,
  input: PaymentMethodUpdateInput,
  fetcher: typeof fetch = fetch,
): Promise<PaymentMethod> {
  const result = parsePaymentMethod(
    await request(
      '/' + encodeURIComponent(previous.id),
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
      fetcher,
    ),
  );
  if (
    !result ||
    result.id !== previous.id ||
    result.code !== previous.code ||
    (input.name !== undefined && result.name !== input.name) ||
    (input.sortOrder !== undefined && result.sortOrder !== input.sortOrder) ||
    (input.behavior !== undefined && result.behavior !== input.behavior) ||
    (input.availableForTips !== undefined &&
      result.availableForTips !== input.availableForTips)
  )
    throw new PaymentMethodError(502);
  return result;
}
export async function changePaymentMethodState(
  previous: PaymentMethod,
  fetcher: typeof fetch = fetch,
): Promise<PaymentMethod> {
  const result = parsePaymentMethod(
    await request(
      '/' +
        encodeURIComponent(previous.id) +
        (previous.isActive ? '/deactivate' : '/reactivate'),
      { method: 'PATCH' },
      fetcher,
    ),
  );
  if (
    !result ||
    result.id !== previous.id ||
    result.isActive === previous.isActive
  )
    throw new PaymentMethodError(502);
  return result;
}
