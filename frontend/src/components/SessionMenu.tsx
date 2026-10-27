'use client';

import { useEffect, useRef, type ReactElement } from 'react';
import { buttonClass } from '@/components/ui/styles';
import { SessionActions } from './SessionActions';

export function SessionMenu(): ReactElement {
  const details = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);
  useEffect(() => {
    function closeOutside(event: PointerEvent): undefined {
      if (
        event.target instanceof Node &&
        !details.current?.contains(event.target)
      )
        details.current?.removeAttribute('open');
    }
    function closeOnEscape(event: KeyboardEvent): undefined {
      if (
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        !details.current?.open ||
        document.querySelector('dialog[open]')
      )
        return;
      event.preventDefault();
      details.current.open = false;
      summary.current?.focus();
    }
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);
  return (
    <details ref={details} className="relative max-w-full shrink-0">
      <summary ref={summary} className={`${buttonClass} cursor-pointer`}>
        Mi sesión
      </summary>
      <div className="absolute top-full right-0 z-30 mt-2 w-80 max-w-[calc(100vw-2.5rem)] rounded-xl border border-line bg-bg p-4 shadow-lg">
        <SessionActions />
      </div>
    </details>
  );
}
