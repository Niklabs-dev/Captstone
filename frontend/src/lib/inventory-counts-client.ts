import { countExportFileName, inventoryCountError } from './inventory-counts';

export class InventoryCountDownloadError extends Error {}

// Descarga el Excel de una toma finalizada por el BFF y lo entrega al
// navegador como archivo (SPRINT-5-T09). Devuelve el nombre del archivo.
export async function downloadInventoryCount(
  id: string,
  countDate: string,
): Promise<string> {
  const response = await fetch(
    `/api/inventory-counts/${encodeURIComponent(id)}/export`,
    { cache: 'no-store', credentials: 'same-origin' },
  ).catch(() => null);
  if (!response)
    throw new InventoryCountDownloadError(inventoryCountError(503, 'export'));
  if (!response.ok) {
    await response.body?.cancel();
    throw new InventoryCountDownloadError(
      inventoryCountError(response.status, 'export'),
    );
  }
  const blob = await response.blob().catch(() => null);
  if (!blob || blob.size === 0)
    throw new InventoryCountDownloadError(inventoryCountError(502, 'export'));
  const name = countExportFileName(
    response.headers.get('Content-Disposition'),
    countDate,
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return name;
}
