/**
 * Shared fluid-background settings: persisted state, option resolution, and the
 * gear-button + popover panel UI. Framework-free, used by both the standalone
 * lab (/fluid-demo.html) and the landing-page backdrop (FluidBackdrop.jsx).
 */
import { PRESETS, DEFAULT_OPTIONS } from "./FluidBackground.js";

export const STORAGE_KEY = "ancoralens-fluid-settings";

/* Site palette (mirrors src/styles.css tokens — light / dark accent variants) */
export const THEMES = {
  light: {
    backColor: "#EFEADD",
    lightColor: "#FFF3D6",
    /* the landing page's editorial cobalt/coral radial washes */
    washes: [
      { x: 0.84, y: 0.94, radius: 0.55, color: "#2B3AE8", strength: 0.10 },
      { x: 0.04, y: 0.04, radius: 0.50, color: "#F0552B", strength: 0.09 }
    ],
    swatches: [
      { name: "Cobalt", hex: "#2B3AE8" },
      { name: "Coral", hex: "#F0552B" },
      { name: "Lime", hex: "#BEE846" },
      { name: "Violet", hex: "#6B4FD8" },
      { name: "Green", hex: "#15966B" },
      { name: "Amber", hex: "#E6A12C" }
    ]
  },
  dark: {
    backColor: "#14120C",
    lightColor: "#FFE9C2",
    washes: [
      { x: 0.84, y: 0.94, radius: 0.55, color: "#6E7BFF", strength: 0.07 },
      { x: 0.04, y: 0.04, radius: 0.50, color: "#FF6A43", strength: 0.06 }
    ],
    swatches: [
      { name: "Cobalt", hex: "#6E7BFF" },
      { name: "Coral", hex: "#FF6A43" },
      { name: "Lime", hex: "#CBF24E" },
      { name: "Violet", hex: "#9B86F0" },
      { name: "Green", hex: "#2FBE86" },
      { name: "Amber", hex: "#F0B23E" }
    ]
  }
};

export const QUALITY = {
  low: { simResolution: 96, dyeResolution: 360 },
  medium: { simResolution: 144, dyeResolution: 540 },
  high: { simResolution: 192, dyeResolution: 768 },
  ultra: { simResolution: 256, dyeResolution: 1024 }
};

export const DEFAULT_STATE = {
  enabled: true, // master switch — false removes the background entirely
  preset: "water",
  theme: "light",
  themeSource: "auto", // "auto" = follow the app theme (landing); "user" = explicit choice wins
  quality: "medium",
  activeSwatches: ["#2B3AE8", "#F0552B", "#BEE846", "#6B4FD8"],
  customColor: null,
  overlay: true, // lab-only: mock landing copy overlay
  overrides: {} // slider tweaks layered on top of the preset
};

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...structuredClone(DEFAULT_STATE), ...JSON.parse(raw) };
  } catch { /* fall through to defaults */ }
  return structuredClone(DEFAULT_STATE);
}

export function saveState(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* private mode */ }
}

/** Switch theme in place, remapping active swatches to the new theme's variants by index. */
export function applyTheme(state, theme) {
  if (state.theme === theme || !THEMES[theme]) return;
  const prev = THEMES[state.theme];
  state.activeSwatches = state.activeSwatches.map((hex) => {
    const i = prev.swatches.findIndex((s) => s.hex === hex);
    return i >= 0 ? THEMES[theme].swatches[i].hex : hex;
  });
  state.theme = theme;
}

/** Resolve full engine options from UI state. */
export function engineOptions(state) {
  const theme = THEMES[state.theme];
  const palette = [...state.activeSwatches];
  if (state.customColor) palette.push(state.customColor);
  return {
    preset: state.preset,
    ...QUALITY[state.quality],
    backColor: theme.backColor,
    lightColor: theme.lightColor,
    washes: theme.washes,
    palette: palette.length ? palette : [theme.swatches[0].hex],
    ...state.overrides
  };
}

/* ------------------------------ panel UI ------------------------------ */

const GEAR_SVG = `
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>`;

