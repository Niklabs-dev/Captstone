import type { ReactElement } from 'react';
export default function Loading(): ReactElement {
  return (
    <div aria-busy="true">
      <p role="status">Cargando panel de alertas DT…</p>
    </div>
  );
}
