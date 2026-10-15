"use client";

import type { ReactNode } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useFormat } from "@/lib/format";

/** Chart palette: validated categorical slots (see globals.css --chart-*). */
export const SERIES = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

interface SeriesDef {
  key: string;
  label: string;
}

function ChartTooltip({ active, payload, label, valueFormat }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string; valueFormat?: (n: number) => string }) {
  const f = useFormat();
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-surface-3 px-3 py-2 text-xs shadow-xl">
      <div className="mb-1 font-medium text-fg">{label ? f.date(label) : null}</div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 text-muted">
          <span className="h-0.5 w-3 rounded" style={{ background: p.color }} />
          <span>{p.name}</span>
          <span className="num ml-auto pl-4 text-fg">{valueFormat ? valueFormat(p.value) : f.number(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

export function TimeSeriesChart({ data, series, height = 240, area = false, valueFormat }: { data: Record<string, unknown>[]; series: SeriesDef[]; height?: number; area?: boolean; valueFormat?: (n: number) => string }) {
  const f = useFormat();
  const common = {
    data,
    margin: { top: 8, right: 8, bottom: 0, left: -12 },
  };
  const axes = (
    <>
      <CartesianGrid vertical={false} strokeDasharray="0" />
      <XAxis dataKey="date" tickFormatter={(d: string) => f.date(d, "short")} tickLine={false} axisLine={{ stroke: "var(--chart-grid)" }} minTickGap={28} />
      <YAxis tickLine={false} axisLine={false} width={44} allowDecimals={false} tickFormatter={(n: number) => f.number(n, Number.isInteger(n) ? 0 : 1)} />
      <Tooltip content={<ChartTooltip valueFormat={valueFormat} />} cursor={{ stroke: "rgb(var(--subtle))", strokeDasharray: "3 3" }} />
      {series.length > 1 && <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, paddingTop: 4 }} />}
    </>
  );
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        {area ? (
          <AreaChart {...common}>
            <defs>
              {series.map((s, i) => (
                <linearGradient key={s.key} id={`fill-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={SERIES[i % SERIES.length]} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={SERIES[i % SERIES.length]} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            {axes}
            {series.map((s, i) => (
              <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={SERIES[i % SERIES.length]} strokeWidth={2} fill={`url(#fill-${s.key})`} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "rgb(var(--surface))" }} />
            ))}
          </AreaChart>
        ) : (
          <LineChart {...common}>
            {axes}
            {series.map((s, i) => (
              <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={SERIES[i % SERIES.length]} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "rgb(var(--surface))" }} />
            ))}
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

export function SimpleBarChart({ data, xKey, yKey, label, height = 220, valueFormat, xFormat }: { data: Record<string, unknown>[]; xKey: string; yKey: string; label: string; height?: number; valueFormat?: (n: number) => string; xFormat?: (v: string) => string }) {
  const f = useFormat();
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey={xKey} tickLine={false} axisLine={{ stroke: "var(--chart-grid)" }} tickFormatter={xFormat} interval={0} fontSize={11} />
          <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={(n: number) => f.number(n, Number.isInteger(n) ? 0 : 1)} />
          <Tooltip
            cursor={{ fill: "rgb(var(--surface-3) / .5)" }}
            content={({ active, payload, label: l }) =>
              active && payload?.length ? (
                <div className="rounded-lg border border-border bg-surface-3 px-3 py-2 text-xs shadow-xl">
                  <div className="font-medium">{xFormat ? xFormat(String(l)) : String(l)}</div>
                  <div className="text-muted">
                    {label}: <span className="num text-fg">{valueFormat ? valueFormat(Number(payload[0].value)) : f.number(Number(payload[0].value))}</span>
                  </div>
                </div>
              ) : null
            }
          />
          <Bar dataKey={yKey} name={label} fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={36} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const w = 100;
  const h = 28;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - ((v - min) / (max - min || 1)) * (h - 4) - 2}`).join(" ");
  const up = values.at(-1)! >= values[0];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={className} aria-hidden>
      <polyline points={pts} fill="none" stroke={up ? "var(--chart-1)" : "var(--chart-2)"} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

/** Horizontal bar list (labels + values) — readable alternative to pie charts. */
export function BarList({ items, valueFormat }: { items: { label: string; value: number; hint?: string; detail?: ReactNode }[]; valueFormat?: (n: number) => string }) {
  const f = useFormat();
  const max = Math.max(...items.map((i) => Math.abs(i.value)), 1);
  return (
    <ul className="space-y-2">
      {items.map((it) => (
        <li key={it.label} className="text-sm">
          <div className="mb-1 flex items-center justify-between gap-3">
            <span className="truncate text-muted">{it.label}</span>
            <span className="num shrink-0 text-fg">
              {valueFormat ? valueFormat(it.value) : f.number(it.value)}
              {it.hint ? <span className="ml-1.5 text-xs text-subtle">{it.hint}</span> : null}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-surface-3">
            <div className="h-1.5 rounded-full" style={{ width: `${(Math.abs(it.value) / max) * 100}%`, background: it.value < 0 ? "var(--chart-2)" : "var(--chart-1)" }} />
          </div>
          {it.detail ? <div className="mt-1">{it.detail}</div> : null}
        </li>
      ))}
    </ul>
  );
}
