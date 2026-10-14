import type { ReactElement } from 'react';
export default function LoadingDocuments(): ReactElement {
  return (
    <div aria-busy="true">
      <p role="status" className="text-sm text-ink2">
        Cargando gestor documental…
      </p>
    </div>
  );
}
