import { useMemo, useState } from 'react';
import { formatCompact, formatEuro, formatPct } from '../utils/format';

export interface Datum {
  id: string;
  label: string;
  value: number;
  color: string;
}

/* ─────────────── Donut ─────────────── */
export function Donut({ data, size = 220, thickness = 34, centerLabel, centerValue, selectedId, onSelect }: { data: Datum[]; size?: number; thickness?: number; centerLabel?: string; centerValue?: string; selectedId?: string | null; onSelect?: (id: string | null) => void }) {
  const [hover, setHover] = useState<string | null>(null);
  const total = data.reduce((s, d) => s + Math.max(0, d.value), 0);
  const r = size / 2 - 6;
  const inner = r - thickness;
  const cx = size / 2;
  let angle = -Math.PI / 2;
  const active = hover ?? selectedId ?? null;
  const activeDatum = data.find((d) => d.id === active);

  const arcs = data.map((d) => {
    const frac = total > 0 ? Math.max(0, d.value) / total : 0;
    const a0 = angle;
    const a1 = angle + frac * Math.PI * 2;
    angle = a1;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const grow = active === d.id ? 5 : 0;
    const R = r + grow;
    const p = (rad: number, a: number) => `${cx + rad * Math.cos(a)} ${cx + rad * Math.sin(a)}`;
    const path =
      frac >= 0.9999
        ? `M ${p(R, 0)} A ${R} ${R} 0 1 1 ${p(R, Math.PI)} A ${R} ${R} 0 1 1 ${p(R, 0)} M ${p(inner, 0)} A ${inner} ${inner} 0 1 0 ${p(inner, Math.PI)} A ${inner} ${inner} 0 1 0 ${p(inner, 0)} Z`
        : `M ${p(R, a0)} A ${R} ${R} 0 ${large} 1 ${p(R, a1)} L ${p(inner, a1)} A ${inner} ${inner} 0 ${large} 0 ${p(inner, a0)} Z`;
    return { d, path, frac };
  });

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto w-full max-w-[260px]" role="img" aria-label="Graphique en anneau">
      {total === 0 && <circle cx={cx} cy={cx} r={r - thickness / 2} fill="none" stroke="#e2e8f0" strokeWidth={thickness} />}
      {arcs.map(({ d, path, frac }) =>
        frac > 0 ? (
          <path
            key={d.id}
            d={path}
            fill={d.color}
            fillRule="evenodd"
            opacity={active && active !== d.id ? 0.35 : 1}
            className="cursor-pointer transition-all duration-200"
            onMouseEnter={() => setHover(d.id)}
            onMouseLeave={() => setHover(null)}
            onClick={() => onSelect?.(selectedId === d.id ? null : d.id)}
          >
            <title>{`${d.label} : ${formatEuro(d.value)} (${formatPct(frac)})`}</title>
          </path>
        ) : null
      )}
      <text x={cx} y={cx - 8} textAnchor="middle" className="fill-slate-500" fontSize="11">
        {activeDatum ? activeDatum.label.slice(0, 26) : centerLabel}
      </text>
      <text x={cx} y={cx + 14} textAnchor="middle" className="fill-slate-900" fontSize="18" fontWeight="700">
        {activeDatum ? formatEuro(activeDatum.value, false) : centerValue}
      </text>
      {activeDatum && total > 0 && (
        <text x={cx} y={cx + 32} textAnchor="middle" className="fill-slate-500" fontSize="11">
          {formatPct(activeDatum.value / total)}
        </text>
      )}
    </svg>
  );
}

