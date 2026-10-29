import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#06080b",
          900: "#0c1016",
          850: "#11161e",
          800: "#161c26",
          700: "#1a2029",
          600: "#252d39",
          500: "#333d4c",
        },
        paper: {
          100: "#eceff5",
          300: "#b6c0cf",
          500: "#7e8a9c",
          600: "#707c8d",
        },
        signal: {
          ok: "#3fbf6f",
          warn: "#d7a63f",
          bad: "#f0564a",
          info: "#5b9dff",
          unknown: "#a98bf5",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      maxWidth: {
        content: "78rem",
        prose: "40rem",
      },
    },
  },
  plugins: [],
};

export default config;
