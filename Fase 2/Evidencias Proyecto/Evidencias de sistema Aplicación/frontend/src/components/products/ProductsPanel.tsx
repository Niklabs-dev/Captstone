'use client';

import { useEffect, useRef, useState, type ReactElement } from 'react';
import {
  alertClass,
  badgeClass,
  buttonClass,
  filterPanelClass,
  infoNoticeClass,
  inputClass,
  labelClass,
  panelTitleClass,
  primaryButtonClass,
  tableCellClass,
  tableClass,
  tableDescriptionClass,
  tableHeadClass,
  tableHeaderClass,
  tableHeadingClass,
  tablePanelClass,
} from '@/components/ui/styles';
import {
  buildCatalog,
  countLabel,
  creationProgress,
  formatSummary,
  productErrorMessage,
  productUpdate,
  type CatalogEntry,
  type Product,
  type ProductFieldErrors,
  type ProductFilters,
  type ProductInput,
  type ProductSection,
  type TemplateRow,
} from '@/lib/products';
import {
  createProduct,
  loadProducts,
  loadSections,
  loadTemplate,
  moveProduct,
  ProductRequestError,
  setProductActive,
  updateProduct,
} from '@/lib/products-client';
import { ProductDialog, type ProductAction } from './ProductDialog';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      products: Product[];
      sections: ProductSection[];
      rows: TemplateRow[];
    };

const HEADINGS = ['Fila', 'Producto', 'SKU', 'Formato', 'Estado', 'Acciones'];

