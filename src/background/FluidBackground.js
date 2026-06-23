/**
 * FluidBackground — a modular, framework-free WebGL2 fluid-dynamics background.
 *
 * Physics:  GPU "stable fluids" Navier–Stokes solver — semi-Lagrangian advection,
 *           vorticity confinement, Jacobi pressure projection (incompressible flow).
 * Lighting: single-bounce ray-traced shading — the view ray is refracted through the
 *           fluid height-field, paper is sampled along the bent ray, with Blinn-Phong
 *           specular, fresnel rim, and curvature caustics from a movable point light.
 *
 * Usage:
 *   import FluidBackground from "./FluidBackground.js";
 *   const fluid = FluidBackground.mount(containerEl, { preset: "water" });
 *   fluid.setOptions({ palette: ["#2B3AE8"] });
 *   fluid.destroy();
 *
 * Zero dependencies, zero globals. Designed to sit behind page content
 * (pointer events are listened on `window` by default so overlaid UI stays usable).
 */

/* ------------------------------------------------------------------ */
/* Presets — tuned against the AncoraLens warm-paper editorial palette */
/* ------------------------------------------------------------------ */

export const PRESETS = {
  /** Clear water over paper: strong refraction, caustics, glassy specular. */
  water: {
    ink: 0.16, glow: 0.0, densityScale: 1.5,
    bump: 24, refraction: 0.12, specular: 1.25, shininess: 140,
    fresnel: 0.35, caustics: 0.85,
    curl: 14, densityDissipation: 1.5, velocityDissipation: 0.55,
    splatRadius: 0.38, splatForce: 5200, splatIntensity: 0.55
  },
  /** Pigment ink blooming on paper: multiplicative colour, slow fade. */
  ink: {
    ink: 1.0, glow: 0.0, densityScale: 2.2,
    bump: 7, refraction: 0.018, specular: 0.14, shininess: 42,
    fresnel: 0.08, caustics: 0.06,
    curl: 9, densityDissipation: 0.12, velocityDissipation: 0.9,
    splatRadius: 0.22, splatForce: 5600, splatIntensity: 0.85
  },
  /** Soft turbulent smoke: high swirl, gentle colour wash. */
  smoke: {
    ink: 0.48, glow: 0.05, densityScale: 1.7,
    bump: 10, refraction: 0.035, specular: 0.45, shininess: 60,
    fresnel: 0.15, caustics: 0.15,
    curl: 38, densityDissipation: 0.85, velocityDissipation: 0.18,
    splatRadius: 0.45, splatForce: 4800, splatIntensity: 0.6
  },
  /** Luminous flow for the dark charcoal theme: additive glow, no pigment. */
  aurora: {
    ink: 0.05, glow: 0.95, densityScale: 1.2,
    bump: 16, refraction: 0.055, specular: 0.85, shininess: 80,
    fresnel: 0.3, caustics: 0.3,
    curl: 26, densityDissipation: 0.6, velocityDissipation: 0.3,
    splatRadius: 0.34, splatForce: 5200, splatIntensity: 0.7
  }
};

export const DEFAULT_OPTIONS = {
  preset: "water",
  // simulation
  simResolution: 144,
  dyeResolution: 540,
  pressure: 0.8,
  pressureIterations: 20,
  curl: 14,
  densityDissipation: 1.5,
  velocityDissipation: 0.55,
  // interaction
  interact: true,
  splatRadius: 0.38,
  splatForce: 5200,
  splatIntensity: 0.55,
  ambient: 0, // 0..1 — idle auto-splat activity (off: only the cursor stirs the fluid)
  idleFreeze: true, // when the cursor goes still / leaves, ease the sim to rest then stop (GPU idle)
  idleTailMs: 5200, // total sim time after the last input before the freeze
  idleFadeMs: 2600, // final portion of the tail spent easing time-scale 1 → 0 (graceful fade, no dead stop)
  uiIgnoreSelector: ".fluid-ui", // pointer events starting inside this never stir the fluid (settings panel)
  // look
  palette: ["#2B3AE8", "#F0552B", "#BEE846", "#6B4FD8"],
  backColor: "#EFEADD",
  // up to 2 soft radial colour washes painted on the paper (mirrors the
  // landing page's editorial cobalt/coral gradients) — [{x,y,radius,color,strength}]
  washes: [],
  grain: 0.05,
  vignette: 0.16,
  ink: 0.16,
  glow: 0.0,
  densityScale: 1.5,
  // light / "ray" pass
  lightOn: true,
  lightFollowsCursor: true,
  lightPos: { x: 0.5, y: 0.35, z: 0.85 },
  lightColor: "#FFF3D6",
  lightIntensity: 1.0,
  bump: 24,
  refraction: 0.12,
  specular: 1.25,
  shininess: 140,
  fresnel: 0.35,
  caustics: 0.85,
  paused: false
};

