import Link from 'next/link';
import type { ReactElement } from 'react';
import {
  buttonClass,
  tableCellClass,
  tableHeadClass,
  tableHeadingClass,
} from '@/components/ui/styles';
import { formatCalendarDate } from '@/lib/display-date';
import {
  cashDifferenceLabel,
  formatAmount,
  importDetailHref,
  reportOperationDetailHref,
  type ReportDay,
  type ReportStore,
  type SalesReport,
  type StoreReport,
} from '@/lib/sales-overview';
import {
  Amount,
  CashDifferencesTable,
  DifferenceBadge,
  EmptyState,
  rowClass,
  SalesByMethodTable,
  ScrollTable,
  StatusBadge,
  SummaryTiles,
  TablePanel,
  VoucherBadge,
} from './SalesOverviewParts';

// Reporte por rango y local (SPRINT-4R-T14): ventas del Excel vigente con
// medios dinámicos, propinas y diferencias de la operación diaria como
// conceptos separados. Sin conciliación Mercado Pago ni columnas fijas.
function Heading({ children }: { children: string }): ReactElement {
  return (
    <th scope="col" className={tableHeadingClass}>
      {children}
    </th>
  );
}
function RightHeading({ children }: { children: string }): ReactElement {
  return (
    <th scope="col" className={`${tableHeadingClass} text-right`}>
      {children}
    </th>
  );
}
const amountCell = `${tableCellClass} whitespace-nowrap text-right`;

