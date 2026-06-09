import { motion } from "framer-motion";
import { BarChart3, Boxes, FileStack, Gauge, Layers, PieChart as PieChartIcon, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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

const COLORS = ["#3b82f6", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#06b6d4", "#f97316"];
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

function useAnimatedNumber(target, duration = 950) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    const nextTarget = Number.isFinite(target) ? target : 0;

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
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);

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

function GaugeCard({ value = 0, label, color = "#3b82f6" }) {
  const safeValue = Math.max(0, Math.min(100, numericValue(value)));
  const animatedValue = useAnimatedNumber(safeValue, 1050);
  const radius = 45;

  return (
    <div className="metric-gauge">
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

function VolumeRingArc({ item, progress, onMouseEnter, onMouseLeave }) {
  const animatedProgress = useAnimatedNumber(progress * 100, 1150);

  return (
    <motion.g
      whileHover={{ scale: 1.025 }}
      transition={{ type: "spring", stiffness: 340, damping: 22 }}
      style={{ transformOrigin: "130px 130px" }}
    >
      <circle cx="130" cy="130" r={item.radius} fill="none" stroke="rgba(148,163,184,0.18)" strokeWidth="14" />
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

function VolumeMetrics({ groups }) {
  const [hovered, setHovered] = useState(null);
  const toNumber = (label) => numericValue(groups.general.find((item) => item.label === label)?.value);
  const data = [
    { name: "Exception Batches", value: toNumber("Exceptional Batches"), color: "#f59e0b", radius: 104 },
    { name: "Processed Docs", value: toNumber("Processed Docs"), color: "#3b82f6", radius: 86 },
    { name: "Processed Pages", value: toNumber("Processed Pages"), color: "#8b5cf6", radius: 68 },
    { name: "Region Templates", value: numericValue(groups.regionTemplate.find((item) => item.label === "Matched Docs")?.value), color: "#06b6d4", radius: 50 },
    { name: "Total Batches", value: toNumber("Total Batches"), color: "#22c55e", radius: 32 }
  ];
  const maxValue = Math.max(...data.map((item) => item.value), 1);

  return (
    <Panel className="volume-panel">
      <h3>
        <Layers size={20} />
        Volume Metrics
      </h3>
      <div className="volume-rings-wrap">
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
          <circle cx="130" cy="130" r="114" fill="rgba(15,23,42,0.28)" stroke="rgba(255,255,255,0.28)" strokeWidth="1" />
          {data.map((item) => {
            const progress = Math.max(0.08, item.value / maxValue);

            return (
              <VolumeRingArc
                key={item.name}
                item={item}
                progress={progress}
                onMouseEnter={() => setHovered(item)}
                onMouseLeave={() => setHovered(null)}
              />
            );
          })}
          <circle cx="130" cy="130" r="18" fill="rgba(15,23,42,0.94)" />
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
  return (
    <Panel className="breakdown-panel">
      <h4 style={{ color }}>{title}</h4>
      <div className="breakdown-score">
        {data.accuracy || 0}
        <span>% accuracy</span>
      </div>
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
          <Tooltip contentStyle={{ background: "var(--bg-tooltip)", borderColor: "var(--glass-border)" }} />
          <Legend verticalAlign="bottom" height={80} wrapperStyle={{ fontSize: "0.78rem" }} />
        </PieChart>
      </ResponsiveContainer>
    </Panel>
  );
}

function AccuracyBar({ title, data, color }) {
  if (!data.length) return null;

  return (
    <Panel>
      <h4 style={{ color }}>{title}</h4>
      <ResponsiveContainer width="100%" height={400}>
        <BarChart data={data.slice(0, 18)} layout="vertical" margin={{ left: 52, right: 24 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(255,255,255,0.1)" />
          <XAxis type="number" domain={[0, 100]} hide />
          <YAxis dataKey="name" type="category" width={150} tick={{ fill: "#cbd5e1", fontSize: 10 }} />
          <Tooltip
            formatter={(value) => [`${numericValue(value).toFixed(2)}%`, "Accuracy"]}
            contentStyle={{ background: "var(--bg-tooltip)", borderColor: "var(--glass-border)" }}
          />
          <Bar dataKey="value" fill={color} radius={[0, 5, 5, 0]} barSize={12} {...CHART_ANIMATION} />
        </BarChart>
      </ResponsiveContainer>
    </Panel>
  );
}

function TrainingPassChart({ data, onTrainingPassSelect }) {
  if (!data.length) return null;

  return (
    <Panel>
      <h4 style={{ color: "#8b5cf6" }}>Training Pass Performance</h4>
      <ResponsiveContainer width="100%" height={340}>
        <BarChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
          <XAxis
            dataKey="name"
            tick={{ fill: "#94a3b8", fontSize: 11 }}
            tickFormatter={(name) => String(name).replace("Training Pass ", "Pass ")}
          />
          <YAxis domain={[0, 100]} tick={{ fill: "#94a3b8" }} />
          <Tooltip contentStyle={{ background: "var(--bg-tooltip)", borderColor: "var(--glass-border)" }} />
          <Bar
            className="training-pass-bar"
            dataKey="fieldAccuracy"
            name="Field Accuracy %"
            fill="#8b5cf6"
            radius={[5, 5, 0, 0]}
            barSize={48}
            onClick={(entry) => onTrainingPassSelect?.(entry?.payload?.name || entry?.name)}
            {...CHART_ANIMATION}
          />
        </BarChart>
      </ResponsiveContainer>
    </Panel>
  );
}

function TypeRadar({ data }) {
  if (!data.length) return null;

  return (
    <Panel>
      <h4 style={{ color: "#ec4899" }}>Accuracy by Field Type</h4>
      <ResponsiveContainer width="100%" height={320}>
        <RadarChart data={data}>
          <PolarGrid stroke="rgba(255,255,255,0.12)" />
          <PolarAngleAxis dataKey="subject" tick={{ fill: "#cbd5e1", fontSize: 12 }} />
          <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: "#94a3b8", fontSize: 10 }} />
          <Radar name="Accuracy" dataKey="A" stroke="#ec4899" fill="#ec4899" fillOpacity={0.35} {...CHART_ANIMATION} />
          <Tooltip contentStyle={{ background: "var(--bg-tooltip)", borderColor: "var(--glass-border)" }} />
        </RadarChart>
      </ResponsiveContainer>
    </Panel>
  );
}

function TimelineChart({ data }) {
  if (!data.length) return null;

  return (
    <Panel>
      <h4 style={{ color: "#3b82f6" }}>Validation Timeline</h4>
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={data}>
          <defs>
            <linearGradient id="countGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8} />
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 12 }} />
          <YAxis tick={{ fill: "#94a3b8", fontSize: 12 }} />
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.08)" />
          <Tooltip contentStyle={{ background: "var(--bg-tooltip)", borderColor: "var(--glass-border)" }} />
          <Area type="monotone" dataKey="count" stroke="#3b82f6" fillOpacity={1} fill="url(#countGradient)" {...CHART_ANIMATION} />
        </AreaChart>
      </ResponsiveContainer>
    </Panel>
  );
}

function DocTypePie({ data }) {
  if (!data.length) return null;

  return (
    <Panel>
      <h4 style={{ color: "#10b981" }}>Document Types</h4>
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
          <Tooltip contentStyle={{ background: "var(--bg-tooltip)", borderColor: "var(--glass-border)" }} />
          <Legend verticalAlign="bottom" height={44} wrapperStyle={{ fontSize: "0.78rem" }} />
        </PieChart>
      </ResponsiveContainer>
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
      <h4 style={{ color: "#14b8a6" }}>Vendor Accuracy - Best vs Worst</h4>
      <ResponsiveContainer width="100%" height={360}>
        <BarChart data={data} layout="vertical" margin={{ left: 60, right: 28 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(255,255,255,0.1)" />
          <XAxis type="number" tickFormatter={(value) => `${Math.abs(value)}%`} tick={{ fill: "#94a3b8" }} />
          <YAxis dataKey="name" type="category" width={170} tick={{ fill: "#cbd5e1", fontSize: 10 }} />
          <Tooltip
            formatter={(value, name, item) => [`${Math.abs(value).toFixed(2)}%`, item.payload.type]}
            contentStyle={{ background: "var(--bg-tooltip)", borderColor: "var(--glass-border)" }}
          />
          <Bar dataKey="accuracy" radius={[0, 5, 5, 0]} {...CHART_ANIMATION}>
            {data.map((entry) => (
              <Cell key={`${entry.type}-${entry.name}`} fill={entry.type === "Best" ? "#5eead4" : "#c4b5fd"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Panel>
  );
}

export default function DashboardView({ data, detailsData, vendorData, onTrainingPassSelect }) {
  const { groups, timelineData, docTypeData } = useMemo(
    () => parseSummaryMetrics(data || [], detailsData || []),
    [data, detailsData]
  );

  const percentMetrics = [
    ...groups.general.filter((item) => item.isPercentage),
    ...groups.regionTemplate.filter((item) => item.isPercentage)
  ];

  return (
    <motion.div className="dashboard-view" variants={dashboardContainer} initial="hidden" animate="visible">
      <motion.h2 className="page-title" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
        <BarChart3 color="#3b82f6" size={32} />
        Summary Overview
      </motion.h2>

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
        <Panel className="stat-card">
          <div>
            <span>Total Fields</span>
            <strong>{groups.summaryStats.total || "-"}</strong>
            <em>Position Accuracy</em>
          </div>
          <GaugeCard value={groups.summaryStats.positionAccuracy} label="Pos Acc" color="#3b82f6" />
        </Panel>
        <Panel className="stat-card">
          <div>
            <span>Total Tables</span>
            <strong>{groups.tableStats.total || "-"}</strong>
            <em>Position Accuracy</em>
          </div>
          <GaugeCard value={groups.tableStats.positionAccuracy} label="Pos Acc" color="#8b5cf6" />
        </Panel>
      </motion.div>

      <SectionTitle icon={PieChartIcon} title="Accuracy Breakdown" color="#3b82f6" />
      <div className="dashboard-grid two">
        <BreakdownPie title="Summary Fields Breakdown" data={groups.summaryStats} color="#3b82f6" />
        <BreakdownPie title="Table Cells Breakdown" data={groups.tableStats} color="#8b5cf6" />
      </div>

      <SectionTitle icon={Layers} title="Field Accuracy" color="#8b5cf6" />
      <div className="dashboard-grid two">
        <AccuracyBar title="Header Fields Position Accuracy" data={groups.hdrFields} color="#3b82f6" />
        <AccuracyBar title="Line Item Fields Position Accuracy" data={groups.liFields} color="#f59e0b" />
      </div>

      <SectionTitle icon={Boxes} title="Training and Types" color="#ec4899" />
      <div className="dashboard-grid two">
        <TrainingPassChart data={groups.trainingPass} onTrainingPassSelect={onTrainingPassSelect} />
        <TypeRadar data={groups.typeMetrics} />
      </div>

      {(timelineData.length > 0 || docTypeData.length > 0) && (
        <>
          <SectionTitle icon={FileStack} title="Detailed Report Signals" color="#10b981" />
          <div className="dashboard-grid two">
            <TimelineChart data={timelineData} />
            <DocTypePie data={docTypeData} />
          </div>
        </>
      )}

      {vendorData?.length > 0 && (
        <>
          <SectionTitle icon={Users} title="Vendor Signals" color="#14b8a6" />
          <VendorBestWorst vendorRows={vendorData} />
        </>
      )}
    </motion.div>
  );
}
