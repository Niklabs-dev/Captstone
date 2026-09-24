'use client';

import { useMemo, useState } from 'react';
import { MOCK_AUDITORIA, AuditoriaRow } from '@/lib/mock-data';
import { Card, CardHeader } from '@/components/ui/Card';
import { Pill } from '@/components/ui/Pill';

const MODULOS: Array<AuditoriaRow['modulo'] | 'Todos'> = [
  'Todos', 'Núcleo', 'Documental', 'Propinas', 'Ventas', 'Inventario', 'Portal',
];

const inputClass =
  'border border-line2 rounded-lg px-3 py-2.5 bg-bg text-ink text-sm focus:outline-none focus:ring-2 focus:ring-salmon';

export default function AuditoriaPage() {
  const [modulo, setModulo] = useState<(typeof MODULOS)[number]>('Todos');
  const [busqueda, setBusqueda] = useState('');

  const filtrados = useMemo(() => {
    return MOCK_AUDITORIA.filter((r) => {
      const pasaModulo = modulo === 'Todos' || r.modulo === modulo;
      const pasaBusqueda =
        !busqueda.trim() ||
        r.usuario.toLowerCase().includes(busqueda.toLowerCase()) ||
        r.accion.toLowerCase().includes(busqueda.toLowerCase());
      return pasaModulo && pasaBusqueda;
    });
  }, [modulo, busqueda]);

  return (
    <Card>
      <CardHeader
        title="Log de auditoría"
        subtitle="Inmutable · quién hizo qué, cuándo y en qué módulo"
        action={<Pill>Transversal</Pill>}
      />

      <div className="flex gap-2.5 mb-4 flex-wrap">
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar usuario o acción…"
          className={`${inputClass} flex-1 min-w-[200px]`}
        />
        <select
          value={modulo}
          onChange={(e) => setModulo(e.target.value as typeof modulo)}
          className={inputClass}
        >
          {MODULOS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      {filtrados.map((r) => (
        <div key={r.hash} className="flex items-center gap-2.5 py-2.5 border-b border-line">
          <span className="font-mono text-[11.5px] text-muted w-11 shrink-0">{r.hora}</span>
          <div className="flex-1 text-sm">
            <b>{r.usuario}</b> {r.accion} <Pill>{r.modulo}</Pill>
          </div>
          <span className="font-mono text-[11px] text-muted">{r.hash}</span>
        </div>
      ))}
      {filtrados.length === 0 && (
        <div className="text-center text-muted py-5">Sin resultados.</div>
      )}

      <div className="text-xs text-muted mt-3.5">
        El log es de solo lectura e inmutable: ni el administrador puede editarlo (E1-H2, criterio 2.0).
      </div>
    </Card>
  );
}
