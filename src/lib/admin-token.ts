"use client";

/**
 * Client-side holder for the administrator token.
 *
 * The write and destructive endpoints now require `AFTERMATH_ADMIN_TOKEN`. The
 * operator enters that same value once in the app frame; it is kept in
 * `sessionStorage` (cleared when the tab closes) and attached as a bearer token
 * to the gated calls this app makes on the operator's behalf. It is never sent
 * anywhere except to this application's own API, and never rendered back.
 *
 * A session-only, in-browser copy is the right trade-off for a single-operator
 * tool: it is not persisted to disk, not shared between tabs, and not embedded
 * in a server-rendered page.
 */

const KEY = "aftermath.adminToken";

const EVENT = "aftermath:admin-token";

export function getAdminToken(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.sessionStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function setAdminToken(token: string): void {
  if (typeof window === "undefined") return;
  try {
    if (token) window.sessionStorage.setItem(KEY, token);
    else window.sessionStorage.removeItem(KEY);
  } catch {
    // Storage can be unavailable (private mode); the token simply stays unset.
  }
  window.dispatchEvent(new Event(EVENT));
}

export function clearAdminToken(): void {
  setAdminToken("");
}

export function hasAdminToken(): boolean {
  return getAdminToken().length > 0;
}

/** Subscribe to token changes, so the header and forms re-render in step. */
export function onAdminTokenChange(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT, listener);
  // `storage` fires for changes made in another tab; keep those in sync too.
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

/**
 * Headers for a gated request: the caller's own `content-type` plus the admin
 * bearer token when one is set. Returns a plain object suitable for spreading
 * into `fetch` options.
 */
export function adminHeaders(
  extra: Record<string, string> = {},
): Record<string, string> {
  const token = getAdminToken();
  return token ? { ...extra, authorization: `Bearer ${token}` } : { ...extra };
}
