/**
 * DashboardView — the Overview screen.
 *
 * Leads with the editorial hero + KPI cards + signature SVG charts (EditorialOverview),
 * all bound to real parsed metrics, then the full Recharts "Detailed analytics" section.
 * Missing metrics render "insufficient data" rather than fabricated 0/NaN. Charts and
 * gauges animate when scrolled into view (useInView + RevealChart / useAnimatedNumber).
 * Props: { sessionInfo, data, detailsData, vendorData, onTrainingPassSelect }.
 */
import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowUpRight,
  Banknote,
  BarChart3,
  Boxes,
  Crosshair,
  Download,
  FileStack,
  FileText,
  FolderOpen,
  Gauge as GaugeIcon,
  Layers,
  Layout,
  PieChart as PieChartIcon,
  Users
} from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  Radar,
  RadarChart,
  ResponsiveContainer,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { numericValue, parseSummaryMetrics, parseVendorMetrics } from "../utils/parsers.js";
import { AreaTrend, ChartTooltip, CountUp, DocTypeBars, Donut, OutcomeSpread, Sparkline } from "./AncoraCharts.jsx";

const COLORS = ["#2B3AE8", "#6B4FD8", "#F0552B", "#E6A12C", "#15966B", "#0E8F8A", "#B9A8F2"];
const BAR_COLORS = ["#2B3AE8", "#6B4FD8", "#F0552B", "#E6A12C", "#15966B", "#0E8F8A", "#B9A8F2", "#BEE846"];
const CHART_ANIMATION = {
  isAnimationActive: true,
  animationDuration: 1100,
  animationEasing: "ease-out"
};

const dashboardContainer = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.08
    }
  }
};

const dashboardItem = {
  hidden: { opacity: 0, y: 22, scale: 0.98 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] }
  }
};

const widgetHover = {
  y: -8,
  scale: 1.025,
  transition: { type: "spring", stiffness: 360, damping: 24 }
};

/* staggered reveal wrapper for the editorial blocks */
const reveal = {
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } }
};

/* fires once the element scrolls into view (so below-the-fold charts animate on arrival) */
// True while the dashboard is being rendered for PDF export. Consumed by useInView so every
// lazily-revealed chart/count-up mounts and animates regardless of scroll position — otherwise
// RevealChart (which renders null until in view) would leave blank gaps in the printed report.
const PrintModeContext = createContext(false);

function useInView(threshold = 0.2) {
  const printing = useContext(PrintModeContext);
  const ref = useRef(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || inView) return undefined;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold, inView]);

  return [ref, inView || printing];
}

function useAnimatedNumber(target, duration = 950, active = true) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    const nextTarget = Number.isFinite(target) ? target : 0;

    if (!active) {
      setValue(0);
      return undefined;
    }

    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setValue(nextTarget);
      return undefined;
    }

    let frame = 0;
    const start = performance.now();

    const tick = (time) => {
      const progress = Math.min((time - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(nextTarget * eased);

      if (progress < 1) frame = requestAnimationFrame(tick);
    };

    setValue(0);
    frame = requestAnimationFrame(tick);
    // safety: settle to final value even if rAF is throttled in a background tab
    const safety = setTimeout(() => setValue(nextTarget), duration + 250);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(safety);
    };
  }, [target, duration, active]);

  return value;
}

function SectionTitle({ icon: Icon, title, color = "var(--accent-primary)" }) {
  return (
    <motion.h3
      className="section-title"
      initial={{ opacity: 0, x: -20 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.45 }}
      style={{ borderBottomColor: color }}
    >
      <Icon size={24} color={color} />
      {title}
    </motion.h3>
  );
}

function GaugeCard({ value = 0, label, color = "#2B3AE8" }) {
  const safeValue = Math.max(0, Math.min(100, numericValue(value)));
  const [ref, inView] = useInView();
  const animatedValue = useAnimatedNumber(safeValue, 1050, inView);
  const radius = 45;

  return (
    <div className="metric-gauge" ref={ref}>
      <svg className="metric-gauge-svg" viewBox="0 0 118 118" role="img" aria-label={`${label}: ${safeValue.toFixed(1)}%`}>
        <circle className="metric-gauge-track" cx="59" cy="59" r={radius} pathLength="100" />
        <circle
          className="metric-gauge-fill"
          cx="59"
          cy="59"
          r={radius}
          pathLength="100"
          strokeDasharray={`${animatedValue} 100`}
          style={{ stroke: color }}
        />
      </svg>
      <div className="metric-gauge-center">
        <strong style={{ color }}>{animatedValue.toFixed(1)}%</strong>
        <span>{label}</span>
      </div>
    </div>
  );
}

