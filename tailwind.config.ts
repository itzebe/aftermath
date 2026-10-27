import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#07090c",
          900: "#0b0e13",
          850: "#10141b",
          800: "#151a23",
          700: "#1e2530",
          600: "#2b3442",
          500: "#3d4859",
        },
        paper: {
          100: "#eef1f6",
          300: "#c3ccda",
          500: "#8d99ac",
        },
        signal: {
          ok: "#3fb950",
          warn: "#d29922",
          bad: "#f0503a",
          info: "#4a9eff",
          unknown: "#a371f7",
        },
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
