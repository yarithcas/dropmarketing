import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";

export default {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "rgb(var(--bg) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        "surface-2": "rgb(var(--surface-2) / <alpha-value>)",
        "surface-3": "rgb(var(--surface-3) / <alpha-value>)",
        border: "rgb(var(--border) / <alpha-value>)",
        fg: "rgb(var(--fg) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        subtle: "rgb(var(--subtle) / <alpha-value>)",
        accent: "rgb(var(--accent) / <alpha-value>)",
        "accent-2": "rgb(var(--accent-2) / <alpha-value>)",
        good: "rgb(var(--good) / <alpha-value>)",
        warn: "rgb(var(--warn) / <alpha-value>)",
        serious: "rgb(var(--serious) / <alpha-value>)",
        critical: "rgb(var(--critical) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
      borderRadius: { xl: "14px", lg: "10px", md: "8px", sm: "6px" },
      keyframes: {
        shimmer: { "100%": { transform: "translateX(100%)" } },
        "fade-in": { from: { opacity: "0", transform: "translateY(4px)" }, to: { opacity: "1", transform: "none" } },
        "nav-progress": { "0%": { transform: "translateX(-100%)" }, "100%": { transform: "translateX(300%)" } },
        "toast-in": { from: { opacity: "0", transform: "translateY(8px) scale(.98)" }, to: { opacity: "1", transform: "none" } },
      },
      animation: {
        "fade-in": "fade-in .25s ease-out both",
        "nav-progress": "nav-progress 1.1s ease-in-out infinite",
        "toast-in": "toast-in .2s cubic-bezier(.2,.8,.2,1) both",
      },
    },
  },
  plugins: [
    // Interaction variants that never fire on disabled controls (also covers <a> styled as buttons via aria-disabled).
    plugin(({ addVariant }) => {
      addVariant("hov", '&:hover:not(:disabled):not([aria-disabled="true"]):not([aria-busy="true"])');
      addVariant("press", '&:active:not(:disabled):not([aria-disabled="true"]):not([aria-busy="true"])');
      addVariant("coarse", "@media (pointer: coarse)");
    }),
  ],
} satisfies Config;