// Administración de productos de inventario (SPRINT-5-T04): listado en el
// orden de la plantilla con los artículos que faltan por crear, filtros y
// formulario de crear y editar.
export function ProductsPanel(): ReactElement {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [revision, setRevision] = useState(0);
  const [filters, setFilters] = useState<ProductFilters>({
    search: '',
    section: '',
    status: 'active',
    missingSku: false,
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
      loadTemplate(controller.signal),
    ]).then(
      ([products, sections, rows]) => {
        if (!controller.signal.aborted)
          setState({ status: 'ready', products, sections, rows });
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
  function fail(cause: unknown): void {
    if (cause instanceof ProductRequestError) {
      setDialogError(cause.message);
      if (cause.fieldErrors) setServerErrors(cause.fieldErrors);
    } else setDialogError(productErrorMessage(503));
  }

  async function save(input: ProductInput): Promise<undefined> {
    if (inFlight.current || !action || action.kind === 'state') return;
    inFlight.current = true;
    setBusy(true);
    setDialogError('');
    setServerErrors({});
    try {
      if (action.kind === 'create') {
        const saved = await createProduct(input);
        setNotice(
          `Producto «${saved.name}» creado en la fila ${saved.templatePosition ?? '—'} de ${saved.section ?? 'su sección'}.`,
        );
      } else {
        let saved = await updateProduct(
          action.product.id,
          productUpdate(input),
        );
        if (
          input.templateRowId &&
          input.templateRowId !== action.product.templateRowId
        )
          saved = await moveProduct(saved.id, input.templateRowId);
        setNotice(`Producto «${saved.name}» actualizado.`);
      }
      setAction(null);
      reload();
    } catch (cause) {
      fail(cause);
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
      fail(cause);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const ready = state.status === 'ready' ? state : null;
  const sections = ready?.sections ?? [];
  const groups = ready ? buildCatalog(ready.rows, ready.products, filters) : [];
  const progress = ready ? creationProgress(ready.rows) : null;
  const missingSku =
    ready?.products.filter((p) => p.isActive && p.sku === null).length ?? 0;
  const missingFormat =
    ready?.products.filter((p) => p.isActive && !p.hasFormat).length ?? 0;

  function setFilter<K extends keyof ProductFilters>(
    key: K,
    value: ProductFilters[K],
  ): void {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function position(entry: CatalogEntry): string {
    const value =
      entry.kind === 'pending'
        ? entry.row.position
        : entry.product.templatePosition;
    return value === null ? '—' : String(value);
  }
  function title(entry: CatalogEntry): string {
    return entry.kind === 'pending'
      ? (entry.row.printedText ?? '')
      : entry.product.name;
  }
  function status(entry: CatalogEntry): ReactElement {
    if (entry.kind === 'pending')
      return (
        <span className={`${badgeClass} bg-tint2 text-ink2`}>
          Pendiente de crear
        </span>
      );
    return entry.product.isActive ? (
      <span className={`${badgeClass} bg-ok-bg text-ok`}>Activo</span>
    ) : (
      <span className={`${badgeClass} bg-crit-bg text-crit`}>Inactivo</span>
    );
  }
  function format(entry: CatalogEntry): ReactElement | string {
    if (entry.kind === 'pending') return '—';
    return (
      formatSummary(entry.product) ?? (
        <span className={`${badgeClass} bg-warn-bg text-warn`}>
          Sin formato
        </span>
      )
    );
  }
  function sku(entry: CatalogEntry): ReactElement | string {
    if (entry.kind === 'pending') return '—';
    return (
      entry.product.sku ?? (
        <span className={`${badgeClass} bg-warn-bg text-warn`}>Sin SKU</span>
      )
    );
  }
  function actions(entry: CatalogEntry): ReactElement {
    if (entry.kind === 'pending')
      return (
        <button
          type="button"
          onClick={() => open({ kind: 'create', row: entry.row })}
          className={buttonClass}
          aria-label={`Crear producto en la fila ${entry.row.position}, ${entry.row.printedText ?? ''}`}
        >
          Crear producto
        </button>
      );
    const product = entry.product;
    return (
      <div className="flex flex-wrap gap-3">
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
    );
  }
  const key = (entry: CatalogEntry) =>
    entry.kind === 'pending' ? entry.row.id : entry.product.id;

  return (
    <div className="min-w-0 space-y-5" aria-busy={state.status === 'loading'}>
      <section aria-labelledby="products-filters" className={filterPanelClass}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="products-filters" className={panelTitleClass}>
              Filtros
            </h2>
            {progress && (
              <p className="mt-1 text-sm text-ink2" aria-live="polite">
                Productos creados: {progress.created} de {progress.total}
              </p>
            )}
          </div>
          <button
            type="button"
            disabled={!ready}
            onClick={() => open({ kind: 'create', row: null })}
            className={primaryButtonClass}
          >
            Crear producto
          </button>
        </div>
        <div className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className={labelClass}>
            Buscar por nombre o SKU
            <input
              type="search"
              className={`${inputClass} mt-2`}
              value={filters.search}
              placeholder="Ej. fanta o SUB-123"
              onChange={(event) => setFilter('search', event.target.value)}
            />
          </label>
          <label className={labelClass}>
            Sección
            <select
              className={`${inputClass} mt-2`}
              value={filters.section}
              onChange={(event) => setFilter('section', event.target.value)}
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
              className={`${inputClass} mt-2`}
              value={filters.status}
              onChange={(event) =>
                setFilter(
                  'status',
                  event.target.value as ProductFilters['status'],
                )
              }
            >
              <option value="active">Activos y pendientes</option>
              <option value="pending">Pendientes de crear</option>
              <option value="inactive">Inactivos</option>
              <option value="all">Todos</option>
            </select>
          </label>
        </div>
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={filters.missingSku}
              onChange={(event) =>
                setFilter('missingSku', event.target.checked)
              }
              className="h-5 w-5 shrink-0 accent-salmon-ink"
            />
            Sin SKU
            {ready && <span className="text-ink2">({missingSku})</span>}
          </label>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={filters.missingFormat}
              onChange={(event) =>
                setFilter('missingFormat', event.target.checked)
              }
              className="h-5 w-5 shrink-0 accent-salmon-ink"
            />
            Sin formato
            {ready && <span className="text-ink2">({missingFormat})</span>}
          </label>
        </div>
      </section>

      {notice && (
        <p role="status" className={infoNoticeClass}>
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
      {ready && groups.length === 0 && (
        <p role="status" className={filterPanelClass}>
          No hay productos que coincidan con los filtros.
        </p>
      )}

      {groups.map((group) => {
        const products = group.entries.filter(
          (entry) => entry.kind === 'product',
        ).length;
        const pending = group.entries.length - products;
        return (
          <section
            key={group.id}
            aria-labelledby={group.id}
            className={`${tablePanelClass} min-w-0`}
          >
            <header className={tableHeaderClass}>
              <div className="min-w-0">
                <h2 id={group.id} className={`${panelTitleClass} break-words`}>
                  {group.section}
                </h2>
                <p className={tableDescriptionClass}>
                  {countLabel(products, 'producto', 'productos')}
                  {pending > 0 &&
                    ` · ${countLabel(pending, 'pendiente', 'pendientes')}`}
                </p>
              </div>
            </header>
            <ul
              aria-label={`Productos de ${group.section}`}
              className="divide-y divide-line lg:hidden"
            >
              {group.entries.map((entry) => (
                <li key={key(entry)}>
                  <article aria-label={title(entry)} className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="break-words text-sm font-bold">
                          {title(entry)}
                        </h3>
                        <p className="mt-1 text-xs text-ink2">
                          Fila {position(entry)}
                        </p>
                      </div>
                      <span className="shrink-0">{status(entry)}</span>
                    </div>
                    {entry.kind === 'product' && (
                      <p className="flex flex-wrap items-center gap-2 text-xs text-ink2">
                        <span>{format(entry)}</span>
                        <span>·</span>
                        {entry.product.sku ? (
                          <span>SKU {entry.product.sku}</span>
                        ) : (
                          sku(entry)
                        )}
                      </p>
                    )}
                    {actions(entry)}
                  </article>
                </li>
              ))}
            </ul>
            <div
              role="region"
              aria-label={`Tabla de ${group.section} desplazable`}
              tabIndex={0}
              className="hidden min-w-0 max-w-full overflow-x-auto overscroll-x-contain focus-visible:outline-2 focus-visible:outline-salmon-ink lg:block"
            >
              <table className={`${tableClass} min-w-[860px]`}>
                <caption className="sr-only">
                  Fila, producto, SKU, formato, estado y acciones de{' '}
                  {group.section}.
                </caption>
                <thead className={tableHeadClass}>
                  <tr>
                    {HEADINGS.map((heading) => (
                      <th
                        key={heading}
                        scope="col"
                        className={tableHeadingClass}
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {group.entries.map((entry) => (
                    <tr
                      key={key(entry)}
                      className="border-b border-line last:border-b-0 hover:bg-tint"
                    >
                      <td className={`${tableCellClass} tabular-nums`}>
                        {position(entry)}
                      </td>
                      <td
                        className={`${tableCellClass} max-w-72 break-words font-semibold`}
                      >
                        {title(entry)}
                        {entry.kind === 'product' &&
                          entry.product.alternativeNames.length > 0 && (
                            <span className="mt-1 block text-xs font-normal text-ink2">
                              {entry.product.alternativeNames.join(', ')}
                            </span>
                          )}
                      </td>
                      <td className={`${tableCellClass} font-mono text-xs`}>
                        {sku(entry)}
                      </td>
                      <td className={`${tableCellClass} max-w-64 break-words`}>
                        {format(entry)}
                      </td>
                      <td className={tableCellClass}>{status(entry)}</td>
                      <td className={tableCellClass}>{actions(entry)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      {action && ready && (
        <ProductDialog
          key={
            action.kind === 'create'
              ? 'create' + (action.row?.id ?? '')
              : action.product.id + action.kind
          }
          action={action}
          sections={sections}
          rows={ready.rows}
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
