/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        cream: { 50: "#FFFCF7", 100: "#FFF8EE", 200: "#F6EBD9", 300: "#EAD9BE" },
        ink: { DEFAULT: "#1E2B2F", muted: "#4F6164" },
        primary: { DEFAULT: "#0E5A5F", dark: "#0A4246", light: "#D7ECEA" },
        coral: { DEFAULT: "#F0705F", dark: "#A8372A", light: "#FDE3DE" },
        sun: { DEFAULT: "#F4B740", dark: "#7A4F00", light: "#FDF0CF" },
      },
      fontFamily: {
        sans: [
          "ui-rounded",
          "\"SF Pro Rounded\"",
          "\"Segoe UI\"",
          "system-ui",
          "-apple-system",
          "Roboto",
          "\"Helvetica Neue\"",
          "Arial",
          "sans-serif",
        ],
      },
      borderRadius: { "4xl": "2rem" },
      boxShadow: { card: "0 2px 0 0 rgba(30,43,47,0.08), 0 8px 24px -12px rgba(30,43,47,0.25)" },
    },
  },
  plugins: [],
};
