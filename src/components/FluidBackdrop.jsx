/**
 * FluidBackdrop — the landing page's fluid-dynamics background.
 *
 * Renders two absolutely-positioned layers inside .landing-screen (so the
 * landing's flex layout, copy and buttons are untouched):
 *   1. a canvas layer at z-index 0, behind every landing child
 *   2. a settings host (gear button + panel) floating above
 *
 * The whole background can be switched off from the panel ("Background"
 * toggle) — that destroys the WebGL engine entirely, leaving the original
 * CSS landing exactly as it was.
 *
 * Theming: by default the fluid follows the app's data-theme ("auto"); once
 * the user picks Paper/Charcoal in the panel that choice wins. The chosen
 * fluid theme is applied to the .landing-screen subtree only (data-theme on
 * the element), so a charcoal backdrop also inverts the landing copy for
 * contrast — without touching the app's theme or any other page.
 */
import { useEffect, useRef } from "react";
import FluidBackground from "../background/FluidBackground.js";
import { applyTheme, createFluidSettings, engineOptions, loadState } from "../background/fluid-settings.js";
import "../background/fluid-settings.css";

export default function FluidBackdrop() {
  const layerRef = useRef(null);
  const uiRef = useRef(null);

  useEffect(() => {
    const layer = layerRef.current;
    const uiHost = uiRef.current;
    if (!layer || !uiHost) return undefined;
    const screen = layer.closest(".landing-screen");

    const state = loadState();
    let fluid = null;
    let ui = null;

    const appTheme = () =>
      document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";

    const mountFluid = () => {
      if (fluid || !state.enabled) return;
      try {
        fluid = FluidBackground.mount(layer, engineOptions(state));
        window.__fluid = fluid;
      } catch (err) {
        // No WebGL2 / float buffers — quietly keep the plain CSS landing.
        console.warn("FluidBackdrop: background disabled —", err.message);
        fluid = null;
        state.enabled = false;
      }
    };
    const unmountFluid = () => {
      if (!fluid) return;
      if (window.__fluid === fluid) delete window.__fluid;
      fluid.destroy();
      fluid = null;
    };

    /** Reflect the fluid theme onto the landing subtree (and only there). */
    const syncScreenTheme = () => {
      if (!screen) return;
      if (state.enabled) screen.setAttribute("data-theme", state.theme);
      else screen.removeAttribute("data-theme");
    };

    const applyState = () => {
      // in auto mode the fluid tracks whatever theme the app is in
      if (state.themeSource === "auto" && state.theme !== appTheme()) {
        applyTheme(state, appTheme());
        fluid?.setOptions(engineOptions(state));
      }
      if (state.enabled && !fluid) mountFluid();
      else if (!state.enabled && fluid) unmountFluid();
      syncScreenTheme();
    };

    if (state.themeSource === "auto") applyTheme(state, appTheme());
    mountFluid();
    syncScreenTheme();

    ui = createFluidSettings({
      host: uiHost,
      state,
      getFluid: () => fluid,
      extraToggles: [
        {
          id: "enabledToggle",
          label: "Background",
          get: () => state.enabled,
          set: (v) => { state.enabled = v; }
        }
      ],
      onRebuild: applyState
    });

    // keep auto mode in sync when the app's light/dark mode flips
    const observer = new MutationObserver(() => {
      if (state.themeSource !== "auto") return;
      if (appTheme() === state.theme) return;
      applyTheme(state, appTheme());
      ui.rebuild();
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    return () => {
      observer.disconnect();
      ui.destroy();
      unmountFluid();
      screen?.removeAttribute("data-theme");
    };
  }, []);

  return (
    <>
      <div ref={layerRef} className="landing-fluid-layer" aria-hidden="true" />
      <div ref={uiRef} className="fluid-ui landing-fluid-ui" />
    </>
  );
}
