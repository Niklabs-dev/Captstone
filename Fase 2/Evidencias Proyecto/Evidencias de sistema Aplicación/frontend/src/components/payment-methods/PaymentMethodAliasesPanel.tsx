'use client';
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  alertClass,
  badgeClass,
  buttonClass,
  inputClass,
  labelClass,
  panelTitleClass,
  primaryButtonClass,
  tableDescriptionClass,
  tableHeaderClass,
  tablePanelClass,
} from '@/components/ui/styles';
import {
  aliasLabelError,
  aliasesByMethod,
  type PaymentMethodAlias,
} from '@/lib/payment-method-aliases';
import {
  createPaymentMethodAlias,
  deletePaymentMethodAlias,
  loadPaymentMethodAliases,
  PaymentMethodAliasError,
} from '@/lib/payment-method-aliases-client';
import { sortPaymentMethods, type PaymentMethod } from '@/lib/payment-methods';
import { loadPaymentMethods } from '@/lib/payment-methods-client';

// SPRINT-4A-T20: etiquetas del Informe de Ventas Diario de MrComanda
// («T. DEBITO», «EFECTIVO», «N.de Créd.») asociadas a cada medio. Corregir un
// alias equivocado es quitarlo y agregarlo en el medio correcto; las
// importaciones ya confirmadas no cambian.

const noticeClass =
  'rounded-lg border border-line2 bg-tint2 px-3.5 py-3 text-sm text-ink2';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      methods: PaymentMethod[];
      aliases: PaymentMethodAlias[];
    };

