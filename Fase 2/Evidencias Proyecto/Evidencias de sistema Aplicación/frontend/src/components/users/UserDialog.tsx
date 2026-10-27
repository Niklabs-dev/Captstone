'use client';
import { useEffect, useRef, type ReactElement, type ReactNode } from 'react';
import { buttonClass, dialogClass } from '@/components/ui/styles';
export function UserDialog({
  title,
  busy,
  children,
  onDismiss,
}: {
  title: string;
  busy: boolean;
  children: ReactNode;
  onDismiss: () => undefined;
}): ReactElement {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previousFocus = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onDismiss();
      }}
      className={dialogClass}
    >
      <div className="mb-5 flex items-start justify-between gap-3">
        <h2 className="text-lg font-bold">{title}</h2>
        <button
          type="button"
          onClick={onDismiss}
          disabled={busy}
          aria-label="Cerrar ventana"
          className={`${buttonClass} shrink-0`}
        >
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
