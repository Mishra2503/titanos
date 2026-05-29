import type { Config } from "tailwindcss";

// Studio Terminal design language (PRD §6, §13).
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        charcoal: {
          DEFAULT: "#0d0d0f",
          800: "#141417",
          700: "#1b1b1f",
          600: "#26262b",
        },
        lime: {
          DEFAULT: "#cdff4d", // single acid-lime signal
          dim: "#a6cf3e",
        },
        ink: {
          DEFAULT: "#ededf0",
          muted: "#9a9aa3",
          faint: "#6b6b73",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      transitionTimingFunction: {
        "studio-out": "cubic-bezier(0.23, 1, 0.32, 1)",
      },
      transitionDuration: {
        "studio": "200ms",
      },
      keyframes: {
        // Never animate from scale(0); start at 0.95 + opacity (Emil Kowalski rules).
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
