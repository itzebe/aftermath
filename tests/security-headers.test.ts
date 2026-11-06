import { describe, expect, it } from "vitest";
import nextConfig, { contentSecurityPolicy } from "../next.config";

/**
 * Regression guard for the security response headers.
 *
 * Production previously shipped only `Strict-Transport-Security`: no
 * `X-Frame-Options` / `frame-ancestors`, no CSP, no `X-Content-Type-Options`,
 * no `Referrer-Policy`, and no `Permissions-Policy`, and it advertised
 * `X-Powered-By: Next.js`. These tests pin the hardened configuration so a
 * future edit to `next.config.ts` cannot silently drop a header again.
 */
describe("next.config security headers", () => {
  async function headersFor(source = "/:path*"): Promise<Map<string, string>> {
    const rules = (await nextConfig.headers?.()) ?? [];
    const rule = rules.find((r) => r.source === source);
    expect(rule, `no header rule for ${source}`).toBeTruthy();
    return new Map(rule!.headers.map((h) => [h.key.toLowerCase(), h.value]));
  }

  it("applies to every path", async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    expect(rules.map((r) => r.source)).toContain("/:path*");
  });

  it("denies framing and MIME sniffing", async () => {
    const h = await headersFor();
    expect(h.get("x-frame-options")).toBe("DENY");
    expect(h.get("x-content-type-options")).toBe("nosniff");
  });

  it("ships a CSP that forbids framing and external resource loads", async () => {
    const h = await headersFor();
    const csp = h.get("content-security-policy");
    expect(csp).toBeTruthy();
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
  });

  it("sets Referrer-Policy and a restrictive Permissions-Policy", async () => {
    const h = await headersFor();
    expect(h.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    const pp = h.get("permissions-policy");
    expect(pp).toBeTruthy();
    expect(pp).toContain("camera=()");
    expect(pp).toContain("microphone=()");
  });

  it("suppresses the X-Powered-By fingerprint", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it("never allows 'unsafe-eval' in the production script-src", () => {
    // `next dev` needs `eval` for hot reload; production must not carry it.
    expect(contentSecurityPolicy(false)).not.toContain("'unsafe-eval'");
    expect(contentSecurityPolicy(true)).toContain("'unsafe-eval'");
  });
});
