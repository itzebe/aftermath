"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

interface BatchResult {
  jobId: string;
  completedThisRequest: number;
  failedThisRequest: number;
  remaining: number;
  done: boolean;
  continuationRequired: boolean;
  busy: boolean;
  progress: {
    jobId: string;
    status: string;
    total: number;
    completed: number;
    failed: number;
    remaining: number;
    executing: number;
  };
  deferred?: Array<{ stepId: string; title: string; reason: string; retryAfterMs: number }>;
  retryAfterMs?: number | null;
  detail: string;
}

const MAX_CONSECUTIVE_ERRORS = 3;
/**
 * How many consecutive batches may make zero progress while deferred before the
 * client stops. A transient dependency condition is worth waiting out, but an
 * indefinite wait should end with an honest message, not an endless spinner.
 */
const MAX_CONSECUTIVE_STALLS = 12;

export function RunScenariosButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    return () => {
      cancelled.current = true;
    };
  }, []);

  const refresh = useCallback(() => {
    startTransition(() => router.refresh());
  }, [router]);

  /**
   * Drive the demonstration to completion.
   *
   * The server runs the plan in bounded slices because the whole plan — with
   * real Mainnet memory writes — outlives a single request's time limit. This
   * loop calls the endpoint repeatedly until the server reports the job is
   * done, refreshing the page after every slice so progress is visible. If the
   * browser tab is closed mid-run the job keeps its progress on the server and
   * can be resumed by pressing the button again.
   */
  async function run(restart = false) {
    setRunning(true);
    setError(null);
    setNote(null);
    cancelled.current = false;
    let consecutiveErrors = 0;
    let consecutiveStalls = 0;
    let lastDone = -1;
    try {
      // Only the first call may request a restart; every later call continues
      // the same durable job. Passing restart=false lets a button press pick up
      // an unfinished job where a previous session left it.
      for (let i = 0; i < 100; i++) {
        if (cancelled.current) return;
        let body: BatchResult;
        try {
          const res = await fetch("/api/scenarios/run", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ restart: i === 0 ? restart : false }),
          });
          body = await res.json();
          if (!res.ok) {
            throw new Error(
              (body as unknown as { error?: string })?.error ?? `HTTP ${res.status}`,
            );
          }
          consecutiveErrors = 0;
        } catch (err) {
          consecutiveErrors += 1;
          if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) throw err;
          // Transient failure: back off briefly and retry the same job.
          await new Promise((r) => setTimeout(r, 1500 * consecutiveErrors));
          continue;
        }

        if (body.busy) {
          // Another request holds the job lease; wait and retry.
          setNote("Another worker is running this demonstration…");
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }

        const { completed, failed, total } = body.progress;
        // A stall is a batch that advanced no scenario. A few in a row is a
        // transient dependency condition being waited out; too many means the
        // dependency is not recovering, and the run should stop honestly.
        const progressed = completed + failed;
        if (progressed > lastDone) {
          consecutiveStalls = 0;
          lastDone = progressed;
        } else {
          consecutiveStalls += 1;
        }
        if (consecutiveStalls >= MAX_CONSECUTIVE_STALLS) {
          setError(
            `${body.remaining} scenario(s) could not be completed: a dependency stayed unavailable. ${body.detail}`,
          );
          return;
        }
        setNote(`Progress: ${completed + failed}/${total} scenarios · ${body.remaining} remaining`);
        refresh();
        if (body.done) {
          setNote(`Complete: ${completed}/${total} scenarios${failed ? ` · ${failed} failed` : ""}`);
          return;
        }
        if (!body.continuationRequired) {
          // The job reached a terminal state that is not success: report it
          // honestly rather than as a completed demonstration.
          if (failed > 0) setError(body.detail);
          return;
        }
        // A transient dependency condition (rate limit, timeout) is not a
        // failure — wait the interval it asked for before continuing, so the
        // next request does not hammer a dependency that just pushed back.
        const waitMs = body.retryAfterMs ?? 0;
        if (waitMs > 0) {
          const n = body.deferred?.length ?? body.remaining;
          setNote(
            `${n} scenario(s) deferred — a dependency was transiently unavailable; no verdict recorded. Waiting ${Math.ceil(waitMs / 1000)}s…`,
          );
          const deadline = Date.now() + waitMs;
          while (Date.now() < deadline && !cancelled.current) {
            await new Promise((r) => setTimeout(r, Math.min(1000, deadline - Date.now())));
          }
        }
      }
      setError("The demonstration did not finish within the iteration limit.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
      refresh();
    }
  }

  const busy = running || pending;

  return (
    <div className="flex items-center gap-3">
      {error ? (
        <span className="mono text-[0.6875rem] text-signal-bad">{error}</span>
      ) : note ? (
        <span className="mono text-[0.6875rem] text-ink-muted">{note}</span>
      ) : null}
      <button className="action" onClick={() => run(false)} disabled={busy}>
        {busy ? "Running…" : "Resume / continue"}
      </button>
      <button className="action primary" onClick={() => run(true)} disabled={busy}>
        {busy ? "Running…" : "Run from scratch"}
      </button>
    </div>
  );
}
