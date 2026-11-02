/**
 * A small TTL cache with single-flight loading.
 *
 * Several public read endpoints rebuild expensive state: the learning-loop view
 * model loads up to 500 records and rebuilds every derived view, and the memory
 * and overview endpoints make live calls to Walrus and Tatum. Without a cache,
 * a refresh loop turns into one set of upstream calls per request.
 *
 * Two properties matter for correctness:
 *
 *   - **Only successes are cached.** If the loader throws (an upstream is
 *     unreachable), nothing is stored, so a dependency going down is never
 *     masked by a stale success and the next request retries immediately. A
 *     loader that *returns* a degraded status is cached, because that status is
 *     itself the honest, current answer.
 *   - **Single-flight.** Concurrent misses for the same key share one in-flight
 *     promise, so a burst of requests triggers one upstream call, not N. This is
 *     process-local (like all in-memory caches on serverless); the staleness
 *     bound it provides is stated explicitly by each caller's TTL.
 */

interface Entry<T> {
  at: number;
  value: T;
}

export interface CacheRead<T> {
  value: T;
  /** Age of the returned value in milliseconds (0 on a fresh load). */
  ageMs: number;
  /** True when the value was served from the cache rather than loaded now. */
  cached: boolean;
}

export class TtlCache {
  private readonly entries = new Map<string, Entry<unknown>>();
  private readonly inflight = new Map<string, Promise<unknown>>();

  /**
   * Return the cached value for `key` when it is younger than `ttlMs`;
   * otherwise load it, store it on success, and return it. Concurrent callers
   * for the same key await the same in-flight load.
   */
  async getOrLoad<T>(
    key: string,
    ttlMs: number,
    loader: () => Promise<T>,
    now: number = Date.now(),
  ): Promise<CacheRead<T>> {
    const existing = this.entries.get(key) as Entry<T> | undefined;
    if (existing && now - existing.at < ttlMs) {
      return { value: existing.value, ageMs: now - existing.at, cached: true };
    }

    const pending = this.inflight.get(key) as Promise<T> | undefined;
    if (pending) {
      // A load is already running for this key; share its result rather than
      // issuing a duplicate upstream call.
      const value = await pending;
      return { value, ageMs: 0, cached: true };
    }

    const load = loader();
    this.inflight.set(key, load);
    try {
      const value = await load;
      // Stamp with the caller-supplied clock, not the wall clock, so a caller
      // that injects a clock gets a deterministic age.
      this.entries.set(key, { at: now, value });
      return { value, ageMs: 0, cached: false };
    } finally {
      this.inflight.delete(key);
    }
  }

  /** Drop every cached entry. Used by tests and after a state reset. */
  clear(): void {
    this.entries.clear();
  }
}
