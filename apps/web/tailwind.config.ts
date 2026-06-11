import type { Config } from "tailwindcss";

// Titan OS design language — light violet system (see DESIGN.md).
// Token names are historical (charcoal/lime/ink) so every screen retains one
// consistent vocabulary; the VALUES define the light theme:
//   charcoal*  = light field/surface/border ramp
//   lime       = the single violet accent
//   ink*       = text ramp (dark on light)
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Premium dark scheme: purple, black, white — nothing else.
        charcoal: {
          DEFAULT: "#0b0712", // page field, input fills, image scrims
          800: "#130d1f",     // cards, panels, sidebar
          700: "#241c38",     // hairline borders, soft fills
          600: "#332853",     // strong borders, dashed outlines
        },
        lime: {
          DEFAULT: "#a78bfa", // accent text/borders on dark (violet-400)
          dim: "#c4b5fd",     // micro labels needing extra pop on dark
        },
        ink: {
          DEFAULT: "#f7f5fc", // near-white text
          muted: "#beb4d6",
          faint: "#8f85aa",
        },
        // Status text steps tuned for dark tinted chips.
        amber: { 300: "#fcd34d" },
        sky: { 300: "#7dd3fc" },
        red: { 400: "#f87171" },
        rose: { 300: "#fda4af" },
        emerald: { 300: "#6ee7b9" },
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        heading: ["var(--font-display)", "system-ui", "sans-serif"],
        serif: ["var(--font-serif)", "Georgia", "serif"],
        // `font-mono` is intentionally mapped to the main sans: the app's
        // micro-labels used monospace and read as "robot tech" — one family
        // (Archivo) now carries every label, stat, and timestamp.
        mono: ["var(--font-display)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "inset 0 1px 0 rgba(255, 255, 255, 0.04), 0 8px 24px -12px rgba(0, 0, 0, 0.6)",
        pop: "0 0 0 1px rgba(139, 92, 246, 0.18), 0 24px 64px -16px rgba(0, 0, 0, 0.8)",
      },
      transitionTimingFunction: {
        "studio-out": "cubic-bezier(0.23, 1, 0.32, 1)",
      },
      transitionDuration: {
        "studio": "200ms",
      },
      keyframes: {
        // Never animate from scale(0); start at 0.98 + opacity (Emil Kowalski rules).
        "reveal": {
          from: { opacity: "0", transform: "translateY(6px) scale(0.98)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
      },
      animation: {
        reveal: "reveal 240ms cubic-bezier(0.23, 1, 0.32, 1) both",
      },
    },
  },
  plugins: [],
};

export default config;
