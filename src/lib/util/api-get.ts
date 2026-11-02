/**
 * Read a JSON body from a public read endpoint, or throw a message that is safe
 * to show a user.
 *
 * The read routes are rate-limited and can answer `429` (and, on a store
 * outage, `5xx`) with a JSON body that is an error object, not the payload the
 * page expects. Parsing that body as the payload and dereferencing a missing
 * field is what turns a rate limit into a blank "client-side exception" page.
 * This checks `res.ok` first, so a refused request surfaces the route's own
 * message instead of crashing the render.
 */
export async function fetchJson<T>(input: string): Promise<T> {
  const res = await fetch(input);
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `Request failed (${res.status})`;
    throw new Error(
      res.status === 429 ? `${message}. Please wait a moment and reload.` : message,
    );
  }
  return body as T;
}
