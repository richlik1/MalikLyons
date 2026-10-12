import type { Config } from "tailwindcss";

// Design tokens: see docs/05-design-system.md
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: "#111111", soft: "#3a3a3a", muted: "#6b6b6b" },
        paper: { DEFAULT: "#fafaf7", raised: "#ffffff", sunken: "#f0efe9" },
        line: "#e3e1d9",
        accent: { DEFAULT: "#d4ff3a", ink: "#1a2000" },
        danger: "#b42318",
        ok: "#067647",
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        display: ["ui-sans-serif", "system-ui", "sans-serif"],
      },
      borderRadius: { card: "14px" },
    },
  },
  plugins: [],
};

export default config;