function VolumeRingArc({ item, progress, active, onMouseEnter, onMouseLeave }) {
  const animatedProgress = useAnimatedNumber(progress * 100, 1150, active);

  return (
    <motion.g
      whileHover={{ scale: 1.025 }}
      transition={{ type: "spring", stiffness: 340, damping: 22 }}
      style={{ transformOrigin: "130px 130px" }}
    >
      <circle cx="130" cy="130" r={item.radius} fill="none" stroke="rgba(24,23,15,0.12)" strokeWidth="14" />
      <circle
        className="volume-ring-arc"
        cx="130"
        cy="130"
        r={item.radius}
        pathLength="100"
        fill="none"
        stroke={item.color}
        strokeWidth="14"
        strokeLinecap="round"
        strokeDasharray={`${animatedProgress} 100`}
        transform="rotate(-90 130 130)"
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      />
    </motion.g>
  );
}

function Panel({ children, className = "" }) {
  return (
    <motion.section
      className={`glass-panel dashboard-panel dashboard-motion-card ${className}`}
      variants={dashboardItem}
      whileHover={widgetHover}
    >
      {children}
    </motion.section>
  );
}

// Mounts a (Recharts) chart only once it scrolls into view, so its entrance
// animation plays on arrival instead of off-screen. Reserves height to avoid layout shift.
function RevealChart({ height, children }) {
  const [ref, inView] = useInView(0.15);
  return (
    <div ref={ref} style={{ minHeight: height }}>
      {inView ? children : null}
    </div>
  );
}

