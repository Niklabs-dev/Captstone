import type { ReactElement } from 'react';
export default function LoadingDailyTips(): ReactElement {
  return (
    <p role="status" className="text-sm text-ink2">
      Cargando registro diario de propinas…
    </p>
  );
}
