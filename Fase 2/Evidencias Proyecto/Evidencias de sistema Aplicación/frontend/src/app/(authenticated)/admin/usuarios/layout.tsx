import type { ReactElement, ReactNode } from 'react';
import './users-theme.css';

export default function UsersLayout({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  return <div className="text-u-ink">{children}</div>;
}
