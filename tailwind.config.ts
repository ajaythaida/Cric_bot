import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        pitch: {
          50: "#f2fbf3",
          100: "#dff7e3",
          500: "#16a34a",
          700: "#15803d",
          900: "#14532d"
        }
      },
      boxShadow: {
        soft: "0 18px 50px rgba(20, 83, 45, 0.14)"
      }
    }
  },
  plugins: []
};

export default config;
