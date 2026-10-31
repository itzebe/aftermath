import { NextResponse } from "next/server";

/**
 * Request-body size enforcement.
 *
 * `Content-Length` is a hint, not a guarantee: a client may omit it (chunked
 * transfer), understate it, or lie outright. So the header is used only to
 * reject an obviously oversized request *before* reading anything, and the
 * actual read is then streamed through a byte counter that aborts as soon as
 * the limit is crossed. Neither path buffers an unbounded body.
 *
 * A rejected request is answered with `413`, which is distinct from the `400` a
 * malformed body gets — the caller can tell "too big" from "not JSON".
 */

export type BodyReadResult =
  | { ok: true; text: string }
  | { ok: false; response: NextResponse };

function tooLarge(limitBytes: number): NextResponse {
  return NextResponse.json(
    {
      error: "payload_too_large",
      detail: `The request body exceeds the ${limitBytes}-byte limit.`,
      limitBytes,
    },
    { status: 413 },
  );
}

/**
 * Read a request body as text, refusing to buffer more than `limitBytes`.
 *
 * Returns the decoded text on success. On an oversized body it returns the
 * `413` response to send; the stream is cancelled so the rest of the upload is
 * not read.
 */
export async function readBodyWithinLimit(
  request: Request,
  limitBytes: number,
): Promise<BodyReadResult> {
  // Fast path: a declared length over the limit is rejected without reading.
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const parsed = Number(declared);
    // A non-numeric or negative length is not trustworthy; fall through to the
    // streaming check rather than treating it as zero or as a rejection.
    if (Number.isFinite(parsed) && parsed >= 0 && parsed > limitBytes) {
      return { ok: false, response: tooLarge(limitBytes) };
    }
  }

  const body = request.body;
  if (!body) return { ok: true, text: "" };

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > limitBytes) {
        await reader.cancel().catch(() => {});
        return { ok: false, response: tooLarge(limitBytes) };
      }
      chunks.push(value);
    }
  } catch {
    // A read failure (client aborted mid-upload) is a malformed request, not a
    // size violation. The caller maps it to the existing invalid-body response.
    return { ok: false, response: NextResponse.json({ error: "invalid_body" }, { status: 400 }) };
  }

  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(buffer) };
}

/** Parse a JSON request body under a size limit, without unbounded buffering. */
export async function readJsonWithinLimit(
  request: Request,
  limitBytes: number,
): Promise<{ ok: true; value: unknown } | { ok: false; response: NextResponse }> {
  const read = await readBodyWithinLimit(request, limitBytes);
  if (!read.ok) return read;
  try {
    return { ok: true, value: JSON.parse(read.text) as unknown };
  } catch {
    return { ok: false, response: NextResponse.json({ error: "invalid JSON body" }, { status: 400 }) };
  }
}
