import type { ReactElement } from 'react';
export default function LoadingStores(): ReactElement {
  return (
    <p role="status" className="text-sm text-ink2">
      Cargando locales…
    </p>
  );
}
