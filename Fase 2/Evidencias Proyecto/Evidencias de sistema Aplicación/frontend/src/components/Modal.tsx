'use client';

import { useEffect, useRef } from 'react';

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    const el = panelRef.current?.querySelector<HTMLElement>(
      'input, select, textarea, button:not([data-close])'
    );
    el?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/45 p-5"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[420px] max-h-[90vh] overflow-y-auto rounded-2xl border border-line
                   bg-bg shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-line px-4.5 py-4">
          <div className="text-sm font-bold">{title}</div>
          <button
            data-close
            onClick={onClose}
            aria-label="Cerrar"
            className="w-7 h-7 rounded-lg text-muted hover:bg-tint hover:text-ink"
          >
            ✕
          </button>
        </div>
        <div className="p-4.5">{children}</div>
      </div>
    </div>
  );
}
