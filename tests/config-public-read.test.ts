import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { loadConfig } from "@/lib/config";

/**
 * Configuration completeness for the public read cap.
 *
 * The per-client cap is keyed on a forwarding header and can be spoofed; the
 * global cap is the non-rotatable backstop. It must always be present and
 * strictly above the per-client cap, or a spoofing burst could slip through.
 */

const KEYS = [
  "AFTERMATH_RL_PUBLIC_READ_MAX",
  "AFTERMATH_RL_PUBLIC_HEAVY_MAX",
  "AFTERMATH_RL_PUBLIC_STATUS_MAX",
  "AFTERMATH_RL_PUBLIC_READ_GLOBAL_MAX",
  "AFTERMATH_RL_PUBLIC_HEAVY_GLOBAL_MAX",
  "AFTERMATH_RL_PUBLIC_STATUS_GLOBAL_MAX",
  "AFTERMATH_RATE_LIMIT_SALT",
];

beforeEach(() => {
  for (const k of KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of KEYS) delete process.env[k];
});

describe("publicReadGlobalLimit", () => {
  it("is present for every bucket and strictly above the per-client cap", () => {
    const config = loadConfig();
    for (const bucket of ["read", "heavy", "status"] as const) {
      expect(config.publicReadGlobalLimit[bucket]).toBeGreaterThan(0);
      expect(config.publicReadGlobalLimit[bucket]).toBeGreaterThan(
        config.publicReadLimit[bucket].maxRequests,
      );
    }
  });

  it("is configurable by environment", () => {
    process.env.AFTERMATH_RL_PUBLIC_READ_GLOBAL_MAX = "77";
    expect(loadConfig().publicReadGlobalLimit.read).toBe(77);
  });
});

describe("rateLimitSalt", () => {
  it("defaults to a public constant when unset", () => {
    expect(loadConfig().rateLimitSalt).toBe("aftermath-public-read");
  });

  it("honours a deployment-specific override", () => {
    process.env.AFTERMATH_RATE_LIMIT_SALT = "private-per-deployment";
    expect(loadConfig().rateLimitSalt).toBe("private-per-deployment");
  });
});
