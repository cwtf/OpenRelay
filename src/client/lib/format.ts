const compactFormatter = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

export const compact = (value: number): string =>
  Math.abs(value) < 1000 ? String(value) : compactFormatter.format(value);

export const plural = (count: number, one: string, many = `${one}s`): string =>
  `${compact(count)} ${count === 1 ? one : many}`;

const UNITS: [number, string][] = [
  [60, 's'],
  [60, 'm'],
  [24, 'h'],
  [30, 'd'],
  [12, 'mo'],
  [Number.POSITIVE_INFINITY, 'y'],
];

/** Short relative age such as "4h" or "2mo". */
export const age = (timestamp: number, now = Date.now()): string => {
  let delta = Math.max(0, (now - timestamp) / 1000);
  if (delta < 45) return 'now';
  for (const [size, unit] of UNITS) {
    if (delta < size) return `${Math.floor(delta)}${unit}`;
    delta /= size;
  }
  return 'long ago';
};

export const fullDate = (timestamp: number): string =>
  new Date(timestamp).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

export const duration = (seconds: number): string => {
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = String(total % 60).padStart(2, '0');
  return `${m}:${s}`;
};

/** Stable hue for letter avatars. */
export const hueOf = (text: string): number => {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
};

export const sortLabel: Record<string, string> = {
  hot: 'Hot',
  new: 'New',
  top: 'Top',
  rising: 'Rising',
  controversial: 'Controversial',
  confidence: 'Best',
  old: 'Old',
  qa: 'Q&A',
  relevance: 'Relevance',
  comments: 'Most comments',
};

export const timeframeLabel: Record<string, string> = {
  hour: 'Past hour',
  day: 'Today',
  week: 'This week',
  month: 'This month',
  year: 'This year',
  all: 'All time',
};