function TipsTable({ stores }: { stores: StoreReport[] }): ReactElement {
  return (
    <ScrollTable caption="Propinas y diferencias de efectivo por local">
      <thead className={tableHeadClass}>
        <tr>
          <Heading>Local</Heading>
          <RightHeading>Operaciones</RightHeading>
          <RightHeading>Propina tarjeta</RightHeading>
          <RightHeading>Propina efectivo</RightHeading>
          <RightHeading>Sobrantes</RightHeading>
          <RightHeading>Faltantes</RightHeading>
          <Heading>Días sin importar</Heading>
        </tr>
      </thead>
      <tbody>
        {stores.map((item) => {
          const registered = item.tips.operationsCount > 0;
          return (
            <tr key={item.store.id} className={rowClass}>
              <th
                scope="row"
                className={`${tableCellClass} min-w-40 break-words font-medium`}
              >
                {item.store.name}
              </th>
              <td className={amountCell}>{item.tips.operationsCount}</td>
              <td className={amountCell}>
                <Amount value={registered ? item.tips.cardTipAmount : null} />
              </td>
              <td className={amountCell}>
                <Amount value={registered ? item.tips.cashTipAmount : null} />
              </td>
              <td className={amountCell}>
                {registered ? (
                  <Amount value={item.cashDifferences.surplusAmount} signed />
                ) : (
                  <Amount value={null} />
                )}
                <span className="block text-xs text-muted">
                  {item.cashDifferences.surplusCount} operaciones
                </span>
              </td>
              <td className={amountCell}>
                {registered ? (
                  <Amount value={item.cashDifferences.shortageAmount} signed />
                ) : (
                  <Amount value={null} />
                )}
                <span className="block text-xs text-muted">
                  {item.cashDifferences.shortageCount} operaciones
                </span>
              </td>
              <td className={`${tableCellClass} whitespace-nowrap`}>
                {item.importStatus.ATRASADO} atrasados ·{' '}
                {item.importStatus.PENDIENTE} pendientes
                <span className="block text-xs text-muted">
                  {item.importStatus.CERRADO} cerrados (no faltan)
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </ScrollTable>
  );
}

// SPRINT-4A-T23: el contador no abre la importación (vista previa y
// confirmación son del administrador); sí el detalle de la operación.
function DaySources({
  day,
  store,
  canOpenImports,
}: {
  day: ReportDay;
  store: ReportStore;
  canOpenImports: boolean;
}): ReactElement {
  const label = `${store.name} del ${formatCalendarDate(day.businessDate)}`;
  const importId = canOpenImports
    ? (day.sales?.importId ?? day.importStatus.pendingImportId ?? null)
    : null;
  if (!importId && !day.dailyOperation)
    return <span className="text-muted">Sin registros</span>;
  return (
    <div className="flex flex-wrap gap-2">
      {importId && (
        <Link
          href={importDetailHref(importId)}
          prefetch={false}
          className={buttonClass}
          aria-label={
            (day.sales
              ? 'Ver importación de ventas de '
              : 'Revisar vista previa sin confirmar de ') + label
          }
        >
          {day.sales ? 'Ver importación' : 'Revisar vista previa'}
        </Link>
      )}
      {day.dailyOperation && (
        <Link
          href={reportOperationDetailHref(day.dailyOperation.operationId)}
          prefetch={false}
          className={buttonClass}
          aria-label={'Ver operación diaria de ' + label}
        >
          Ver operación diaria
        </Link>
      )}
    </div>
  );
}

function DaysTable({
  stores,
  canOpenImports,
}: {
  stores: StoreReport[];
  canOpenImports: boolean;
}): ReactElement {
  const rows = stores
    .flatMap((item) => item.days.map((day) => ({ store: item.store, day })))
    .sort(
      (a, b) =>
        b.day.businessDate.localeCompare(a.day.businessDate) ||
        a.store.name.localeCompare(b.store.name, 'es'),
    );
  if (rows.length === 0)
    return <EmptyState>No hay días informados en el período.</EmptyState>;
  return (
    <ScrollTable caption="Detalle por día y local">
      <thead className={tableHeadClass}>
        <tr>
          <Heading>Fecha</Heading>
          <Heading>Local</Heading>
          <Heading>Importación</Heading>
          <RightHeading>Ventas (Excel)</RightHeading>
          <RightHeading>Propina tarjeta</RightHeading>
          <RightHeading>Propina efectivo</RightHeading>
          <Heading>Diferencia de efectivo</Heading>
          <Heading>Voucher</Heading>
          <Heading>Fuentes</Heading>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ store, day }) => {
          const difference = day.dailyOperation?.cashDifference;
          return (
            <tr
              key={store.id + day.businessDate}
              className={`${rowClass} align-top`}
            >
              <td className={`${tableCellClass} whitespace-nowrap font-mono`}>
                {formatCalendarDate(day.businessDate)}
              </td>
              <th
                scope="row"
                className={`${tableCellClass} min-w-36 break-words font-medium`}
              >
                {store.name}
              </th>
              <td className={tableCellClass}>
                <StatusBadge status={day.importStatus.status} />
                {day.importStatus.closure && (
                  <span className="mt-1 block text-xs break-words text-ink2">
                    Motivo: {day.importStatus.closure.reason}
                  </span>
                )}
              </td>
              <td className={`${amountCell} font-semibold`}>
                <Amount value={day.sales?.totalAmount ?? null} />
              </td>
              <td className={amountCell}>
                <Amount value={day.dailyOperation?.cardTipAmount ?? null} />
              </td>
              <td className={amountCell}>
                <Amount value={day.dailyOperation?.cashTipAmount ?? null} />
              </td>
              <td className={`${tableCellClass} min-w-44`}>
                {difference ? (
                  <>
                    {/* SPRINT-4A-T11: sobrantes y faltantes se resaltan. */}
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">
                        <Amount value={difference.amount} signed />
                      </span>
                      {difference.type === 'SIN_DIFERENCIA' ? (
                        <span className="text-ink2">
                          {cashDifferenceLabel(difference.type)}
                        </span>
                      ) : (
                        <DifferenceBadge type={difference.type} />
                      )}
                    </span>
                    {difference.reason && (
                      <span className="mt-1 block text-xs break-words text-ink2">
                        Motivo: {difference.reason}
                      </span>
                    )}
                  </>
                ) : (
                  <Amount value={null} />
                )}
              </td>
              <td className={`${tableCellClass} whitespace-nowrap`}>
                {day.dailyOperation ? (
                  <VoucherBadge figures={day.dailyOperation} />
                ) : (
                  <Amount value={null} />
                )}
              </td>
              <td className={`${tableCellClass} min-w-48`}>
                <DaySources
                  day={day}
                  store={store}
                  canOpenImports={canOpenImports}
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </ScrollTable>
  );
}

export function SalesReportView({
  report,
  scope,
  canOpenImports,
}: {
  report: SalesReport;
  scope: string;
  canOpenImports: boolean;
}): ReactElement {
  const { totals } = report;
  const period = `${formatCalendarDate(report.from)} al ${formatCalendarDate(report.to)}`;
  const registered = totals.tips.operationsCount > 0;
  const hasStores = report.stores.length > 0;
  return (
    <>
      <section aria-labelledby="report-summary-title" className="space-y-3">
        <h2 id="report-summary-title" className="text-base font-bold">
          Totales del {period} · {scope}
        </h2>
        <SummaryTiles
          items={[
            {
              label: 'Ventas importadas',
              value: formatAmount(
                totals.sales.importedDays > 0 ? totals.sales.totalAmount : null,
              ),
              detail: `${totals.sales.importedDays} días con Excel vigente`,
            },
            {
              label: 'Días sin importar',
              value: `${totals.importStatus.ATRASADO} atrasados`,
              detail: `${totals.importStatus.PENDIENTE} pendientes hoy · ${totals.importStatus.CERRADO} cerrados (no faltan)`,
            },
            {
              label: 'Propinas con tarjeta',
              value: formatAmount(
                registered ? totals.tips.cardTipAmount : null,
              ),
              detail: 'Operación diaria; no se suman a las ventas',
            },
            {
              label: 'Propinas en efectivo',
              value: formatAmount(
                registered ? totals.tips.cashTipAmount : null,
              ),
              detail: `${totals.tips.operationsCount} operaciones registradas`,
            },
            {
              label: 'Fondo de propinas',
              value: formatAmount(
                registered ? totals.tips.tipFundAmount : null,
              ),
              detail: 'Tarjeta más efectivo',
            },
            {
              label: 'Sobrantes',
              value: registered ? (
                <Amount value={totals.cashDifferences.surplusAmount} signed />
              ) : (
                <Amount value={null} />
              ),
              detail: `${totals.cashDifferences.surplusCount} operaciones`,
            },
            {
              label: 'Faltantes',
              value: registered ? (
                <Amount value={totals.cashDifferences.shortageAmount} signed />
              ) : (
                <Amount value={null} />
              ),
              detail: `${totals.cashDifferences.shortageCount} operaciones`,
            },
            {
              label: 'Diferencias declaradas',
              value: `${totals.cashDifferences.count} operaciones`,
              detail: 'Sobrantes y faltantes se informan sin compensar',
            },
          ]}
        />
      </section>

      <TablePanel
        id="report-methods-title"
        title="Ventas por medio de pago"
        description="Solo del Excel de MrComanda vigente. Las columnas salen del catálogo; «Sin dato» indica que no hubo Excel vigente en el período."
      >
        {hasStores ? (
          <SalesByMethodTable
            caption={`Ventas por medio de pago del ${period}`}
            firstHeading="Local"
            columns={report.paymentMethods}
            rows={report.stores.map((item) => ({
              key: item.store.id,
              label: item.store.name,
              sales: item.sales.importedDays > 0 ? item.sales : null,
              detail: `${item.sales.importedDays} días importados${item.store.isActive ? '' : ' · Inactivo'}`,
            }))}
            total={{
              key: 'total',
              label: 'Total del período',
              sales: totals.sales.importedDays > 0 ? totals.sales : null,
              detail: `${totals.sales.importedDays} días importados`,
            }}
          />
        ) : (
          <EmptyState>No hay locales con datos en el período.</EmptyState>
        )}
      </TablePanel>

      <TablePanel
        id="report-tips-title"
        title="Propinas y diferencias por local"
        description="Declaradas en la operación diaria de cada supervisor; son conceptos separados de las ventas."
      >
        {hasStores ? (
          <TipsTable stores={report.stores} />
        ) : (
          <EmptyState>No hay locales con datos en el período.</EmptyState>
        )}
      </TablePanel>

      <TablePanel
        id="report-days-title"
        title="Detalle por día"
        description="Estado de la importación, ventas y operación diaria de cada día informado, con indicador de voucher y enlace a cada fuente. La foto del voucher y las ventas del día por medio de pago se contrastan en el detalle de la operación."
      >
        <DaysTable stores={report.stores} canOpenImports={canOpenImports} />
      </TablePanel>

      <TablePanel
        id="report-differences-title"
        title="Diferencias de efectivo"
        description="Cada diferencia distinta de cero con signo y motivo."
      >
        <CashDifferencesTable
          lines={report.cashDifferences}
          caption={`Diferencias de efectivo del ${period}`}
          operationHref={reportOperationDetailHref}
          emptyText="No hay diferencias de efectivo declaradas en el período."
        />
      </TablePanel>
    </>
  );
}
