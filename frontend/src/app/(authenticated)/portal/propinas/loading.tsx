import type { ReactElement } from 'react';

// Mientras el servidor consulta las propinas del mes (SPRINT-4A-T10).
export default function Loading(): ReactElement {
  return (
    <p
      role="status"
      aria-busy="true"
      className="py-12 text-center text-sm text-ink2"
    >
      Cargando tus propinas…
    </p>
  );
}
