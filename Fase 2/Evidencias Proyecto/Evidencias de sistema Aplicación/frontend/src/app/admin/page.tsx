import { Card, CardHeader } from '@/components/ui/Card';
import { Pill } from '@/components/ui/Pill';

function Kpi({ label, value, sub, accent = 'salmon' }: { label: string; value: string; sub: React.ReactNode; accent?: 'salmon' | 'ok' | 'warn' | 'crit' }) {
  const border = { salmon: 'border-l-salmon', ok: 'border-l-ok', warn: 'border-l-warn', crit: 'border-l-crit' }[accent];
  return (
    <Card className={`border-l-[3px] ${border}`}>
      <div className="font-mono text-[9.5px] tracking-widest uppercase text-muted">{label}</div>
      <div className="font-mono text-[26px] font-bold my-1.5 tracking-tight">{value}</div>
      <div className="text-xs text-ink2">{sub}</div>
    </Card>
  );
}

export default function AdminDashboard() {
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 mb-3.5">
        <Kpi label="Ventas hoy · consolidado" value="$1.284.500" sub={<><span className="text-ok font-semibold">▲ 8,2%</span> vs. jueves anterior</>} />
        <Kpi label="Propinas por enterar" value="$186.400" sub={<>Plazo art. 64: <b>quedan 3 días hábiles</b></>} accent="warn" />
        <Kpi label="Alertas documentales" value="4" sub={<><b>1 contrato</b> sin registrar en Mi DT</>} accent="crit" />
        <Kpi label="Cierres de caja ayer" value="3 / 3" sub={<>Diferencia total: <b className="text-crit">−$4.250</b></>} accent="ok" />
      </div>

      <div className="grid lg:grid-cols-[1.6fr_1fr] gap-3.5">
        <div className="flex flex-col gap-3.5">
          <Card>
            <CardHeader title="Ventas por local — hoy" subtitle="Comparativo contra meta diaria" />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    {['Local', 'Venta neta', 'Meta', 'Cumplimiento', 'Cierre caja'].map((h) => (
                      <th key={h} className="text-left text-[11px] text-muted uppercase font-semibold px-2.5 py-2 border-b border-line">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['Melipilla Centro', 'LOC-01 · R. Fernández', '$512.300', '$480.000', '107%', 'ok'],
                    ['Melipilla Poniente', 'LOC-02 · G. Muñoz', '$438.700', '$450.000', '97%', 'warn'],
                    ['Calera de Tango', 'LOC-03 · L. Araya', '$333.500', '$320.000', '104%', 'ok'],
                  ].map(([local, sup, venta, meta, pct, cls]) => (
                    <tr key={local}>
                      <td className="px-2.5 py-2.5 border-b border-line">
                        <div className="font-semibold">{local}</div>
                        <div className="text-[11.5px] text-muted">{sup}</div>
                      </td>
                      <td className="px-2.5 py-2.5 border-b border-line font-mono text-right">{venta}</td>
                      <td className="px-2.5 py-2.5 border-b border-line font-mono text-right">{meta}</td>
                      <td className="px-2.5 py-2.5 border-b border-line">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 rounded-full bg-tint2 flex-1 overflow-hidden">
                            <div className={`h-full rounded-full ${cls === 'ok' ? 'bg-ok' : 'bg-warn'}`} style={{ width: '100%' }} />
                          </div>
                          <span className="font-mono text-[11px]">{pct}</span>
                        </div>
                      </td>
                      <td className="px-2.5 py-2.5 border-b border-line">
                        <Pill variant={cls === 'ok' ? 'ok' : 'warn'}>{cls === 'ok' ? 'Cuadrada' : '−$4.250'}</Pill>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <CardHeader title="Ventas consolidadas — últimos 7 días" subtitle="CLP · los 3 locales" />
            <div className="flex items-end gap-2.5 h-[150px] pt-1.5">
              {[
                ['1,09M', 62, 'Vie'], ['1,42M', 84, 'Sáb'], ['1,51M', 90, 'Dom'],
                ['0,98M', 55, 'Lun'], ['1,12M', 65, 'Mar'], ['1,18M', 70, 'Mié'], ['1,28M', 76, 'Jue'],
              ].map(([v, h, d], i) => (
                <div key={d as string} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end">
                  <span className="font-mono text-[9.5px] text-ink2">{v}</span>
                  <div
                    className={`w-full max-w-[38px] rounded-t-md rounded-b-sm ${i === 6 ? 'bg-tint3' : 'bg-gradient-to-b from-salmon to-salmon-deep'}`}
                    style={{ height: `${h}%` }}
                  />
                  <span className="font-mono text-[9.5px] text-muted uppercase tracking-wide">{d}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <Card className="self-start">
          <CardHeader title="Panel de alertas" subtitle="Vencimientos legales y operación" action={<Pill variant="crit" pulse>7 activas</Pill>} />
          {[
            ['crit', 'border-l-crit', 'Contrato sin registrar en Mi DT', 'J. PAREDES · LOC-02 · FIRMADO 28-AGO · VENCE 11-SEP', 'Art. 9 bis'],
            ['crit', 'border-l-crit', 'Diferencia de caja sobre umbral', 'LOC-02 · TURNO TARDE · −$4.250 · RESP: G. MUÑOZ', 'Caja'],
            ['warn', 'border-l-warn', 'Propinas tarjeta por enterar', '$186.400 · SEMANA 36 · QUEDAN 3 DÍAS HÁBILES', 'Art. 64'],
            ['warn', 'border-l-warn', 'Stock bajo: Pan Italiano', 'LOC-01 · 42 UN · MÍNIMO 60 UN', 'Inventario'],
            ['info', 'border-l-info', 'Liquidaciones agosto pendientes de firma', '5 DE 18 PUBLICADAS', 'Documental'],
          ].map(([variant, border, ttl, meta, tag], i) => (
            <div key={i} className={`flex gap-3 items-start bg-bg border border-line ${border} border-l-[3px] rounded-lg px-3.5 py-3 mb-2.5`}>
              <div>
                <div className="text-[13px] font-semibold">{ttl}</div>
                <div className="font-mono text-[10.5px] text-muted mt-0.5">{meta}</div>
              </div>
              <span className="ml-auto shrink-0">
                <Pill variant={variant as 'crit' | 'warn' | 'info'}>{tag}</Pill>
              </span>
            </div>
          ))}
        </Card>
      </div>
    </>
  );
}
