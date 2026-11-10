import { callBackend, type BackendResult } from './auth-backend';
import { parseDailyOperation, type DailyOperation } from './daily-operations';
import {
  parseSalesImportDetail,
  type SalesImportDetail,
} from './sales-imports';
import {
  parseSalesDashboard,
  parseSalesDays,
  parseSalesReport,
  reportQuery,
  salesOverviewError,
  type ReportFilters,
  type SalesDashboard,
  type SalesDays,
  type SalesReport,
} from './sales-overview';

// Lecturas del panel y los reportes de ventas desde Server Components
// (SPRINT-4R-T14). El token nunca sale del servidor y solo se usan rutas
// construidas aquí; cada respuesta se proyecta al contrato antes de pintarse.
async function read<T>(
  path: string,
  token: string,
  parse: (value: unknown) => T | null,
): Promise<BackendResult<T>> {
  const upstream = await callBackend(path, {
    redirect: 'error',
    headers: { Authorization: 'Bearer ' + token },
  });
  if (!upstream)
    return { ok: false, status: 503, message: salesOverviewError(503) };
  if (!upstream.ok) {
    await upstream.body?.cancel();
    const status = [400, 401, 403, 404, 429].includes(upstream.status)
      ? upstream.status
      : 502;
    return { ok: false, status, message: salesOverviewError(status) };
  }
  const parsed = parse(await upstream.json().catch(() => null));
  return parsed
    ? { ok: true, data: parsed }
    : { ok: false, status: 502, message: salesOverviewError(502) };
}

export function fetchSalesDashboard(
  token: string,
  date: string,
): Promise<BackendResult<SalesDashboard>> {
  return read(
    '/sales-dashboard?' + new URLSearchParams({ date }).toString(),
    token,
    parseSalesDashboard,
  );
}
// Rango por defecto del backend: los últimos 30 días hasta hoy.
export function fetchRecentSalesDays(
  token: string,
): Promise<BackendResult<SalesDays>> {
  return read('/sales-days', token, parseSalesDays);
}
export function fetchSalesReport(
  token: string,
  filters: ReportFilters,
): Promise<BackendResult<SalesReport>> {
  return read(
    '/sales-reports?' + reportQuery(filters),
    token,
    parseSalesReport,
  );
}
export function fetchDailyOperation(
  token: string,
  id: string,
): Promise<BackendResult<DailyOperation>> {
  return read('/daily-operations/' + id, token, (value) =>
    parseDailyOperation(value),
  );
}
export function fetchSalesImport(
  token: string,
  id: string,
): Promise<BackendResult<SalesImportDetail>> {
  return read('/sales-imports/' + id, token, parseSalesImportDetail);
}
