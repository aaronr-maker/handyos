import type { SVGProps } from 'react';

const paths = {
  home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
  customers: 'M16 11a4 4 0 10-8 0 4 4 0 008 0zM4 21a8 8 0 0116 0',
  estimates: 'M7 3h8l4 4v14H7zM15 3v4h4M10 12h6M10 16h6',
  jobs: 'M3 8h18v12H3zM8 8V5h8v3M3 13h18',
  scheduling: 'M4 6h16v15H4zM4 10h16M8 3v4M16 3v4',
  invoicing: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  payments: 'M3 6h18v12H3zM3 10h18M7 15h4',
  jobcosting: 'M4 20V10M10 20V4M16 20v-8M22 20H2',
  cashplan: 'M12 3v18M16 7H10a3 3 0 000 6h4a3 3 0 010 6H8',
  revenue: 'M3 17l6-6 4 4 8-9M15 6h6v6',
  qbsync: 'M4 12a8 8 0 0114-5l2 2M20 12a8 8 0 01-14 5l-2-2M18 4v5h-5M6 20v-5h5',
  timetrack: 'M12 7v5l3 2M12 3a9 9 0 100 18 9 9 0 000-18z',
  timesheets: 'M5 4h14v17H5zM9 2v4M15 2v4M8 11h8M8 15h5',
  desk: 'M4 5h16v10H4zM8 19h8M12 15v4M8 9h8',
  handy: 'M8 13V5a1.5 1.5 0 013 0v6M11 11V3.5a1.5 1.5 0 013 0V11M14 11V5a1.5 1.5 0 013 0v8M17 9a1.5 1.5 0 013 0v5a7 7 0 01-7 7h-1a6 6 0 01-5-3l-3-5a1.5 1.5 0 012.5-1.5L8 14',
  messaging: 'M4 5h16v11H9l-5 4z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  system: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v3M12 19v3M2 12h3M19 12h3',
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, ...props }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d={paths[name]} />
    </svg>
  );
}