const SLIDERS = [
  { group: "Motion", key: "curl", label: "Swirl", min: 0, max: 60, step: 1 },
  { group: "Motion", key: "densityDissipation", label: "Fade speed", min: 0, max: 4, step: 0.05 },
  { group: "Motion", key: "velocityDissipation", label: "Drag", min: 0, max: 4, step: 0.05 },
  { group: "Motion", key: "ambient", label: "Ambient motion", min: 0, max: 1, step: 0.05 },
  { group: "Motion", key: "idleTailMs", label: "Settle time", min: 1500, max: 12000, step: 100 },
  { group: "Cursor", key: "splatRadius", label: "Brush size", min: 0.05, max: 1, step: 0.01 },
  { group: "Cursor", key: "splatForce", label: "Brush force", min: 1000, max: 12000, step: 100 },
  { group: "Cursor", key: "splatIntensity", label: "Colour amount", min: 0.1, max: 1.5, step: 0.05 },
  { group: "Light", key: "lightIntensity", label: "Light intensity", min: 0, max: 2.5, step: 0.05 },
  { group: "Light", key: "specular", label: "Specular", min: 0, max: 3, step: 0.05 },
  { group: "Light", key: "shininess", label: "Gloss", min: 10, max: 300, step: 5 },
  { group: "Light", key: "refraction", label: "Refraction", min: 0, max: 0.3, step: 0.005 },
  { group: "Light", key: "caustics", label: "Caustics", min: 0, max: 2, step: 0.05 },
  { group: "Light", key: "bump", label: "Surface relief", min: 0, max: 60, step: 1 },
  { group: "Light", key: "lightHeight", label: "Light height", min: 0.2, max: 2, step: 0.05 }
];

function fmt(v) { return Math.abs(v) >= 100 ? Math.round(v) : +(+v).toFixed(2); }

/**
 * Build the gear button + settings panel inside `host`.
 *
 * @param {object} cfg
 * @param {HTMLElement} cfg.host          container (gets the markup appended)
 * @param {object}      cfg.state         shared settings state (mutated in place)
 * @param {() => object|null} cfg.getFluid  returns the live engine, or null when off
 * @param {(state) => void} [cfg.onRebuild] page side effects (theme class, mount/unmount, overlay)
 * @param {Array}  [cfg.extraToggles]     [{ id, label, get():bool, set(bool) }] page-specific switches
 * @returns {{ rebuild():void, destroy():void }}
 */
