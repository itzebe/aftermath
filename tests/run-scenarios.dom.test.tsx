import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// The button reads the Next router for its refresh callback; stub it so the
// render does not depend on an app-router context.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
  usePathname: () => "/admin",
}));

import { RunScenariosButton } from "@/components/run-scenarios";

/**
 * Regression guard for the resumable demonstration's client loop.
 *
 * The run is advanced in bounded batches, and `/api/scenarios/run` carries its
 * own per-minute write cap. The loop previously treated the resulting `429` as
 * a fatal error: after three consecutive batches the whole run aborted with
 * "rate_limited", even though the server had stated the interval to wait. A
 * long, legitimately resumable demonstration could therefore be killed by the
 * endpoint's own admission control. These tests pin the corrected behaviour —
 * a `429` is waited out and the same job continued.
 */

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function batchDone(): unknown {
  return {
    jobId: "job-1",
    completedThisRequest: 1,
    failedThisRequest: 0,
    remaining: 0,
    done: true,
    continuationRequired: false,
    busy: false,
    progress: {
      jobId: "job-1",
      status: "completed",
      total: 1,
      completed: 1,
      failed: 0,
      remaining: 0,
      executing: 0,
    },
    detail: "done",
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("RunScenariosButton rate-limit handling", () => {
  it("waits out a 429 and continues the same job instead of aborting", async () => {
    let calls = 0;
    global.fetch = vi.fn(async () => {
      calls += 1;
      // More refusals than the old consecutive-error cap (3): the previous code
      // aborted the run here, the fixed loop waits each interval and continues.
      if (calls <= 5) {
        return json(429, { error: "rate_limited", retryAfterSeconds: 1 });
      }
      return json(200, batchDone());
    }) as unknown as typeof fetch;

    render(<RunScenariosButton />);
    fireEvent.click(screen.getByRole("button", { name: /resume \/ continue/i }));

    await waitFor(() => expect(screen.getByText(/Complete:/i)).not.toBeNull(), {
      timeout: 20000,
    });
    // The loop kept going through the rate limits rather than stopping at three.
    expect(calls).toBe(6);
    expect(screen.queryByText(/rate_limited/i)).toBeNull();
  }, 30000);

  it("reports an honest error when the limiter never lets the run through", async () => {
    global.fetch = vi.fn(async () =>
      json(429, { error: "rate_limited", retryAfterSeconds: 1 }),
    ) as unknown as typeof fetch;

    render(<RunScenariosButton />);
    fireEvent.click(screen.getByRole("button", { name: /resume \/ continue/i }));

    // Bounded: it eventually stops with a message rather than looping forever.
    await waitFor(
      () => expect(screen.getByText(/kept rate-limiting/i)).not.toBeNull(),
      { timeout: 60000 },
    );
  }, 90000);
});
