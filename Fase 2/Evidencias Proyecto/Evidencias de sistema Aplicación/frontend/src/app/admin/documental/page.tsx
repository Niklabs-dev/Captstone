import { Card, CardHeader } from '@/components/ui/Card';
import { Pill, PillVariant } from '@/components/ui/Pill';
import { DisabledAction } from '@/components/DisabledAction';

const TRABAJADORES: Array<[string, string, PillVariant, string]> = [
  ['Camila Rojas', '12.345.678-5 · CAJERA · LOC-01', 'ok', 'Al día'],
  ['José Paredes', '18.765.432-1 · SANDWICHERO · LOC-02', 'crit', 'Contrato s/ registro'],
  ['María Contreras', '15.987.654-3 · SUPERVISORA · LOC-01', 'warn', 'Pacto vence 08-sep'],
  ['Diego Fuentes', '17.456.789-2 · SANDWICHERO · LOC-03', 'ok', 'Al día'],
  ['Valentina Soto', '19.234.567-8 · CAJERA · LOC-02', 'warn', 'Liq. ago. s/ firma'],
  ['Andrés Molina', '16.543.210-9 · EX TRABAJADOR', 'gray', 'Conservación'],
];

const DOCUMENTOS: Array<[string, string, string, string, PillVariant, string, string]> = [
  ['Contrato de trabajo.pdf', 'v2 · SUBIDO 28-AGO', 'José Paredes', 'a3f2…9c41', 'warn', 'Falta registro DT', 'Hasta 08-2031'],
  ['Liquidación 2026-08.pdf', 'v1 · CARGA MASIVA 02-SEP', 'Camila Rojas', '77be…02dd', 'info', 'Pendiente de firma', 'Hasta 08-2031'],
  ['Pacto horas extraordinarias.pdf', 'v1 · SUBIDO 08-JUN', 'María Contreras', 'c04d…b1e8', 'warn', 'Vence en 5 días', 'Hasta 08-2031'],
  ['Pacto reparto de propinas.pdf', 'v3 · REEMPLAZA v2', 'Local LOC-03', 'e91a…4f07', 'ok', 'Vigente', 'Hasta 01-2032'],
  ['Finiquito + carta de aviso.pdf', 'v1 · SUBIDO 15-JUL', 'Andrés Molina', '5d8c…73aa', 'gray', 'Ex trabajador', 'Hasta 07-2031'],
];

export default function DocumentalPage() {
  return (
    <>
      <div className="flex gap-2.5 mb-3.5 flex-wrap">
        <div className="flex items-center gap-2 flex-1 max-w-[340px] border border-line2 rounded-lg px-3 py-2.5 bg-bg">
          🔍<input placeholder="Buscar por trabajador, RUT, tipo de documento…" className="border-none outline-none text-sm w-full bg-transparent" />
        </div>
        <div className="ml-auto">
          <DisabledAction label="＋ Subir documento" sprint="Sprint 2" primary />
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_1.6fr] gap-3.5">
        <Card className="self-start">
          <CardHeader title="Trabajadores" subtitle="18 activos · 3 locales" />
          <table className="w-full text-sm">
            <tbody>
              {TRABAJADORES.map(([nombre, meta, variant, estado]) => (
                <tr key={nombre}>
                  <td className="px-2.5 py-2.5 border-b border-line">
                    <div className="font-semibold">{nombre}</div>
                    <div className="text-[11.5px] text-muted">{meta}</div>
                  </td>
                  <td className="px-2.5 py-2.5 border-b border-line"><Pill variant={variant}>{estado}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card>
          <CardHeader
            title="Documentos recientes"
            subtitle="Integridad verificable SHA-256 · conservación 5 años"
            action={<Pill>Hash verificado</Pill>}
          />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  {['Documento', 'Trabajador', 'Hash', 'Estado', 'Conservación'].map((h) => (
                    <th key={h} className="text-left text-[11px] text-muted uppercase font-semibold px-2.5 py-2 border-b border-line">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {DOCUMENTOS.map(([doc, meta, trab, hash, variant, estado, vence]) => (
                  <tr key={doc}>
                    <td className="px-2.5 py-2.5 border-b border-line">
                      <div className="font-semibold">{doc}</div>
                      <div className="text-[11.5px] text-muted">{meta}</div>
                    </td>
                    <td className="px-2.5 py-2.5 border-b border-line">{trab}</td>
                    <td className="px-2.5 py-2.5 border-b border-line">
                      <span className="font-mono text-[10.5px] bg-tint px-1.5 py-0.5 rounded">{hash}</span>
                    </td>
                    <td className="px-2.5 py-2.5 border-b border-line"><Pill variant={variant}>{estado}</Pill></td>
                    <td className="px-2.5 py-2.5 border-b border-line font-mono text-[11px]">{vence} 🔒</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="h-px bg-line my-3.5" />
          <div className="text-xs text-muted leading-relaxed">
            🔒 <b>Bloqueo de eliminación activo:</b> ningún documento puede eliminarse antes de cumplir los 5 años
            de conservación desde el término de la relación laboral (art. 9 bis CT). Todo acceso queda en auditoría.
          </div>
        </Card>
      </div>
    </>
  );
}
