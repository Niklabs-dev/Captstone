import type { ReactElement } from 'react';
export default function Loading(): ReactElement {
  return (
    <main className="min-h-screen bg-tint p-6 text-ink">
      <p role="status">Cargando panel de alertas DT…</p>
    </main>
  );
}
