import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatBytes, formatNumber } from '../../utils/format.js';
import { cn } from '../../utils/cn.js';

// Colour follows the category (entity), never its rank, so filtering never repaints the survivors.
// Theme-variable colours follow light/dark automatically; the fixed hexes are mid-tones that read on both surfaces.
export const CATEGORY_COLORS = {
  image: 'rgb(var(--color-brand))',
  pdf: 'rgb(var(--color-accent))',
  document: 'rgb(var(--color-info))',
  spreadsheet: '#8b6fd1',
  presentation: '#d9588a',
  video: '#3aa0c4',
  archive: '#8a8578',
  text: '#6f9a3d',
  other: 'rgb(var(--color-content-faint))',
};
export const categoryColor = (c) => CATEGORY_COLORS[c] ?? CATEGORY_COLORS.other;

const AXIS = { fontSize: 11, fill: 'rgb(var(--color-content-muted))' };

export function ChartTooltip({ active, payload, label, render }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-pop">
      {label != null && <p className="mb-1 font-semibold text-content">{label}</p>}
      {render(payload[0].payload)}
    </div>
  );
}

const shortDate = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** Donut + legend. Legend rows carry label, size and count so identity is never colour-only. */
export function CategoryDonut({ data, className }) {
  const rows = data.filter((d) => d.bytes > 0 || d.count > 0);
  const total = rows.reduce((s, r) => s + r.bytes, 0);
  return (
    <div className={cn('flex flex-col items-center gap-5 sm:flex-row lg:flex-col xl:flex-row', className)}>
      <div className="relative h-44 w-44 shrink-0" role="img" aria-label="Storage by file type">
        <ResponsiveContainer>
          <PieChart>
            <Pie data={rows} dataKey="bytes" nameKey="label" innerRadius={56} outerRadius={80} paddingAngle={2} stroke="rgb(var(--color-surface))" strokeWidth={2}>
              {rows.map((r) => <Cell key={r.category} fill={categoryColor(r.category)} />)}
            </Pie>
            <Tooltip content={<ChartTooltip render={(p) => <p className="tabular text-content-muted">{formatBytes(p.bytes)} · {formatNumber(p.count)} files</p>} />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-display text-lg font-semibold tabular">{formatBytes(total)}</span>
          <span className="text-[11px] text-content-muted">in files</span>
        </div>
      </div>
      <ul className="w-full min-w-0 flex-1 space-y-2">
        {rows.map((r) => (
          <li key={r.category} className="flex items-center gap-2.5 text-sm">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: categoryColor(r.category) }} />
            <span className="min-w-0 flex-1 truncate">{r.label}</span>
            <span className="tabular text-content-muted">{formatBytes(r.bytes)}</span>
            <span className="tabular w-14 text-right text-xs text-content-faint">{formatNumber(r.count)} {r.count === 1 ? 'file' : 'files'}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Daily series area chart. `metric` = 'count' | 'bytes'. */
export function DailyArea({ data, metric = 'count', color = 'rgb(var(--color-brand))', label = 'Uploads', height = 220 }) {
  const fmt = metric === 'bytes' ? formatBytes : formatNumber;
  const id = `fill-${metric}-${label.replace(/\W/g, '')}`;
  return (
    <div style={{ height }} role="img" aria-label={`${label} over the last 30 days`}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.28} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="rgb(var(--color-border))" strokeDasharray="3 3" />
          <XAxis dataKey="date" tickFormatter={shortDate} tick={AXIS} tickLine={false} axisLine={false} minTickGap={32} />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} width={metric === 'bytes' ? 56 : 36} allowDecimals={false} tickFormatter={(v) => (metric === 'bytes' ? formatBytes(v, 0) : v)} />
          <Tooltip cursor={{ stroke: 'rgb(var(--color-border-strong))' }}
            content={<ChartTooltip render={(p) => <p className="tabular text-content-muted">{label}: <span className="font-semibold text-content">{fmt(p[metric])}</span></p>} />}
            labelFormatter={shortDate} />
          <Area type="monotone" dataKey={metric} stroke={color} strokeWidth={2} fill={`url(#${id})`} dot={false} activeDot={{ r: 4, stroke: 'rgb(var(--color-surface))', strokeWidth: 2 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
