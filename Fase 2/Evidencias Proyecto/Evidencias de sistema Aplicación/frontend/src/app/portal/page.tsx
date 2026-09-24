import { cookies } from 'next/headers';
import { parseSessionCookie, SESSION_COOKIE } from '@/lib/mock-auth';
import { Card, CardHeader } from '@/components/ui/Card';
import { Pill } from '@/components/ui/Pill';
import { LogoutButton } from '@/components/LogoutButton';

// Datos de ejemplo del propio trabajador — en el backend real, el endpoint
// debe devolver únicamente los registros de session.user.id (E4-H1/E4-H2).
const MI_INFO = {
  liquidaciones: [
    { periodo: 'Agosto 2026', estado: 'Publicada', monto: '$612.400' },
    { periodo: 'Julio 2026', estado: 'Publicada', monto: '$598.100' },
  ],
  propinas: [
    { semana: 'Semana 35', monto: '$21.300', estado: 'Entregada' },
    { semana: 'Semana 34', monto: '$19.800', estado: 'Entregada' },
  ],
  horario: [
    { dia: 'Lunes', turno: '09:00 – 17:00' },
    { dia: 'Miércoles', turno: '09:00 – 17:00' },
    { dia: 'Viernes', turno: '12:00 – 20:00' },
  ],
};

export default async function PortalPage() {
  const jar = await cookies();
  const user = parseSessionCookie(jar.get(SESSION_COOKIE)?.value);

  return (
    <main className="max-w-[760px] mx-auto px-3.5 sm:px-5 py-6 sm:py-9">
      <header className="flex items-center justify-between gap-3 mb-5 sm:mb-6 flex-wrap">
        <div>
          <div className="font-mono text-[10px] tracking-widest uppercase text-muted">
            Portal del trabajador · solo lectura
          </div>
          <h1 className="text-xl font-extrabold mt-0.5">Hola, {user?.nombre ?? 'trabajador/a'}</h1>
        </div>
        <LogoutButton />
      </header>

      <div className="grid gap-4">
        <Card>
          <CardHeader
            title="Mis liquidaciones"
            subtitle="Solo se muestran una vez publicadas por el contador (E2-H1)"
          />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left text-[11px] text-muted uppercase font-semibold px-2.5 py-2 border-b border-line">Período</th>
                  <th className="text-left text-[11px] text-muted uppercase font-semibold px-2.5 py-2 border-b border-line">Estado</th>
                  <th className="text-right text-[11px] text-muted uppercase font-semibold px-2.5 py-2 border-b border-line">Monto</th>
                </tr>
              </thead>
              <tbody>
                {MI_INFO.liquidaciones.map((l) => (
                  <tr key={l.periodo}>
                    <td className="px-2.5 py-2.5 border-b border-line">{l.periodo}</td>
                    <td className="px-2.5 py-2.5 border-b border-line"><Pill variant="ok">{l.estado}</Pill></td>
                    <td className="px-2.5 py-2.5 border-b border-line text-right font-mono">{l.monto}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader title="Mis propinas" subtitle="Reparto calculado según el pacto firmado" />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left text-[11px] text-muted uppercase font-semibold px-2.5 py-2 border-b border-line">Semana</th>
                  <th className="text-left text-[11px] text-muted uppercase font-semibold px-2.5 py-2 border-b border-line">Estado</th>
                  <th className="text-right text-[11px] text-muted uppercase font-semibold px-2.5 py-2 border-b border-line">Monto</th>
                </tr>
              </thead>
              <tbody>
                {MI_INFO.propinas.map((p) => (
                  <tr key={p.semana}>
                    <td className="px-2.5 py-2.5 border-b border-line">{p.semana}</td>
                    <td className="px-2.5 py-2.5 border-b border-line"><Pill variant="ok">{p.estado}</Pill></td>
                    <td className="px-2.5 py-2.5 border-b border-line text-right font-mono">{p.monto}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader title="Mi horario" />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left text-[11px] text-muted uppercase font-semibold px-2.5 py-2 border-b border-line">Día</th>
                  <th className="text-left text-[11px] text-muted uppercase font-semibold px-2.5 py-2 border-b border-line">Turno</th>
                </tr>
              </thead>
              <tbody>
                {MI_INFO.horario.map((h) => (
                  <tr key={h.dia}>
                    <td className="px-2.5 py-2.5 border-b border-line">{h.dia}</td>
                    <td className="px-2.5 py-2.5 border-b border-line">{h.turno}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="text-xs text-muted text-center">
          Solo puedes ver tu propia información (Ley N°21.719). Cualquier intento de
          acceder a datos de otro trabajador queda registrado en auditoría (E4-H1, criterio 2.0).
        </div>
      </div>
    </main>
  );
}
