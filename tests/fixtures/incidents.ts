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
