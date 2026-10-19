// Controles y tipografía comunes; los colores proceden exclusivamente de globals.css.
export const inputClass =
  'min-h-11 w-full min-w-0 rounded-lg border border-line2 bg-bg px-3 py-2.5 text-sm leading-5 font-normal text-ink placeholder:text-muted outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-salmon-ink disabled:cursor-not-allowed disabled:opacity-60';

const buttonBaseClass =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm leading-5 font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-salmon-ink disabled:cursor-not-allowed disabled:opacity-50';

export const buttonClass = `${buttonBaseClass} border-line2 bg-bg text-salmon-ink hover:bg-tint`;
export const primaryButtonClass = `${buttonBaseClass} border-salmon bg-salmon text-ink hover:border-salmon-deep hover:bg-salmon-deep`;
export const dangerButtonClass = `${buttonBaseClass} border-crit bg-crit text-white hover:bg-crit/90`;
export const labelClass = 'block text-xs font-semibold text-ink2';
export const introClass = 'text-sm text-ink2';
export const filterPanelClass = 'rounded-[14px] border border-line bg-bg p-5';
export const panelTitleClass = 'text-sm font-bold';
export const tablePanelClass =
  'overflow-hidden rounded-[14px] border border-line bg-bg';
export const tableHeaderClass =
  'flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4';
export const tableDescriptionClass = 'mt-1 text-xs text-muted';
export const badgeClass =
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold';

export const tableClass = 'w-full border-collapse text-left text-[13px]';
export const tableHeadClass =
  'border-b border-line bg-tint font-mono text-[10px] font-semibold uppercase tracking-wider text-ink2';
export const tableHeadingClass = 'whitespace-nowrap px-4 py-3 font-semibold';
export const tableCellClass = 'px-4 py-4';

export const brandTitleClass = 'text-base font-extrabold tracking-tight';
export const brandCaptionClass =
  'font-mono text-[10px] uppercase tracking-[0.14em] text-ink2';
