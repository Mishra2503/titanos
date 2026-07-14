import type { Config } from "tailwindcss";

// Aifluencee Content Hub — light theme design system (June 2026 redesign).
// Token names are historical; values define the light theme:
//   charcoal*  = light field/surface/border ramp (inverted from original dark)
//   lime       = brand blue-violet accent (#5047EB)
//   ink*       = text ramp (dark on light)
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Light theme — soft lavender page, white cards, blue-violet accent.
        charcoal: {
          DEFAULT: "#F5F6FF", // page background (soft lavender-white)
          800: "#FFFFFF",     // cards, panels, sidebar (pure white)
          700: "#E8E8FF",     // hairline borders
          600: "#CACBFF",     // strong borders, focused states
        },
        lime: {
          DEFAULT: "#5047EB", // brand blue-violet (primary accent)
          dim: "#7168F0",     // lighter variant for hover/labels
        },
        ink: {
          DEFAULT: "#15151A", // near-black text
          muted: "#475569",   // secondary text (darkened for readability)
          faint: "#5B647A",   // micro labels, placeholders (darkened for readability)
        },
        // Status colors — tuned for light backgrounds.
        amber: { 300: "#F59E0B" },
        sky:   { 300: "#38BDF8" },
        red:   { 400: "#EF4444" },
        rose:  { 300: "#FB7185" },
        emerald: { 300: "#34D399" },
      },
      fontFamily: {
        display: ["var(--font-sans)", "system-ui", "sans-serif"],
        heading: ["var(--font-heading)", "system-ui", "sans-serif"],
        serif:   ["var(--font-serif)", "Georgia", "serif"],
        mono:    ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      // Nudge the smallest tiers up one notch so labels/body read cleanly site-wide.
      fontSize: {
        xs: ["0.8125rem", { lineHeight: "1.15rem" }],   // 13px (was 12px)
        sm: ["0.9375rem", { lineHeight: "1.4rem" }],    // 15px (was 14px)
      },
      boxShadow: {
        card: "0 1px 3px rgba(0,0,0,0.06), 0 4px 16px rgba(80,71,235,0.07)",
        pop:  "0 0 0 1px rgba(80,71,235,0.15), 0 8px 32px rgba(80,71,235,0.18)",
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
