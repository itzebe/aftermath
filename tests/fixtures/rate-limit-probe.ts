/**
 * Test fixture: a tiny CLI over the real shared rate limiter.
 *
 * The cross-instance rate-limit test spawns this file in two or more separate
 * Node processes, each with its own module state (its own in-process fallback
 * limiter and its own runtime), connected to the *same* PostgreSQL database.
 * It proves that a counter charged by one process is observed by another, i.e.
 * that the cap holds across serverless instances rather than per process.
 *
 * Usage: tsx tests/fixtures/rate-limit-probe.ts <check|hits> <bucket> <clientKey> [count]
 *
 * `check` performs one hit and prints the verdict. `hits` performs `count` hits
 * and prints the final verdict plus how many were allowed.
 */
import { loadConfig } from "../../src/lib/config";
import {
  DbRateLimitStore,
  SharedRateLimiter,
  rateLimitKey,
  type RateLimitBucket,
} from "../../src/lib/api/rate-limit";
import { FixedWindowRateLimiter } from "../../src/lib/api/verify-guard";
import { resolveAuditStore } from "../../src/lib/db/store-factory";
import { runtime } from "../../src/lib/runtime";

const BUCKET_POLICY: Record<RateLimitBucket, "read" | "heavy" | "status"> = {
  "public-read": "read",
  "public-read-heavy": "heavy",
  "public-read-status": "status",
};

async function main(): Promise<void> {
  const [cmd, bucketArg, clientKey, countArg] = process.argv.slice(2);
  const bucket = bucketArg as RateLimitBucket;
  const count = countArg ? Number(countArg) : 1;
  const config = loadConfig();

  // Build the limiter over the durable store exactly as the route does, so this
  // exercises the production path rather than a reimplementation.
  const policy = config.publicReadLimit[BUCKET_POLICY[bucket]];
  const limiter = new SharedRateLimiter({
    policy,
    store: new DbRateLimitStore(runtime().durable.db),
    fallback: new FixedWindowRateLimiter(policy),
    globalMaxRequests: config.publicReadGlobalLimit[BUCKET_POLICY[bucket]],
    globalScope: bucket,
    retentionMs: config.rateLimitRetentionMs,
  });

  const key = rateLimitKey(bucket, clientKey, config.rateLimitSalt ?? "");
  const rounds = cmd === "hits" ? count : 1;
  let allowed = 0;
  let last: Awaited<ReturnType<typeof limiter.check>> | null = null;
  for (let i = 0; i < rounds; i++) {
    last = await limiter.check(key);
    if (last.allowed) allowed += 1;
  }

  const audit = resolveAuditStore(config);
  try {
    process.stdout.write(
      JSON.stringify({
        ok: true,
        allowed,
        rounds,
        lastAllowed: last?.allowed,
        degraded: last?.degraded,
        globalLimited: last?.globalLimited ?? false,
        backend: audit.backend,
        durable: audit.durable,
      }),
    );
  } finally {
    await audit.close();
  }
}

main().catch((err) => {
  process.stderr.write(String(err) + "\n");
  process.exit(1);
});
