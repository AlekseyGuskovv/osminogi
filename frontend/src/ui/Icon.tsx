const paths = {
  brand: 'M12 2v20M3.34 7l17.32 10m0-10L3.34 17M12 2l2 4m-2-4-2 4m10.66 1-1.9 4m1.9-4-4.4.3M20.66 17l-4.4-.3m4.4.3-1.9-4M12 22l-2-4m2 4 2-4M3.34 17l1.9-4m-1.9 4 4.4-.3M3.34 7l4.4.3M3.34 7l1.9 4',
  graph: 'M6 6h5a4 4 0 0 1 4 4v4a4 4 0 0 0 4 4M6 6V4H2v4h4V6Zm16 10h-4v4h4v-4ZM6 16H2v4h4v-4Zm0 2h8',
  runs: 'M3 12h4l3-7 4 14 3-7h4',
  findings: 'M11 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6M7 7h10M7 11h5m-5 4h2m11.5 5.5L22 22m-1-5a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  templates: 'M3 3h8v8H3zm10 0h8v8h-8zM3 13h8v8H3zm10 0h8v8h-8z',
  start: 'm8 5 12 7-12 7z',
  finish: 'M5 12l4 4L19 6',
  secrets: 'M14 10a5 5 0 1 1 5 5l-5 5h-3v-3l5-5',
  sca: 'm12 3 9 5v8l-9 5-9-5V8l9-5Zm-9 5 9 5 9-5m-9 5v8m-5-10 9-5',
  sast: 'm8 7-5 5 5 5m8-10 5 5-5 5m-3-12-2 14',
  gradle: 'M4 6h16v12H4zM4 10h16m-12 4 2 2 3-3',
  coverage: 'M4 19h16M6 15v-3m4 3V8m4 7v-5m4 5V5',
  ai: 'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Zm7 0v4m-2-2h4',
  condition: 'M6 3v13a3 3 0 0 0 3 3h6M6 10a4 4 0 0 1 4-4h5m-2-2 2 2-2 2m0 9 2 2-2 2',
  telegram: 'M22 3 2 11l7 2.5L12 21l10-18ZM9 13.5l8-6.5',
  layout: 'M3 5h4v4H3zm14 0h4v4h-4zM10 15h4v4h-4zM7 7h10m-5 0v8',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  fit: 'M8 4H4v4m12-4h4v4m0 8v4h-4m-8 0H4v-4',
  arrow: 'M4 12h16m-6-5 6 5-6 5',
  panel: 'M3 4h18v16H3zm12 0v16',
  upload: 'M12 16V4m-5 5 5-5 5 5M4 16v4h16v-4',
} as const

export function Icon({ name, size = 18 }: { name: keyof typeof paths; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={paths[name]} />
  </svg>
}
