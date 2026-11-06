import type { NextConfig } from "next";

/**
 * Security response headers applied to every route.
 *
 * The app renders no iframes and loads no third-party scripts, fonts, or
 * images (next/font self-hosts the Google fonts at build time), so the strict
 * form of each header is safe: framing is denied, the content type cannot be
 * sniffed, and a CSP that only allows same-origin resources plus Next.js's own
 * inline bootstrap/hydration markup is enforceable.
 *
 * `script-src` keeps `'unsafe-inline'` because Next.js emits inline bootstrap
 * scripts; a nonce-based policy would need middleware and is out of scope here.
 * `'unsafe-eval'` is added only in development, where the dev runtime's hot
 * reload evaluates code with `eval` — production never carries it.
 */
const isDev = process.env.NODE_ENV !== "production";

/** Build the Content-Security-Policy. Exported so both branches are testable. */
export function contentSecurityPolicy(dev: boolean): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    dev
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
      : "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
  ].join("; ");
}

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy(isDev) },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["@mysten-incubation/memwal"],
  eslint: { ignoreDuringBuilds: true },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
