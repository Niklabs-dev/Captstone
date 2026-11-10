import {
  aliasErrorMessage,
  parsePaymentMethodAlias,
  parsePaymentMethodAliases,
  type AliasOperation,
  type PaymentMethodAlias,
  type PaymentMethodAliasInput,
} from './payment-method-aliases';

// Cliente del BFF de alias de medios de pago (SPRINT-4A-T20).
export class PaymentMethodAliasError extends Error {
  constructor(
    public readonly status: number,
    operation: AliasOperation,
  ) {
    super(aliasErrorMessage(status, operation));
    this.name = 'PaymentMethodAliasError';
  }
}

async function request<T>(
  path: string,
  init: RequestInit,
  operation: AliasOperation,
  parse: (value: unknown) => T | null,
  fetcher: typeof fetch,
): Promise<T> {
  let response: Response;
  try {
    response = await fetcher('/api/payment-method-aliases' + path, {
      ...init,
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'error',
    });
  } catch (cause) {
    if (cause instanceof Error && cause.name === 'AbortError') throw cause;
    throw new PaymentMethodAliasError(503, operation);
  }
  if (!response.ok)
    throw new PaymentMethodAliasError(response.status, operation);
  const parsed = parse(await response.json().catch(() => null));
  if (parsed === null) throw new PaymentMethodAliasError(502, operation);
  return parsed;
}

export function loadPaymentMethodAliases(
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<PaymentMethodAlias[]> {
  return request('', { signal }, 'load', parsePaymentMethodAliases, fetcher);
}
export function createPaymentMethodAlias(
  input: PaymentMethodAliasInput,
  fetcher: typeof fetch = fetch,
): Promise<PaymentMethodAlias> {
  return request(
    '',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
    'create',
    parsePaymentMethodAlias,
    fetcher,
  );
}
export function deletePaymentMethodAlias(
  id: string,
  fetcher: typeof fetch = fetch,
): Promise<PaymentMethodAlias> {
  return request(
    '/' + id,
    { method: 'DELETE' },
    'delete',
    parsePaymentMethodAlias,
    fetcher,
  );
}
