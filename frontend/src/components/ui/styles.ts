// Controles y tipografía comunes; los colores proceden exclusivamente de globals.css.
export const inputClass =
  'min-h-11 w-full min-w-0 max-w-full rounded-lg border border-line2 bg-bg px-3 py-2.5 text-base leading-5 font-normal text-ink placeholder:text-muted outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-salmon-ink disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm';

const buttonBaseClass =
  'inline-flex min-h-11 min-w-11 max-w-full items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-center text-sm leading-5 font-semibold wrap-anywhere transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

export const buttonClass = `${buttonBaseClass} border-line2 bg-bg text-salmon-ink hover:bg-tint focus-visible:outline-salmon-ink`;
export const primaryButtonClass = `${buttonBaseClass} border-salmon bg-salmon text-ink hover:border-salmon-deep hover:bg-salmon-deep focus-visible:outline-salmon-ink`;
export const dangerButtonClass = `${buttonBaseClass} border-crit bg-crit text-white hover:bg-crit/90 focus-visible:outline-salmon-ink`;
export const labelClass = 'block min-w-0 text-xs font-semibold text-ink2';
export const introClass = 'text-sm text-ink2';
export const filterPanelClass = 'rounded-[14px] border border-line bg-bg p-5';
export const panelTitleClass = 'text-sm font-bold';
export const tablePanelClass =
  'min-w-0 overflow-hidden rounded-[14px] border border-line bg-bg';
export const tableHeaderClass =
  'flex flex-col items-start justify-between gap-3 border-b border-line px-4 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:px-5';
export const tableDescriptionClass = 'mt-1 text-xs text-muted';
export const badgeClass =
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold';

// Enlace dentro de un párrafo (panel de ventas, propinas).
export const inlineLinkClass =
  'font-semibold text-salmon-ink underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-salmon-ink';

export const alertClass =
  'rounded-lg border border-crit/20 bg-crit-bg px-3.5 py-3 text-sm text-crit';
export const infoNoticeClass =
  'rounded-xl border border-line2 bg-tint2 p-4 text-sm text-ink2';
export const scrollRegionClass =
  'overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-salmon-ink';

export const tableClass = 'w-full border-collapse text-left text-[13px]';
export const tableHeadClass =
  'border-b border-line bg-tint font-mono text-[10px] font-semibold uppercase tracking-wider text-ink2';
export const tableHeadingClass = 'whitespace-nowrap px-4 py-3 font-semibold';
export const tableCellClass = 'px-4 py-4';

export const dialogClass =
  'fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] min-w-0 max-w-lg overflow-y-auto overscroll-contain rounded-2xl border border-line bg-bg p-4 text-ink wrap-anywhere shadow-xl backdrop:bg-ink/35 sm:p-6';
export const dialogActionsClass =
  'flex flex-col gap-3 pt-2 sm:flex-row sm:flex-wrap sm:justify-end';

export const brandTitleClass = 'text-base font-extrabold tracking-tight';
export const brandCaptionClass =
  'font-mono text-[10px] uppercase tracking-[0.14em] text-ink2';

// Composición móvil compartida: navegación al pulgar y módulos de inicio.
export const mobileDockItemClass =
  'flex min-h-14 min-w-11 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-[11px] leading-4 font-semibold outline-offset-2 focus-visible:outline-2 focus-visible:outline-salmon-ink';
export const mobileModuleClass =
  'flex min-h-24 min-w-0 flex-col items-start justify-center gap-3 rounded-[14px] p-4 text-sm font-semibold wrap-anywhere outline-offset-2 focus-visible:outline-2 focus-visible:outline-salmon-ink hover:bg-tint2';
export const homeModuleClass =
  'group flex min-h-20 min-w-0 flex-col items-center gap-2 px-2 py-2 text-center text-xs font-semibold text-ink2 outline-offset-2 focus-visible:outline-2 focus-visible:outline-salmon-ink sm:text-sm';

export const featuredModuleClass =
  'block rounded-2xl bg-salmon p-5 text-ink outline-offset-4 hover:bg-salmon-deep focus-visible:outline-2 focus-visible:outline-ink sm:p-6';