export function createFluidSettings({ host, state, getFluid, onRebuild, extraToggles = [] }) {
  host.insertAdjacentHTML("beforeend", `
    <button type="button" class="gear-btn" data-fs="gear" aria-label="Background settings" aria-expanded="false">${GEAR_SVG}</button>
    <aside class="settings-panel" data-fs="panel" hidden>
      <div class="panel-head">
        <div>
          <div class="panel-eyebrow">Background engine</div>
          <h2>Fluid settings</h2>
        </div>
        <button type="button" class="panel-close" data-fs="close" aria-label="Close settings">&times;</button>
      </div>
      <div class="panel-body" data-fs="body"></div>
    </aside>
  `);
  const gearBtn = host.querySelector('[data-fs="gear"]');
  const panel = host.querySelector('[data-fs="panel"]');
  const body = host.querySelector('[data-fs="body"]');

  const onGear = () => {
    const open = panel.hasAttribute("hidden");
    panel.toggleAttribute("hidden", !open);
    gearBtn.setAttribute("aria-expanded", String(open));
    gearBtn.classList.toggle("active", open);
    if (open) renderPanel();
  };
  const closePanel = () => {
    panel.setAttribute("hidden", "");
    gearBtn.setAttribute("aria-expanded", "false");
    gearBtn.classList.remove("active");
  };
  const onKeyDown = (e) => { if (e.key === "Escape" && !panel.hasAttribute("hidden")) closePanel(); };
  gearBtn.addEventListener("click", onGear);
  host.querySelector('[data-fs="close"]').addEventListener("click", closePanel);
  window.addEventListener("keydown", onKeyDown);

  /** options as the engine sees them (or would, when currently disabled) */
  function resolved() {
    return getFluid()?.getOptions()
      ?? { ...DEFAULT_OPTIONS, ...PRESETS[state.preset], ...engineOptions(state) };
  }

  function currentValue(key) {
    if (key === "lightHeight") return (state.overrides.lightPos ?? resolved().lightPos).z;
    if (key in state.overrides) return state.overrides[key];
    return resolved()[key] ?? DEFAULT_OPTIONS[key];
  }

  function applyOverride(key, value) {
    if (key === "lightHeight") {
      const lp = { ...resolved().lightPos, z: value };
      state.overrides.lightPos = lp;
      getFluid()?.setOptions({ lightPos: lp });
    } else {
      state.overrides[key] = value;
      getFluid()?.setOptions({ [key]: value });
    }
    saveState(state);
  }

  function rebuild() {
    saveState(state);
    getFluid()?.setOptions(engineOptions(state));
    onRebuild?.(state);
    renderPanel();
  }

  function renderPanel() {
    const theme = THEMES[state.theme];
    const opts = resolved();

    const presetChips = Object.keys(PRESETS).map((p) =>
      `<button type="button" class="chip ${state.preset === p ? "on" : ""}" data-preset="${p}">${p[0].toUpperCase()}${p.slice(1)}</button>`
    ).join("");

    const themeChips = ["light", "dark"].map((t) =>
      `<button type="button" class="chip ${state.theme === t ? "on" : ""}" data-theme="${t}">${t === "light" ? "Paper" : "Charcoal"}</button>`
    ).join("");

    const qualityChips = Object.keys(QUALITY).map((q) =>
      `<button type="button" class="chip ${state.quality === q ? "on" : ""}" data-quality="${q}">${q[0].toUpperCase()}${q.slice(1)}</button>`
    ).join("");

    const swatches = theme.swatches.map((s) => {
      const on = state.activeSwatches.includes(s.hex);
      return `<button type="button" class="swatch ${on ? "on" : ""}" data-swatch="${s.hex}" title="${s.name}" style="--c:${s.hex}"><span></span></button>`;
    }).join("");

    const groups = ["Motion", "Cursor", "Light"];
    const sliderHtml = groups.map((g) => `
      <div class="panel-section">
        <div class="panel-label">${g}</div>
        ${g === "Light" ? `
          <div class="toggle-row">
            <label class="toggle"><input type="checkbox" data-fs-toggle="lightOn" ${opts.lightOn ? "checked" : ""}/><span></span>Light effects</label>
            <label class="toggle"><input type="checkbox" data-fs-toggle="lightFollowsCursor" ${opts.lightFollowsCursor ? "checked" : ""}/><span></span>Follows cursor</label>
          </div>` : ""}
        ${SLIDERS.filter((s) => s.group === g).map((s) => {
          const v = currentValue(s.key);
          return `
            <div class="slider-row">
              <label for="sl-${s.key}">${s.label}</label>
              <input id="sl-${s.key}" type="range" min="${s.min}" max="${s.max}" step="${s.step}" value="${v}" data-slider="${s.key}" />
              <output data-fs-out="${s.key}">${fmt(v)}</output>
            </div>`;
        }).join("")}
      </div>`).join("");

    const extraHtml = extraToggles.map((t) =>
      `<label class="toggle"><input type="checkbox" data-fs-extra="${t.id}" ${t.get() ? "checked" : ""}/><span></span>${t.label}</label>`
    ).join("");

    body.innerHTML = `
      <div class="panel-section">
        <div class="panel-label">Effect</div>
        <div class="chip-row">${presetChips}</div>
      </div>
      <div class="panel-section">
        <div class="panel-label">Backdrop</div>
        <div class="chip-row">
          ${themeChips}
          <label class="swatch custom backdrop-pick ${state.overrides.backColor ? "on" : ""}" title="Custom backdrop colour" style="--c:${state.overrides.backColor || THEMES[state.theme].backColor}">
            <input type="color" data-fs="backColor" value="${state.overrides.backColor || THEMES[state.theme].backColor}" />
            <span>+</span>
          </label>
        </div>
      </div>
      <div class="panel-section">
        <div class="panel-label">Palette <span class="panel-hint">site accent colours</span></div>
        <div class="swatch-row">
          ${swatches}
          <label class="swatch custom ${state.customColor ? "on" : ""}" title="Custom colour" style="--c:${state.customColor || "#888"}">
            <input type="color" data-fs="customColor" value="${state.customColor || "#2B3AE8"}" />
            <span>+</span>
          </label>
        </div>
      </div>
      ${sliderHtml}
      <div class="panel-section">
        <div class="panel-label">Quality</div>
        <div class="chip-row">${qualityChips}</div>
      </div>
      <div class="panel-section">
        <div class="toggle-row">
          ${extraHtml}
          <label class="toggle"><input type="checkbox" data-fs-extra="__pause" ${opts.paused ? "checked" : ""}/><span></span>Pause</label>
        </div>
        <div class="btn-row">
          <button type="button" class="btn-mini" data-fs="splash">Splash</button>
          <button type="button" class="btn-mini" data-fs="clear">Clear</button>
          <button type="button" class="btn-mini ghost" data-fs="reset">Reset defaults</button>
        </div>
      </div>
    `;

    wirePanel();
  }

  function wirePanel() {
    body.querySelectorAll("[data-preset]").forEach((b) => b.addEventListener("click", () => {
      state.preset = b.dataset.preset;
      state.overrides = {}; // a preset is a fresh, tuned starting point
      if (state.preset === "aurora" && state.theme !== "dark") {
        applyTheme(state, "dark");
        state.themeSource = "user";
      }
      rebuild();
    }));

    body.querySelectorAll("[data-theme]").forEach((b) => b.addEventListener("click", () => {
      applyTheme(state, b.dataset.theme);
      state.themeSource = "user"; // explicit pick — stop auto-following the app theme
      delete state.overrides.backColor; // theme chip resets any custom backdrop colour
      rebuild();
    }));

    body.querySelector('[data-fs="backColor"]').addEventListener("input", (e) => {
      state.overrides.backColor = e.target.value;
      const well = e.target.closest(".swatch");
      well.classList.add("on");
      well.style.setProperty("--c", e.target.value);
      getFluid()?.setOptions({ backColor: e.target.value });
      saveState(state);
    });

    body.querySelectorAll("[data-quality]").forEach((b) => b.addEventListener("click", () => {
      state.quality = b.dataset.quality;
      rebuild();
    }));

    body.querySelectorAll("[data-swatch]").forEach((b) => b.addEventListener("click", () => {
      const hex = b.dataset.swatch;
      const i = state.activeSwatches.indexOf(hex);
      if (i >= 0) state.activeSwatches.splice(i, 1);
      else state.activeSwatches.push(hex);
      getFluid()?.setOptions({ palette: engineOptions(state).palette });
      saveState(state);
      b.classList.toggle("on", i < 0);
    }));

    body.querySelector('[data-fs="customColor"]').addEventListener("input", (e) => {
      state.customColor = e.target.value;
      e.target.closest(".swatch").classList.add("on");
      e.target.closest(".swatch").style.setProperty("--c", state.customColor);
      getFluid()?.setOptions({ palette: engineOptions(state).palette });
      saveState(state);
    });

    body.querySelectorAll("[data-slider]").forEach((input) => input.addEventListener("input", () => {
      const key = input.dataset.slider;
      const v = parseFloat(input.value);
      body.querySelector(`[data-fs-out="${key}"]`).textContent = fmt(v);
      applyOverride(key, v);
    }));

    body.querySelectorAll("[data-fs-toggle]").forEach((input) => input.addEventListener("change", (e) => {
      const key = e.target.dataset.fsToggle;
      state.overrides[key] = e.target.checked;
      getFluid()?.setOptions({ [key]: e.target.checked });
      saveState(state);
    }));

    body.querySelectorAll("[data-fs-extra]").forEach((input) => input.addEventListener("change", (e) => {
      const id = e.target.dataset.fsExtra;
      if (id === "__pause") {
        const f = getFluid();
        if (f) e.target.checked ? f.pause() : f.resume();
        return;
      }
      const toggle = extraToggles.find((t) => t.id === id);
      toggle?.set(e.target.checked);
      rebuild();
    }));

    body.querySelector('[data-fs="splash"]').addEventListener("click", () => getFluid()?.randomSplats(8, 1));
    body.querySelector('[data-fs="clear"]').addEventListener("click", () => getFluid()?.clear());
    body.querySelector('[data-fs="reset"]').addEventListener("click", () => {
      Object.keys(state).forEach((k) => delete state[k]);
      Object.assign(state, structuredClone(DEFAULT_STATE));
      rebuild();
    });
  }

  return {
    rebuild,
    destroy() {
      window.removeEventListener("keydown", onKeyDown);
      gearBtn.remove();
      panel.remove();
    }
  };
}
