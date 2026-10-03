import { Card, CardHeader } from '@/components/ui/Card';
import { Pill, PillVariant } from '@/components/ui/Pill';
import { DisabledAction } from '@/components/DisabledAction';

const CIERRES: Array<[string, string, string, string, string, string, PillVariant, string]> = [
  ['LOC-01 · Turno completo', 'R. FERNÁNDEZ · 22:41', '$198.400', '$246.900', '$67.000', '$0', 'ok', 'Cuadrada'],
  ['LOC-02 · Turno completo', 'G. MUÑOZ · 22:37', '$171.550', '$201.300', '$70.100', '−$4.250', 'crit', 'Faltante'],
  ['LOC-03 · Turno completo', 'L. ARAYA · 22:29', '$124.700', '$158.600', '$50.200', '$0', 'ok', 'Cuadrada'],
];

export default function VentasPage() {
  return (
    <>
      <div className="flex gap-2.5 mb-3.5 flex-wrap items-center">
        <button className="border border-line2 bg-bg rounded-lg px-3 py-2 text-[12.5px] font-semibold">
          03-sep-2026 ▾
        </button>
        <div className="ml-auto flex gap-2.5">
          <DisabledAction label="＋ Nuevo cierre de caja" sprint="Sprint 4" primary />
          <DisabledAction label="Importar desde POS" sprint="Sprint 4" />
        </div>
      </div>

      <div className="grid lg:grid-cols-[1.6fr_1fr] gap-3.5">
        <Card>
          <CardHeader
            title="Cierres de caja — miércoles 02-sep"
            subtitle="Con responsable, fecha y diferencia calculada"
            action={<Pill>3 de 3 cerrados</Pill>}
          />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  {['Local / Turno', 'Efectivo', 'Débito/Crédito', 'Apps delivery', 'Diferencia', 'Estado'].map((h) => (
                    <th key={h} className="text-left text-[11px] text-muted uppercase font-semibold px-2.5 py-2 border-b border-line">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {CIERRES.map(([local, resp, ef, deb, apps, dif, variant, estado]) => (
                  <tr key={local}>
                    <td className="px-2.5 py-2.5 border-b border-line">
                      <div className="font-semibold">{local}</div>
                      <div className="text-[11.5px] text-muted">RESP: {resp}</div>
                    </td>
                    <td className="px-2.5 py-2.5 border-b border-line font-mono text-right">{ef}</td>
                    <td className="px-2.5 py-2.5 border-b border-line font-mono text-right">{deb}</td>
                    <td className="px-2.5 py-2.5 border-b border-line font-mono text-right">{apps}</td>
                    <td className={`px-2.5 py-2.5 border-b border-line font-mono text-right ${dif !== '$0' ? 'text-crit font-bold' : ''}`}>{dif}</td>
                    <td className="px-2.5 py-2.5 border-b border-line"><Pill variant={variant}>{estado}</Pill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="h-px bg-line my-3.5" />
          <div className="flex gap-3 items-start bg-bg border border-line border-l-crit border-l-[3px] rounded-lg px-3.5 py-3">
            <div>
              <div className="text-[13px] font-semibold">Diferencia con observación obligatoria — LOC-02</div>
              <div className="font-mono text-[10.5px] text-muted mt-0.5">
                &quot;FALTANTE EN EFECTIVO, POSIBLE ERROR EN VUELTO&quot; · REGISTRADO POR G. MUÑOZ · REVISIÓN PENDIENTE
              </div>
            </div>
            <div className="ml-auto shrink-0">
              <DisabledAction label="Revisar" sprint="Sprint 4" />
            </div>
          </div>
        </Card>

        <Card className="self-start">
          <CardHeader title="Detalle del cierre — LOC-02" subtitle="02-sep · turno completo" />
          <table className="w-full text-sm">
            <tbody>
              {[
                ['Venta bruta POS', '$447.200', false],
                ['Descuentos', '−$3.500', false],
                ['Anulaciones (2)', '−$5.000', false],
                ['Venta neta', '$438.700', false],
                ['Efectivo esperado', '$175.800', false],
                ['Efectivo contado', '$171.550', false],
                ['Diferencia (faltante)', '−$4.250', true],
              ].map(([label, val, crit]) => (
                <tr key={label as string} className={crit ? 'bg-crit-bg' : ''}>
                  <td className={`px-2.5 py-2.5 border-b border-line ${crit ? 'text-crit font-semibold' : ''}`}>{label}</td>
                  <td className={`px-2.5 py-2.5 border-b border-line font-mono text-right ${crit ? 'text-crit font-bold' : ''}`}>{val}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="h-px bg-line my-3.5" />
          <div className="text-xs text-muted leading-relaxed">
            El módulo <b>no reemplaza el POS</b>: importa las ventas para evitar digitación. Los reportes
            alimentan el consumo teórico del módulo Inventario.
          </div>
        </Card>
      </div>
    </>
  );
}
