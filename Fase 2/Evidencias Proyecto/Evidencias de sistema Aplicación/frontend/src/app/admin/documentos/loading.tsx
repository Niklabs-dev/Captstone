import type { ReactElement } from 'react';
export default function LoadingDocuments(): ReactElement {
  return (
    <main className="p-6">
      <p role="status" className="text-sm text-ink2">
        Cargando gestor documental…
      </p>
    </main>
  );
}
