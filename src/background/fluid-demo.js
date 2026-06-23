/**
 * Fluid Background Lab — standalone test harness for FluidBackground.
 * Mounts the sim full-screen and reuses the shared settings UI
 * (src/background/fluid-settings.js) — the exact panel the landing page gets —
 * plus a lab-only mock of the landing copy to preview legibility.
 *
 * Settings persist to localStorage (shared key), so a look tuned here is the
 * look the real landing page background loads with.
 */
import FluidBackground from "./FluidBackground.js";
import { createFluidSettings, engineOptions, loadState } from "./fluid-settings.js";

const state = loadState();

const stage = document.getElementById("stage");
stage.innerHTML = `
  <div class="lab-badge">
    <span class="lab-badge-dot"></span>
    Fluid background lab — standalone preview
  </div>

  <div class="landing-mock" id="landingMock" aria-hidden="true">
    <header class="mock-brand"><h1><span>ancora</span><strong>Lens</strong></h1></header>
    <main class="mock-copy">
      <div class="mock-eyebrow"><span class="mock-eyebrow-dot"></span>Document intelligence, audited</div>
      <div class="mock-headline"><span>data</span><em>intelligence.</em></div>
      <p>AncoraLens audits your document pipeline end to end — extraction accuracy, vendor performance and AI-powered reporting, all on one precise, calm surface.</p>
      <div class="mock-cta"><span>Get started</span><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg></div>
      <div class="mock-stats">
        <div><b>98.4%</b><i>Extraction accuracy</i></div>
        <div><b>36k+</b><i>Documents audited</i></div>
        <div><b>12</b><i>Vendor pipelines</i></div>
      </div>
    </main>
  </div>

  <div class="fluid-ui" id="fluidUi"></div>
`;

const fluid = FluidBackground.mount(stage, engineOptions(state));
// exposed for automated drive-by previews + manual poking
window.__fluid = fluid;

createFluidSettings({
  host: document.getElementById("fluidUi"),
  state,
  getFluid: () => fluid,
  showTheme: true,
  extraToggles: [
    {
      id: "overlayToggle",
      label: "Landing copy overlay",
      get: () => state.overlay,
      set: (v) => { state.overlay = v; }
    }
  ],
  onRebuild: (s) => {
    document.body.classList.toggle("theme-dark", s.theme === "dark");
    document.getElementById("landingMock").classList.toggle("hidden", !s.overlay);
  }
});

// apply initial page side effects (theme class + overlay visibility)
document.body.classList.toggle("theme-dark", state.theme === "dark");
document.getElementById("landingMock").classList.toggle("hidden", !state.overlay);
