import type { ReactElement } from 'react';

export default function AuditLoading(): ReactElement {
  return (
    <section>
      <p role="status" className="rounded-[14px] border border-line bg-bg p-5">
        Cargando registro de auditoría…
      </p>
    </section>
  );
}
