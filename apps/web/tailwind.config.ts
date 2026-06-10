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
        charcoal: {
          DEFAULT: "#f8f7fc", // page field, input fills, image scrims
          800: "#ffffff",     // cards, panels, sidebar
          700: "#edebf5",     // hairline borders, soft fills
          600: "#dfdcec",     // strong borders, dashed outlines
        },
        lime: {
          DEFAULT: "#7c3aed", // single violet accent (violet-600)
          dim: "#5b21b6",     // higher-contrast accent for micro labels
        },
        ink: {
          DEFAULT: "#17141f",
          muted: "#5d5869",
          faint: "#757085",
        },
        // Status text steps are re-tuned for readability on light tinted
        // chips (the /10 tint + /40 border steps keep their stock values).
        amber: { 300: "#b45309" },
        sky: { 300: "#0369a1" },
        red: { 400: "#dc2626" },
        rose: { 300: "#be123c" },
        emerald: { 300: "#047857" },
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        heading: ["var(--font-heading)", "var(--font-display)", "system-ui", "sans-serif"],
        serif: ["var(--font-serif)", "Georgia", "serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(23, 20, 31, 0.04), 0 8px 24px -12px rgba(23, 20, 31, 0.10)",
        pop: "0 4px 12px rgba(23, 20, 31, 0.06), 0 24px 64px -24px rgba(23, 20, 31, 0.18)",
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
