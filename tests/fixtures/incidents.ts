/**
 * A synthetic incident used by the investigation regression tests.
 *
 * It is deliberately synthetic: it contains no real credentials, hosts, or
 * customer data. It is modelled on a real, common failure — a database
 * connection pool exhausted under load — and it carries the three things a
 * reader needs to judge the engine's behaviour:
 *
 *   1. ordinary upper-case field labels ("ENVIRONMENT", "EXPECTED", "ERROR")
 *      that must NOT be mistaken for error codes;
 *   2. a concrete mechanism (pool exhaustion) with measurements, which the
 *      investigation must reason from rather than treating as an unknown
 *      operation outcome;
 *   3. no success claim and no authoritative record, so the outcome stays
 *      unestablished.
 */
export const POOL_EXHAUSTION_INCIDENT = `2026-03-01T10:00:00Z payment-api POST /v1/charge
HTTP 500 Internal Server Error
ENVIRONMENT: production
EXPECTED: charge completes within 1000ms
ACTUAL: request failed
SEVERITY: critical
ERROR: Connection pool exhausted
Active connections: 50
idle connections: 0
max pool size: 50
Database pool utilization reached 100%
Database connection acquisition timed out after 5000ms
Request duration exceeded threshold: 10042ms
Health check failed: database connection unavailable`;

/** A small incident whose only fault is a genuine, code-shaped error code. */
export const REAL_ERROR_CODE_INCIDENT =
  "2026-03-01T10:00:00Z checkout-service POST /v1/charge " +
  "returned 503 Service Unavailable (error_code: E5031)";

/**
 * Payment regression scenario 1 — connection-pool exhaustion.
 *
 * Carries, in one report: HTTP 500 responses, connection-acquisition timeouts,
 * saturation metrics, elevated latency, retries, and a failed readiness check.
 * The engine must extract the measurements, describe saturation as observed,
 * keep a connection *leak* as an unproven hypothesis, and leave the specific
 * request's outcome unknown.
 */
export const POOL_EXHAUSTION_TIMELINE = `2026-03-01T10:00:00Z payment-api POST /v1/charge
HTTP 500 Internal Server Error
ENVIRONMENT: production
EXPECTED: charge completes within 1000ms
ACTUAL: request failed
SEVERITY: critical
ERROR: Connection pool exhausted
Active connections: 50
idle connections: 0
max pool size: 50
Database pool utilization reached 100%
Database connection acquisition timed out after 5000ms
Request duration exceeded threshold: 10042ms
Retrying request (attempt 2/3) after 500ms
Retrying request (attempt 3/3) after 1000ms
Health check failed: database connection unavailable`;

/**
 * Payment regression scenario 2 — a longer timeline.
 *
 * Adds, on top of saturation: long-held connections, a service restart, a
 * recovery, and an unrelated successful request. The engine must (a) keep the
 * connection *leak* a hypothesis, not a finding, (b) not treat the unrelated
 * 200 as evidence about the failed charge, and (c) preserve the unknown outcome
 * of the request that timed out.
 */
export const POOL_EXHAUSTION_LONG_TIMELINE = `2026-03-01T10:00:00Z payment-api POST /v1/charge
HTTP 500 Internal Server Error
ENVIRONMENT: production
ERROR: Connection pool exhausted
Active connections: 50
idle connections: 0
max pool size: 50
Database pool utilization reached 100%
Database connection acquisition timed out after 5000ms
Long-held connection detected: connection held for 65000ms
Request duration exceeded threshold: 10042ms
Retrying request (attempt 2/3) after 500ms
Health check failed: database connection unavailable
2026-03-01T10:02:00Z payment-api service restart initiated
2026-03-01T10:03:00Z payment-api readiness check passed
2026-03-01T10:03:05Z payment-api GET /v1/health returned 200 OK
2026-03-01T10:04:00Z payment-api GET /v1/charges/ch_123 returned 200 OK`;
