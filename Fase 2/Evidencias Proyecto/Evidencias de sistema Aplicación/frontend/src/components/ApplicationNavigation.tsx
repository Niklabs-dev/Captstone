'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactElement } from 'react';
import type { Role } from '@/lib/auth';
import { getNavigationItems, getNavigationView } from '@/lib/navigation';

export function ApplicationNavigation({ role }: { role: Role }): ReactElement {
  const { href } = getNavigationView(usePathname());
  return (
    <nav
      aria-label="Navegación principal"
      className="flex flex-wrap gap-1 px-2.5 py-3 lg:block lg:space-y-1 lg:py-4"
    >
      {getNavigationItems(role).map((item) => (
        <Link
          key={item.href}
          href={item.href}
          prefetch={false}
          aria-current={href === item.href ? 'page' : undefined}
          className={`rounded-[9px] px-3 py-2.5 text-[13.5px] outline-offset-2 focus-visible:outline-2 focus-visible:outline-salmon-ink lg:block ${href === item.href ? 'bg-tint2 font-semibold text-salmon-ink' : 'text-ink2 hover:bg-tint'}`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

export function ApplicationHeading(): ReactElement {
  const { title } = getNavigationView(usePathname());
  return <h1 className="text-[17px] font-bold tracking-tight">{title}</h1>;
}
