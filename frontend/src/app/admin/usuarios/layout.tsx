import { Inter, JetBrains_Mono } from 'next/font/google';
import type { ReactElement, ReactNode } from 'react';
import './users-theme.css';
const inter = Inter({ subsets: ['latin'] });
const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-users-mono',
});
export default function UsersLayout({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  return (
    <div
      lang="es"
      className={`${inter.className} ${mono.variable} min-h-screen bg-u-tint text-u-ink`}
    >
      {children}
    </div>
  );
}