/* ----------------------------- shaders ----------------------------- */

const VERT = `#version 300 es
precision highp float;
in vec2 aPosition;
out vec2 vUv;
out vec2 vL, vR, vT, vB;
uniform vec2 uTexelSize;
void main () {
  vUv = aPosition * 0.5 + 0.5;
  vL = vUv - vec2(uTexelSize.x, 0.0);
  vR = vUv + vec2(uTexelSize.x, 0.0);
  vT = vUv + vec2(0.0, uTexelSize.y);
  vB = vUv - vec2(0.0, uTexelSize.y);
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

const FRAG_COPY = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uTexture;
void main () { o = texture(uTexture, vUv); }`;

const FRAG_CLEAR = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uTexture;
uniform float uValue;
void main () { o = uValue * texture(uTexture, vUv); }`;

const FRAG_SPLAT = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uTarget;
uniform float uAspectRatio;
uniform vec3 uColor;
uniform vec2 uPoint;
uniform float uRadius;
void main () {
  vec2 p = vUv - uPoint;
  p.x *= uAspectRatio;
  vec3 splat = exp(-dot(p, p) / uRadius) * uColor;
  o = vec4(texture(uTarget, vUv).xyz + splat, 1.0);
}`;

const FRAG_ADVECTION = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 uTexelSize;
uniform float uDt;
uniform float uDissipation;
void main () {
  vec2 coord = vUv - uDt * texture(uVelocity, vUv).xy * uTexelSize;
  vec4 result = texture(uSource, coord);
  float decay = 1.0 + uDissipation * uDt;
  o = result / decay;
}`;

const FRAG_DIVERGENCE = `#version 300 es
precision highp float;
in vec2 vUv; in vec2 vL, vR, vT, vB; out vec4 o;
uniform sampler2D uVelocity;
void main () {
  float L = texture(uVelocity, vL).x;
  float R = texture(uVelocity, vR).x;
  float T = texture(uVelocity, vT).y;
  float B = texture(uVelocity, vB).y;
  vec2 C = texture(uVelocity, vUv).xy;
  if (vL.x < 0.0) { L = -C.x; }
  if (vR.x > 1.0) { R = -C.x; }
  if (vT.y > 1.0) { T = -C.y; }
  if (vB.y < 0.0) { B = -C.y; }
  o = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
}`;

const FRAG_CURL = `#version 300 es
precision highp float;
in vec2 vUv; in vec2 vL, vR, vT, vB; out vec4 o;
uniform sampler2D uVelocity;
void main () {
  float L = texture(uVelocity, vL).y;
  float R = texture(uVelocity, vR).y;
  float T = texture(uVelocity, vT).x;
  float B = texture(uVelocity, vB).x;
  o = vec4(R - L - T + B, 0.0, 0.0, 1.0);
}`;

const FRAG_VORTICITY = `#version 300 es
precision highp float;
in vec2 vUv; in vec2 vL, vR, vT, vB; out vec4 o;
uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform float uCurlStrength;
uniform float uDt;
void main () {
  float L = texture(uCurl, vL).x;
  float R = texture(uCurl, vR).x;
  float T = texture(uCurl, vT).x;
  float B = texture(uCurl, vB).x;
  float C = texture(uCurl, vUv).x;
  vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  force /= length(force) + 0.0001;
  force *= uCurlStrength * C;
  force.y *= -1.0;
  vec2 velocity = texture(uVelocity, vUv).xy + force * uDt;
  o = vec4(clamp(velocity, -1000.0, 1000.0), 0.0, 1.0);
}`;

const FRAG_PRESSURE = `#version 300 es
precision highp float;
in vec2 vUv; in vec2 vL, vR, vT, vB; out vec4 o;
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
void main () {
  float L = texture(uPressure, vL).x;
  float R = texture(uPressure, vR).x;
  float T = texture(uPressure, vT).x;
  float B = texture(uPressure, vB).x;
  float divergence = texture(uDivergence, vUv).x;
  o = vec4((L + R + B + T - divergence) * 0.25, 0.0, 0.0, 1.0);
}`;

const FRAG_GRADIENT_SUBTRACT = `#version 300 es
precision highp float;
in vec2 vUv; in vec2 vL, vR, vT, vB; out vec4 o;
uniform sampler2D uPressure;
uniform sampler2D uVelocity;
void main () {
  float L = texture(uPressure, vL).x;
  float R = texture(uPressure, vR).x;
  float T = texture(uPressure, vT).x;
  float B = texture(uPressure, vB).x;
  vec2 velocity = texture(uVelocity, vUv).xy - vec2(R - L, T - B);
  o = vec4(velocity, 0.0, 1.0);
}`;

/* The display pass — refraction + Blinn-Phong specular + fresnel + caustics. */
const FRAG_DISPLAY = `#version 300 es
precision highp float;
in vec2 vUv; in vec2 vL, vR, vT, vB; out vec4 fragColor;
uniform sampler2D uDye;
uniform vec2 uAspect;        // (aspect, 1)
uniform vec3 uBackColor;
uniform float uGrain;
uniform float uVignette;
uniform float uInk;          // pigment opacity (multiplicative)
uniform float uGlow;         // additive luminous dye
uniform float uDensityScale;
uniform float uBump;         // height-field normal strength
uniform float uRefract;      // refraction ray displacement
uniform float uSpec;
uniform float uShininess;
uniform float uFresnel;
uniform float uCaustic;
uniform vec3 uLightPos;      // xy in uv-space, z = height above plane
uniform vec3 uLightColor;
uniform float uLightOn;      // 0..1 * intensity
uniform vec4 uWash1;         // xy = centre (uv), z = radius, w = strength
uniform vec3 uWash1Color;
uniform vec4 uWash2;
uniform vec3 uWash2Color;

