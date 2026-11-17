import type { ReactElement } from 'react';

export default function LoadingInventoryCount(): ReactElement {
  return (
    <p role="status" className="text-sm text-ink2">
      Cargando la toma de inventario…
    </p>
  );
}
