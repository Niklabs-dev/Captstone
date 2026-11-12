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
  computeBoxContent,
  formatExample,
  formatQuantity,
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
} from '@/lib/products';

export type ProductAction =
  { kind: 'create' } | { kind: 'edit' | 'state'; product: Product };

// Formulario de crear y editar, y confirmación de activar o desactivar
// (SPRINT-5-T04). Los errores de la API se muestran junto al campo y lo
// escrito se conserva.
export function ProductDialog({
  action,
  sections,
  busy,
  error,
  serverErrors,
  onClose,
  onSave,
  onState,
}: {
  action: ProductAction;
  sections: ProductSection[];
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
    productFormValues(product),
  );
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
    const result = productInputFromForm(values);
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

  const packagesPerBox = /^\d+$/.test(values.packagesPerBox.trim())
    ? Number(values.packagesPerBox.trim())
    : null;
  const packageContent = parseDecimalInput(values.packageContent) ?? null;
  const computed = values.looseOnly
    ? null
    : computeBoxContent(packagesPerBox, packageContent);
  const boxContent = computed ?? parseDecimalInput(values.boxContent) ?? null;
  const example = formatExample({
    unit: PRODUCT_UNITS.includes(values.unit as never)
      ? (values.unit as ProductInput['unit'])
      : 'KG',
    packageName: values.packageName.trim() || null,
    packageContent: values.looseOnly ? null : packageContent,
    boxContent: values.looseOnly ? null : boxContent,
    looseOnly: values.looseOnly,
  });

  function field(
    name: ProductField,
    label: string,
    input: ReactElement,
    help?: string,
  ): ReactElement {
    return (
      <div className="min-w-0">
        <label htmlFor={`product-${name}`} className={labelClass}>
          {label}
        </label>
        <div className="mt-1">{input}</div>
        {help && (
          <p id={`product-${name}-help`} className="mt-1 text-xs text-ink2">
            {help}
          </p>
        )}
        {errors[name] && (
          <p id={`product-${name}-error`} className="mt-1 text-xs text-crit">
            {errors[name]}
          </p>
        )}
      </div>
    );
  }
  const describedBy = (name: ProductField, help = false) =>
    [
      help ? `product-${name}-help` : '',
      errors[name] ? `product-${name}-error` : '',
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
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            {field(
              'section',
              'Sección',
              <select
                id="product-section"
                className={inputClass}
                value={values.section}
                onChange={(event) => set('section', event.target.value)}
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
          </div>

          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={values.looseOnly}
              onChange={(event) => set('looseOnly', event.target.checked)}
              className="h-5 w-5 shrink-0 accent-salmon-ink"
            />
            Solo cantidad en línea (sin cajas ni paquetes)
          </label>
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
              'packageName',
              'Nombre del paquete',
              <input
                id="product-packageName"
                className={inputClass}
                value={values.packageName}
                maxLength={30}
                placeholder="bolsa"
                onChange={(event) => set('packageName', event.target.value)}
                aria-invalid={Boolean(errors.packageName)}
                aria-describedby={describedBy('packageName')}
              />,
            )}
            {field(
              'packagesPerBox',
              'Paquetes por caja',
              <input
                id="product-packagesPerBox"
                className={inputClass}
                inputMode="numeric"
                value={values.packagesPerBox}
                placeholder="2"
                onChange={(event) => set('packagesPerBox', event.target.value)}
                aria-invalid={Boolean(errors.packagesPerBox)}
                aria-describedby={describedBy('packagesPerBox')}
              />,
            )}
            {field(
              'packageContent',
              'Contenido por paquete',
              <input
                id="product-packageContent"
                className={inputClass}
                inputMode="decimal"
                value={values.packageContent}
                placeholder="2,5"
                onChange={(event) => set('packageContent', event.target.value)}
                aria-invalid={Boolean(errors.packageContent)}
                aria-describedby={describedBy('packageContent', true)}
              />,
              'Acepta decimales con coma (2,5).',
            )}
            {field(
              'boxContent',
              'Contenido por caja',
              <input
                id="product-boxContent"
                className={inputClass}
                inputMode="decimal"
                value={
                  computed !== null
                    ? formatQuantity(computed).replace(/\./g, '')
                    : values.boxContent
                }
                readOnly={computed !== null}
                placeholder="5"
                onChange={(event) => set('boxContent', event.target.value)}
                aria-invalid={Boolean(errors.boxContent)}
                aria-describedby={describedBy('boxContent', true)}
              />,
              computed !== null
                ? 'Calculado: paquetes por caja × contenido por paquete.'
                : 'Si no informas paquetes, ingrésalo directamente.',
            )}
          </fieldset>
          <p role="status" className="text-sm text-ink2">
            {example
              ? `Ejemplo: ${example}`
              : 'Sin formato: completa los contenidos para ver un ejemplo.'}
          </p>

          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
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
            {field(
              'alternativeNames',
              'Otros nombres (separados por coma)',
              <input
                id="product-alternativeNames"
                className={inputClass}
                value={values.alternativeNames}
                onChange={(event) =>
                  set('alternativeNames', event.target.value)
                }
                aria-invalid={Boolean(errors.alternativeNames)}
                aria-describedby={describedBy('alternativeNames')}
              />,
            )}
          </div>

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
