/* AncoraLens — bespoke animated SVG charts (real React port of the design handoff).
   Generic, dependency-free primitives that bind to whatever real data is passed in.
   The original mockup hard-coded its demo series; these accept generic props so the
   reskinned Overview can feed them parsed CSV metrics. */
import { useEffect, useMemo, useRef, useState } from "react";

/* animate 0→1 over duration once mounted (respects reduced-motion) */
export function useGrow(duration = 1100, delay = 0) {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setT(1);
      return undefined;
    }
    let raf;
    let start;
    const ease = (x) => 1 - Math.pow(1 - x, 3);
    const tick = (ts) => {
      if (!start) start = ts;
      const p = Math.min(1, (ts - start - delay) / duration);
      setT(p < 0 ? 0 : ease(p));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // safety: if rAF is throttled/paused (background tab), settle to final value anyway
    const safety = setTimeout(() => setT(1), duration + delay + 250);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(safety);
    };
  }, [duration, delay]);
  return t;
}

/* count-up number for KPI values */
export function CountUp({ to = 0, dur = 1100, decimals = 0, suffix = "", prefix = "", group = false }) {
  const [v, setV] = useState(0);
  const target = Number.isFinite(to) ? to : 0;
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setV(target);
      return undefined;
    }
    let raf;
    let start;
    const ease = (x) => 1 - Math.pow(1 - x, 3);
    const tick = (ts) => {
      if (!start) start = ts;
      const p = Math.min(1, (ts - start) / dur);
      setV(target * ease(p));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // safety: if rAF is throttled/paused (background tab), settle to final value anyway
    const safety = setTimeout(() => setV(target), dur + 250);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(safety);
    };
  }, [target, dur]);
  const text = group
    ? v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    : v.toFixed(decimals);
  return (
    <span className="tnum">
      {prefix}
      {text}
      {suffix}
    </span>
  );
}

/* ---------- Sparkline for KPI cards ---------- */
export function Sparkline({ data = [], color = "var(--blue)", w = 120, h = 56 }) {
  const t = useGrow(1300);
  const id = useMemo(() => "sp" + Math.random().toString(36).slice(2), []);
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const pts = data.map((v, i) => [
    (i / (data.length - 1)) * w,
    h - 6 - ((v - min) / (max - min || 1)) * (h - 12)
  ]);
  const line = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const area = line + ` L${w} ${h} L0 ${h} Z`;
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.28" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} opacity={t} />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeDasharray="400"
        strokeDashoffset={400 - 400 * t}
      />
    </svg>
  );
}

/* ---------- Main accuracy / value trend (area + line + hover) ----------
   data: [{ value: number, label: string, sub?: string }]
   domain: optional [min, max]; auto-computed with padding otherwise. */
export function AreaTrend({ data = [], accent = "var(--blue)", unit = "", domain = null, gridLines = 4 }) {
  const t = useGrow(1300);
  const [hover, setHover] = useState(null);
  const id = useMemo(() => "trend" + Math.random().toString(36).slice(2), []);

  const W = 760;
  const H = 280;
  const padL = 8;
  const padR = 8;
  const padT = 22;
  const padB = 30;
  const iw = W - padL - padR;
  const ih = H - padT - padB;

  const safe = Array.isArray(data) ? data.filter((d) => Number.isFinite(d?.value)) : [];
  if (safe.length < 2) {
    return <div className="chart-empty">Not enough data points to plot a trend.</div>;
  }

  const vals = safe.map((d) => d.value);
  let lo = domain ? domain[0] : Math.min(...vals);
  let hi = domain ? domain[1] : Math.max(...vals);
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  } else if (!domain) {
    const pad = (hi - lo) * 0.18;
    lo = Math.max(0, lo - pad);
    hi += pad;
  }

  const x = (i) => padL + (i / (safe.length - 1)) * iw;
  const y = (v) => padT + ih - ((v - lo) / (hi - lo)) * ih;
  const line = safe.map((d, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(d.value).toFixed(1)).join(" ");
  const area = line + ` L${x(safe.length - 1)} ${padT + ih} L${x(0)} ${padT + ih} Z`;
  const grid = Array.from({ length: gridLines + 1 }, (_, i) => lo + ((hi - lo) * i) / gridLines);

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - padL) / iw) * (safe.length - 1));
    setHover(Math.max(0, Math.min(safe.length - 1, i)));
  };

  const fmt = (v) => (Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(1));

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: "100%", display: "block", overflow: "visible" }}
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={accent} stopOpacity="0.22" />
          <stop offset="1" stopColor={accent} stopOpacity="0" />
        </linearGradient>
      </defs>
      {grid.map((g, gi) => (
        <g key={gi}>
          <line x1={padL} x2={W - padR} y1={y(g)} y2={y(g)} stroke="var(--line-2)" strokeWidth="1" />
          <text
            x={W - padR}
            y={y(g) - 5}
            textAnchor="end"
            fontSize="10.5"
            fontWeight="700"
            fill="var(--ink-mut)"
            fontFamily="var(--mono)"
          >
            {fmt(g)}
            {unit}
          </text>
        </g>
      ))}
      <path d={area} fill={`url(#${id})`} opacity={t} />
      <path
        d={line}
        fill="none"
        stroke={accent}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="2600"
        strokeDashoffset={2600 - 2600 * t}
      />
      {hover != null && (
        <g>
          <line
            x1={x(hover)}
            x2={x(hover)}
            y1={padT - 6}
            y2={padT + ih}
            stroke="var(--ink)"
            strokeWidth="1.4"
            strokeDasharray="3 4"
            opacity="0.45"
          />
          <circle cx={x(hover)} cy={y(safe[hover].value)} r="6.5" fill="var(--card)" stroke={accent} strokeWidth="3.5" />
          <g transform={`translate(${Math.min(Math.max(x(hover), 60), W - 60)}, ${y(safe[hover].value) - 48})`}>
            <rect x="-58" y="-2" width="116" height="42" rx="9" fill="var(--emph)" />
            <text x="0" y="16" textAnchor="middle" fontSize="15" fontWeight="800" fill="#fff" fontFamily="var(--display)">
              {fmt(safe[hover].value)}
              {unit}
            </text>
            <text x="0" y="31" textAnchor="middle" fontSize="10" fontWeight="600" fill="rgba(255,255,255,.6)">
              {safe[hover].sub || safe[hover].label}
            </text>
          </g>
        </g>
      )}
      <text x={padL} y={H - 6} fontSize="10.5" fontWeight="700" fill="var(--ink-mut)" fontFamily="var(--mono)">
        {safe[0].label}
      </text>
      <text
        x={W - padR}
        y={H - 6}
        textAnchor="end"
        fontSize="10.5"
        fontWeight="700"
        fill="var(--ink-mut)"
        fontFamily="var(--mono)"
      >
        {safe[safe.length - 1].label}
      </text>
    </svg>
  );
}

