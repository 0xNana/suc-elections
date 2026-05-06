import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        cream: "#f6efdf",
        navy: "#122338",
        "navy-soft": "#203852",
        gold: "#ba9446",
        ink: "#20263a",
        stone: "#6f7380"
      },
      boxShadow: {
        panel: "0 24px 60px rgba(18, 35, 56, 0.12)"
      }
    }
  },
  plugins: []
};

export default config;
