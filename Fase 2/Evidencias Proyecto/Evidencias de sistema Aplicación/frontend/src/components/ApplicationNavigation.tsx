'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useId, useRef, useState, type ReactElement } from 'react';
import type { Role } from '@/lib/auth';
import { getNavigationItems, getNavigationView } from '@/lib/navigation';
import { buttonClass } from '@/components/ui/styles';
import { Icon } from '@/components/ui/Icon';

export function ApplicationNavigation({ role }: { role: Role }): ReactElement {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Navegación principal"
      className="px-3 py-3 lg:px-2.5 lg:py-4"
    >
      <NavigationMenu key={pathname} role={role} pathname={pathname} />
    </nav>
  );
}

function NavigationMenu({
  role,
  pathname,
}: {
  role: Role;
  pathname: string;
}): ReactElement {
  const { href } = getNavigationView(pathname);
  const [expanded, setExpanded] = useState(false);
  const menuId = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  return (
    <div
      onKeyDown={(event) => {
        if (event.key === 'Escape' && expanded) {
          setExpanded(false);
          toggle.current?.focus();
        }
      }}
    >
      <button
        ref={toggle}
        type="button"
        aria-expanded={expanded}
        aria-controls={menuId}
        onClick={() => setExpanded((value) => !value)}
        className={`${buttonClass} w-full justify-between lg:hidden`}
      >
        Menú principal
        <Icon name={expanded ? 'close' : 'menu'} />
      </button>
      <div
        id={menuId}
        className={`${expanded ? 'grid' : 'hidden'} mt-2 gap-1 lg:mt-0 lg:grid`}
      >
        {getNavigationItems(role).map((item) => (
          <Link
            key={item.href}
            href={item.href}
            prefetch={false}
            onNavigate={() => setExpanded(false)}
            aria-current={href === item.href ? 'page' : undefined}
            className={`flex min-h-11 min-w-0 items-center rounded-lg px-3 py-2.5 text-sm outline-offset-2 focus-visible:outline-2 focus-visible:outline-salmon-ink ${href === item.href ? 'bg-tint2 font-semibold text-salmon-ink' : 'text-ink2 hover:bg-tint'}`}
          >
            {item.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

export function ApplicationHeading(): ReactElement {
  const { title } = getNavigationView(usePathname());
  return (
    <h1 className="min-w-0 flex-1 break-words text-[17px] font-bold tracking-tight">
      {title}
    </h1>
  );
}
