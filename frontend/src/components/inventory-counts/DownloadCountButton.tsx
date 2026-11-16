'use client';
import { useState, type ReactElement } from 'react';
import { alertClass, primaryButtonClass } from '@/components/ui/styles';
import {
  downloadInventoryCount,
  InventoryCountDownloadError,
} from '@/lib/inventory-counts-client';
import { inventoryCountError } from '@/lib/inventory-counts';

// SPRINT-5-T09: botón «Descargar Excel» de una toma finalizada. La página
// solo lo muestra en tomas finalizadas; el backend vuelve a exigirlo (409).
export function DownloadCountButton({
  countId,
  countDate,
}: {
  countId: string;
  countDate: string;
}): ReactElement {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  async function download(): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      const name = await downloadInventoryCount(countId, countDate);
      setMessage({ ok: true, text: `Se descargó ${name}.` });
    } catch (error) {
      setMessage({
        ok: false,
        text:
          error instanceof InventoryCountDownloadError
            ? error.message
            : inventoryCountError(502, 'export'),
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex min-w-0 flex-col items-stretch gap-2 sm:items-end">
      <button
        type="button"
        onClick={download}
        disabled={busy}
        aria-busy={busy}
        className={primaryButtonClass}
      >
        {busy ? 'Descargando…' : 'Descargar Excel'}
      </button>
      {message &&
        (message.ok ? (
          <p role="status" className="text-xs text-ink2">
            {message.text}
          </p>
        ) : (
          <p role="alert" className={alertClass}>
            {message.text}
          </p>
        ))}
    </div>
  );
}
