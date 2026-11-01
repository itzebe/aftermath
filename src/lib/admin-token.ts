"use client";

/**
 * In-memory holder for the administrator token, used only by the admin console.
 *
 * The value lives in a module-level variable for the lifetime of the page. It is
 * never written to `localStorage`, `sessionStorage`, cookies, or any other
 * browser-readable persistent storage, so a reload or a navigation away from the
 * console discards it and the operator re-authenticates. That is the narrowest
 * lifetime that still lets the console make its gated calls.
 *
 * The token is attached only to this application's own API requests (see
 * `adminHeaders`) and is never rendered back into the page.
 */

let token: string | null = null;

const EVENT = "aftermath:admin-token";

export function getAdminToken(): string {
  return token ?? "";
}

export function setAdminToken(next: string): void {
  token = next || null;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(EVENT));
  }
}

export function clearAdminToken(): void {
  setAdminToken("");
}

export function hasAdminToken(): boolean {
  return token !== null && token.length > 0;
}

/** Subscribe to token changes, so the console re-renders in step. */
export function onAdminTokenChange(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}

/**
 * Headers for a gated request: the caller's own `content-type` plus the admin
 * bearer token when one is set. Returns a plain object suitable for spreading
 * into `fetch` options.
 */
export function adminHeaders(
  extra: Record<string, string> = {},
): Record<string, string> {
  const current = getAdminToken();
  return current ? { ...extra, authorization: `Bearer ${current}` } : { ...extra };
}
