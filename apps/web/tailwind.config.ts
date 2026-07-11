import type { Config } from "tailwindcss";

// Tailwind v4 is configured primarily via CSS (@import "tailwindcss" in globals.css).
// This file only declares content sources for class scanning.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
};
export default config;
