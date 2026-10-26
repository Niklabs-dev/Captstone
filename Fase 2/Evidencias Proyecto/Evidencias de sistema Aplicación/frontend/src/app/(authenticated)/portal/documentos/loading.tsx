import type { ReactElement } from 'react';
export default function Loading(): ReactElement {
  return (
    <p role="status" className="py-12 text-center text-sm text-ink2">
      Consultando tus documentos…
    </p>
  );
}
