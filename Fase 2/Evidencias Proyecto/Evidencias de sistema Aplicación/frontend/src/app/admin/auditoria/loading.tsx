import type { ReactElement } from 'react';

export default function AuditLoading(): ReactElement {
  return (
    <main className="min-h-screen bg-tint p-6 text-ink">
      <p role="status" className="rounded-[14px] border border-line bg-bg p-5">
        Cargando registro de auditoría…
      </p>
    </main>
  );
}
