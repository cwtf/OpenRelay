// Original line icons drawn on a 24px grid. Stroke-based so they inherit
// `currentColor` and scale cleanly at any density.

const PATHS = {
  menu: 'M4 7h16M4 12h16M4 17h16',
  back: 'M19 12H5M11 6l-6 6 6 6',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM20 20l-4.8-4.8',
  close: 'M6 6l12 12M18 6L6 18',
  more: 'M12 5.5v.01M12 12v.01M12 18.5v.01',
  sort: 'M4 7h9M4 12h6M4 17h3M17 5v14M14 16l3 3 3-3',
  cards:
    'M5 4h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM4 18h16M4 21h10',
  compact: 'M4 6h9M4 10h6M15.5 5h4v5h-4zM4 15h9M4 19h6M15.5 14h4v5h-4z',
  list: 'M4.5 5h4v4h-4zM11 6h9M11 8.5h5M4.5 15h4v4h-4zM11 16h9M11 18.5h5',
  comment:
    'M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8.5L6 19.5V16H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
  up: 'M12 19V6M6.5 11.5L12 6l5.5 5.5',
  down: 'M12 5v13M6.5 12.5L12 18l5.5-5.5',
  share: 'M12 4v11M8 8l4-4 4 4M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5',
  external:
    'M14 5h5v5M19 5l-8 8M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4',
  tune: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
  chevronDown: 'M6 9l6 6 6-6',
  chevronUp: 'M6 15l6-6 6 6',
  chevronRight: 'M9 6l6 6-6 6',
  chevronLeft: 'M15 6l-6 6 6 6',
  image: 'M5 5h14v14H5zM5 15.5l4-4 4.5 4.5 2-2L19 17.5M15 9v.01',
  gallery: 'M8 8h12v12H8zM4 16V4h12',
  link: 'M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1',
  refresh: 'M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5',
  reply: 'M10 7.5L5 12l5 4.5M5 12h9a5 5 0 0 1 5 5v2',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  pin: 'M9 4h6l-1 6 3 3H7l3-3zM12 13v7',
  lock: 'M6 11h12v9H6zM9 11V8a3 3 0 0 1 6 0v3',
  check: 'M5 12.5l4.5 4.5L19 7',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7.5v.01',
  people:
    'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3 20a6 6 0 0 1 12 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14.5a6 6 0 0 1 3 5.5',
  hide: 'M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 9 6 9 6a15 15 0 0 1-2.6 3.2M6.6 7.6C4.3 9.1 3 12 3 12s4 6 9 6a9 9 0 0 0 4.4-1.2M9.9 9.9a3 3 0 0 0 4.2 4.2',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  plus: 'M12 5v14M5 12h14',
  hot: 'M12 21c-3.9 0-7-2.8-7-6.5 0-3 2-5 3.5-6.5.3 2 1.5 3 2.5 3.5C11 8 12 5 15 3c-.5 3 3.5 5.5 3.5 10 0 4.5-2.6 8-6.5 8z',
  new: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM18.5 16l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z',
  top: 'M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7',
  rising: 'M4 17l6-6 4 4 6-7M15 8h5v5',
  controversial: 'M13 3L5 13.5h6L10 21l8-10.5h-6z',
  home: 'M4 11l8-7 8 7v9h-5v-6H9v6H4z',
  text: 'M4 18L9 6l5 12M5.8 14h6.4M15 18l3-7 3 7M15.8 16h4.4',
  shield: 'M12 3l7 3v5c0 5-3 8.5-7 10-4-1.5-7-5-7-10V6z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20a7.5 7.5 0 0 1 15 0',
  play: 'M8 5.5v13l11-6.5z',
  pause: 'M8 5v14M16 5v14',
  zoom: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM20 20l-4.8-4.8M10.5 8v5M8 10.5h5',
  poll: 'M5 20V10M12 20V4M19 20v-7',
  collapse: 'M7 9l5-5 5 5M7 15l5 5 5-5',
  op: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20a7.5 7.5 0 0 1 15 0M17 4l2 2 3-3',
  thread: 'M6 4v8a4 4 0 0 0 4 4h8M14 12l4 4-4 4',
} as const;

const FILLED = new Set<IconName>(['play']);
const DOTS = new Set<IconName>(['more']);

export type IconName = keyof typeof PATHS;

type IconProps = {
  name: IconName;
  size?: number;
  className?: string;
  title?: string;
};

export const Icon = ({ name, size = 24, className, title }: IconProps) => {
  const filled = FILLED.has(name);
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={DOTS.has(name) ? 3.2 : filled ? 0 : 1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title ? <title>{title}</title> : null}
      <path d={PATHS[name]} />
    </svg>
  );
};
