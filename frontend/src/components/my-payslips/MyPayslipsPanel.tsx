'use client';
import {
  labelClass,
  inputClass,
  panelTitleClass,
  tablePanelClass,
  buttonClass,
  primaryButtonClass,
} from '@/components/ui/styles';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import {
  payslipDownloadName,
  payslipPeriodLabel,
  type OwnPayslip,
} from '@/lib/my-payslips';
import {
  loadOwnPayslipCollection,
  downloadOwnPayslip,
  PayslipError,
} from '@/lib/my-payslips-client';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; items: OwnPayslip[]; invalidCount?: number };
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
    loadOwnPayslipCollection(workerId, controller.signal).then(
      (collection) => {
        if (!controller.signal.aborted)
          setState({ status: 'ready', ...collection });
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
  function reload(): void {
    if (downloadController.current) return;
    setState({ status: 'loading' });
    setFailure('');
    setNotice('');
    setVerified({});
    setRetry((current) => current + 1);
  }
  async function download(payslip: OwnPayslip): Promise<void> {
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
  }
  if (state.status === 'loading')
    return (
      <p
        role="status"
        aria-busy="true"
        className="rounded-[14px] border border-line bg-bg p-6 text-sm text-ink2"
      >
        Consultando tus liquidaciones publicadas…
      </p>
    );
  if (state.status === 'error')
    return (
      <section
        aria-labelledby="module-load-error"
        className="rounded-[14px] border border-line bg-bg p-5"
      >
        <div role="alert">
          <h2 id="module-load-error" className={panelTitleClass}>
            No se pudieron consultar tus liquidaciones
          </h2>
          <p className="mt-2 text-sm leading-6 text-ink2">{state.message}</p>
        </div>
        <button
          type="button"
          onClick={reload}
          className={'mt-4 ' + buttonClass}
        >
          Reintentar
        </button>
      </section>
    );
  const items = state.items.filter((item) => !period || item.period === period);
  return (
    <section aria-labelledby="my-payslips-title" className="min-w-0 space-y-5">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row">
        <div>
          <h2 id="my-payslips-title" className={panelTitleClass}>
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
          className={buttonClass}
        >
          Actualizar listado
        </button>
      </div>
      {state.items.length > 0 && (
        <label className={`${labelClass} max-w-xs`}>
          Período
          <select
            aria-label="Período"
            value={period}
            disabled={Boolean(downloadId)}
            onChange={(event) => setPeriod(event.target.value)}
            className={`${inputClass} mt-2`}
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
      {Boolean(state.invalidCount) && (
        <p role="alert" className="rounded-lg bg-warn-bg p-4 text-sm text-ink2">
          No se pudieron verificar {state.invalidCount} liquidaciones. Se
          muestran las válidas; informa al administrador.
        </p>
      )}
      {failure && (
        <p
          role="alert"
          className="rounded-lg border border-crit/20 bg-crit-bg px-3.5 py-3 text-sm text-crit"
        >
          {failure}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="rounded-xl border border-line2 bg-tint2 p-4 text-sm text-ink2 leading-6"
        >
          {notice}
        </p>
      )}
      {items.length === 0 ? (
        <div className="rounded-[14px] border border-line bg-bg px-6 py-12 text-center">
          <h3 className={panelTitleClass}>
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
              className={'mt-4 ' + buttonClass}
            >
              Ver todos los períodos
            </button>
          )}
        </div>
      ) : (
        <ul
          aria-label="Mis liquidaciones publicadas"
          className={tablePanelClass}
        >
          {items.map((item) => (
            <li
              key={item.id}
              className="border-b border-line p-5 last:border-b-0 sm:p-6"
            >
              <div className="flex flex-col items-start justify-between gap-4 sm:flex-row">
                <div className="w-full min-w-0 flex-1 sm:w-auto">
                  <h3 className={panelTitleClass}>
                    {payslipPeriodLabel(item.period)}
                  </h3>
                  <p className="mt-2 break-words text-sm text-ink2">
                    {item.fileName}
                  </p>
                  <p className="mt-2 text-xs text-ink2">
                    Fecha de firma: {item.signedAt}
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
                  className={primaryButtonClass}
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
                <summary className="min-h-11 cursor-pointer py-3 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-salmon-ink">
                  Ver datos del archivo
                </summary>
                <p className="mt-3">SHA-256 registrado</p>
                <code className="mt-2 block break-all">{item.sha256}</code>
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
