import { Card, CardHeader } from '@/components/ui/Card';
import { Pill, PillVariant } from '@/components/ui/Pill';
import { DisabledAction } from '@/components/DisabledAction';

const REPARTO: Array<[string, string, number, string, string, string, PillVariant, string]> = [
  ['Camila Rojas', 'LOC-01', 38, '$28.400', '$46.900', '$75.300', 'ok', 'Entregada'],
  ['María Contreras', 'LOC-01', 45, '$33.600', '$55.500', '$89.100', 'ok', 'Entregada'],
  ['José Paredes', 'LOC-02', 30, '$22.400', '$37.000', '$59.400', 'warn', 'Pendiente'],
  ['Valentina Soto', 'LOC-02', 36, '$26.900', '$44.400', '$71.300', 'ok', 'Entregada'],
  ['Diego Fuentes', 'LOC-03', 42, '$31.400', '$51.800', '$83.200', 'ok', 'Entregada'],
];

const REGISTRO_DIARIO = [
  ['03-sep', 'LOC-01', '$14.800', '$21.300', '$6.900'],
  ['03-sep', 'LOC-02', '$9.600', '$15.450', '$5.200'],
  ['03-sep', 'LOC-03', '$6.800', '$11.400', '$3.400'],
  ['02-sep', 'LOC-01', '$13.100', '$19.800', '$7.100'],
];

export default function PropinasPage() {
  return (
    <>
      <div className="flex gap-2.5 mb-3.5 flex-wrap items-center">
        <button className="border border-line2 bg-bg rounded-lg px-3 py-2 text-[12.5px] font-semibold">
          Semana 36 (31-ago → 06-sep) ▾
        </button>
        <div className="ml-auto flex gap-2.5">
          <DisabledAction label="＋ Registrar propinas del día" sprint="Sprint 3" primary />
          <DisabledAction label="Enterar y generar constancias" sprint="Sprint 3" />
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-3.5 mb-3.5">
        <Card>
          <CardHeader title="Reloj legal — art. 64 CT" subtitle="Propinas tarjeta · semana 35" />
          <div className="flex items-center gap-4">
            <svg viewBox="0 0 100 100" className="w-[86px] h-[86px] shrink-0">
              <circle cx="50" cy="50" r="42" fill="none" strokeWidth={9} className="stroke-tint2" />
              <circle
                cx="50" cy="50" r="42" fill="none" strokeWidth={9}
                className="stroke-salmon-deep [stroke-linecap:round]"
                style={{ transform: 'rotate(-90deg)', transformOrigin: 'center' }}
                strokeDasharray="263.9" strokeDashoffset="150.8"
              />
              <text x="50" y="46" textAnchor="middle" fontSize="19" className="fill-ink font-bold font-mono">3</text>
              <text x="50" y="62" textAnchor="middle" fontSize="8.5" className="fill-ink font-bold font-mono">DÍAS HÁB.</text>
            </svg>
            <div>
              <div className="font-bold text-sm">Quedan 3 de 7 días hábiles</div>
              <div className="text-xs text-muted mt-1 leading-relaxed">
                Vencimiento: <b>09-sep</b><br />Monto por enterar: <span className="font-mono font-semibold">$186.400</span>
              </div>
            </div>
          </div>
        </Card>
        <Card>
          <div className="font-mono text-[9.5px] tracking-widest uppercase text-muted">Propinas hoy · consolidado</div>
          <div className="font-mono text-[26px] font-bold my-1.5">$94.850</div>
          <div className="text-xs text-ink2">Efectivo <b>$31.200</b> · Tarjeta <b>$48.150</b> · Apps <b>$15.500</b></div>
        </Card>
        <Card className="border-l-[3px] border-l-ok">
          <div className="font-mono text-[9.5px] tracking-widest uppercase text-muted">Enteradas semana 35</div>
          <div className="font-mono text-[26px] font-bold my-1.5">$412.700</div>
          <div className="text-xs text-ink2"><b>18 constancias</b> generadas y archivadas</div>
        </Card>
      </div>

      <div className="grid lg:grid-cols-[1.6fr_1fr] gap-3.5">
        <Card>
          <CardHeader
            title="Reparto calculado — semana 35"
            subtitle="Criterio: horas trabajadas · según pacto firmado"
            action={<Pill variant="ok">Validado por contador</Pill>}
          />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  {['Trabajador', 'Local', 'Horas', 'Efectivo', 'Tarjeta + apps', 'Total', 'Constancia'].map((h) => (
                    <th key={h} className="text-left text-[11px] text-muted uppercase font-semibold px-2.5 py-2 border-b border-line">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {REPARTO.map(([nombre, local, horas, ef, tj, total, variant, estado]) => (
                  <tr key={nombre}>
                    <td className="px-2.5 py-2.5 border-b border-line font-semibold">{nombre}</td>
                    <td className="px-2.5 py-2.5 border-b border-line">{local}</td>
                    <td className="px-2.5 py-2.5 border-b border-line font-mono text-right">{horas}</td>
                    <td className="px-2.5 py-2.5 border-b border-line font-mono text-right">{ef}</td>
                    <td className="px-2.5 py-2.5 border-b border-line font-mono text-right">{tj}</td>
                    <td className="px-2.5 py-2.5 border-b border-line font-mono text-right font-bold">{total}</td>
                    <td className="px-2.5 py-2.5 border-b border-line"><Pill variant={variant}>{estado}</Pill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="self-start">
          <CardHeader title="Registro diario por medio de pago" subtitle="Nunca se mezcla con la venta" />
          <table className="w-full text-sm">
            <thead>
              <tr>
                {['Fecha', 'Local', 'Efectivo', 'Tarjeta', 'Apps'].map((h) => (
                  <th key={h} className="text-left text-[11px] text-muted uppercase font-semibold px-2.5 py-2 border-b border-line">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {REGISTRO_DIARIO.map((r, i) => (
                <tr key={i}>
                  <td className="px-2.5 py-2.5 border-b border-line font-mono text-xs">{r[0]}</td>
                  <td className="px-2.5 py-2.5 border-b border-line">{r[1]}</td>
                  <td className="px-2.5 py-2.5 border-b border-line font-mono text-right">{r[2]}</td>
                  <td className="px-2.5 py-2.5 border-b border-line font-mono text-right">{r[3]}</td>
                  <td className="px-2.5 py-2.5 border-b border-line font-mono text-right">{r[4]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="h-px bg-line my-3.5" />
          <div className="text-xs text-muted leading-relaxed">
            Las propinas son <b>propiedad de los trabajadores</b>: no son remuneración, no pagan cotizaciones ni
            impuestos. El sistema solo calcula el reparto según el pacto firmado.
          </div>
        </Card>
      </div>
    </>
  );
}