function VolumeMetrics({ groups }) {
  const [hovered, setHovered] = useState(null);
  const [ringsRef, ringsInView] = useInView();
  const toNumber = (label) => numericValue(groups.general.find((item) => item.label === label)?.value);
  const data = [
    { name: "Exception Batches", value: toNumber("Exceptional Batches"), color: "#E6A12C", radius: 104 },
    { name: "Processed Docs", value: toNumber("Processed Docs"), color: "#2B3AE8", radius: 86 },
    { name: "Processed Pages", value: toNumber("Processed Pages"), color: "#6B4FD8", radius: 68 },
    { name: "Region Templates", value: numericValue(groups.regionTemplate.find((item) => item.label === "Matched Docs")?.value), color: "#0E8F8A", radius: 50 },
    { name: "Total Batches", value: toNumber("Total Batches"), color: "#15966B", radius: 32 }
  ];
  const maxValue = Math.max(...data.map((item) => item.value), 1);

  return (
    <Panel className="volume-panel">
      <h3>
        <Layers size={20} />
        Volume Metrics
      </h3>
      <div className="volume-rings-wrap" ref={ringsRef}>
        <motion.svg
          className="volume-rings"
          viewBox="0 0 260 260"
          role="img"
          aria-label="Volume Metrics"
          initial={{ rotate: -8, scale: 0.94, opacity: 0 }}
          whileInView={{ rotate: 0, scale: 1, opacity: 1 }}
          whileHover={{ scale: 1.035 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        >
          <circle cx="130" cy="130" r="114" fill="rgba(24,23,15,0.04)" stroke="rgba(24,23,15,0.10)" strokeWidth="1" />
          {data.map((item) => {
            const progress = Math.max(0.08, item.value / maxValue);

            return (
              <VolumeRingArc
                key={item.name}
                item={item}
                progress={progress}
                active={ringsInView}
                onMouseEnter={() => setHovered(item)}
                onMouseLeave={() => setHovered(null)}
              />
            );
          })}
          <circle cx="130" cy="130" r="18" fill="rgba(24,23,15,0.88)" />
        </motion.svg>
        {hovered && (
          <motion.div
            className="volume-hover-card"
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: 0.18 }}
          >
            <strong style={{ color: hovered.color }}>{hovered.name}</strong>
            <span>Count: {hovered.value.toLocaleString()}</span>
          </motion.div>
        )}
        <div className="volume-ring-legend">
          {data.map((item) => (
            <motion.div
              key={item.name}
              onMouseEnter={() => setHovered(item)}
              onMouseLeave={() => setHovered(null)}
              whileHover={{ x: 6, scale: 1.03 }}
              transition={{ type: "spring", stiffness: 420, damping: 26 }}
            >
              <i style={{ background: item.color }} />
              <span>{item.name}</span>
              <strong>{item.value.toLocaleString()}</strong>
            </motion.div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

function BreakdownPie({ title, data, color }) {
  const hasBreakdown = Array.isArray(data.breakdown) && data.breakdown.length > 0;
  if (!hasBreakdown) {
    return (
      <Panel className="breakdown-panel">
        <h4 style={{ color }}>{title}</h4>
        <div className="chart-empty" style={{ minHeight: 320 }}>
          This metric could not be loaded — insufficient data in this report.
        </div>
      </Panel>
    );
  }
  return (
    <Panel className="breakdown-panel">
      <h4 style={{ color }}>{title}</h4>
      <div className="breakdown-score">
        {data.accuracy || 0}
        <span>% accuracy</span>
      </div>
      <RevealChart height={360}>
        <ResponsiveContainer width="100%" height={360}>
          <PieChart>
            <Pie
              data={data.breakdown}
              cx="50%"
              cy="42%"
              innerRadius={78}
              outerRadius={118}
              paddingAngle={3}
              dataKey="value"
              {...CHART_ANIMATION}
            >
              {data.breakdown.map((entry) => (
                <Cell key={entry.name} fill={entry.color} stroke="none" />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip />} />
            <Legend verticalAlign="bottom" height={80} wrapperStyle={{ fontSize: "0.78rem" }} />
          </PieChart>
        </ResponsiveContainer>
      </RevealChart>
    </Panel>
  );
}

function AccuracyBar({ title, data, color }) {
  if (!data.length) return null;

  return (
    <Panel>
      <h4 style={{ color }}>{title}</h4>
      <RevealChart height={400}>
        <ResponsiveContainer width="100%" height={400}>
          <BarChart data={data.slice(0, 18)} layout="vertical" margin={{ left: 52, right: 24 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(24,23,15,0.08)" />
            <XAxis type="number" domain={[0, 100]} hide />
            <YAxis dataKey="name" type="category" width={150} tick={{ fill: "#6E6B5C", fontSize: 10 }} />
            <Tooltip content={<ChartTooltip formatter={(value) => [`${numericValue(value).toFixed(2)}%`, "Accuracy"]} />} />
            <Bar dataKey="value" fill={color} radius={[0, 5, 5, 0]} barSize={12} {...CHART_ANIMATION} />
          </BarChart>
        </ResponsiveContainer>
      </RevealChart>
    </Panel>
  );
}

function TrainingPassChart({ data, onTrainingPassSelect }) {
  if (!data.length) return null;

  return (
    <Panel>
      <h4 style={{ color: "#6B4FD8" }}>Training Pass Performance</h4>
      <RevealChart height={340}>
        <ResponsiveContainer width="100%" height={340}>
          <BarChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(24,23,15,0.08)" />
            <XAxis
              dataKey="name"
              tick={{ fill: "#6E6B5C", fontSize: 11 }}
              tickFormatter={(name) => String(name).replace("Training Pass ", "Pass ")}
            />
            <YAxis domain={[0, 100]} tick={{ fill: "#6E6B5C" }} />
            <Tooltip content={<ChartTooltip />} />
            <Bar
              className="training-pass-bar"
              dataKey="fieldAccuracy"
              name="Field Accuracy %"
              fill="#6B4FD8"
              radius={[5, 5, 0, 0]}
              barSize={48}
              onClick={(entry) => onTrainingPassSelect?.(entry?.payload?.name || entry?.name)}
              {...CHART_ANIMATION}
            />
          </BarChart>
        </ResponsiveContainer>
      </RevealChart>
    </Panel>
  );
}

function TypeRadar({ data }) {
  if (!data.length) return null;

  return (
    <Panel>
      <h4 style={{ color: "#F0552B" }}>Accuracy by Field Type</h4>
      <RevealChart height={320}>
        <ResponsiveContainer width="100%" height={320}>
          <RadarChart data={data}>
            <PolarGrid stroke="rgba(24,23,15,0.08)" />
            <PolarAngleAxis dataKey="subject" tick={{ fill: "#6E6B5C", fontSize: 12 }} />
            <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: "#6E6B5C", fontSize: 10 }} />
            <Radar name="Accuracy" dataKey="A" stroke="#F0552B" fill="#F0552B" fillOpacity={0.35} {...CHART_ANIMATION} />
            <Tooltip content={<ChartTooltip />} />
          </RadarChart>
        </ResponsiveContainer>
      </RevealChart>
    </Panel>
  );
}

function TimelineChart({ data }) {
  if (!data.length) return null;

  return (
    <Panel>
      <h4 style={{ color: "#2B3AE8" }}>Validation Timeline</h4>
      <RevealChart height={300}>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={data}>
            <defs>
              <linearGradient id="countGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#2B3AE8" stopOpacity={0.8} />
                <stop offset="95%" stopColor="#2B3AE8" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="date" tick={{ fill: "#6E6B5C", fontSize: 12 }} />
            <YAxis tick={{ fill: "#6E6B5C", fontSize: 12 }} />
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(24,23,15,0.06)" />
            <Tooltip content={<ChartTooltip />} />
            <Area type="monotone" dataKey="count" stroke="#2B3AE8" fillOpacity={1} fill="url(#countGradient)" {...CHART_ANIMATION} />
          </AreaChart>
        </ResponsiveContainer>
      </RevealChart>
    </Panel>
  );
}

function DocTypePie({ data }) {
  if (!data.length) return null;

  return (
    <Panel>
      <h4 style={{ color: "#15966B" }}>Document Types</h4>
      <RevealChart height={300}>
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="45%"
              innerRadius={60}
              outerRadius={82}
              paddingAngle={5}
              dataKey="value"
              {...CHART_ANIMATION}
            >
              {data.map((entry, index) => (
                <Cell key={entry.name} fill={COLORS[index % COLORS.length]} stroke="none" />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip />} />
            <Legend verticalAlign="bottom" height={44} wrapperStyle={{ fontSize: "0.78rem" }} />
          </PieChart>
        </ResponsiveContainer>
      </RevealChart>
    </Panel>
  );
}

function VendorBestWorst({ vendorRows }) {
  const vendors = useMemo(() => {
    const parsed = parseVendorMetrics(vendorRows || []);
    return Array.isArray(parsed) ? parsed : [];
  }, [vendorRows]);

  if (!vendors.length) return null;

  const sorted = [...vendors].sort(
    (left, right) => numericValue(right.overall?.accuracy) - numericValue(left.overall?.accuracy)
  );
  const best = sorted.slice(0, 5).map((vendor) => ({
    name: vendor.name,
    accuracy: numericValue(vendor.overall?.accuracy),
    type: "Best"
  }));
  const worst = sorted.slice(-5).reverse().map((vendor) => ({
    name: vendor.name,
    accuracy: -numericValue(vendor.overall?.accuracy),
    type: "Needs Review"
  }));
  const data = [...worst, ...best];

  return (
    <Panel>
      <h4 style={{ color: "#2B3AE8" }}>Vendor Accuracy - Best vs Worst</h4>
      <RevealChart height={360}>
        <ResponsiveContainer width="100%" height={360}>
          <BarChart data={data} layout="vertical" margin={{ left: 60, right: 28 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(24,23,15,0.08)" />
            <XAxis type="number" tickFormatter={(value) => `${Math.abs(value)}%`} tick={{ fill: "#6E6B5C" }} />
            <YAxis dataKey="name" type="category" width={170} tick={{ fill: "#6E6B5C", fontSize: 10 }} />
            <Tooltip content={<ChartTooltip formatter={(value, name, item) => [`${Math.abs(value).toFixed(2)}%`, item?.payload?.type]} />} />
            <Bar dataKey="accuracy" radius={[0, 5, 5, 0]} {...CHART_ANIMATION}>
              {data.map((entry) => (
                <Cell key={`${entry.type}-${entry.name}`} fill={entry.type === "Best" ? "#15966B" : "#F0552B"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </RevealChart>
    </Panel>
  );
}

/* ════════════════════════════════════════════════════════════
   Editorial overview (Claude Design handoff) — bound to real data
   ════════════════════════════════════════════════════════════ */

function fieldTone(acc) {
  if (acc < 90) return "var(--coral)";
  if (acc < 95) return "var(--amber)";
  return "var(--green)";
}

function shortPass(name) {
  return String(name).replace("Training Pass ", "Pass ");
}

function KpiCard({ label, icon, value, decimals = 0, suffix = "", foot, variant = "", spark, sparkColor, available = true }) {
  return (
    <div className={"kpi " + variant}>
      <div className="kpi-label">
        {icon}
        {label}
      </div>
      {available ? (
        <>
          <div className="kpi-val">
            <CountUp to={value} decimals={decimals} suffix={suffix} />
          </div>
          <div className="kpi-foot">{foot}</div>
          {spark && spark.length > 1 && <Sparkline data={spark} color={sparkColor || "var(--blue)"} />}
        </>
      ) : (
        <>
          <div className="kpi-val kpi-na">&mdash;</div>
          <div className="kpi-foot">insufficient data</div>
        </>
      )}
    </div>
  );
}

function MiniStat({ k, v }) {
  return (
    <div>
      <div style={{ fontFamily: "var(--display)", fontWeight: 800, fontSize: 24, letterSpacing: "-0.03em" }}>{v}</div>
      <div style={{ fontSize: 11.5, fontWeight: 600, color: "rgba(239,234,221,.55)", marginTop: 2 }}>{k}</div>
    </div>
  );
}

function StatCard({ label, total, acc, color }) {
  const available = numericValue(total) > 0;
  return (
    <Panel className="stat-card">
      <div>
        <span>{label}</span>
        <strong>{available ? total : "—"}</strong>
        <em style={available ? undefined : { color: "var(--text-muted)", fontStyle: "normal" }}>
          {available ? "Position Accuracy" : "insufficient data"}
        </em>
      </div>
      {available && <GaugeCard value={acc} label="Pos Acc" color={color} />}
    </Panel>
  );
}

function FieldAccuracyList({ fields }) {
  if (!fields.length) {
    return (
      <>
        <div className="panel-head">
          <div>
            <div className="panel-title">Field-level accuracy</div>
            <div className="panel-sub">where extraction wins &amp; struggles</div>
          </div>
        </div>
        <div className="chart-empty">No field-level accuracy in this dataset.</div>
      </>
    );
  }
  return (
    <>
      <div className="panel-head">
        <div>
          <div className="panel-title">Field-level accuracy</div>
          <div className="panel-sub">where extraction wins &amp; struggles</div>
        </div>
      </div>
      <div>
        {fields.map((f) => (
          <div className="field-row" key={f.name}>
            <div className="field-name">{f.name}</div>
            <div
              className="field-pct"
              style={{ color: f.acc < 90 ? "var(--coral)" : f.acc < 95 ? "var(--amber)" : "var(--ink)" }}
            >
              {f.acc.toFixed(1)}%
            </div>
            <div className="field-bar">
              <i style={{ width: `${Math.max(0, Math.min(100, f.acc))}%`, background: fieldTone(f.acc) }} />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function TrainingPassTable({ rows, onTrainingPassSelect }) {
  if (!rows.length) {
    return (
      <>
        <div className="panel-head">
          <div>
            <div className="panel-title">Training pass performance</div>
            <div className="panel-sub">field accuracy per pass</div>
          </div>
        </div>
        <div className="chart-empty">No training-pass data in this dataset.</div>
      </>
    );
  }
  return (
    <>
      <div className="panel-head">
        <div>
          <div className="panel-title">Training pass performance</div>
          <div className="panel-sub">field accuracy per pass · click to drill in</div>
        </div>
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th>Pass</th>
            <th>Field accuracy</th>
            <th>Batches</th>
            <th>Exceptions</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const acc = numericValue(p.fieldAccuracy);
            return (
              <tr
                key={p.name}
                style={{ cursor: "pointer" }}
                onClick={() => onTrainingPassSelect?.(p.name)}
              >
                <td>
                  <div className="doc">
                    <span className="ic">
                      <Layers size={16} />
                    </span>
                    <div>
                      <div>{shortPass(p.name)}</div>
                      <div className="muted mono">{p.name}</div>
                    </div>
                  </div>
                </td>
                <td>
                  <div className="acc-cell">
                    <span className="tnum" style={{ fontWeight: 800, fontFamily: "var(--display)" }}>
                      {acc.toFixed(1)}%
                    </span>
                    <span className="minibar">
                      <i style={{ width: acc + "%", background: fieldTone(acc) }} />
                    </span>
                  </div>
                </td>
                <td className="tnum">{numericValue(p.totalBatches).toLocaleString()}</td>
                <td>
                  <span className={"status " + (numericValue(p.exBatches) > 0 ? "review" : "ok")}>
                    {numericValue(p.exBatches).toLocaleString()}
                  </span>
                </td>
                <td style={{ textAlign: "right" }}>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ padding: "7px 12px" }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onTrainingPassSelect?.(p.name);
                    }}
                  >
                    Open <ArrowUpRight size={15} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

function EditorialOverview({ groups, timelineData, docTypeData, onTrainingPassSelect, sessionInfo, onExportPdf }) {
  const source = sessionInfo?.source;
  const sourceMeta = source
    ? [sessionInfo?.clientName, source.fileCount ? `${source.fileCount} files` : source.kind === "file" ? "single file" : null]
        .filter(Boolean)
        .join(" · ")
    : "";
  const num = (label) => numericValue(groups.general.find((i) => i.label === label)?.value);
  const has = (label) => groups.general.some((i) => i.label === label);

  const processedDocs = num("Processed Docs");
  const processedPages = num("Processed Pages");
  const totalBatches = num("Total Batches");
  const exceptionalBatches = num("Exceptional Batches");
  const fieldAcc = has("Field Acc %") ? num("Field Acc %") : numericValue(groups.summaryStats.accuracy);
  const fieldPosAcc = has("Field & Pos Acc %")
    ? num("Field & Pos Acc %")
    : numericValue(groups.summaryStats.positionAccuracy);
  // availability — distinguish "absent" from a legitimate 0 so we never fabricate a metric
  const docsAvail = has("Processed Docs");
  const accAvail = has("Field Acc %") || numericValue(groups.summaryStats.accuracy) > 0;
  const posAvail = has("Field & Pos Acc %") || numericValue(groups.summaryStats.positionAccuracy) > 0;
  const excAvail = has("Exceptional Batches");

  // Pipeline-health donut = straight-through processing. Prefer the explicit page-level
  // Pass-Through % from the summary CSV; when that row is absent, derive a batch-level STP
  // rate from exceptions ((total − exception) / total); only then fall back to field accuracy.
  const canDeriveStp = excAvail && totalBatches > 0;
  const passThrough = has("Pass-Through %")
    ? num("Pass-Through %")
    : canDeriveStp
      ? ((totalBatches - exceptionalBatches) / totalBatches) * 100
      : fieldAcc;
  const passThroughLabel = has("Pass-Through %")
    ? "pass-through"
    : canDeriveStp
      ? "straight-through"
      : "field accuracy";
  const passAvail = has("Pass-Through %") || canDeriveStp || accAvail;

  // Labor savings — only surfaced when the summary CSV provides it. Prefer the field-level
  // saving as the headline number and show the character-level saving as the footnote.
  const laborChars = has("Labor Sav (Chars) %") ? num("Labor Sav (Chars) %") : null;
  const laborFields = has("Labor Sav (Fields) %") ? num("Labor Sav (Fields) %") : null;
  const laborAvail = laborChars !== null || laborFields !== null;
  const laborValue = laborFields ?? laborChars ?? 0;
  const laborFoot =
    laborFields !== null && laborChars !== null
      ? `${laborChars.toFixed(1)}% characters`
      : laborFields !== null
        ? "fields saved"
        : "characters saved";

  // accuracy series: prefer per-training-pass accuracy; fall back to validation volume timeline
  const trainingTrend = groups.trainingPass
    .filter((p) => Number.isFinite(numericValue(p.fieldAccuracy)))
    .map((p) => ({
      value: numericValue(p.fieldAccuracy),
      label: shortPass(p.name),
      sub: `${shortPass(p.name)} · ${numericValue(p.totalBatches)} batches`
    }));
  const volumeTrend = timelineData.map((d) => ({ value: d.count, label: d.date, sub: `${d.date} · ${d.count} docs` }));
  const trend =
    trainingTrend.length >= 2
      ? { data: trainingTrend, unit: "%", domain: null, title: "Accuracy by training pass", sub: "field-weighted extraction accuracy per pass", legend: "Field accuracy %" }
      : volumeTrend.length >= 2
        ? { data: volumeTrend, unit: "", domain: null, title: "Validation volume", sub: "documents validated over time", legend: "Documents" }
        : null;

  const accSpark = trainingTrend.map((d) => d.value);
  const volSpark = volumeTrend.map((d) => d.value);

  // volume by document type — real parsed doc types (from detail rows)
  const typeBars = docTypeData
    .slice()
    .sort((a, b) => b.value - a.value)
    .slice(0, 8)
    .map((d, i) => ({ name: d.name, count: d.value, color: BAR_COLORS[i % BAR_COLORS.length] }));

  // outcome spread — the summary fields breakdown buckets (name + value + color)
  const breakdown = groups.summaryStats.breakdown || [];

  // field-level accuracy list — real header (and line-item) field accuracy
  const fieldSource = groups.hdrFields.length ? groups.hdrFields : groups.liFields;
  const fields = fieldSource
    .map((f) => ({ name: f.name, acc: numericValue(f.value) }))
    .filter((f) => Number.isFinite(f.acc))
    .sort((a, b) => a.acc - b.acc)
    .slice(0, 6);

  const exceptionPct = totalBatches > 0 ? ((exceptionalBatches / totalBatches) * 100).toFixed(1) : null;

  return (
    <div className="al-page">
      {/* Hero */}
      <motion.div className="hero" variants={reveal} initial="hidden" animate="visible">
        <div>
          <div className="eyebrow">
            <span className="dot" /> Live · {totalBatches.toLocaleString()} batches analyzed
          </div>
          <h1>
            Every document, <em>read right</em> the first time.
          </h1>
          <p className="sub">
            AncoraLens audits your intelligent document pipeline — surfacing accuracy, confidence and exceptions across{" "}
            {processedDocs.toLocaleString()} processed documents.
          </p>
        </div>
        <div className="hero-right">
          <button type="button" className="pdf-export-button no-print" onClick={onExportPdf}>
            <Download size={15} />
            Download PDF
          </button>
          {source && (
            <div className="data-source" title={`Loaded from ${source.name}`}>
              <span className="ds-icon">{source.kind === "file" ? <FileText size={16} /> : <FolderOpen size={16} />}</span>
              <div className="ds-text">
                <div className="ds-label">Data source</div>
                <div className="ds-name">{source.name}</div>
                {sourceMeta && <div className="ds-meta">{sourceMeta}</div>}
              </div>
            </div>
          )}
        </div>
      </motion.div>

      {/* KPI row */}
      <motion.div className={`kpis${laborAvail ? " kpis-5" : ""}`} variants={reveal} initial="hidden" animate="visible">
        <KpiCard
          label="Documents processed"
          icon={<FileStack size={15} />}
          value={processedDocs}
          foot={`${processedPages.toLocaleString()} pages`}
          spark={volSpark}
          sparkColor="var(--blue)"
          available={docsAvail}
        />
        <KpiCard
          label="Extraction accuracy"
          icon={<Crosshair size={15} />}
          value={fieldAcc}
          decimals={1}
          suffix="%"
          foot="field-weighted"
          variant="accent"
          spark={accSpark}
          sparkColor="#fff"
          available={accAvail}
        />
        <KpiCard
          label="Field & position accuracy"
          icon={<GaugeIcon size={15} />}
          value={fieldPosAcc}
          decimals={1}
          suffix="%"
          foot="value + location"
          available={posAvail}
        />
        <KpiCard
          label="Exception batches"
          icon={<AlertTriangle size={15} />}
          value={exceptionalBatches}
          foot={exceptionPct ? `${exceptionPct}% of batches` : "awaiting review"}
          variant="dark"
          available={excAvail}
        />
        {laborAvail && (
          <KpiCard
            label="Labor savings"
            icon={<Banknote size={15} />}
            value={laborValue}
            decimals={1}
            suffix="%"
            foot={laborFoot}
            available={laborAvail}
          />
        )}
      </motion.div>

      {/* Trend + pipeline health */}
      <motion.div className="grid cols-12" variants={reveal} initial="hidden" animate="visible">
        <div className="panel col-8">
          <div className="panel-head">
            <div>
              <div className="panel-title">{trend ? trend.title : "Accuracy trend"}</div>
              <div className="panel-sub">{trend ? trend.sub : "field-weighted extraction accuracy"}</div>
            </div>
            {trend && (
              <div className="legend">
                <span>
                  <i style={{ background: "var(--blue)" }} /> {trend.legend}
                </span>
              </div>
            )}
          </div>
          {trend ? (
            <AreaTrend data={trend.data} accent="var(--blue)" unit={trend.unit} domain={trend.domain} />
          ) : (
            <div className="chart-empty">Not enough time-series data to plot a trend.</div>
          )}
        </div>
        <div
          className="panel ink col-4"
          style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}
        >
          <div className="panel-head" style={{ marginBottom: 0 }}>
            <div>
              <div className="panel-title" style={{ color: "var(--paper)" }}>
                Pipeline health
              </div>
              <div className="panel-sub">straight-through processing</div>
            </div>
          </div>
          {passAvail ? (
            <Donut value={passThrough} label={passThroughLabel} accent="var(--lime)" />
          ) : (
            <div className="chart-empty" style={{ color: "rgba(243,239,227,.6)" }}>
              Could not be loaded — insufficient data.
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 4 }}>
            <MiniStat k="Total batches" v={excAvail || totalBatches ? totalBatches.toLocaleString() : "—"} />
            <MiniStat k="Exception batches" v={excAvail ? exceptionalBatches.toLocaleString() : "—"} />
          </div>
        </div>
      </motion.div>

      {/* Volume by type + outcome spread */}
      <motion.div className="grid cols-12" style={{ marginTop: 14 }} variants={reveal} initial="hidden" animate="visible">
        <div className="panel col-7">
          <div className="panel-head">
            <div>
              <div className="panel-title">Volume by document type</div>
              <div className="panel-sub">count per detected type</div>
            </div>
          </div>
          {typeBars.length ? (
            <DocTypeBars data={typeBars} />
          ) : (
            <div className="chart-empty">Upload a detailed report to see document-type volume.</div>
          )}
        </div>
        <div className="panel col-5">
          <div className="panel-head">
            <div>
              <div className="panel-title">Extraction outcome spread</div>
              <div className="panel-sub">share of fields by outcome bucket</div>
            </div>
          </div>
          <OutcomeSpread data={breakdown} />
        </div>
      </motion.div>

      {/* Field list + training pass table */}
      <motion.div className="grid cols-12" style={{ marginTop: 14 }} variants={reveal} initial="hidden" animate="visible">
        <div className="panel col-5">
          <FieldAccuracyList fields={fields} />
        </div>
        <div className="panel col-7">
          <TrainingPassTable rows={groups.trainingPass} onTrainingPassSelect={onTrainingPassSelect} />
        </div>
      </motion.div>
    </div>
  );
}

export default function DashboardView({ data, detailsData, vendorData, onTrainingPassSelect, sessionInfo }) {
  const { groups, timelineData, docTypeData } = useMemo(
    () => parseSummaryMetrics(data || [], detailsData || []),
    [data, detailsData]
  );

  const percentMetrics = [
    ...groups.general.filter((item) => item.isPercentage),
    ...groups.regionTemplate.filter((item) => item.isPercentage)
  ];

  const [printing, setPrinting] = useState(false);

  // Export the dashboard to PDF via the browser's print pipeline (no extra deps, keeps text
  // and SVG charts crisp). Flip on print mode so every lazily-revealed chart mounts, give the
  // charts/count-ups a beat to settle, then open the print dialog and restore normal mode.
  const handleExportPdf = () => {
    if (printing) return;
    setPrinting(true);
    const previousTitle = document.title;
    document.title = sessionInfo?.clientName ? `${sessionInfo.clientName} — AncoraLens Report` : "AncoraLens Report";

    window.setTimeout(() => {
      window.print();
      document.title = previousTitle;
      setPrinting(false);
    }, 1200);
  };

  return (
    <PrintModeContext.Provider value={printing}>
    <motion.div className={`dashboard-view${printing ? " printing" : ""}`} variants={dashboardContainer} initial="hidden" animate="visible">
      {/* Editorial overview — leads the page */}
      <EditorialOverview
        groups={groups}
        timelineData={timelineData}
        docTypeData={docTypeData}
        onTrainingPassSelect={onTrainingPassSelect}
        sessionInfo={sessionInfo}
        onExportPdf={handleExportPdf}
      />

      {/* Detailed analytics — full chart set, restyled */}
      <SectionTitle icon={Layout} title="Detailed analytics" color="#2B3AE8" />

      <motion.div className="dashboard-top" variants={dashboardContainer}>
        <VolumeMetrics groups={groups} />
        <div className="gauge-grid">
          {percentMetrics.map((metric, index) => (
            <motion.section
              key={`${metric.label}-${index}`}
              className="glass-panel gauge-card dashboard-motion-card hover-scale"
              variants={dashboardItem}
              whileHover={widgetHover}
            >
              <GaugeCard
                value={metric.numeric ?? metric.value}
                label={metric.label.replace("Total ", "").replace(" %", "")}
                color={COLORS[index % COLORS.length]}
              />
            </motion.section>
          ))}
        </div>
      </motion.div>

      <motion.div className="stat-strip" variants={dashboardContainer}>
        <StatCard label="Total Fields" total={groups.summaryStats.total} acc={groups.summaryStats.positionAccuracy} color="#2B3AE8" />
        <StatCard label="Total Tables" total={groups.tableStats.total} acc={groups.tableStats.positionAccuracy} color="#6B4FD8" />
      </motion.div>

      <SectionTitle icon={PieChartIcon} title="Accuracy Breakdown" color="#2B3AE8" />
      <div className="dashboard-grid two">
        <BreakdownPie title="Summary Fields Breakdown" data={groups.summaryStats} color="#2B3AE8" />
        <BreakdownPie title="Table Cells Breakdown" data={groups.tableStats} color="#6B4FD8" />
      </div>

      <SectionTitle icon={Layers} title="Field Accuracy" color="#6B4FD8" />
      <div className="dashboard-grid two">
        <AccuracyBar title="Header Fields Position Accuracy" data={groups.hdrFields} color="#2B3AE8" />
        <AccuracyBar title="Line Item Fields Position Accuracy" data={groups.liFields} color="#E6A12C" />
      </div>

      <SectionTitle icon={Boxes} title="Training and Types" color="#F0552B" />
      <div className="dashboard-grid two">
        <TrainingPassChart data={groups.trainingPass} onTrainingPassSelect={onTrainingPassSelect} />
        <TypeRadar data={groups.typeMetrics} />
      </div>

      {(timelineData.length > 0 || docTypeData.length > 0) && (
        <>
          <SectionTitle icon={FileStack} title="Detailed Report Signals" color="#15966B" />
          <div className="dashboard-grid two">
            <TimelineChart data={timelineData} />
            <DocTypePie data={docTypeData} />
          </div>
        </>
      )}

      {vendorData?.length > 0 && (
        <>
          <SectionTitle icon={Users} title="Vendor Signals" color="#2B3AE8" />
          <VendorBestWorst vendorRows={vendorData} />
        </>
      )}
    </motion.div>
    </PrintModeContext.Provider>
  );
}