export function PaymentMethodAliasesPanel(): ReactElement {
  const router = useRouter();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [revision, setRevision] = useState(0);
  const [label, setLabel] = useState('');
  const [methodId, setMethodId] = useState('');
  const [formError, setFormError] = useState('');
  const [failure, setFailure] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const inFlight = useRef(false);
  const labelInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      loadPaymentMethods({}, controller.signal),
      loadPaymentMethodAliases(controller.signal),
    ]).then(
      ([methods, aliases]) => {
        if (!controller.signal.aborted)
          setState({
            status: 'ready',
            methods: sortPaymentMethods(methods),
            aliases,
          });
      },
      (cause: unknown) => {
        if (!controller.signal.aborted)
          setState({
            status: 'error',
            message:
              cause instanceof Error && cause.name !== 'AbortError'
                ? cause.message
                : 'No se pudieron cargar las etiquetas de los informes.',
          });
      },
    );
    return () => controller.abort();
  }, [revision]);

  function refresh(): void {
    setState({ status: 'loading' });
    setRevision((value) => value + 1);
  }
  function fail(cause: unknown): string {
    if (cause instanceof PaymentMethodAliasError) {
      if (cause.status === 401) router.replace('/session-expired');
      if (cause.status === 403) router.replace('/dashboard?reason=forbidden');
      return cause.message;
    }
    return 'No se pudo guardar la etiqueta. Intenta nuevamente.';
  }

  async function add(event: FormEvent<HTMLFormElement>): Promise<undefined> {
    event.preventDefault();
    if (state.status !== 'ready' || inFlight.current) return;
    const invalid =
      aliasLabelError(label, state.aliases) ??
      (methodId ? null : 'Elige el medio de pago de la etiqueta.');
    setFormError(invalid ?? '');
    setNotice('');
    setFailure('');
    if (invalid) {
      labelInput.current?.focus();
      return;
    }
    inFlight.current = true;
    setBusy('create');
    try {
      const created = await createPaymentMethodAlias({
        label,
        paymentMethodId: methodId,
      });
      setState({ ...state, aliases: [...state.aliases, created] });
      setNotice(
        `«${created.label}» quedó asociada a ${created.paymentMethod.name}. Las próximas cargas la reconocerán.`,
      );
      setLabel('');
    } catch (cause) {
      setFailure(fail(cause));
    } finally {
      inFlight.current = false;
      setBusy('');
    }
  }

  async function remove(alias: PaymentMethodAlias): Promise<undefined> {
    if (state.status !== 'ready' || inFlight.current) return;
    inFlight.current = true;
    setBusy(alias.id);
    setNotice('');
    setFailure('');
    try {
      await deletePaymentMethodAlias(alias.id);
      setState({
        ...state,
        aliases: state.aliases.filter((item) => item.id !== alias.id),
      });
      setNotice(
        `Se quitó «${alias.label}» de ${alias.paymentMethod.name}. Las importaciones confirmadas no cambian; la próxima carga con esa etiqueta pedirá elegir su medio.`,
      );
    } catch (cause) {
      setFailure(fail(cause));
    } finally {
      inFlight.current = false;
      setBusy('');
    }
  }

  const groups =
    state.status === 'ready' ? aliasesByMethod(state.aliases) : new Map();
  return (
    <section
      aria-labelledby="aliases-title"
      aria-busy={state.status === 'loading'}
      className={`${tablePanelClass} min-w-0`}
    >
      <header className={tableHeaderClass}>
        <div className="min-w-0">
          <h2 id="aliases-title" className={panelTitleClass}>
            Etiquetas de los informes de ventas
          </h2>
          <p className={tableDescriptionClass}>
            Cómo aparece cada medio en el Informe de Ventas Diario de MrComanda
          </p>
        </div>
      </header>
      <div className="space-y-4 p-5">
        <p className="text-sm text-ink2">
          Al importar, cada etiqueta se asocia a su medio. Si una etiqueta no
          está aquí, la vista previa pide elegir su medio (u omitirla si viene
          en 0). Quitar o cambiar una etiqueta no modifica las importaciones ya
          confirmadas.
        </p>
        {state.status === 'loading' && (
          <p role="status" className="text-sm text-ink2">
            Cargando etiquetas…
          </p>
        )}
        {state.status === 'error' && (
          <div role="alert" className="space-y-3 text-sm text-crit">
            <p>{state.message}</p>
            <button type="button" onClick={refresh} className={buttonClass}>
              Reintentar
            </button>
          </div>
        )}
        {failure && (
          <p role="alert" className={alertClass}>
            {failure}
          </p>
        )}
        {notice && (
          <p role="status" className={noticeClass}>
            {notice}
          </p>
        )}
        {state.status === 'ready' && (
          <>
            <form
              onSubmit={add}
              noValidate
              aria-busy={busy === 'create'}
              className="grid min-w-0 gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
            >
              <label className={labelClass}>
                Etiqueta del informe
                <input
                  ref={labelInput}
                  value={label}
                  maxLength={100}
                  onChange={(event) => {
                    setLabel(event.target.value);
                    setFormError('');
                  }}
                  placeholder="Ej.: N.de Créd."
                  aria-invalid={Boolean(formError)}
                  aria-describedby="alias-form-error"
                  className={`${inputClass} mt-2`}
                />
              </label>
              <label className={labelClass}>
                Medio de pago
                <select
                  value={methodId}
                  onChange={(event) => {
                    setMethodId(event.target.value);
                    setFormError('');
                  }}
                  className={`${inputClass} mt-2`}
                >
                  <option value="">Selecciona un medio activo</option>
                  {state.methods
                    .filter((method) => method.isActive)
                    .map((method) => (
                      <option key={method.id} value={method.id}>
                        {method.name}
                      </option>
                    ))}
                </select>
              </label>
              <button
                type="submit"
                disabled={busy !== ''}
                className={primaryButtonClass}
              >
                {busy === 'create' ? 'Agregando…' : 'Agregar etiqueta'}
              </button>
              <p
                id="alias-form-error"
                role="alert"
                hidden={!formError}
                className="text-sm text-crit sm:col-span-3"
              >
                {formError}
              </p>
            </form>
            <ul className="divide-y divide-line rounded-[14px] border border-line">
              {state.methods.map((method) => {
                const aliases: PaymentMethodAlias[] =
                  groups.get(method.id) ?? [];
                return (
                  <li key={method.id} className="min-w-0 p-4">
                    <article className="min-w-0">
                      <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                        <span className="break-words">{method.name}</span>
                        <span className="font-mono text-[11px] font-normal text-muted">
                          {method.code}
                        </span>
                        {!method.isActive && (
                          <span
                            className={`${badgeClass} bg-crit-bg text-crit`}
                          >
                            Desactivado
                          </span>
                        )}
                      </h3>
                      {aliases.length === 0 ? (
                        <p className="mt-2 text-xs text-muted">
                          Sin etiquetas asociadas.
                        </p>
                      ) : (
                        <ul className="mt-2 flex flex-wrap gap-2">
                          {aliases.map((alias) => (
                            <li
                              key={alias.id}
                              className="flex min-w-0 items-center gap-2 rounded-lg border border-line2 bg-tint py-1 pl-3 pr-1"
                            >
                              <span className="break-all text-sm">
                                {alias.label}
                              </span>
                              <button
                                type="button"
                                disabled={busy !== ''}
                                onClick={() => void remove(alias)}
                                aria-label={`Quitar «${alias.label}» de ${method.name}`}
                                className={`${buttonClass} min-h-11`}
                              >
                                {busy === alias.id ? 'Quitando…' : 'Quitar'}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </article>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
