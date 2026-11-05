import { parseCashClosing, type CashClosing } from './cash-closings';
import {
  isDashboardDate,
  parseSalesDashboard,
  type SalesDashboard,
} from './sales-dashboard';

export class SalesDashboardError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'SalesDashboardError';
  }
}

async function request(
  url: string,
  signal: AbortSignal | undefined,
  fetcher: typeof fetch,
  messages: Record<number, string>,
): Promise<unknown> {
  try {
    const response = await fetcher(url, {
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'error',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      const common: Record<number, string> = {
        400: 'La fecha consultada no es válida. Revisa el filtro.',
        401: 'Tu sesión venció. Vuelve a iniciar sesión.',
        403: 'No tienes permiso para ver esta información.',
      };
      throw new SalesDashboardError(
        messages[response.status] ??
          common[response.status] ??
          'No se pudo completar la consulta. Intenta nuevamente.',
        response.status,
      );
    }
    return await response.json().catch(() => invalidContract());
  } catch (error) {
    if (
      error instanceof SalesDashboardError ||
      (error instanceof Error && error.name === 'AbortError')
    )
      throw error;
    throw new SalesDashboardError(
      'No se pudo conectar con el servicio. Intenta nuevamente.',
      503,
    );
  }
}

function invalidContract(): never {
  throw new SalesDashboardError(
    'La respuesta del servicio no pudo verificarse. Actualiza el panel.',
    502,
  );
}

export async function loadSalesDashboard(
  date: string,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<SalesDashboard> {
  if (!isDashboardDate(date))
    throw new SalesDashboardError(
      'La fecha consultada no es válida. Revisa el filtro.',
      400,
    );
  const data = parseSalesDashboard(
    await request(
      '/api/sales-dashboard?date=' + encodeURIComponent(date),
      signal,
      fetcher,
      {
        403: 'Solo el administrador puede consultar el panel consolidado.',
        503: 'El panel consolidado no está disponible. Intenta más tarde.',
      },
    ),
  );
  // El backend debe responder el mismo día que se pidió.
  if (!data || data.businessDate !== date) invalidContract();
  return data;
}

export async function loadCashClosing(
  id: string,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<CashClosing> {
  const closing = parseCashClosing(
    await request(
      '/api/cash-closings/' + encodeURIComponent(id),
      signal,
      fetcher,
      {
        403: 'No tienes acceso al cierre de este local.',
        404: 'El cierre de caja ya no está disponible.',
      },
    ),
  );
  if (!closing || closing.id !== id) invalidContract();
  return closing;
}
