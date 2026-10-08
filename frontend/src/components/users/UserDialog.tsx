'use client';
import { useEffect, useRef, type ReactElement, type ReactNode } from 'react';
import { userButtonClass } from './styles';
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
      aria-labelledby="user-dialog-title"
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onDismiss();
      }}
      className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl border border-u-line bg-u-bg p-5 text-u-ink shadow-xl backdrop:bg-u-ink/35 sm:p-6"
    >
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 id="user-dialog-title" className="text-lg font-bold">
          {title}
        </h2>
        <button
          type="button"
          onClick={onDismiss}
          disabled={busy}
          aria-label="Cerrar ventana"
          className={userButtonClass}
        >
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