/* ─────────────── Barres horizontales ─────────────── */
export function HBars({ data, total, selectedId, onSelect, suffix }: { data: Datum[]; total?: number; selectedId?: string | null; onSelect?: (id: string | null) => void; suffix?: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const sum = total ?? data.reduce((s, d) => s + d.value, 0);
  return (
    <ul className="space-y-2.5">
      {data.map((d) => (
        <li key={d.id}>
          <button type="button" onClick={() => onSelect?.(selectedId === d.id ? null : d.id)} className={`group w-full rounded-lg px-1.5 py-1 text-left transition ${selectedId === d.id ? 'bg-slate-100' : 'hover:bg-slate-50'}`}>
            <div className="mb-1 flex items-center justify-between gap-2 text-sm">
              <span className="flex min-w-0 items-center gap-2 font-medium text-slate-700">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: d.color }} />
                <span className="truncate">{d.label}</span>
              </span>
              <span className="shrink-0 tabular-nums">
                <strong className="font-semibold text-slate-900">{formatEuro(d.value)}</strong>
                {suffix && <span className="text-xs text-slate-400">{suffix}</span>}
                <span className="ml-1.5 text-xs text-slate-500">{sum > 0 ? formatPct(d.value / sum) : ''}</span>
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${(d.value / max) * 100}%`, backgroundColor: d.color }} />
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

/* ─────────────── Treemap (squarified) ─────────────── */
interface Rect { x: number; y: number; w: number; h: number; d: Datum }

function squarify(items: Datum[], x: number, y: number, w: number, h: number): Rect[] {
  const total = items.reduce((s, d) => s + d.value, 0);
  if (!items.length || total <= 0) return [];
  const scale = (w * h) / total;
  const nodes = items.map((d) => ({ d, area: d.value * scale }));
  const out: Rect[] = [];
  let rx = x, ry = y, rw = w, rh = h;
  let row: typeof nodes = [];
  const worst = (r: typeof nodes, side: number) => {
    const s = r.reduce((t, n) => t + n.area, 0);
    const mx = Math.max(...r.map((n) => n.area));
    const mn = Math.min(...r.map((n) => n.area));
    return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
  };
  const layout = (r: typeof nodes) => {
    const s = r.reduce((t, n) => t + n.area, 0);
    if (rw >= rh) {
      const cw = s / rh;
      let cy = ry;
      for (const n of r) { const ch = n.area / cw; out.push({ x: rx, y: cy, w: cw, h: ch, d: n.d }); cy += ch; }
      rx += cw; rw -= cw;
    } else {
      const ch = s / rw;
      let cx = rx;
      for (const n of r) { const cw = n.area / ch; out.push({ x: cx, y: ry, w: cw, h: ch, d: n.d }); cx += cw; }
      ry += ch; rh -= ch;
    }
  };
  for (const n of nodes) {
    const side = Math.min(rw, rh);
    if (!row.length || worst([...row, n], side) <= worst(row, side)) row.push(n);
    else { layout(row); row = [n]; }
  }
  if (row.length) layout(row);
  return out;
}

export function Treemap({ data, height = 300, selectedId, onSelect }: { data: Datum[]; height?: number; selectedId?: string | null; onSelect?: (id: string | null) => void }) {
  const W = 600;
  const total = data.reduce((s, d) => s + d.value, 0);
  const rects = useMemo(() => squarify(data.filter((d) => d.value > 0).sort((a, b) => b.value - a.value), 0, 0, W, height), [data, height]);
  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="w-full rounded-xl" role="img" aria-label="Treemap">
      {rects.map((r) => {
        const big = r.w > 70 && r.h > 34;
        return (
          <g key={r.d.id} className="cursor-pointer" onClick={() => onSelect?.(selectedId === r.d.id ? null : r.d.id)} opacity={selectedId && selectedId !== r.d.id ? 0.4 : 1}>
            <rect x={r.x + 1} y={r.y + 1} width={Math.max(0, r.w - 2)} height={Math.max(0, r.h - 2)} rx={8} fill={r.d.color} className="transition-opacity hover:opacity-90">
              <title>{`${r.d.label} : ${formatEuro(r.d.value)} (${formatPct(r.d.value / total)})`}</title>
            </rect>
            {big && (
              <>
                <text x={r.x + 10} y={r.y + 20} fill="white" fontSize="12" fontWeight="600" pointerEvents="none">
                  {r.d.label.length * 6.5 > r.w - 16 ? r.d.label.slice(0, Math.max(3, Math.floor((r.w - 16) / 6.5))) + '…' : r.d.label}
                </text>
                <text x={r.x + 10} y={r.y + 36} fill="white" fillOpacity={0.9} fontSize="11" pointerEvents="none">
                  {formatEuro(r.d.value, false)} · {formatPct(r.d.value / total, 0)}
                </text>
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/* ─────────────── Barre 100 % empilée ─────────────── */
export function StackedBar({ data, height = 28, showLabels = true }: { data: Datum[]; height?: number; showLabels?: boolean }) {
  const total = data.reduce((s, d) => s + Math.max(0, d.value), 0);
  return (
    <div>
      <div className="flex w-full overflow-hidden rounded-lg bg-slate-100" style={{ height }}>
        {data.map((d) =>
          d.value > 0 ? (
            <div key={d.id} className="h-full transition-all duration-500 first:rounded-l-lg last:rounded-r-lg" style={{ width: `${(d.value / total) * 100}%`, backgroundColor: d.color }} title={`${d.label} : ${formatEuro(d.value)} (${formatPct(d.value / total)})`} />
          ) : null
        )}
      </div>
      {showLabels && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {data.filter((d) => d.value > 0).map((d) => (
            <span key={d.id} className="flex items-center gap-1.5 text-xs text-slate-600">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: d.color }} />
              {d.label} <span className="font-medium text-slate-900 tabular-nums">{formatPct(d.value / total, 0)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────────── Courbes ─────────────── */
export interface Series {
  id: string;
  label: string;
  color: string;
  values: number[];
  dashed?: boolean;
}

export function LineChart({ series, xLabels, height = 260, formatY = formatCompact }: { series: Series[]; xLabels: string[]; height?: number; formatY?: (v: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const pad = { l: 56, r: 12, t: 12, b: 26 };
  const n = xLabels.length;
  const all = series.flatMap((s) => s.values);
  const maxY = Math.max(1, ...all) * 1.05;
  const minY = Math.min(0, ...all);
  const x = (i: number) => pad.l + (n <= 1 ? 0 : (i / (n - 1)) * (W - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - (v - minY) / (maxY - minY)) * (height - pad.t - pad.b);
  const ticks = 4;
  const step = Math.max(1, Math.ceil(n / 8));

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${height}`}
        className="w-full"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * W;
          const i = Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (n - 1));
          setHover(Math.max(0, Math.min(n - 1, i)));
        }}
      >
        {Array.from({ length: ticks + 1 }, (_, i) => {
          const v = minY + ((maxY - minY) * i) / ticks;
          return (
            <g key={i}>
              <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="#f1f5f9" />
              <text x={pad.l - 6} y={y(v) + 4} textAnchor="end" fontSize="10" className="fill-slate-400">
                {formatY(v)}
              </text>
            </g>
          );
        })}
        {xLabels.map((l, i) =>
          i % step === 0 || i === n - 1 ? (
            <text key={i} x={x(i)} y={height - 8} textAnchor="middle" fontSize="10" className="fill-slate-400">
              {l}
            </text>
          ) : null
        )}
        {series.map((s) => (
          <g key={s.id}>
            <path d={s.values.map((v, i) => `${i ? 'L' : 'M'} ${x(i)} ${y(v)}`).join(' ')} fill="none" stroke={s.color} strokeWidth={2.2} strokeDasharray={s.dashed ? '5 4' : undefined} strokeLinejoin="round" />
          </g>
        ))}
        {hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={height - pad.b} stroke="#cbd5e1" strokeDasharray="3 3" />
            {series.map((s) => (
              <circle key={s.id} cx={x(hover)} cy={y(s.values[hover] ?? 0)} r={3.5} fill="white" stroke={s.color} strokeWidth={2} />
            ))}
          </g>
        )}
      </svg>
      {hover != null && (
        <div className="pointer-events-none absolute top-2 rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-md" style={{ left: `${Math.min(70, (x(hover) / W) * 100)}%` }}>
          <p className="mb-1 font-semibold text-slate-700">{xLabels[hover]}</p>
          {series.map((s) => (
            <p key={s.id} className="flex items-center gap-1.5 tabular-nums">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
              <span className="text-slate-500">{s.label}</span>
              <span className="ml-auto pl-3 font-semibold text-slate-900">{formatEuro(s.values[hover] ?? 0, false)}</span>
            </p>
          ))}
        </div>
      )}
      <div className="mt-1 flex flex-wrap gap-3">
        {series.map((s) => (
          <span key={s.id} className="flex items-center gap-1.5 text-xs text-slate-600">
            <span className="h-0.5 w-4 rounded" style={{ backgroundColor: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ─────────────── Jauge ─────────────── */
export function Gauge({ value, size = 180 }: { value: number; size?: number }) {
  const v = Math.max(0, Math.min(100, value));
  const r = size / 2 - 14;
  const cx = size / 2;
  const cy = size / 2 + 6;
  const a = Math.PI * (1 - v / 100);
  const color = v >= 75 ? '#10b981' : v >= 50 ? '#f59e0b' : '#ef4444';
  const arc = (from: number, to: number) => `M ${cx + r * Math.cos(from)} ${cy - r * Math.sin(from)} A ${r} ${r} 0 0 1 ${cx + r * Math.cos(to)} ${cy - r * Math.sin(to)}`;
  return (
    <svg viewBox={`0 0 ${size} ${size / 2 + 26}`} className="mx-auto w-full max-w-[220px]">
      <path d={arc(Math.PI, 0)} stroke="#e2e8f0" strokeWidth={14} fill="none" strokeLinecap="round" />
      {v > 0 && <path d={arc(Math.PI, a)} stroke={color} strokeWidth={14} fill="none" strokeLinecap="round" />}
      <text x={cx} y={cy - 8} textAnchor="middle" fontSize="34" fontWeight="800" fill={color}>
        {Math.round(v)}
      </text>
      <text x={cx} y={cy + 12} textAnchor="middle" fontSize="11" className="fill-slate-500">
        sur 100
      </text>
    </svg>
  );
}

/* ─────────────── Sparkline ─────────────── */
export function Sparkline({ values, color = '#6366f1', width = 120, height = 32 }: { values: number[]; color?: string; width?: number; height?: number }) {
  if (values.length < 2) return <div style={{ width, height }} className="flex items-center text-[10px] text-slate-400">1 relevé</div>;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * width},${height - 3 - ((v - min) / (max - min || 1)) * (height - 6)}`);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
    </svg>
  );
}
