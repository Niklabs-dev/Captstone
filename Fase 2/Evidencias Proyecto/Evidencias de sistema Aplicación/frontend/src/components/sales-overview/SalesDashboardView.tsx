import Link from 'next/link';
import type { ReactElement, ReactNode } from 'react';
import {
  alertClass,
  badgeClass,
  buttonClass,
  infoNoticeClass,
  tableCellClass,
  tableHeadClass,
  tableHeadingClass,
} from '@/components/ui/styles';
import type { BackendResult } from '@/lib/auth-backend';
import { formatCalendarDate } from '@/lib/display-date';
import {
  cashDifferenceLabel,
  formatAmount,
  importDetailHref,
  missingSalesDays,
  operationDetailHref,
  type AlertCounts,
  type SalesDashboard,
  type SalesDays,
  type StoreDashboard,
} from '@/lib/sales-overview';
import {
  Amount,
  CashDifferencesTable,
  EmptyState,
  rowClass,
  ScrollTable,
  SalesByMethodTable,
  StatusBadge,
  SummaryTiles,
  TablePanel,
} from './SalesOverviewParts';

// Panel consolidado del día por local (SPRINT-4R-T14). Cada concepto
// conserva su fuente: ventas del Excel vigente, propinas y diferencia de la
// operación diaria del supervisor y alertas legales vigentes hoy.
const inlineLinkClass =
  'font-semibold text-salmon-ink underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-salmon-ink';

function alertsText(counts: AlertCounts): string {
  if (counts.overdue === 0 && counts.upcoming === 0) return 'Sin alertas';
  return `${counts.overdue} vencidas · ${counts.upcoming} por vencer`;
}

function ImportCell({ item }: { item: StoreDashboard }): ReactElement {
  const { importStatus } = item;
  return (
    <div className="space-y-1">
      <StatusBadge status={importStatus.status} />
      {importStatus.closure && (
        <p className="text-xs break-words text-ink2">
          Motivo: {importStatus.closure.reason}
        </p>
      )}
      {importStatus.pendingImportId && !item.sales && (
        <p className="text-xs text-warn">Vista previa sin confirmar</p>
      )}
    </div>
  );
}
function DifferenceCell({ item }: { item: StoreDashboard }): ReactElement {
  if (!item.dailyOperation) return <Amount value={null} />;
  const difference = item.dailyOperation.cashDifference;
  return (
    <div className="space-y-1">
      <p className="font-semibold">
        <Amount value={difference.amount} signed />{' '}
        <span className="font-normal text-ink2">
          · {cashDifferenceLabel(difference.type)}
        </span>
      </p>
      {difference.reason && (
        <p className="text-xs break-words text-ink2">
          Motivo: {difference.reason}
        </p>
      )}
    </div>
  );
}
// Enlaces a cada fuente por separado: el Excel importado y la operación.
function SourceLinks({ item }: { item: StoreDashboard }): ReactElement {
  const links: ReactNode[] = [];
  const name = item.store.name;
  if (item.sales)
    links.push(
      <Link
        key="import"
        href={importDetailHref(item.sales.importId)}
        prefetch={false}
        className={buttonClass}
        aria-label={`Ver importación de ventas de ${name}`}
      >
        Ver importación
      </Link>,
    );
  else if (item.importStatus.pendingImportId)
    links.push(
      <Link
        key="pending"
        href={importDetailHref(item.importStatus.pendingImportId)}
        prefetch={false}
        className={buttonClass}
        aria-label={`Revisar vista previa sin confirmar de ${name}`}
      >
        Revisar vista previa
      </Link>,
    );
  else if (
    item.importStatus.status === 'ATRASADO' ||
    item.importStatus.status === 'PENDIENTE'
  )
    links.push(
      <Link
        key="upload"
        href="/admin/importacion-ventas"
        prefetch={false}
        className={buttonClass}
        aria-label={`Importar ventas de ${name}`}
      >
        Importar ventas
      </Link>,
    );
  if (item.dailyOperation)
    links.push(
      <Link
        key="operation"
        href={operationDetailHref(item.dailyOperation.operationId)}
        prefetch={false}
        className={buttonClass}
        aria-label={`Ver operación diaria de ${name}`}
      >
        Ver operación diaria
      </Link>,
    );
  return links.length ? (
    <div className="flex flex-wrap gap-2">{links}</div>
  ) : (
    <span className="text-muted">Sin registros</span>
  );
}

