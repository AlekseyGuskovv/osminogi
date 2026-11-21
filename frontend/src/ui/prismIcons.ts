export const prismIcons = {
  // Workflow nodes
  start: 'M6.5 5.3a1 1 0 0 1 1.5-.85l12 6.7a1 1 0 0 1 0 1.7l-12 6.7a1 1 0 0 1-1.5-.85Z',
  secrets: 'M13 4.5a5 5 0 1 1 2.3 9.5L8 21H4v-4l2.5-2.5H9V12l2-2a5 5 0 0 1 2-5.5ZM16.5 8.5h.01',
  sca: 'M12 3 5 7v8l7 4 7-4V7l-7-4ZM5 7l7 4 7-4m-7 4v8m-3.5-10 7-4',
  sast: 'm8 6-5 6 5 6m8-12 5 6-5 6m-2-14-4 16',
  ai: 'M10 3.5 12 9l5.5 2L12 13l-2 5.5L8 13l-5.5-2L8 9l2-5.5ZM18 3v4m-2-2h4m-2 10 1 2.5 2.5 1-2.5 1L18 22l-1-2.5-2.5-1 2.5-1L18 15Z',
  condition: 'M4 12h5m0 0 4-4h4m-8 4 4 4h4m0-10 2 2-2 2m0 4 2 2-2 2',
  telegram: 'm3 10 18-6-5 16-4-6-5-1.5L17 7l-5 7v4l2-1.5',
  finish: 'M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-11.5 0 2.3 2.3 4.7-4.7',
  gradle: 'M4 5h16v14H4zM4 9h16m-13 4 2 2 3-3m2 3h3',
  coverage: 'M4 4v15h16M8 15v-3m4 3V8m4 7V5',
  // Workspace and controls
  brand: 'M12 2v20M3.34 7l17.32 10m0-10L3.34 17M12 2l2 4m-2-4-2 4m10.66 1-1.9 4m1.9-4-4.4.3M20.66 17l-4.4-.3m4.4.3-1.9-4M12 22l-2-4m2 4 2-4M3.34 17l1.9-4m-1.9 4 4.4-.3M3.34 7l4.4.3M3.34 7l1.9 4',
  graph: 'M3 4h5v5H3zm13 11h5v5h-5zM3 15h5v5H3zm5-8.5h4a2 2 0 0 1 2 2v7a2 2 0 0 0 2 2m-8 0h3',
  runs: 'M3 12h4l3-6 4 12 3-6h4',
  findings: 'M11 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6M7 7h10M7 11h5m-5 4h2m11.5 5.5L22 22m-1-5a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  snapshots: 'm12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5',
  templates: 'M4 4h6v6H4zm10 0h6v6h-6zM4 14h6v6H4zm10 0h6v6h-6z',
  settings: 'M4 6h5m4 0h7M4 12h10m4 0h2M4 18h2m4 0h10M9 4h4v4H9zm5 6h4v4h-4zm-8 6h4v4H6z',
  layout: 'M4 5h4v4H4zm12 0h4v4h-4zm-6 10h4v4h-4zM8 7h8m-4 0v8',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  fit: 'M9 4H4v5m11-5h5v5m0 6v5h-5m-6 0H4v-5',
  arrow: 'M4 12h15m-5-5 5 5-5 5',
  panel: 'M4 5h16v14H4zm10 0v14',
  upload: 'M12 15V4m-4 4 4-4 4 4M4 16v4h16v-4',
  close: 'm6 6 12 12M18 6 6 18',
  check: 'm5 12 4 4 10-10',
  alert: 'M12 8v5m0 3h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  clock: 'M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
} as const

export type PrismIconName = keyof typeof prismIcons
