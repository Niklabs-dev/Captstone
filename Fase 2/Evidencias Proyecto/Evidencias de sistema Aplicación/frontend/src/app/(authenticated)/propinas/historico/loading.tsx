import type { ReactElement } from 'react';

export default function Loading(): ReactElement {
  return (
    <div aria-busy="true">
      <p role="status" className="text-sm text-ink2">
        Cargando repartos anteriores…
      </p>
    </div>
  );
}
