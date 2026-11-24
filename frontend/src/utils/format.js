const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

/** 1536 -> "1.5 KB". Accepts numbers or numeric strings; null/NaN -> "0 B". */
export function formatBytes(bytes, decimals = 1) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), UNITS.length - 1);
  const value = n / 1024 ** i;
  return `${i === 0 ? value : value.toFixed(value >= 100 ? 0 : decimals)} ${UNITS[i]}`;
}

export const formatNumber = (n) => new Intl.NumberFormat().format(Number(n) || 0);

export const formatPercent = (n, digits = 0) => {
  const v = Number(n) || 0;
  if (v > 0 && v < 1 && digits === 0) return "<1%"; // a non-empty drive never reads as 0%
  return `${v.toFixed(digits)}%`;
};

const toDate = (v) => (v instanceof Date ? v : new Date(v));
const valid = (d) => d instanceof Date && !Number.isNaN(d.getTime());

export function formatDate(value, opts = { year: 'numeric', month: 'short', day: 'numeric' }) {
  const d = toDate(value);
  return valid(d) ? new Intl.DateTimeFormat(undefined, opts).format(d) : '—';
}

export const formatDateTime = (value) =>
  formatDate(value, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

const RTF = typeof Intl !== 'undefined' && Intl.RelativeTimeFormat ? new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }) : null;
const STEPS = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

/** "3 minutes ago", "yesterday", "in 2 days". Falls back to an absolute date past ~1 year. */
export function formatRelative(value, now = Date.now()) {
  const d = toDate(value);
  if (!valid(d)) return '—';
  const diff = Math.round((d.getTime() - now) / 1000);
  const abs = Math.abs(diff);
  if (abs < 45) return 'just now';
  for (const [unit, secs] of STEPS) {
    if (abs >= secs) {
      const amount = Math.round(diff / secs);
      return RTF ? RTF.format(amount, unit) : formatDate(d);
    }
  }
  return RTF ? RTF.format(Math.round(diff / 60), 'minute') : formatDate(d);
}

export function initials(name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return ((parts[0][0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export const pluralize = (n, one, many = `${one}s`) => `${formatNumber(n)} ${n === 1 ? one : many}`;
