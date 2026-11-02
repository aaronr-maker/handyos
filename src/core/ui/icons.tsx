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
