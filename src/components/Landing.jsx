/**
 * Landing — editorial entry screen with the animated typed headline.
 * Props: { onStart } — invoked to enter the app (App navigates to the Upload view).
 */
import { motion } from "framer-motion";
import { ArrowRight, BarChart3, Brain, Database } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import FluidBackdrop from "./FluidBackdrop.jsx";

const TYPED_WORDS = ["intelligence.", "clarity.", "precision.", "insight."];

const FEATURES = [
  { icon: BarChart3, label: "Real-time dashboards" },
  { icon: Database, label: "SQL connector" },
  { icon: Brain, label: "AI assistant" }
];

/* compact product-preview stats — mirrors the app's KPI vocabulary */
const STATS = [
  { value: "98.4%", label: "Extraction accuracy" },
  { value: "36k+", label: "Documents audited" },
  { value: "12", label: "Vendor pipelines" }
];

const stagger = {
  container: {
    hidden: {},
    show: { transition: { staggerChildren: 0.1, delayChildren: 0.25 } }
  },
  item: {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0, transition: { duration: 0.65, ease: [0.16, 1, 0.3, 1] } }
  }
};

export default function Landing({ onStart }) {
  const [wordIdx, setWordIdx] = useState(0);
  const [typedWord, setTypedWord] = useState("");
  const [phase, setPhase] = useState("typing"); // "typing" | "erasing"
  const timerRef = useRef(null);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      setTypedWord(TYPED_WORDS[0]);
      return;
    }

    const word = TYPED_WORDS[wordIdx];
    let charIdx = phase === "erasing" ? word.length : 0;

    function clearTimer() {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }

    function tick() {
      if (phase === "typing") {
        charIdx += 1;
        setTypedWord(word.slice(0, charIdx));
        if (charIdx >= word.length) {
          timerRef.current = window.setTimeout(() => setPhase("erasing"), 2000);
        } else {
          timerRef.current = window.setTimeout(tick, 78);
        }
      } else {
        charIdx -= 1;
        setTypedWord(word.slice(0, charIdx));
        if (charIdx <= 0) {
          timerRef.current = window.setTimeout(() => {
            setWordIdx((i) => (i + 1) % TYPED_WORDS.length);
            setPhase("typing");
          }, 200);
        } else {
          timerRef.current = window.setTimeout(tick, 38);
        }
      }
    }

    // Small initial delay for the typing start
    timerRef.current = window.setTimeout(tick, phase === "typing" ? 500 : 60);

    return clearTimer;
  }, [phase, wordIdx]);

  return (
    <div className="landing-screen">
      {/* Animated fluid background — sits behind all content, removable via its own settings panel */}
      <FluidBackdrop />

      {/* Brand */}
      <motion.header
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
        className="landing-brand"
      >
        <h1>
          <span>ancora</span>
          <strong>Lens</strong>
        </h1>
      </motion.header>

      {/* Hero */}
      <main className="landing-copy">
        <motion.div variants={stagger.container} initial="hidden" animate="show">
          <motion.div variants={stagger.item} className="landing-eyebrow">
            <span className="landing-eyebrow-dot" />
            Document intelligence, audited
          </motion.div>

          <motion.div variants={stagger.item}>
            <div className="landing-headline" aria-label={`data ${TYPED_WORDS[wordIdx]}`}>
              <span className="landing-word-primary">data</span>
              <span className="landing-word-secondary landing-word-typed" aria-hidden="true">
                {typedWord}
              </span>
            </div>
          </motion.div>

          <motion.p variants={stagger.item}>
            AncoraLens audits your document pipeline end to end — extraction accuracy, vendor performance and AI-powered
            reporting, all on one precise, calm surface.
          </motion.p>

          <motion.div variants={stagger.item} className="landing-cta-row">
            <button type="button" className="crystal-button" onClick={onStart}>
              <span>Get started</span>
              <ArrowRight size={18} />
            </button>
          </motion.div>

          {/* Product-preview stats — the editorial KPI ethos, distilled */}
          <motion.div variants={stagger.item} className="landing-stats">
            {STATS.map((stat) => (
              <div key={stat.label} className="landing-stat">
                <div className="landing-stat-value">{stat.value}</div>
                <div className="landing-stat-label">{stat.label}</div>
              </div>
            ))}
          </motion.div>
        </motion.div>
      </main>

      {/* Feature strip */}
      <motion.footer
        className="landing-features"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.55, delay: 0.95 }}
      >
        {FEATURES.map(({ icon: Icon, label }) => (
          <div key={label} className="landing-feature">
            <span className="landing-feature-dot" />
            <Icon size={14} strokeWidth={2} />
            {label}
          </div>
        ))}
      </motion.footer>
    </div>
  );
}
