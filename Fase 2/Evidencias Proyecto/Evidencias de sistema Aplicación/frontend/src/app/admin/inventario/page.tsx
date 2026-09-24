import { Card, CardHeader } from '@/components/ui/Card';
import { Pill, PillVariant } from '@/components/ui/Pill';

const INSUMOS: Array<[string, string, string, string, string, string, number, 'ok' | 'crit', string, PillVariant, string]> = [
  ['Pan Italiano 15 cm', 'Panes', '42 un', '60 un', '380 un', '389 un', 24, 'ok', '+2,4%', 'warn', 'Reponer'],
  ['Pollo rotisserie', 'Proteínas', '18 kg', '10 kg', '24,5 kg', '25,1 kg', 25, 'ok', '+2,4%', 'ok', 'Normal'],
  ['Palta', 'Vegetales', '4 kg', '6 kg', '11,2 kg', '11,0 kg', 18, 'ok', '−1,8%', 'warn', 'Reponer'],
  ['Queso americano', 'Lácteos', '210 lámina', '150', '740 lámina', '782 lámina', 57, 'crit', '+5,7%', 'crit', 'Revisar'],
  ['Vasos 22 oz', 'Empaques', '480 un', '300 un', '612 un', '620 un', 13, 'ok', '+1,3%', 'ok', 'Normal'],
];

export default function InventarioPage() {
  return (
    <>
      <div className="grid md:grid-cols-3 gap-3.5 mb-3.5">
        <Card className="border-l-[3px] border-l-warn">
          <div className="font-mono text-[9.5px] tracking-widest uppercase text-muted">Insumos a reponer</div>
          <div className="font-mono text-[26px] font-bold my-1.5">2</div>
          <div className="text-xs text-ink2">Pan Italiano · Palta</div>
        </Card>
        <Card className="border-l-[3px] border-l-crit">
          <div className="font-mono text-[9.5px] tracking-widest uppercase text-muted">Desviaciones críticas</div>
          <div className="font-mono text-[26px] font-bold my-1.5">1</div>
          <div className="text-xs text-ink2">Queso americano · +5,7%</div>
        </Card>
        <Card className="border-l-[3px] border-l-ok">
          <div className="font-mono text-[9.5px] tracking-widest uppercase text-muted">Desviación teórico vs real</div>
          <div className="font-mono text-[26px] font-bold my-1.5">2,1%</div>
          <div className="text-xs text-ink2">Dentro del rango aceptable (&lt;4%)</div>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Consumo teórico vs. real — semana 35"
          subtitle="Teórico por recetas del franquiciador × ventas del módulo Ventas"
        />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                {['Insumo', 'Categoría', 'Stock actual', 'Stock mín.', 'Consumo teórico', 'Consumo real', 'Desviación', 'Estado'].map((h) => (
                  <th key={h} className="text-left text-[11px] text-muted uppercase font-semibold px-2.5 py-2 border-b border-line">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {INSUMOS.map(([nombre, cat, stock, min, teo, real, pct, barCls, dif, variant, estado]) => (
                <tr key={nombre}>
                  <td className="px-2.5 py-2.5 border-b border-line font-semibold">{nombre}</td>
                  <td className="px-2.5 py-2.5 border-b border-line">{cat}</td>
                  <td className="px-2.5 py-2.5 border-b border-line font-mono text-right">{stock}</td>
                  <td className="px-2.5 py-2.5 border-b border-line font-mono text-right">{min}</td>
                  <td className="px-2.5 py-2.5 border-b border-line font-mono text-right">{teo}</td>
                  <td className="px-2.5 py-2.5 border-b border-line font-mono text-right">{real}</td>
                  <td className="px-2.5 py-2.5 border-b border-line">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 rounded-full bg-tint2 flex-1 overflow-hidden">
                        <div className={`h-full rounded-full ${barCls === 'crit' ? 'bg-crit' : 'bg-ok'}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className={`font-mono text-[11px] ${barCls === 'crit' ? 'text-crit' : ''}`}>{dif}</span>
                    </div>
                  </td>
                  <td className="px-2.5 py-2.5 border-b border-line"><Pill variant={variant}>{estado}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="h-px bg-line my-3.5" />
        <div className="text-xs text-muted leading-relaxed">
          Última merma registrada: <b>Pan Italiano vencido — 26 un · $18.200</b> (LOC-02, 02-sep, causa &quot;vencimiento&quot;).
          Los ajustes de conteo físico requieren justificación obligatoria y quedan en auditoría.
        </div>
      </Card>
    </>
  );
}
