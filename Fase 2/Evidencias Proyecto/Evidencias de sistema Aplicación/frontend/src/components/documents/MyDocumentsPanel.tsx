'use client';
import type { ReactElement } from 'react';
import { DocumentWorkspace } from './DocumentWorkspace';
// El ID procede del Server Component; el BFF lo ignora como parámetro y usa la cookie.
export function MyDocumentsPanel({
  workerId,
}: {
  workerId: string;
}): ReactElement {
  return (
    <DocumentWorkspace
      workerId={workerId}
      workerName="Mis documentos laborales"
      personal
      onBusy={() => undefined}
    />
  );
}
