'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useId, useRef, useState, type ReactElement } from 'react';
import type { Role } from '@/lib/auth';
import { getNavigationItems, getNavigationView } from '@/lib/navigation';
import {
  getMobileLabel,
  getMobileNavigation,
  getNavigationIcon,
} from '@/lib/mobile-navigation';
import { Icon } from './ui/Icon';
import {
  buttonClass,
  mobileDockItemClass,
  mobileModuleClass,
} from './ui/styles';

export function MobileNavigation({ role }: { role: Role }): ReactElement {
  const pathname = usePathname();
  return (
    <nav aria-label="Navegación principal" className="mobile-dock lg:hidden">
      <MobileMenu key={pathname} role={role} pathname={pathname} />
    </nav>
  );
}

function MobileMenu({
  role,
  pathname,
}: {
  role: Role;
  pathname: string;
}): ReactElement {
  const { href } = getNavigationView(pathname);
  const { primary, additional } = getMobileNavigation(role);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);
  const menuId = useId();
  const titleId = useId();
  const inAdditional = additional.some((item) => item.href === href);
  function close(): undefined {
    dialog.current?.close();
  }
  return (
    <>
      <div className="flex items-stretch justify-around gap-1">
        {primary.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            prefetch={false}
            aria-label={item.label}
            aria-current={href === item.href ? 'page' : undefined}
            className={
              mobileDockItemClass +
              (href === item.href
                ? ' bg-tint2 text-salmon-ink'
                : ' text-ink2 hover:bg-tint')
            }
          >
            <Icon name={getNavigationIcon(item.href)} />
            <span>{getMobileLabel(item)}</span>
          </Link>
        ))}
        {additional.length > 0 && (
          <button
            ref={trigger}
            type="button"
            aria-label="Menú principal"
            aria-current={inAdditional ? 'page' : undefined}
            aria-expanded={expanded}
            aria-controls={menuId}
            aria-haspopup="dialog"
            className={
              mobileDockItemClass +
              (inAdditional
                ? ' bg-tint2 text-salmon-ink'
                : ' text-ink2 hover:bg-tint')
            }
            onClick={() => {
              dialog.current?.showModal();
              setExpanded(true);
            }}
          >
            <Icon name="more" />
            <span>Más</span>
          </button>
        )}
      </div>
      {additional.length > 0 && (
        <dialog
          ref={dialog}
          id={menuId}
          aria-labelledby={titleId}
          className="mobile-menu"
          onClick={(event) => {
            if (event.target === event.currentTarget) close();
          }}
          onClose={() => {
            setExpanded(false);
            trigger.current?.focus();
          }}
        >
          <div className="space-y-5 p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 id={titleId} className="text-lg font-bold">
                  Todos los módulos
                </h2>
                <p className="mt-1 text-sm text-ink2">Elige dónde continuar.</p>
              </div>
              <button
                type="button"
                className={buttonClass}
                aria-label="Cerrar menú"
                onClick={close}
              >
                <Icon name="close" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {getNavigationItems(role).map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch={false}
                  onNavigate={close}
                  aria-current={href === item.href ? 'page' : undefined}
                  className={
                    mobileModuleClass +
                    (href === item.href
                      ? ' bg-tint2 text-salmon-ink'
                      : ' bg-tint text-ink2')
                  }
                >
                  <Icon name={getNavigationIcon(item.href)} />
                  <span>{item.label}</span>
                </Link>
              ))}
            </div>
          </div>
        </dialog>
      )}
    </>
  );
}
