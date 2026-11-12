'use client';

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
} from 'react';
import {
  alertClass,
  buttonClass,
  dangerButtonClass,
  dialogActionsClass,
  dialogClass,
  inputClass,
  labelClass,
  primaryButtonClass,
} from '@/components/ui/styles';
import {
  formatExample,
  freeRowOptions,
  isUnit,
  PACKAGE_NAMES,
  parseDecimalInput,
  PRODUCT_UNIT_LABELS,
  PRODUCT_UNITS,
  productFormValues,
  productInputFromForm,
  type Product,
  type ProductField,
  type ProductFieldErrors,
  type ProductFormValues,
  type ProductInput,
  type ProductSection,
  type TemplateRow,
  type TemplateRowSummary,
} from '@/lib/products';
import { loadSuggestion } from '@/lib/products-client';

export type ProductAction =
  | { kind: 'create'; row: TemplateRowSummary | null }
  | { kind: 'edit' | 'state'; product: Product };

// Formulario de crear y editar, y confirmación de activar o desactivar
// (SPRINT-5-T04). Los errores de la API se muestran junto al campo y lo
// escrito se conserva. La fila de la plantilla parte con la sugerencia de la
// API mientras el administrador no elija otra.
export function ProductDialog({
  action,
  sections,
  rows,
  busy,
  error,
  serverErrors,
  onClose,
  onSave,
  onState,
}: {
  action: ProductAction;
  sections: ProductSection[];
  rows: TemplateRow[];
  busy: boolean;
  error: string;
  serverErrors: ProductFieldErrors;
  onClose: () => undefined;
  onSave: (input: ProductInput) => Promise<undefined>;
  onState: () => Promise<undefined>;
}): ReactElement {
  const ref = useRef<HTMLDialogElement>(null);
  const product = action.kind === 'create' ? null : action.product;
  const [values, setValues] = useState<ProductFormValues>(() =>
    productFormValues(product, action.kind === 'create' ? action.row : null),
  );
  // La fila la eligió el administrador (o vino de una fila pendiente): no se
  // reemplaza con la sugerencia.
  const [rowChosen, setRowChosen] = useState(
    action.kind !== 'create' || action.row !== null,
  );
  const [suggestionNote, setSuggestionNote] = useState('');
  const [clientErrors, setClientErrors] = useState<ProductFieldErrors>({});
  const errors: ProductFieldErrors = { ...serverErrors, ...clientErrors };
  const title =
    action.kind === 'create'
      ? 'Crear producto'
      : action.kind === 'edit'
        ? 'Editar producto'
        : action.product.isActive
          ? 'Desactivar producto'
          : 'Activar producto';

  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, []);
  useEffect(() => {
    if (Object.keys(serverErrors).length)
      ref.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [serverErrors]);

  // Sugerencia de la API para la fila (solo al crear y sin fila elegida).
  const name = values.name.trim();
  const alternatives = values.alternativeNames;
  useEffect(() => {
    if (action.kind !== 'create' || rowChosen || !values.section || !name)
      return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      loadSuggestion(
        {
          section: values.section,
          name,
          alternativeNames: alternatives
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)
            .slice(0, 10),
        },
        controller.signal,
      ).then(
        (suggestion) => {
          setValues((current) => ({
            ...current,
            templateRowId: suggestion.row?.id ?? '',
          }));
          setSuggestionNote(
            suggestion.reason === 'MATCH'
              ? `Sugerida: fila ${suggestion.row?.position ?? ''}, coincide con el nombre.`
              : suggestion.reason === 'EMPTY'
                ? `Sugerida: fila ${suggestion.row?.position ?? ''}, la primera <Vacío> libre.`
                : 'No quedan filas libres en la sección: corrige el texto de un artículo pendiente que ya no se usa o libera la fila de un producto desactivado.',
          );
        },
        () => undefined,
      );
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [action.kind, rowChosen, values.section, name, alternatives]);

  function set<K extends keyof ProductFormValues>(
    field: K,
    value: ProductFormValues[K],
  ): void {
    setValues((current) => ({ ...current, [field]: value }));
    setClientErrors((current) => ({ ...current, [field]: undefined }));
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<undefined> {
    event.preventDefault();
    if (busy) return;
    const result = productInputFromForm(
      values,
      action.kind === 'create' ? 'create' : 'edit',
    );
    if ('errors' in result) {
      setClientErrors(result.errors);
      window.setTimeout(
        () =>
          ref.current
            ?.querySelector<HTMLElement>('[aria-invalid="true"]')
            ?.focus(),
        0,
      );
      return;
    }
    setClientErrors({});
    await onSave(result.input);
  }

  const example = formatExample({
    unit: isUnit(values.unit) ? values.unit : 'KG',
    packageName: values.packageName || null,
    packageContent: values.looseOnly
      ? null
      : (parseDecimalInput(values.packageContent) ?? null),
    boxContent: values.looseOnly
      ? null
      : (parseDecimalInput(values.boxContent) ?? null),
    looseOnly: values.looseOnly,
  });
  const rowOptions = values.section
    ? freeRowOptions(rows, values.section, product?.templateRowId ?? null)
    : [];

  function field(
    fieldName: ProductField,
    label: string,
    input: ReactElement,
    help?: string,
  ): ReactElement {
    return (
      <div className="min-w-0">
        <label htmlFor={`product-${fieldName}`} className={labelClass}>
          {label}
        </label>
        <div className="mt-2">{input}</div>
        {help && (
          <p
            id={`product-${fieldName}-help`}
            className="mt-1 text-xs text-ink2"
          >
            {help}
          </p>
        )}
        {errors[fieldName] && (
          <p
            id={`product-${fieldName}-error`}
            className="mt-1 text-xs text-crit"
          >
            {errors[fieldName]}
          </p>
        )}
      </div>
    );
  }
  const describedBy = (fieldName: ProductField, help = false) =>
    [
      help ? `product-${fieldName}-help` : '',
      errors[fieldName] ? `product-${fieldName}-error` : '',
    ]
      .filter(Boolean)
      .join(' ') || undefined;

  return (
    <dialog
      ref={ref}
      aria-label={title}
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      className={dialogClass}
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-bold">{title}</h2>
        <button
          type="button"
          disabled={busy}
          onClick={onClose}
          className={buttonClass}
          aria-label="Cerrar ventana"
        >
          ×
        </button>
      </div>

      {action.kind === 'state' ? (
        <div className="mt-4 space-y-4 text-sm">
          <p>
            {action.product.isActive
              ? `«${action.product.name}» dejará de aparecer en las tomas nuevas. Se conserva en la plantilla y en las tomas finalizadas.`
              : `«${action.product.name}» volverá a aparecer en las tomas nuevas.`}
          </p>
          {error && (
            <p role="alert" className={alertClass}>
              {error}
            </p>
          )}
          <div className={dialogActionsClass}>
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              className={buttonClass}
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void onState()}
              className={
                action.product.isActive ? dangerButtonClass : primaryButtonClass
              }
            >
              {action.product.isActive ? 'Desactivar' : 'Activar'}
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="mt-4 space-y-4">
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            {field(
              'name',
              'Nombre',
              <input
                id="product-name"
                className={inputClass}
                value={values.name}
                maxLength={120}
                onChange={(event) => set('name', event.target.value)}
                aria-invalid={Boolean(errors.name)}
                aria-describedby={describedBy('name')}
              />,
            )}
            {field(
              'sku',
              'SKU del proveedor (opcional)',
              <input
                id="product-sku"
                className={inputClass}
                value={values.sku}
                maxLength={40}
                onChange={(event) => set('sku', event.target.value)}
                aria-invalid={Boolean(errors.sku)}
                aria-describedby={describedBy('sku')}
              />,
            )}
          </div>
          {field(
            'alternativeNames',
            'Nombres alternativos (separados por coma)',
            <input
              id="product-alternativeNames"
              className={inputClass}
              value={values.alternativeNames}
              placeholder="Beef Steak, Carne Queso"
              onChange={(event) => set('alternativeNames', event.target.value)}
              aria-invalid={Boolean(errors.alternativeNames)}
              aria-describedby={describedBy('alternativeNames')}
            />,
          )}
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            {field(
              'section',
              'Sección',
              <select
                id="product-section"
                className={inputClass}
                value={values.section}
                onChange={(event) => {
                  set('section', event.target.value);
                  set('templateRowId', '');
                  setRowChosen(false);
                  setSuggestionNote('');
                }}
                aria-invalid={Boolean(errors.section)}
                aria-describedby={describedBy('section')}
              >
                <option value="">Selecciona una sección</option>
                {sections.map((section) => (
                  <option key={section.name} value={section.name}>
                    {section.name}
                  </option>
                ))}
              </select>,
            )}
            {field(
              'templateRowId',
              'Fila de la plantilla',
              <select
                id="product-templateRowId"
                className={inputClass}
                value={values.templateRowId}
                disabled={!values.section}
                onChange={(event) => {
                  set('templateRowId', event.target.value);
                  setRowChosen(true);
                  setSuggestionNote('');
                }}
                aria-invalid={Boolean(errors.templateRowId)}
                aria-describedby={describedBy('templateRowId', true)}
              >
                <option value="">
                  {action.kind === 'create'
                    ? 'La que sugiera la API'
                    : 'Elige una fila'}
                </option>
                {rowOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>,
              suggestionNote ||
                'Solo filas de artículo sin producto. La posición de la fila no cambia.',
            )}
          </div>
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            {field(
              'unit',
              'Unidad de medida',
              <select
                id="product-unit"
                className={inputClass}
                value={values.unit}
                onChange={(event) => set('unit', event.target.value)}
                aria-invalid={Boolean(errors.unit)}
                aria-describedby={describedBy('unit')}
              >
                {PRODUCT_UNITS.map((unit) => (
                  <option key={unit} value={unit}>
                    {PRODUCT_UNIT_LABELS[unit]}
                  </option>
                ))}
              </select>,
            )}
            <label className="flex min-h-11 cursor-pointer items-center gap-3 self-end text-sm">
              <input
                type="checkbox"
                checked={values.looseOnly}
                onChange={(event) => set('looseOnly', event.target.checked)}
                className="h-5 w-5 shrink-0 accent-salmon-ink"
              />
              Solo cantidad suelta (sin cajas ni paquetes)
            </label>
          </div>
          {errors.looseOnly && (
            <p className="text-xs text-crit">{errors.looseOnly}</p>
          )}

          <fieldset
            disabled={values.looseOnly}
            className="grid min-w-0 gap-4 rounded-lg border border-line p-4 sm:grid-cols-2 disabled:opacity-60"
          >
            <legend className="px-1 text-xs font-semibold text-ink2">
              Formato de caja y paquete
            </legend>
            {field(
              'boxContent',
              'Contenido por caja',
              <input
                id="product-boxContent"
                className={inputClass}
                inputMode="decimal"
                value={values.boxContent}
                placeholder="7,3"
                onChange={(event) => set('boxContent', event.target.value)}
                aria-invalid={Boolean(errors.boxContent)}
                aria-describedby={describedBy('boxContent', true)}
              />,
              'Acepta decimales con coma (7,3).',
            )}
            {field(
              'packageName',
              'Nombre del paquete',
              <select
                id="product-packageName"
                className={inputClass}
                value={values.packageName}
                onChange={(event) => set('packageName', event.target.value)}
                aria-invalid={Boolean(errors.packageName)}
                aria-describedby={describedBy('packageName')}
              >
                <option value="">Sin paquete</option>
                {PACKAGE_NAMES.map((packageName) => (
                  <option key={packageName} value={packageName}>
                    {packageName}
                  </option>
                ))}
              </select>,
            )}
            {field(
              'packageContent',
              'Contenido por paquete',
              <input
                id="product-packageContent"
                className={inputClass}
                inputMode="decimal"
                value={values.packageContent}
                placeholder="0,93"
                onChange={(event) => set('packageContent', event.target.value)}
                aria-invalid={Boolean(errors.packageContent)}
                aria-describedby={describedBy('packageContent', true)}
              />,
              'Se guarda por separado de la caja.',
            )}
            {field(
              'packagesPerBox',
              'Paquetes por caja',
              <input
                id="product-packagesPerBox"
                className={inputClass}
                inputMode="numeric"
                value={values.packagesPerBox}
                placeholder="8"
                onChange={(event) => set('packagesPerBox', event.target.value)}
                aria-invalid={Boolean(errors.packagesPerBox)}
                aria-describedby={describedBy('packagesPerBox', true)}
              />,
              'Solo informativo: no se usa para calcular la caja.',
            )}
          </fieldset>
          <p role="status" className="text-sm text-ink2">
            {example
              ? `Ejemplo: ${example}`
              : 'Sin formato: completa los contenidos para ver un ejemplo.'}
          </p>

          {error && (
            <p role="alert" className={alertClass}>
              {error}
            </p>
          )}
          <div className={dialogActionsClass}>
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              className={buttonClass}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={busy}
              className={primaryButtonClass}
            >
              {busy ? 'Guardando…' : 'Guardar producto'}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