float lum (vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float hash (vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

vec3 wash (vec2 uv, vec4 w, vec3 color) {
  if (w.w <= 0.0) return vec3(0.0);
  vec2 d = (uv - w.xy) * uAspect;
  return color * w.w * exp(-dot(d, d) / (w.z * w.z));
}

vec3 paper (vec2 uv) {
  // warm paper with a fine static grain and a soft top-light wash
  float g = (hash(floor(gl_FragCoord.xy * 0.75) + floor(uv * 3.0)) - 0.5) * uGrain;
  float topWash = 1.0 + 0.025 * (1.0 - uv.y);
  vec3 col = uBackColor * topWash + vec3(g);
  // editorial radial colour washes (cobalt / coral on the landing page)
  col += wash(uv, uWash1, uWash1Color);
  col += wash(uv, uWash2, uWash2Color);
  return col;
}

void main () {
  // --- height field from dye density ---
  float hC = lum(texture(uDye, vUv).rgb);
  float hL = lum(texture(uDye, vL).rgb);
  float hR = lum(texture(uDye, vR).rgb);
  float hT = lum(texture(uDye, vT).rgb);
  float hB = lum(texture(uDye, vB).rgb);

  vec3 N = normalize(vec3(-(hR - hL) * uBump, -(hT - hB) * uBump, 1.0));

  // --- single-bounce refraction: bend the view ray through the surface ---
  vec2 refrUv = clamp(vUv - N.xy * uRefract * (0.25 + hC), vec2(0.001), vec2(0.999));
  vec3 base = paper(refrUv);

  // --- point light ---
  vec2 toL = (uLightPos.xy - vUv) * uAspect;
  float lightDist2 = dot(toL, toL);
  vec3 Ldir = normalize(vec3(toL, uLightPos.z));
  float atten = (uLightPos.z * uLightPos.z) / (lightDist2 + uLightPos.z * uLightPos.z);

  // gentle ambient pool of light on the paper itself
  base += uLightColor * (atten * atten) * 0.10 * uLightOn;

  // --- caustics: surface curvature focuses light onto the paper ---
  float lapl = hL + hR + hT + hB - 4.0 * hC;
  float caustic = max(lapl, 0.0) * uCaustic * 26.0 * atten;
  base += uLightColor * caustic;

  // --- pigment (Beer-Lambert-ish multiplicative ink) ---
  vec3 dye = texture(uDye, refrUv).rgb;
  float d = clamp(hC * uDensityScale, 0.0, 1.0);
  vec3 chroma = dye / max(lum(dye), 0.0001);
  vec3 pigment = clamp(chroma * 0.92, 0.0, 1.25);
  vec3 col = base * mix(vec3(1.0), pigment, d * uInk);

  // subtle depth shading so thick ink reads as wet
  col *= 1.0 - d * uInk * 0.22 * (1.0 - N.z);

  // --- additive glow (dark theme / aurora) ---
  col += dye * uGlow;

  // --- specular + fresnel, gated to where fluid exists ---
  float mask = smoothstep(0.0, 0.06, hC);
  vec3 H = normalize(Ldir + vec3(0.0, 0.0, 1.0));
  float spec = pow(max(dot(N, H), 0.0), uShininess) * atten;
  float fres = pow(clamp(1.0 - N.z, 0.0, 1.0), 2.0) * uFresnel;
  col += (spec * uSpec * mix(0.04, 1.0, mask) + fres * mask) * uLightColor * uLightOn;

  // --- vignette + dither ---
  vec2 vq = vUv * (1.0 - vUv.yx);
  col *= 1.0 - uVignette * (1.0 - clamp(pow(vq.x * vq.y * 18.0, 0.25), 0.0, 1.0));
  col += (hash(gl_FragCoord.xy) - 0.5) / 255.0;

  fragColor = vec4(col, 1.0);
}`;

/* ----------------------------- helpers ----------------------------- */

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const v = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return { r: ((v >> 16) & 255) / 255, g: ((v >> 8) & 255) / 255, b: (v & 255) / 255 };
}

/** Small hue/lightness jitter so repeated splats of one swatch stay lively. */
function jitterColor({ r, g, b }, amount = 0.08) {
  const j = () => 1 + (Math.random() * 2 - 1) * amount;
  return { r: Math.min(1, r * j()), g: Math.min(1, g * j()), b: Math.min(1, b * j()) };
}

class Program {
  constructor(gl, fragSource) {
    this.gl = gl;
    this.handle = gl.createProgram();
    gl.attachShader(this.handle, Program.compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(this.handle, Program.compile(gl, gl.FRAGMENT_SHADER, fragSource));
    gl.linkProgram(this.handle);
    if (!gl.getProgramParameter(this.handle, gl.LINK_STATUS)) {
      throw new Error("FluidBackground: program link failed — " + gl.getProgramInfoLog(this.handle));
    }
    this.uniforms = {};
    const count = gl.getProgramParameter(this.handle, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) {
      const name = gl.getActiveUniform(this.handle, i).name;
      this.uniforms[name] = gl.getUniformLocation(this.handle, name);
    }
  }
  static compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error("FluidBackground: shader compile failed — " + gl.getShaderInfoLog(shader));
    }
    return shader;
  }
  bind() { this.gl.useProgram(this.handle); }
}

/* ------------------------------ engine ----------------------------- */

export default class FluidBackground {
  /**
   * Create a canvas filling `container` (position:absolute, inset:0) and start the sim.
   * The container should be position:relative/absolute/fixed.
   */
  static mount(container, options = {}) {
    const canvas = document.createElement("canvas");
    canvas.className = "fluid-background-canvas";
    Object.assign(canvas.style, {
      position: "absolute", inset: "0", width: "100%", height: "100%", display: "block"
    });
    container.prepend(canvas);
    return new FluidBackground(canvas, options);
  }

  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.opts = { ...DEFAULT_OPTIONS, ...PRESETS[options.preset || DEFAULT_OPTIONS.preset], ...options };
    this._destroyed = false;
    this._paletteIdx = 0;
    this._pointers = new Map();
    this._ambientClock = 0;
    this._lastTime = null;
    this._lastActivity = -Infinity; // ms (perf clock) of the last splat / cursor move
    this._idleRendered = false;     // have we drawn the final settled frame yet
    this._cursorLight = { x: 0.5, y: 0.35 };

    // preserveDrawingBuffer keeps the last frame stable for screenshots and for
    // the idle-freeze mode (no per-frame redraw while the cursor is still)
    const gl = canvas.getContext("webgl2", {
      alpha: false, depth: false, stencil: false, antialias: false,
      preserveDrawingBuffer: true, powerPreference: "high-performance"
    });
    if (!gl) throw new Error("FluidBackground: WebGL2 is not available in this browser.");
    const colorFloat = gl.getExtension("EXT_color_buffer_float") || gl.getExtension("EXT_color_buffer_half_float");
    if (!colorFloat) throw new Error("FluidBackground: float render targets unsupported (EXT_color_buffer_float).");
    this.gl = gl;

    this._initBlit();
    this.programs = {
      copy: new Program(gl, FRAG_COPY),
      clear: new Program(gl, FRAG_CLEAR),
      splat: new Program(gl, FRAG_SPLAT),
      advection: new Program(gl, FRAG_ADVECTION),
      divergence: new Program(gl, FRAG_DIVERGENCE),
      curl: new Program(gl, FRAG_CURL),
      vorticity: new Program(gl, FRAG_VORTICITY),
      pressure: new Program(gl, FRAG_PRESSURE),
      gradientSubtract: new Program(gl, FRAG_GRADIENT_SUBTRACT),
      display: new Program(gl, FRAG_DISPLAY)
    };

    this._resizeCanvas();
    this._initFramebuffers();
    this._bindEvents(options.interactTarget || window);

    this._raf = 0;
    this._tick = this._tick.bind(this);
    this._raf = requestAnimationFrame(this._tick);

    // a soft opening flourish so the background never loads dead-still,
    // and a synchronous first paint so the canvas is never black for a frame
    this.randomSplats(4, 0.35);
    this._render();
  }

  /* ------------------------- public API ------------------------- */

  /** Merge new options; pass { preset } to switch the whole look. */
  setOptions(partial = {}) {
    const prev = this.opts;
    const next = partial.preset
      ? { ...prev, ...PRESETS[partial.preset], ...partial }
      : { ...prev, ...partial };
    this.opts = next;
    if (next.simResolution !== prev.simResolution || next.dyeResolution !== prev.dyeResolution) {
      this._initFramebuffers();
    }
  }

  getOptions() { return { ...this.opts }; }

  /** Inject a splat: x/y in [0..1] (origin bottom-left), dx/dy velocity, color hex or {r,g,b}. */
  splat(x, y, dx, dy, color) {
    const c = typeof color === "string" ? hexToRgb(color) : color || this._nextColor();
    this._splat(x, y, dx, dy, c);
  }

  /** Burst of random gentle splats. */
  randomSplats(count = 5, strength = 1) {
    for (let i = 0; i < count; i++) {
      const c = this._nextColor();
      const x = 0.15 + Math.random() * 0.7;
      const y = 0.15 + Math.random() * 0.7;
      const a = Math.random() * Math.PI * 2;
      const f = this.opts.splatForce * (0.15 + Math.random() * 0.35) * strength;
      this._splat(x, y, Math.cos(a) * f, Math.sin(a) * f, c, 1 + Math.random());
    }
  }

  /** Clear all dye + motion. */
  clear() {
    const { gl } = this;
    [this.dye, this.velocity, this.pressureFbo].forEach((fbo) => {
      [fbo.read, fbo.write].forEach((t) => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
      });
    });
  }

  pause() { this.opts.paused = true; }
  resume() { this.opts.paused = false; this._lastTime = null; }

  /** Manually advance the sim (also used by automated previews where rAF is throttled). */
  frame(steps = 1, dt = 1 / 60) {
    for (let i = 0; i < steps; i++) this._step(dt);
    this._render();
  }

  destroy() {
    this._destroyed = true;
    cancelAnimationFrame(this._raf);
    this._unbindEvents();
    this._resizeObserver?.disconnect();
    const lose = this.gl.getExtension("WEBGL_lose_context");
    lose?.loseContext();
    this.canvas.remove();
  }

  /* ----------------------- internals: setup ---------------------- */

  _initBlit() {
    const { gl } = this;
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this._blit = (target) => {
      if (target == null) {
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      } else {
        gl.viewport(0, 0, target.width, target.height);
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
  }

  _resolution(base) {
    const w = this.gl.drawingBufferWidth, h = this.gl.drawingBufferHeight;
    const aspect = Math.max(w / h, h / w);
    const min = Math.round(base), max = Math.round(base * aspect);
    return w > h ? { width: max, height: min } : { width: min, height: max };
  }

  _createFBO(w, h, internalFormat, format, filter) {
    const { gl } = this;
    const texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, gl.HALF_FLOAT, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return {
      texture, fbo, width: w, height: h,
      texelSizeX: 1 / w, texelSizeY: 1 / h,
      attach: (id) => { gl.activeTexture(gl.TEXTURE0 + id); gl.bindTexture(gl.TEXTURE_2D, texture); return id; }
    };
  }

  _createDoubleFBO(w, h, internalFormat, format, filter) {
    let read = this._createFBO(w, h, internalFormat, format, filter);
    let write = this._createFBO(w, h, internalFormat, format, filter);
    return {
      get read() { return read; }, get write() { return write; },
      width: w, height: h, texelSizeX: 1 / w, texelSizeY: 1 / h,
      swap() { const t = read; read = write; write = t; }
    };
  }

  _initFramebuffers() {
    const { gl } = this;
    const sim = this._resolution(this.opts.simResolution);
    const dye = this._resolution(this.opts.dyeResolution);
    gl.disable(gl.BLEND);
    this.dye = this._createDoubleFBO(dye.width, dye.height, gl.RGBA16F, gl.RGBA, gl.LINEAR);
    this.velocity = this._createDoubleFBO(sim.width, sim.height, gl.RG16F, gl.RG, gl.LINEAR);
    this.divergence = this._createFBO(sim.width, sim.height, gl.R16F, gl.RED, gl.NEAREST);
    this.curlFbo = this._createFBO(sim.width, sim.height, gl.R16F, gl.RED, gl.NEAREST);
    this.pressureFbo = this._createDoubleFBO(sim.width, sim.height, gl.R16F, gl.RED, gl.NEAREST);
  }

  _resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      return true;
    }
    return false;
  }

  /* --------------------- internals: interaction ------------------- */

  _bindEvents(target) {
    this._eventTarget = target;
    this._isUiEvent = (e) =>
      !!(this.opts.uiIgnoreSelector && e.target?.closest?.(this.opts.uiIgnoreSelector));
    this._onPointerMove = (e) => {
      if (!this.opts.interact) return;
      if (this._isUiEvent(e)) {
        // cursor is over the settings UI — drop its trail so re-entry doesn't jump-splat
        this._pointers.delete(e.pointerId ?? 0);
        return;
      }
      this._lastActivity = this._now(); // cursor moved → wake the sim (also moves the light)
      const pos = this._toCanvasUv(e);
      if (this.opts.lightFollowsCursor) this._cursorLight = { x: pos.x, y: pos.y };
      const prev = this._pointers.get(e.pointerId ?? 0);
      // keep only the previous coordinates — never the object itself, or each
      // move would chain an ever-growing prev->prev->... list the GC can't free
      this._pointers.set(e.pointerId ?? 0, {
        ...pos,
        down: prev?.down || false,
        moved: true,
        prev: prev ? { x: prev.x, y: prev.y } : null
      });
    };
    this._onPointerDown = (e) => {
      if (!this.opts.interact || this._isUiEvent(e)) return;
      this._lastActivity = this._now();
      const pos = this._toCanvasUv(e);
      this._pointers.set(e.pointerId ?? 0, { ...pos, down: true, moved: false, prev: null });
      const c = this._nextColor();
      this._splat(pos.x, pos.y, 0, 0, c, 4.0);
    };
    this._onPointerUp = (e) => {
      const p = this._pointers.get(e.pointerId ?? 0);
      if (p) p.down = false;
    };
    this._onResize = () => { if (this._resizeCanvas()) this._initFramebuffers(); };
    target.addEventListener("pointermove", this._onPointerMove, { passive: true });
    target.addEventListener("pointerdown", this._onPointerDown, { passive: true });
    target.addEventListener("pointerup", this._onPointerUp, { passive: true });
    this._resizeObserver = new ResizeObserver(this._onResize);
    this._resizeObserver.observe(this.canvas);
  }

  _unbindEvents() {
    const t = this._eventTarget;
    if (!t) return;
    t.removeEventListener("pointermove", this._onPointerMove);
    t.removeEventListener("pointerdown", this._onPointerDown);
    t.removeEventListener("pointerup", this._onPointerUp);
  }

  _now() {
    return (typeof performance !== "undefined" ? performance.now() : 0);
  }

  _toCanvasUv(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: 1 - (e.clientY - rect.top) / rect.height
    };
  }

  _nextColor() {
    const palette = this.opts.palette.length ? this.opts.palette : ["#2B3AE8"];
    const hex = palette[this._paletteIdx % palette.length];
    this._paletteIdx++;
    return jitterColor(hexToRgb(hex));
  }

  /* ----------------------- internals: sim loop -------------------- */

  _tick(now) {
    if (this._destroyed) return;
    this._raf = requestAnimationFrame(this._tick);
    if (this._lastTime == null) this._lastTime = now;
    let dt = (now - this._lastTime) / 1000;
    this._lastTime = now;
    if (dt <= 0) return;
    dt = Math.min(dt, 1 / 20);

    if (this.opts.paused) return;

    this._applyPointerSplats();
    this._ambient(dt);

    // Idle wind-down: once the cursor goes still (or leaves the page), let the
    // fluid keep flowing for a tail, then ease the simulation's time-scale from
    // 1 → 0 over idleFadeMs — a graceful slow-motion settle, never a dead stop.
    // After the fade completes, the solver AND renderer stop entirely; the rAF
    // loop keeps spinning (nearly free) only to notice when input resumes.
    if (this.opts.idleFreeze) {
      const since = this._now() - this._lastActivity;
      const tail = Math.max(this.opts.idleTailMs, this.opts.idleFadeMs);
      if (since >= tail) {
        if (!this._idleRendered) { this._render(); this._idleRendered = true; } // one clean settled frame
        return;
      }
      this._idleRendered = false;
      const fadeStart = tail - this.opts.idleFadeMs;
      if (since > fadeStart) {
        const k = 1 - (since - fadeStart) / this.opts.idleFadeMs; // 1 → 0 across the fade
        dt *= k * k * (3 - 2 * k); // smoothstep ease-out on the sim's time-scale
      }
    }

    this._step(dt);
    this._render();
  }

  _applyPointerSplats() {
    for (const p of this._pointers.values()) {
      if (!p.moved || !p.prev) continue;
      p.moved = false;
      const dx = (p.x - p.prev.x) * this.opts.splatForce;
      const dy = (p.y - p.prev.y) * this.opts.splatForce;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      const c = this._nextColor();
      // dragging while pressed paints harder, hovering paints gently
      const gain = p.down ? 1.0 : 0.55;
      this._splat(p.x, p.y, dx * gain, dy * gain, c, gain);
    }
  }

  _ambient(dt) {
    if (this.opts.ambient <= 0) return;
    this._ambientClock += dt;
    const interval = 4.2 - 3.6 * this.opts.ambient; // 0.6s..4.2s between gentle stirs
    if (this._ambientClock >= interval) {
      this._ambientClock = 0;
      this.randomSplats(1 + Math.round(Math.random() * 1.4), 0.45);
    }
  }

  _splat(x, y, dx, dy, color, sizeScale = 1) {
    this._lastActivity = this._now(); // any dye injection counts as activity → keeps the sim awake
    const { gl, programs } = this;
    const aspect = this.canvas.width / this.canvas.height;
    const radius = (this.opts.splatRadius / 100) * sizeScale;
    const k = this.opts.splatIntensity;

    programs.splat.bind();
    gl.uniform1f(programs.splat.uniforms.uAspectRatio, aspect);
    gl.uniform2f(programs.splat.uniforms.uPoint, x, y);
    gl.uniform1f(programs.splat.uniforms.uRadius, radius);

    gl.uniform1i(programs.splat.uniforms.uTarget, this.velocity.read.attach(0));
    gl.uniform3f(programs.splat.uniforms.uColor, dx, dy, 0);
    this._blit(this.velocity.write);
    this.velocity.swap();

    gl.uniform1i(programs.splat.uniforms.uTarget, this.dye.read.attach(0));
    gl.uniform3f(programs.splat.uniforms.uColor, color.r * k, color.g * k, color.b * k);
    this._blit(this.dye.write);
    this.dye.swap();
  }

  _step(dt) {
    const { gl, programs, velocity, dye } = this;
    gl.disable(gl.BLEND);

    // vorticity confinement — restores the small swirls numerical damping kills
    programs.curl.bind();
    gl.uniform2f(programs.curl.uniforms.uTexelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(programs.curl.uniforms.uVelocity, velocity.read.attach(0));
    this._blit(this.curlFbo);

    programs.vorticity.bind();
    gl.uniform2f(programs.vorticity.uniforms.uTexelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(programs.vorticity.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(programs.vorticity.uniforms.uCurl, this.curlFbo.attach(1));
    gl.uniform1f(programs.vorticity.uniforms.uCurlStrength, this.opts.curl);
    gl.uniform1f(programs.vorticity.uniforms.uDt, dt);
    this._blit(velocity.write);
    velocity.swap();

    // pressure projection — enforce incompressibility (∇·u = 0)
    programs.divergence.bind();
    gl.uniform2f(programs.divergence.uniforms.uTexelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(programs.divergence.uniforms.uVelocity, velocity.read.attach(0));
    this._blit(this.divergence);

    programs.clear.bind();
    gl.uniform1i(programs.clear.uniforms.uTexture, this.pressureFbo.read.attach(0));
    gl.uniform1f(programs.clear.uniforms.uValue, this.opts.pressure);
    this._blit(this.pressureFbo.write);
    this.pressureFbo.swap();

    programs.pressure.bind();
    gl.uniform2f(programs.pressure.uniforms.uTexelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(programs.pressure.uniforms.uDivergence, this.divergence.attach(0));
    for (let i = 0; i < this.opts.pressureIterations; i++) {
      gl.uniform1i(programs.pressure.uniforms.uPressure, this.pressureFbo.read.attach(1));
      this._blit(this.pressureFbo.write);
      this.pressureFbo.swap();
    }

    programs.gradientSubtract.bind();
    gl.uniform2f(programs.gradientSubtract.uniforms.uTexelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(programs.gradientSubtract.uniforms.uPressure, this.pressureFbo.read.attach(0));
    gl.uniform1i(programs.gradientSubtract.uniforms.uVelocity, velocity.read.attach(1));
    this._blit(velocity.write);
    velocity.swap();

    // semi-Lagrangian advection — velocity carries itself, then the dye
    programs.advection.bind();
    gl.uniform2f(programs.advection.uniforms.uTexelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(programs.advection.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(programs.advection.uniforms.uSource, velocity.read.attach(0));
    gl.uniform1f(programs.advection.uniforms.uDt, dt);
    gl.uniform1f(programs.advection.uniforms.uDissipation, this.opts.velocityDissipation);
    this._blit(velocity.write);
    velocity.swap();

    gl.uniform1i(programs.advection.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(programs.advection.uniforms.uSource, dye.read.attach(1));
    gl.uniform1f(programs.advection.uniforms.uDissipation, this.opts.densityDissipation);
    this._blit(dye.write);
    dye.swap();
  }

  _render() {
    const { gl, programs, opts } = this;
    const p = programs.display;
    const back = hexToRgb(opts.backColor);
    const lightC = hexToRgb(opts.lightColor);
    const light = opts.lightFollowsCursor ? { ...this._cursorLight, z: opts.lightPos.z } : opts.lightPos;
    const aspect = this.canvas.width / this.canvas.height;

    p.bind();
    gl.uniform2f(p.uniforms.uTexelSize, this.dye.texelSizeX, this.dye.texelSizeY);
    gl.uniform1i(p.uniforms.uDye, this.dye.read.attach(0));
    gl.uniform2f(p.uniforms.uAspect, aspect, 1);
    gl.uniform3f(p.uniforms.uBackColor, back.r, back.g, back.b);
    gl.uniform1f(p.uniforms.uGrain, opts.grain);
    gl.uniform1f(p.uniforms.uVignette, opts.vignette);
    gl.uniform1f(p.uniforms.uInk, opts.ink);
    gl.uniform1f(p.uniforms.uGlow, opts.glow);
    gl.uniform1f(p.uniforms.uDensityScale, opts.densityScale);
    gl.uniform1f(p.uniforms.uBump, opts.bump);
    gl.uniform1f(p.uniforms.uRefract, opts.refraction);
    gl.uniform1f(p.uniforms.uSpec, opts.specular);
    gl.uniform1f(p.uniforms.uShininess, opts.shininess);
    gl.uniform1f(p.uniforms.uFresnel, opts.fresnel);
    gl.uniform1f(p.uniforms.uCaustic, opts.caustics);
    gl.uniform3f(p.uniforms.uLightPos, light.x, light.y, light.z);
    gl.uniform3f(p.uniforms.uLightColor, lightC.r, lightC.g, lightC.b);
    gl.uniform1f(p.uniforms.uLightOn, opts.lightOn ? opts.lightIntensity : 0);
    for (let i = 0; i < 2; i++) {
      const w = opts.washes?.[i];
      const c = w ? hexToRgb(w.color) : { r: 0, g: 0, b: 0 };
      gl.uniform4f(p.uniforms[`uWash${i + 1}`], w?.x ?? 0, w?.y ?? 0, w?.radius ?? 1, w?.strength ?? 0);
      gl.uniform3f(p.uniforms[`uWash${i + 1}Color`], c.r, c.g, c.b);
    }
    this._blit(null);
  }
}
