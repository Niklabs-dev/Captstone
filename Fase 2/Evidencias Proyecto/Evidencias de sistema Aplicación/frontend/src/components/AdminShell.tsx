'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Button } from './ui/Button';

const NAV = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/documental', label: 'Gestor Documental' },
  { href: '/admin/propinas', label: 'Propinas' },
  { href: '/admin/ventas', label: 'Ventas y Caja' },
  { href: '/admin/inventario', label: 'Inventario' },
  { href: '/admin/usuarios', label: 'Usuarios (T10)' },
  { href: '/admin/auditoria', label: 'Auditoría (T16)' },
];

export function AdminShell({
  user,
  children,
}: {
  user: { nombre: string; rol: string };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [menuOpen]);

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-[210px_1fr] lg:grid-cols-[248px_1fr] min-h-screen">
      {menuOpen && (
        <div
          className="fixed inset-0 bg-ink/40 z-30 md:hidden"
          onClick={() => setMenuOpen(false)}
        />
      )}

      <aside
        className={`bg-bg border-r border-line flex flex-col
                    fixed md:sticky top-0 left-0 h-dvh md:h-screen w-[248px] z-40
                    transition-transform md:translate-x-0
                    ${menuOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'}`}
      >
        <div className="flex items-center gap-3 p-5 border-b border-line">
          <div className="w-10 h-10 rounded-xl bg-salmon text-white flex items-center justify-center font-extrabold shrink-0">
            M
          </div>
          <div>
            <div className="font-extrabold text-[15px]">
              Moi<span className="text-salmon-deep">Food</span>
            </div>
            <div className="font-mono text-[9px] tracking-widest uppercase text-muted">
              Gestión interna
            </div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto p-2.5">
          {NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMenuOpen(false)}
                className={`block px-3 py-2.5 mb-0.5 rounded-lg text-[13.5px] no-underline ${
                  active ? 'font-semibold text-salmon-ink bg-tint2' : 'font-medium text-ink2'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-line px-4 py-3.5">
          <div className="flex items-center gap-2.5 mb-2.5">
            <div className="w-8.5 h-8.5 rounded-lg bg-salmon text-white flex items-center justify-center font-bold text-xs shrink-0">
              {user.nombre.slice(0, 1)}
            </div>
            <div className="min-w-0">
              <div className="text-[13px] font-semibold truncate">{user.nombre}</div>
              <div className="font-mono text-[9.5px] tracking-widest uppercase text-salmon-deep">
                {user.rol}
              </div>
            </div>
          </div>
          <Button onClick={handleLogout} className="w-full">
            Cerrar sesión
          </Button>
        </div>
      </aside>

      <div className="flex flex-col min-w-0">
        <header className="bg-bg border-b border-line px-4 md:px-7 h-16 flex items-center gap-3.5 sticky top-0 z-20">
          <button
            aria-label="Abrir menú"
            onClick={() => setMenuOpen((v) => !v)}
            className="md:hidden w-9 h-9 rounded-lg border border-line2 bg-bg text-base"
          >
            ☰
          </button>
          <h1 className="text-[17px] font-bold tracking-tight">
            {NAV.find((n) => n.href === pathname)?.label ?? 'MoiFood'}
          </h1>
        </header>
        <main className="p-4 md:p-7 pb-14 flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}
