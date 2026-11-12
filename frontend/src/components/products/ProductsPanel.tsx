'use client';

import { useEffect, useRef, useState, type ReactElement } from 'react';
import {
  alertClass,
  badgeClass,
  buttonClass,
  filterPanelClass,
  inputClass,
  labelClass,
  panelTitleClass,
  primaryButtonClass,
  tableDescriptionClass,
  tableHeaderClass,
  tablePanelClass,
} from '@/components/ui/styles';
import {
  filterProducts,
  formatSummary,
  groupBySection,
  productErrorMessage,
  type Product,
  type ProductFieldErrors,
  type ProductFilters,
  type ProductInput,
  type ProductSection,
} from '@/lib/products';
import {
  loadProducts,
  loadSections,
  ProductRequestError,
  saveProduct,
  setProductActive,
} from '@/lib/products-client';
import { ProductDialog, type ProductAction } from './ProductDialog';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; products: Product[]; sections: ProductSection[] };

// Administración de productos de inventario (SPRINT-5-T04): listado en el
// orden de la plantilla, filtros y formulario de crear y editar.
export function ProductsPanel(): ReactElement {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [revision, setRevision] = useState(0);
  const [filters, setFilters] = useState<ProductFilters>({
    search: '',
    section: '',
    status: 'active',
    missingFormat: false,
  });
  const [action, setAction] = useState<ProductAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState('');
  const [serverErrors, setServerErrors] = useState<ProductFieldErrors>({});
  const [notice, setNotice] = useState('');
  const inFlight = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      loadProducts(controller.signal),
      loadSections(controller.signal),
    ]).then(
      ([products, sections]) => {
        if (!controller.signal.aborted)
          setState({ status: 'ready', products, sections });
      },
      (cause: unknown) => {
        if (!controller.signal.aborted)
          setState({
            status: 'error',
            message:
              cause instanceof ProductRequestError
                ? cause.message
                : productErrorMessage(503),
          });
      },
    );
    return () => controller.abort();
  }, [revision]);

  function open(next: ProductAction): void {
    setAction(next);
    setDialogError('');
    setServerErrors({});
    setNotice('');
  }
  function close(): undefined {
    setAction(null);
    return undefined;
  }
  function reload(): void {
    setState({ status: 'loading' });
    setRevision((value) => value + 1);
  }

  async function save(input: ProductInput): Promise<undefined> {
    if (inFlight.current || !action || action.kind === 'state') return;
    inFlight.current = true;
    setBusy(true);
    setDialogError('');
    setServerErrors({});
    try {
      const saved = await saveProduct(
        input,
        action.kind === 'edit' ? action.product.id : null,
      );
      setNotice(
        action.kind === 'create'
          ? `Producto «${saved.name}» creado en ${saved.section ?? 'su sección'}.`
          : `Producto «${saved.name}» actualizado.`,
      );
      setAction(null);
      reload();
    } catch (cause) {
      if (cause instanceof ProductRequestError) {
        setDialogError(cause.message);
        if (cause.fieldErrors) setServerErrors(cause.fieldErrors);
      } else setDialogError(productErrorMessage(503));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function toggle(): Promise<undefined> {
    if (inFlight.current || !action || action.kind !== 'state') return;
    inFlight.current = true;
    setBusy(true);
    setDialogError('');
    try {
      const saved = await setProductActive(
        action.product.id,
        !action.product.isActive,
      );
      setNotice(
        saved.isActive
          ? `Producto «${saved.name}» activado.`
          : `Producto «${saved.name}» desactivado.`,
      );
      setAction(null);
      reload();
    } catch (cause) {
      setDialogError(
        cause instanceof ProductRequestError
          ? cause.message
          : productErrorMessage(503),
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const sections = state.status === 'ready' ? state.sections : [];
  const visible =
    state.status === 'ready' ? filterProducts(state.products, filters) : [];
  const groups = groupBySection(visible, sections);
  const missing =
    state.status === 'ready'
      ? state.products.filter(
          (product) => product.isActive && !product.hasFormat,
        ).length
      : 0;

  return (
    <div className="min-w-0 space-y-5">
      <section aria-labelledby="products-filters" className={filterPanelClass}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="products-filters" className={panelTitleClass}>
            Filtros
          </h2>
          <button
            type="button"
            disabled={state.status !== 'ready'}
            onClick={() => open({ kind: 'create' })}
            className={primaryButtonClass}
          >
            Crear producto
          </button>
        </div>
        <div className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className={labelClass}>
            Buscar por nombre
            <input
              type="search"
              className={`${inputClass} mt-1`}
              value={filters.search}
              placeholder="Ej. fanta"
              onChange={(event) =>
                setFilters((value) => ({
                  ...value,
                  search: event.target.value,
                }))
              }
            />
          </label>
          <label className={labelClass}>
            Sección
            <select
              className={`${inputClass} mt-1`}
              value={filters.section}
              onChange={(event) =>
                setFilters((value) => ({
                  ...value,
                  section: event.target.value,
                }))
              }
            >
              <option value="">Todas las secciones</option>
              {sections.map((section) => (
                <option key={section.name} value={section.name}>
                  {section.name}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            Estado
            <select
              className={`${inputClass} mt-1`}
              value={filters.status}
              onChange={(event) =>
                setFilters((value) => ({
                  ...value,
                  status: event.target.value as ProductFilters['status'],
                }))
              }
            >
              <option value="active">Activos</option>
              <option value="inactive">Inactivos</option>
              <option value="all">Todos</option>
            </select>
          </label>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 self-end text-sm">
            <input
              type="checkbox"
              checked={filters.missingFormat}
              onChange={(event) =>
                setFilters((value) => ({
                  ...value,
                  missingFormat: event.target.checked,
                }))
              }
              className="h-5 w-5 shrink-0 accent-salmon-ink"
            />
            Solo sin formato
            {state.status === 'ready' && (
              <span className="text-ink2">({missing})</span>
            )}
          </label>
        </div>
      </section>

      {notice && (
        <p
          role="status"
          className="rounded-lg border border-line2 bg-tint2 px-3.5 py-3 text-sm text-ink2"
        >
          {notice}
        </p>
      )}

      {state.status === 'loading' && (
        <p role="status" className={filterPanelClass}>
          Cargando productos…
        </p>
      )}
      {state.status === 'error' && (
        <div role="alert" className={`${alertClass} space-y-3`}>
          <p>{state.message}</p>
          <button type="button" onClick={reload} className={buttonClass}>
            Reintentar
          </button>
        </div>
      )}
      {state.status === 'ready' && groups.length === 0 && (
        <p role="status" className={filterPanelClass}>
          No hay productos que coincidan con los filtros.
        </p>
      )}

      {groups.map((group) => (
        <section
          key={group.section}
          aria-labelledby={`section-${group.section}`}
          className={`${tablePanelClass} min-w-0`}
        >
          <header className={tableHeaderClass}>
            <div className="min-w-0">
              <h2
                id={`section-${group.section}`}
                className={`${panelTitleClass} break-words`}
              >
                {group.section}
              </h2>
              <p className={tableDescriptionClass}>
                {group.products.length} productos
              </p>
            </div>
          </header>
          <ul className="divide-y divide-line">
            {group.products.map((product) => {
              const summary = formatSummary(product);
              return (
                <li
                  key={product.id}
                  className="flex min-w-0 flex-col gap-3 p-5 text-sm sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="break-words font-medium">{product.name}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink2">
                      {summary ?? (
                        <span className={`${badgeClass} bg-warn-bg text-warn`}>
                          Sin formato
                        </span>
                      )}
                      {product.sku && <span>SKU {product.sku}</span>}
                      {!product.isActive && (
                        <span className={`${badgeClass} bg-tint2 text-ink2`}>
                          Inactivo
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => open({ kind: 'edit', product })}
                      className={buttonClass}
                      aria-label={`Editar ${product.name}`}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => open({ kind: 'state', product })}
                      className={buttonClass}
                      aria-label={`${product.isActive ? 'Desactivar' : 'Activar'} ${product.name}`}
                    >
                      {product.isActive ? 'Desactivar' : 'Activar'}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {action && (
        <ProductDialog
          key={
            action.kind === 'create'
              ? 'create'
              : action.product.id + action.kind
          }
          action={action}
          sections={sections}
          busy={busy}
          error={dialogError}
          serverErrors={serverErrors}
          onClose={close}
          onSave={save}
          onState={toggle}
        />
      )}
    </div>
  );
}
