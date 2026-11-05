import type { ReactElement } from 'react';

const paths = {
  plus: 'M12 5v14M5 12h14',
  menu: 'M4 6h16M4 12h16M4 18h16',
  close: 'm6 6 12 12M6 18 18 6',
  home: 'm3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',
  users:
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  store:
    'M3 10h18l-2-7H5l-2 7Zm1 0v11h16V10M9 21v-7h6v7M3 10a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0',
  document: 'M14 2H5v20h14V7l-5-5Zm0 0v6h5M8 12h8M8 16h6',
  wallet: 'M20 7H5a2 2 0 0 1 0-4h13v4M5 7H3v14h18V7h-1Zm-4 5h5v5h-5v-5Z',
  tips: 'M12 7v10M15 9c0-1-1.3-2-3-2s-3 1-3 2 1.3 2 3 3 3 1 3 3-1.3 2-3 2-3-1-3-2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  audit: 'M9 3H5v18h14V3h-4M9 2h6v4H9V2ZM8 11h8M8 15h8',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4',
  more: 'M5 11v2M12 11v2M19 11v2',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  user: 'M20 21a8 8 0 0 0-16 0M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
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
