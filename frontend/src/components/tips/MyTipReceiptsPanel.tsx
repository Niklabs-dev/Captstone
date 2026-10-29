'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatCalendarDate, formatChileDate } from '@/lib/display-date';
import { ownReceiptError, type OwnTipReceipt } from '@/lib/my-tip-receipts';
import {
  loadOwnReceipts,
  downloadOwnReceipt,
  OwnReceiptError,
} from '@/lib/my-tip-receipts-client';
import {
  buttonClass,
  introClass,
  tablePanelClass,
  tableHeaderClass,
  panelTitleClass,
} from '@/components/ui/styles';
type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; items: OwnTipReceipt[] };
const money = (amount: number) =>
  new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(amount);
export function MyTipReceiptsPanel({ workerId }: { workerId: string }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const downloadController = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    loadOwnReceipts(workerId, controller.signal)
      .then((items) => {
        if (!controller.signal.aborted) setState({ status: 'ready', items });
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        if (cause instanceof OwnReceiptError && cause.status === 401)
          router.replace('/session-expired');
        setState({
          status: 'error',
          message:
            cause instanceof OwnReceiptError
              ? cause.message
              : ownReceiptError(503),
        });
      });
    return () => {
      controller.abort();
      downloadController.current?.abort();
    };
  }, [workerId, retry, router]);
  function reload(): undefined {
    if (downloadController.current) return;
    setState({ status: 'loading' });
    setError('');
    setNotice('');
    setRetry((n) => n + 1);
    return undefined;
  }
  async function download(receipt: OwnTipReceipt): Promise<undefined> {
    if (downloadController.current) return;
    const controller = new AbortController();
    downloadController.current = controller;
    setBusy(receipt.id);
    setError('');
    setNotice('');
    try {
      const blob = await downloadOwnReceipt(receipt, controller.signal);
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download =
        'constancia-propinas_' +
        receipt.periodStart +
        '_' +
        receipt.periodEnd +
        '_' +
        receipt.id.slice(0, 8) +
        '.pdf';
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('Constancia descargada. Integridad SHA-256 verificada.');
    } catch (cause) {
      if (!controller.signal.aborted) {
        if (cause instanceof OwnReceiptError && cause.status === 401)
          router.replace('/session-expired');
        setError(
          cause instanceof OwnReceiptError
            ? cause.message
            : ownReceiptError(503),
        );
      }
    } finally {
      if (!controller.signal.aborted) {
        setBusy('');
        downloadController.current = null;
      }
    }
  }
  return (
    <>
      <p className={introClass}>
        Consulta las propinas que ya te fueron entregadas y descarga tus
        constancias. Esta sección es de solo lectura; no muestra repartos
        pendientes de pago.
      </p>
      <section
        className={tablePanelClass}
        aria-labelledby="own-tips-title"
        aria-busy={state.status === 'loading'}
      >
        <header className={tableHeaderClass}>
          <div>
            <h2 id="own-tips-title" className={panelTitleClass}>
              Mis constancias de propinas
            </h2>
            <p className="mt-1 text-xs text-muted">
              Montos en pesos chilenos. Fechas de emisión en hora de Chile.
            </p>
          </div>
          <button
            className={buttonClass}
            onClick={reload}
            disabled={state.status === 'loading' || Boolean(busy)}
          >
            Actualizar constancias
          </button>
        </header>
        {state.status === 'loading' ? (
          <p className="p-5 text-sm" role="status">
            Cargando tus constancias de propinas…
          </p>
        ) : state.status === 'error' ? (
          <div className="space-y-3 p-5">
            <p role="alert" className="text-sm text-crit">
              {state.message}
            </p>
            <button className={buttonClass} onClick={reload}>
              Reintentar consulta
            </button>
          </div>
        ) : state.items.length === 0 ? (
          <div className="space-y-2 p-6">
            <h3 className="text-sm font-semibold">
              Aún no tienes constancias de propinas
            </h3>
            <p className="text-sm text-ink2">
              Aparecerán aquí cuando el contador registre la entrega de un
              reparto que te incluya.
            </p>
          </div>
        ) : (
          <>
            <p className="border-b border-line px-5 py-3 text-xs text-muted">
              {state.items.length} constancia
              {state.items.length === 1 ? '' : 's'} de entrega
            </p>
            <ul className="divide-y divide-line">
              {state.items.map((receipt) => (
                <li key={receipt.id} className="space-y-3 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold wrap-anywhere">
                        {receipt.storeName} ·{' '}
                        {formatCalendarDate(receipt.periodStart)} al{' '}
                        {formatCalendarDate(receipt.periodEnd)}
                      </h3>
                      <p className="mt-1 text-sm font-bold">
                        {money(receipt.amount)}
                      </p>
                    </div>
                    <button
                      className={buttonClass}
                      disabled={Boolean(busy)}
                      onClick={() => void download(receipt)}
                      aria-label={
                        'Descargar constancia del ' +
                        formatCalendarDate(receipt.periodStart) +
                        ' al ' +
                        formatCalendarDate(receipt.periodEnd)
                      }
                    >
                      {busy === receipt.id
                        ? 'Verificando…'
                        : 'Descargar constancia'}
                    </button>
                  </div>
                  <dl className="grid gap-3 text-sm text-ink2 sm:grid-cols-2">
                    <div>
                      <dt className="text-xs text-muted">Fecha de entrega</dt>
                      <dd>{formatCalendarDate(receipt.paymentDate)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted">
                        Responsable del pago
                      </dt>
                      <dd className="wrap-anywhere">{receipt.paidByName}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted">Horas consideradas</dt>
                      <dd>{receipt.hoursWorked.replace('.', ',')}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted">Emitida el</dt>
                      <dd>{formatChileDate(receipt.createdAt)}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-crit/20 bg-crit-bg p-4 text-sm text-crit"
        >
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-lg bg-ok-bg p-4 text-sm text-ok">
          {notice}
        </p>
      )}
    </>
  );
}
