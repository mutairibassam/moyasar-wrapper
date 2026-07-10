import type { NextConfig } from "next";

// The browser only ever calls relative /api/* (same-origin). Next rewrites forward
// those to the Bun API so the httpOnly session + CSRF cookies work without CORS.
const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:8080";

const config: NextConfig = {
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_ORIGIN}/api/:path*` }];
  },
};
export default config;