/* ---------- vertical bars by category ----------
   data: [{ name, count, accuracy?, color }] */
export function DocTypeBars({ data = [], unit = "" }) {
  const t = useGrow(1200);
  const [hi, setHi] = useState(null);
  const W = 560;
  const H = 240;
  const padB = 44;
  const padT = 16;
  const ih = H - padB - padT;
  const safe = Array.isArray(data) ? data.slice(0, 8) : [];
  if (!safe.length) return <div className="chart-empty">No category data available.</div>;
  const max = Math.max(...safe.map((d) => d.count), 1);
  const bw = (W / safe.length) * 0.52;
  const gap = W / safe.length;
  const fmtCount = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block", overflow: "visible" }}>
      {safe.map((d, i) => {
        const h = (d.count / max) * ih * t;
        const cx = gap * i + gap / 2;
        const on = hi === i;
        return (
          <g
            key={d.name + i}
            onMouseEnter={() => setHi(i)}
            onMouseLeave={() => setHi(null)}
            style={{ cursor: "pointer" }}
          >
            <rect x={cx - bw / 2} y={padT} width={bw} height={ih} rx="7" fill="var(--card-2)" />
            <rect
              x={cx - bw / 2}
              y={padT + ih - h}
              width={bw}
              height={h}
              rx="7"
              fill={d.color || "var(--blue)"}
              opacity={hi == null || on ? 1 : 0.42}
              style={{ transition: "opacity .2s" }}
            />
            <text
              x={cx}
              y={padT + ih - h - 8}
              textAnchor="middle"
              fontSize="13"
              fontWeight="800"
              fill="var(--ink)"
              fontFamily="var(--display)"
              opacity={t}
            >
              {fmtCount(d.count)}
            </text>
            <text x={cx} y={H - 24} textAnchor="middle" fontSize="10.5" fontWeight="700" fill="var(--ink-soft)">
              {String(d.name).split(" ")[0].slice(0, 9)}
            </text>
            {d.accuracy != null && (
              <text
                x={cx}
                y={H - 10}
                textAnchor="middle"
                fontSize="10"
                fontWeight="700"
                fill="var(--ink-mut)"
                fontFamily="var(--mono)"
              >
                {d.accuracy}
                {unit}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/* ---------- radial donut for a headline percentage ---------- */
export function Donut({ value = 0, label = "", accent = "var(--lime)", track = "rgba(255,255,255,.14)" }) {
  const t = useGrow(1400);
  const R = 78;
  const C = 2 * Math.PI * R;
  const safe = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  const frac = (safe / 100) * t;
  const shown = (safe * t).toFixed(1);
  return (
    <div style={{ position: "relative", width: 200, height: 200, margin: "0 auto" }}>
      <svg viewBox="0 0 200 200" style={{ width: "100%", transform: "rotate(-90deg)" }}>
        <circle cx="100" cy="100" r={R} fill="none" stroke={track} strokeWidth="16" />
        <circle
          cx="100"
          cy="100"
          r={R}
          fill="none"
          stroke={accent}
          strokeWidth="16"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C - C * frac}
        />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "grid", placeContent: "center", textAlign: "center" }}>
        <div
          style={{
            fontFamily: "var(--display)",
            fontWeight: 800,
            fontSize: 46,
            letterSpacing: "-0.04em",
            lineHeight: 1
          }}
        >
          {shown}
          <span style={{ fontSize: 20, opacity: 0.5 }}>%</span>
        </div>
        <div style={{ fontSize: 11.5, fontWeight: 700, opacity: 0.6, marginTop: 6, letterSpacing: ".04em" }}>{label}</div>
      </div>
    </div>
  );
}

/* ---------- outcome spread: 100% stacked bar + labelled breakdown list ----------
   data: [{ name, value, color }] — shows each category's share of the whole with
   full (untruncated) names, exact %, and counts. Replaces the cramped histogram. */
export function OutcomeSpread({ data = [] }) {
  const t = useGrow(900);
  const [hi, setHi] = useState(null);
  const items = (Array.isArray(data) ? data : [])
    .map((d) => ({ name: d.name, value: Number(d.value) || 0, color: d.color || "var(--blue)" }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value);
  if (!items.length) return <div className="chart-empty">No outcome breakdown in this dataset.</div>;
  const total = items.reduce((s, d) => s + d.value, 0) || 1;
  const rows = items.map((d) => ({ ...d, pct: (d.value / total) * 100 }));

  return (
    <div className="spread">
      <div className="spread-bar" role="img" aria-label="Outcome share">
        {rows.map((d, i) => (
          <div
            key={i}
            className="spread-seg"
            title={`${d.name}: ${d.pct.toFixed(1)}% (${d.value.toLocaleString()})`}
            onMouseEnter={() => setHi(i)}
            onMouseLeave={() => setHi(null)}
            style={{
              width: `${d.pct * t}%`,
              minWidth: d.pct > 0 ? 3 : 0,
              background: d.color,
              opacity: hi == null || hi === i ? 1 : 0.45
            }}
          />
        ))}
      </div>
      <div className="spread-list">
        {rows.map((d, i) => (
          <div
            key={i}
            className={"spread-row" + (hi === i ? " on" : "")}
            onMouseEnter={() => setHi(i)}
            onMouseLeave={() => setHi(null)}
          >
            <span className="spread-dot" style={{ background: d.color }} />
            <span className="spread-name">{d.name}</span>
            <span className="spread-val">
              {d.pct < 10 ? d.pct.toFixed(1) : Math.round(d.pct)}%<small>{d.value.toLocaleString()}</small>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- shared Recharts tooltip — rounded, theme-aware card ----------
   Drop-in replacement for the default dark box: <Tooltip content={<ChartTooltip />} />.
   Pass `formatter` (same signature as Recharts') to format values/labels. */
export function ChartTooltip({ active, payload, label, formatter }) {
  if (!active || !payload || !payload.length) return null;
  const heading = label !== undefined && label !== null && label !== "" ? label : null;
  return (
    <div className="chart-tip">
      {heading != null && <div className="chart-tip-label">{heading}</div>}
      {payload.map((entry, i) => {
        const swatch =
          entry.color || entry.payload?.color || entry.payload?.fill || entry.fill || "var(--blue)";
        let name = entry.name;
        let value = entry.value;
        if (formatter) {
          const out = formatter(entry.value, entry.name, entry);
          if (Array.isArray(out)) {
            value = out[0];
            if (out[1] != null) name = out[1];
          } else if (out != null) {
            value = out;
          }
        }
        return (
          <div className="chart-tip-row" key={i}>
            <span className="chart-tip-dot" style={{ background: swatch }} />
            {name != null && name !== "" && <span className="chart-tip-name">{name}</span>}
            <span className="chart-tip-val">{value}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- histogram / distribution bars ----------
   data: [{ bucket, pct, tone? }]  tone "warn" → coral, else cobalt */
export function ConfHist({ data = [] }) {
  const t = useGrow(1100);
  const safe = Array.isArray(data) ? data : [];
  if (!safe.length) return <div className="chart-empty">No distribution data available.</div>;
  const max = Math.max(...safe.map((d) => d.pct), 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 150, marginTop: 8 }}>
      {safe.map((d) => (
        <div
          key={d.bucket}
          style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}
        >
          <div className="tnum" style={{ fontFamily: "var(--display)", fontWeight: 800, fontSize: 14, opacity: t }}>
            {d.pct}%
          </div>
          <div
            style={{
              width: "100%",
              height: `${(d.pct / max) * 100 * t}%`,
              minHeight: 4,
              borderRadius: "7px 7px 4px 4px",
              background: d.tone === "warn" ? "var(--coral)" : "var(--blue)",
              transition: "height .2s"
            }}
          />
          <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--ink-mut)", fontFamily: "var(--mono)" }}>
            {d.bucket}
          </div>
        </div>
      ))}
    </div>
  );
}