function StoreCards({ stores }: { stores: StoreDashboard[] }): ReactElement {
  return (
    <ul className="divide-y divide-line lg:hidden">
      {stores.map((item) => (
        <li key={item.store.id}>
          <article
            aria-label={item.store.name}
            className="space-y-4 p-4 text-sm"
          >
            <header className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="font-semibold break-words">{item.store.name}</h3>
                <p className="text-xs text-muted">
                  {item.store.city}
                  {item.store.isActive ? '' : ' · Inactivo'}
                </p>
              </div>
              <ImportCell item={item} />
            </header>
            <dl className="grid grid-cols-2 gap-3">
              <div>
                <dt className="text-xs text-ink2">Ventas (Excel)</dt>
                <dd className="mt-1 font-semibold">
                  <Amount value={item.sales?.totalAmount ?? null} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ink2">Propina con tarjeta</dt>
                <dd className="mt-1">
                  <Amount value={item.dailyOperation?.cardTipAmount ?? null} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ink2">Propina en efectivo</dt>
                <dd className="mt-1">
                  <Amount value={item.dailyOperation?.cashTipAmount ?? null} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ink2">Diferencia de efectivo</dt>
                <dd className="mt-1">
                  <DifferenceCell item={item} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ink2">Alertas DT</dt>
                <dd className="mt-1">
                  {alertsText(item.alerts.dtRegistration)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ink2">Alertas de propinas</dt>
                <dd className="mt-1">{alertsText(item.alerts.tipPayment)}</dd>
              </div>
            </dl>
            <SourceLinks item={item} />
          </article>
        </li>
      ))}
    </ul>
  );
}

function StoreTable({ stores }: { stores: StoreDashboard[] }): ReactElement {
  return (
    <div className="hidden lg:block">
      <ScrollTable caption="Resumen del día por local">
        <thead className={tableHeadClass}>
          <tr>
            {[
              'Local',
              'Importación',
              'Ventas (Excel)',
              'Propina tarjeta',
              'Propina efectivo',
              'Diferencia de efectivo',
              'Alertas legales',
              'Fuentes',
            ].map((heading) => (
              <th key={heading} scope="col" className={tableHeadingClass}>
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {stores.map((item) => (
            <tr key={item.store.id} className={`${rowClass} align-top`}>
              <th
                scope="row"
                className={`${tableCellClass} min-w-36 break-words font-medium`}
              >
                {item.store.name}
                <span className="mt-1 block text-xs font-normal text-muted">
                  {item.store.city}
                  {item.store.isActive ? '' : ' · Inactivo'}
                </span>
              </th>
              <td className={tableCellClass}>
                <ImportCell item={item} />
              </td>
              <td
                className={`${tableCellClass} whitespace-nowrap font-semibold`}
              >
                <Amount value={item.sales?.totalAmount ?? null} />
              </td>
              <td className={`${tableCellClass} whitespace-nowrap`}>
                <Amount value={item.dailyOperation?.cardTipAmount ?? null} />
              </td>
              <td className={`${tableCellClass} whitespace-nowrap`}>
                <Amount value={item.dailyOperation?.cashTipAmount ?? null} />
              </td>
              <td className={`${tableCellClass} min-w-44`}>
                <DifferenceCell item={item} />
              </td>
              <td className={`${tableCellClass} whitespace-nowrap`}>
                DT: {alertsText(item.alerts.dtRegistration)}
                <span className="mt-1 block">
                  Propinas: {alertsText(item.alerts.tipPayment)}
                </span>
              </td>
              <td className={`${tableCellClass} min-w-48`}>
                <SourceLinks item={item} />
              </td>
            </tr>
          ))}
        </tbody>
      </ScrollTable>
    </div>
  );
}

function MissingSales({
  result,
}: {
  result: BackendResult<SalesDays>;
}): ReactElement {
  if (!result.ok)
    return (
      <TablePanel id="missing-sales-title" title="Ventas sin importar">
        <p role="alert" className={`${alertClass} m-5`}>
          No se pudo consultar el estado de importación de los últimos días.{' '}
          {result.message}
        </p>
      </TablePanel>
    );
  const missing = missingSalesDays(result.data.items);
  const { summary } = result.data;
  return (
    <TablePanel
      id="missing-sales-title"
      title="Ventas sin importar"
      description={`Del ${formatCalendarDate(result.data.from)} al ${formatCalendarDate(result.data.to)}. Los días cerrados (${summary.CERRADO}) no se cuentan como faltantes.`}
      aside={
        <div className="flex flex-wrap gap-2">
          <span className={`${badgeClass} bg-crit-bg text-crit`}>
            {summary.ATRASADO} atrasados
          </span>
          <span className={`${badgeClass} bg-info-bg text-info`}>
            {summary.PENDIENTE} pendientes hoy
          </span>
        </div>
      }
    >
      {missing.length === 0 ? (
        <EmptyState>
          No hay ventas pendientes ni atrasadas en los últimos 30 días.
        </EmptyState>
      ) : (
        <ScrollTable caption="Días sin ventas importadas">
          <thead className={tableHeadClass}>
            <tr>
              <th scope="col" className={tableHeadingClass}>
                Local
              </th>
              <th scope="col" className={tableHeadingClass}>
                Fecha
              </th>
              <th scope="col" className={tableHeadingClass}>
                Estado
              </th>
              <th scope="col" className={tableHeadingClass}>
                Qué hacer
              </th>
            </tr>
          </thead>
          <tbody>
            {missing.map((item) => (
              <tr
                key={item.store.id + item.businessDate}
                className={`${rowClass} align-top`}
              >
                <th
                  scope="row"
                  className={`${tableCellClass} min-w-36 break-words font-medium`}
                >
                  {item.store.name}
                </th>
                <td className={`${tableCellClass} whitespace-nowrap font-mono`}>
                  {formatCalendarDate(item.businessDate)}
                </td>
                <td className={tableCellClass}>
                  <StatusBadge status={item.status} />
                </td>
                <td className={`${tableCellClass} min-w-56 space-y-2`}>
                  <p className="text-ink2">
                    {item.status === 'ATRASADO'
                      ? 'Día abierto sin Excel importado. Al importarlo, la alerta se resuelve sola.'
                      : 'El Excel de hoy suele llegar al día siguiente.'}
                  </p>
                  <Link
                    href={
                      item.pendingImportId
                        ? importDetailHref(item.pendingImportId)
                        : '/admin/importacion-ventas'
                    }
                    prefetch={false}
                    className={buttonClass}
                    aria-label={
                      (item.pendingImportId
                        ? 'Revisar vista previa sin confirmar de '
                        : 'Importar ventas de ') +
                      `${item.store.name} del ${formatCalendarDate(item.businessDate)}`
                    }
                  >
                    {item.pendingImportId
                      ? 'Revisar vista previa'
                      : 'Importar ventas'}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </ScrollTable>
      )}
    </TablePanel>
  );
}

export function SalesDashboardView({
  dashboard,
  salesDays,
}: {
  dashboard: SalesDashboard;
  salesDays: BackendResult<SalesDays>;
}): ReactElement {
  const { totals } = dashboard;
  const day = formatCalendarDate(dashboard.businessDate);
  const hasOperations = totals.tips.operationsCount > 0;
  const alertsDate = formatCalendarDate(dashboard.alertsAsOf);
  return (
    <>
      <section aria-labelledby="dashboard-summary-title" className="space-y-3">
        <h2 id="dashboard-summary-title" className="text-base font-bold">
          Resumen del {day}
        </h2>
        <SummaryTiles
          items={[
            {
              label: 'Ventas importadas',
              value: formatAmount(
                totals.sales.importedDays > 0 ? totals.sales.totalAmount : null,
              ),
              detail: `${totals.sales.importedDays} locales con Excel vigente · ${totals.storesWithoutImport} sin importar`,
            },
            {
              label: 'Propinas con tarjeta',
              value: formatAmount(
                hasOperations ? totals.tips.cardTipAmount : null,
              ),
              detail: 'Operación diaria; no se suman a las ventas',
            },
            {
              label: 'Propinas en efectivo',
              value: formatAmount(
                hasOperations ? totals.tips.cashTipAmount : null,
              ),
              detail: `${totals.tips.operationsCount} operaciones registradas`,
            },
            {
              label: 'Sin operación diaria',
              value: `${totals.storesWithoutDailyOperation} locales`,
              detail: 'Locales que debían operar y no registraron el día',
            },
            {
              label: 'Sobrantes',
              value: hasOperations ? (
                <Amount value={totals.cashDifferences.surplusAmount} signed />
              ) : (
                <Amount value={null} />
              ),
              detail: `${totals.cashDifferences.surplusCount} operaciones`,
            },
            {
              label: 'Faltantes',
              value: hasOperations ? (
                <Amount value={totals.cashDifferences.shortageAmount} signed />
              ) : (
                <Amount value={null} />
              ),
              detail: `${totals.cashDifferences.shortageCount} operaciones`,
            },
            {
              label: 'Alertas DT',
              value: `${totals.dtRegistrationAlerts.overdue} vencidas`,
              detail: `${totals.dtRegistrationAlerts.upcoming} por vencer · vigentes al ${alertsDate}`,
            },
            {
              label: 'Alertas de propinas',
              value: `${totals.tipPaymentAlerts.overdue} vencidas`,
              detail: `${totals.tipPaymentAlerts.upcoming} por vencer · vigentes al ${alertsDate}`,
            },
          ]}
        />
        {dashboard.businessDate !== dashboard.alertsAsOf && (
          <p role="note" className={infoNoticeClass}>
            Las alertas legales son las vigentes hoy ({alertsDate}), no las del{' '}
            {day}. Revísalas en{' '}
            <Link
              href="/admin/alertas-dt"
              prefetch={false}
              className={inlineLinkClass}
            >
              Alertas DT
            </Link>{' '}
            y{' '}
            <Link
              href="/propinas/repartos"
              prefetch={false}
              className={inlineLinkClass}
            >
              Reparto de propinas
            </Link>
            .
          </p>
        )}
      </section>

      <MissingSales result={salesDays} />

      <TablePanel
        id="dashboard-stores-title"
        title="Resumen por local"
        description="Ventas del Excel vigente, propinas y diferencia de la operación diaria y alertas legales, cada una desde su fuente."
        aside={
          <span className={`${badgeClass} bg-tint2 text-salmon-ink`}>
            {dashboard.stores.length} locales
          </span>
        }
      >
        {dashboard.stores.length === 0 ? (
          <EmptyState>No hay locales activos para mostrar.</EmptyState>
        ) : (
          <>
            <StoreCards stores={dashboard.stores} />
            <StoreTable stores={dashboard.stores} />
          </>
        )}
      </TablePanel>

      <TablePanel
        id="dashboard-methods-title"
        title="Ventas por medio de pago"
        description="Columnas del catálogo de medios de pago. «Sin dato» indica que el local no tiene Excel vigente ese día."
      >
        {dashboard.stores.length === 0 ? (
          <EmptyState>No hay locales para mostrar.</EmptyState>
        ) : (
          <SalesByMethodTable
            caption={`Ventas por medio de pago del ${day}`}
            firstHeading="Local"
            columns={dashboard.paymentMethods}
            rows={dashboard.stores.map((item) => ({
              key: item.store.id,
              label: item.store.name,
              sales: item.sales,
              detail: item.sales ? `Versión ${item.sales.version}` : undefined,
            }))}
            total={{
              key: 'total',
              label: 'Total del día',
              sales: totals.sales.importedDays > 0 ? totals.sales : null,
              detail: `${totals.sales.importedDays} locales con Excel vigente`,
            }}
          />
        )}
      </TablePanel>

      <TablePanel
        id="dashboard-differences-title"
        title="Diferencias de efectivo"
        description="Declaradas en la operación diaria, con signo y motivo. Sobrantes y faltantes no se compensan."
      >
        <CashDifferencesTable
          lines={dashboard.cashDifferences}
          caption={`Diferencias de efectivo del ${day}`}
          emptyText={
            hasOperations
              ? 'Ninguna operación del día declaró diferencia de efectivo.'
              : 'Sin operaciones diarias registradas para este día.'
          }
        />
      </TablePanel>
    </>
  );
}
