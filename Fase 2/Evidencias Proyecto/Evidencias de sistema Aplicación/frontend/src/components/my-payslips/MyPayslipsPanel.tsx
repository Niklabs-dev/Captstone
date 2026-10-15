'use client';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import {
  payslipDownloadName,
  payslipPeriodLabel,
  type OwnPayslip,
} from '@/lib/my-payslips';
import {
  loadOwnPayslips,
  downloadOwnPayslip,
  PayslipError,
} from '@/lib/my-payslips-client';

const button =
  'min-h-11 rounded-lg border border-line2 bg-bg px-3 py-2 text-sm font-semibold text-salmon-ink hover:bg-tint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-salmon-ink disabled:cursor-not-allowed disabled:opacity-50';
const primary =
  'min-h-11 rounded-lg bg-salmon-ink px-4 py-2 text-sm font-semibold text-white hover:bg-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-salmon-ink disabled:cursor-not-allowed disabled:opacity-50';
type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; items: OwnPayslip[] };
export function MyPayslipsPanel({
  workerId,
}: {
  workerId: string;
}): ReactElement {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [retry, setRetry] = useState(0);
  const [period, setPeriod] = useState('');
  const [downloadId, setDownloadId] = useState('');
  const [failure, setFailure] = useState('');
  const [notice, setNotice] = useState('');
  const [verified, setVerified] = useState<Record<string, boolean>>({});
  const downloadController = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    loadOwnPayslips(workerId, controller.signal).then(
      (items) => {
        if (!controller.signal.aborted) setState({ status: 'ready', items });
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setState({
            status: 'error',
            message:
              error instanceof PayslipError
                ? error.message
                : 'No se pudieron consultar tus liquidaciones.',
          });
      },
    );
    return () => {
      controller.abort();
      downloadController.current?.abort();
    };
  }, [workerId, retry]);
  function reload(): undefined {
    if (downloadController.current) return;
    setState({ status: 'loading' });
    setFailure('');
    setNotice('');
    setVerified({});
    setRetry((current) => current + 1);
    return undefined;
  }
  async function download(payslip: OwnPayslip): Promise<undefined> {
    if (downloadController.current) return;
    const controller = new AbortController();
    downloadController.current = controller;
    setDownloadId(payslip.id);
    setFailure('');
    setNotice('');
    try {
      const blob = await downloadOwnPayslip(payslip, controller.signal);
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = payslipDownloadName(payslip.fileName, payslip.period);
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setVerified((current) => ({ ...current, [payslip.id]: true }));
      setNotice(
        'Descarga verificada para ' +
          payslipPeriodLabel(payslip.period) +
          '. El SHA-256 del archivo recibido coincide.',
      );
    } catch (error) {
      if (!controller.signal.aborted) {
        setVerified((current) => ({ ...current, [payslip.id]: false }));
        setFailure(
          error instanceof PayslipError
            ? error.message
            : 'No se pudo completar la descarga. Intenta nuevamente.',
        );
      }
    } finally {
      downloadController.current = null;
      if (!controller.signal.aborted) setDownloadId('');
    }
    return undefined;
  }
  if (state.status === 'loading')
    return (
      <p
        role="status"
        className="rounded-[14px] border border-line bg-bg p-6 text-sm text-ink2"
      >
        Consultando tus liquidaciones publicadas…
      </p>
    );
  if (state.status === 'error')
    return (
      <section className="rounded-[14px] border border-line2 bg-bg p-6">
        <div role="alert">
          <h2 className="font-bold">
            No se pudieron consultar tus liquidaciones
          </h2>
          <p className="mt-2 text-sm leading-6 text-ink2">{state.message}</p>
        </div>
        <button type="button" onClick={reload} className={'mt-4 ' + button}>
          Reintentar
        </button>
      </section>
    );
  const items = state.items.filter((item) => !period || item.period === period);
  return (
    <section aria-labelledby="my-payslips-title" className="min-w-0 space-y-5">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row">
        <div>
          <h2 id="my-payslips-title" className="text-xl font-bold">
            Liquidaciones publicadas
          </h2>
          <p className="mt-2 text-sm text-ink2">
            Disponibles en tu cuenta: {state.items.length}
          </p>
        </div>
        <button
          type="button"
          onClick={reload}
          disabled={Boolean(downloadId)}
          className={button}
        >
          Actualizar listado
        </button>
      </div>
      {state.items.length > 0 && (
        <label className="block max-w-xs text-xs font-semibold text-ink2">
          Período
          <select
            aria-label="Período"
            value={period}
            disabled={Boolean(downloadId)}
            onChange={(event) => setPeriod(event.target.value)}
            className="mt-1 min-h-11 w-full rounded-lg border border-line2 bg-bg px-3 py-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-salmon-ink"
          >
            <option value="">Todos los períodos</option>
            {state.items.map((item) => (
              <option key={item.id} value={item.period}>
                {payslipPeriodLabel(item.period)}
              </option>
            ))}
          </select>
        </label>
      )}
      {failure && (
        <p
          role="alert"
          className="rounded-lg border border-line2 bg-crit-bg p-4 text-sm leading-6"
        >
          {failure}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="rounded-lg border border-line bg-bg p-4 text-sm leading-6"
        >
          {notice}
        </p>
      )}
      {items.length === 0 ? (
        <div className="rounded-[14px] border border-line bg-bg px-6 py-12 text-center">
          <h3 className="font-bold">
            {state.items.length
              ? 'No hay liquidaciones para este período'
              : 'Aún no tienes liquidaciones publicadas'}
          </h3>
          <p className="mt-2 text-sm leading-6 text-ink2">
            {state.items.length
              ? 'Selecciona todos los períodos para revisar las disponibles.'
              : 'Tus liquidaciones aparecerán aquí después de que el contador confirme su publicación.'}
          </p>
          {state.items.length > 0 && (
            <button
              type="button"
              onClick={() => setPeriod('')}
              className={'mt-4 ' + button}
            >
              Ver todos los períodos
            </button>
          )}
        </div>
      ) : (
        <ul
          aria-label="Mis liquidaciones publicadas"
          className="overflow-hidden rounded-[14px] border border-line bg-bg"
        >
          {items.map((item) => (
            <li
              key={item.id}
              className="border-b border-line p-5 last:border-b-0 sm:p-6"
            >
              <div className="flex flex-col items-start justify-between gap-4 sm:flex-row">
                <div className="w-full min-w-0 flex-1 sm:w-auto">
                  <h3 className="font-bold">
                    {payslipPeriodLabel(item.period)}
                  </h3>
                  <p className="mt-2 break-words text-sm text-ink2">
                    {item.fileName}
                  </p>
                  <p className="mt-2 text-xs text-ink2">
                    Publicada el{' '}
                    {new Intl.DateTimeFormat('es-CL', {
                      dateStyle: 'short',
                      timeZone: 'America/Santiago',
                    }).format(new Date(item.publishedAt))}{' '}
                    ·{' '}
                    {item.size < 1024
                      ? item.size + ' B'
                      : (item.size / 1024).toLocaleString('es-CL', {
                          maximumFractionDigits: 1,
                        }) + ' KiB'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => download(item)}
                  disabled={Boolean(downloadId)}
                  className={primary}
                  aria-label={
                    'Descargar liquidación de ' +
                    payslipPeriodLabel(item.period)
                  }
                >
                  {downloadId === item.id
                    ? 'Verificando archivo…'
                    : 'Descargar PDF'}
                </button>
              </div>
              <p className="mt-4 text-xs text-ink2">
                {verified[item.id]
                  ? 'Archivo recibido verificado con SHA-256.'
                  : 'La integridad se comprobará antes de guardar la descarga.'}
              </p>
              <details className="mt-3 text-xs text-ink2">
                <summary className="cursor-pointer font-semibold">
                  Ver datos del archivo
                </summary>
                <p className="mt-3">SHA-256 registrado</p>
                <code className="mt-1 block break-all">{item.sha256}</code>
              </details>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs leading-5 text-ink2">
        Si un archivo no supera la verificación de integridad, su descarga se
        bloquea.
      </p>
    </section>
  );
}
