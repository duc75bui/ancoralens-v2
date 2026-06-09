import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";

const TYPED_WORD = "intelligence.";

export default function Landing({ onStart }) {
  const [typedWord, setTypedWord] = useState("");

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (prefersReducedMotion) {
      setTypedWord(TYPED_WORD);
      return undefined;
    }

    let index = 0;
    const startDelay = window.setTimeout(() => {
      const intervalId = window.setInterval(() => {
        index += 1;
        setTypedWord(TYPED_WORD.slice(0, index));

        if (index >= TYPED_WORD.length) {
          window.clearInterval(intervalId);
        }
      }, 95);
    }, 760);

    return () => {
      window.clearTimeout(startDelay);
    };
  }, []);

  return (
    <div className="landing-screen">
      <motion.header
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
        className="landing-brand"
      >
        <h1>
          <span>ancora</span>
          <strong>Lens</strong>
        </h1>
      </motion.header>

      <main className="landing-copy">
        <motion.div
          initial={{ opacity: 0, x: -30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
        >
          <h2 aria-label="data intelligence.">
            <span className="landing-word-primary">data</span>
            <span className="landing-word-secondary landing-word-typed" aria-hidden="true">
              {typedWord}
            </span>
          </h2>
          <p>Advanced CSV Analytics & Visualization Platform</p>
          <button type="button" className="crystal-button" onClick={onStart}>
            <span>Start</span>
            <ArrowRight size={20} />
          </button>
        </motion.div>
      </main>
    </div>
  );
}
