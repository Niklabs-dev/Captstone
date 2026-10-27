import type { ReactElement } from 'react';

const paths = {
  menu: 'M4 6h16M4 12h16M4 18h16',
  close: 'm6 6 12 12M6 18 18 6',
};

export function Icon({ name }: { name: keyof typeof paths }): ReactElement {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="h-5 w-5 shrink-0"
    >
      <path d={paths[name]} />
    </svg>
  );
}
