// Minimal stroke icon set (24px grid), drawn inline so the app has no icon dependency.
const PATHS: Record<string, string> = {
  image: 'M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5M15 9.5a1.5 1.5 0 1 0 0-.01',
  layers: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
  sparkle: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18',
  play: 'M7 5l12 7-12 7z',
  stop: 'M6 6h12v12H6z',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  compare: 'M12 3v18M5 5h5v14H5zM14 5h5v14h-5z',
  zoom: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4M8 11h6M11 8v6',
  fit: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
  chevron: 'M9 6l6 6-6 6',
  text: 'M5 6h14M12 6v13M9 19h6',
  check: 'M5 12l5 5 9-10',
  library: 'M5 4h4v16H5zM11 4h4v16h-4zM17 5l3 .8-3.5 14.5-3-.8',
  pulse: 'M3 12h4l2-6 4 12 2-6h6',
  mask: 'M12 3a9 9 0 1 0 0 18V3z',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  monitor: 'M3 5h18v11H3zM8 20h8M12 16v4',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  arrowLeft: 'M15 6l-6 6 6 6',
  arrowRight: 'M9 6l6 6-6 6',
  arrowUp: 'M12 19V5M6 11l6-6 6 6',
  person: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 21c1-4 4-6 8-6s7 2 8 6',
  scene: 'M3 19l6-8 4 5 3-3 5 6zM16 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  pose: 'M13 4a2 2 0 1 0 0 .01M10 21l2-7 3 3v4M8 10l4-2 3 3 3 1M12 8l-1 6',
  select: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 17l2 2 4-4',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  wand: 'M5 19L15 9M14 4v2M19 9h2M17.5 5.5L16 7M19 14l-1.5-1.5M9.5 4.5L11 6',
};

export function Icon({name, size = 16, title}: {name: keyof typeof PATHS | string; size?: number; title?: string}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}
         strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      <path d={PATHS[name] ?? PATHS.sparkle} />
    </svg>
  );
}
