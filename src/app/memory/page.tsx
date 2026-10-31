"use client";

import { useCallback, useEffect, useState } from "react";
import { adminHeaders } from "@/lib/admin-token";
import {
  EmptyState,
  Loading,
  Metric,
  Notice,
  PageHeader,
  Panel,
  Pill,
} from "@/components/ui";

type WriteState = "requested" | "processing" | "completed" | "failed";

interface MemoryWrite {
  writeId: string;
  kind: "incident" | "lesson";
  jobId: string | null;
  state: WriteState;
  blobId?: string;
  owner?: string;
  namespace?: string;
  error?: string;
  recallVerified: boolean;
  recallMatches?: number;
  backend: string;
  provenance: "live" | "simulated";
  requestedAt: string;
  completedAt?: string;
  text: string;
}

interface MemoryStatusPayload {
  state:
    | "SIMULATED_BACKEND"
    | "MAINNET_CONNECTED"
    | "MAINNET_AUTH_CONFIRMED"
    | "MAINNET_WRITE_CONFIRMED"
    | "MAINNET_RECALL_CONFIRMED"
    | "MAINNET_AUTH_FAILED"
    | "MAINNET_UNAVAILABLE";
  reachable: boolean;
  authenticated: boolean;
  authFailed: boolean;
  authUpstreamUnavailable: boolean;
  serverCode?: string;
  namespaceMemoryCount?: number;
  detail: string;
}

interface MemoryResponse {
  writes: MemoryWrite[];
  health: { ok: boolean; detail: string; relayerVersion?: string; writeReady?: boolean };
  status: MemoryStatusPayload;
  backend: string;
  isLive: boolean;
  reason: string;
  degraded: boolean;
}

const STATE_TONE: Record<WriteState, "neutral" | "warn" | "ok" | "bad"> = {
  requested: "neutral",
  processing: "warn",
  completed: "ok",
  failed: "bad",
};

/**
 * How to present the backend state. A reachable-but-unauthenticated relayer is
 * a warning, never a success: the credentials were not accepted, so no Mainnet
 * write can be claimed.
 */
const BACKEND_STATE_TONE: Record<MemoryStatusPayload["state"], "ok" | "warn" | "bad"> = {
  SIMULATED_BACKEND: "warn",
  MAINNET_CONNECTED: "warn",
  MAINNET_AUTH_CONFIRMED: "ok",
  MAINNET_WRITE_CONFIRMED: "ok",
  MAINNET_RECALL_CONFIRMED: "ok",
  MAINNET_AUTH_FAILED: "bad",
  MAINNET_UNAVAILABLE: "bad",
};

const BACKEND_STATE_LABEL: Record<MemoryStatusPayload["state"], string> = {
  SIMULATED_BACKEND: "Simulated backend",
  MAINNET_CONNECTED: "Mainnet reachable · auth unverified",
  MAINNET_AUTH_CONFIRMED: "Mainnet connected · credentials accepted",
  MAINNET_WRITE_CONFIRMED: "Mainnet write confirmed",
  MAINNET_RECALL_CONFIRMED: "Mainnet recall confirmed",
  MAINNET_AUTH_FAILED: "Mainnet credentials rejected",
  MAINNET_UNAVAILABLE: "Mainnet unavailable",
};

export default function MemoryPage() {
  const [data, setData] = useState<MemoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [verifyResult, setVerifyResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/memory");
    setData((await r.json()) as MemoryResponse);
  }, []);

  useEffect(() => {
    load().catch((e: Error) => setError(e.message));
  }, [load]);

  const runVerify = useCallback(async () => {
    setBusy(true);
    setVerifyResult(null);
    try {
      const r = await fetch("/api/memory-verify", {
        method: "POST",
        headers: adminHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ query: "safeguard", limit: 10 }),
      });
      const d = (await r.json()) as {
        count?: number;
        backend?: string;
        isLive?: boolean;
        error?: string;
        detail?: string;
      };
      if (!r.ok) {
        setVerifyResult(
          d.error === "unauthorized"
            ? "Administrator token required. Enter it in the header (the Admin control), then retry."
            : d.error === "admin_disabled"
              ? "Memory verification is disabled: the server has no AFTERMATH_ADMIN_TOKEN configured."
              : `Verification failed: ${d.detail ?? d.error ?? `HTTP ${r.status}`}`,
        );
        return;
      }
      setVerifyResult(
        `Recall returned ${d.count ?? 0} stored lesson(s) from ${d.backend} (live=${d.isLive}).`,
      );
      await load();
    } catch (e) {
      setVerifyResult(`Verification failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [load]);

  if (error) {
    return (
      <div>
        <PageHeader eyebrow="System" title="Memory Ledger" />
        <Panel>
          <p className="text-[0.875rem] text-signal-bad">{error}</p>
        </Panel>
      </div>
    );
  }
  if (!data) return <Loading label="Loading memory ledger…" />;

  const liveWrites = data.writes.filter((w) => w.backend !== "simulated");
  const completedLive = liveWrites.filter((w) => w.state === "completed");
  const recallVerifiedLive = liveWrites.filter((w) => w.recallVerified);
  const failed = data.writes.filter((w) => w.state === "failed");

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="System"
        title="Memory Ledger"
        lead="Every write this application attempted against the memory backend, with its true lifecycle. A write is only counted as complete once the relayer returned a blob id, and only counted as verified once a recall query returned the record."
        right={
          <button
            type="button"
            className="action"
            onClick={runVerify}
            disabled={busy}
          >
            {busy ? "Re-verifying…" : "Re-verify recall"}
          </button>
        }
      />

      {data.status.state === "MAINNET_AUTH_FAILED" ? (
        <Notice tone="bad" title="Walrus Memory credentials rejected">
          The relayer at {data.backend} is reachable, but it refused the delegate
          credentials, so no Mainnet write can be attempted or claimed.{" "}
          {data.status.serverCode ? `Server code: ${data.status.serverCode}. ` : ""}
          {data.status.detail}
        </Notice>
      ) : !data.status.authenticated && data.isLive ? (
        <Notice tone="warn" title="Walrus Memory authentication unverified">
          The relayer is reachable but the credential check did not confirm the
          delegate key. Mainnet writes are not counted as connected until an
          authenticated call succeeds. {data.status.detail}
        </Notice>
      ) : !data.isLive ? (
        <Notice tone="warn" title="Walrus Memory is not configured">
          {data.reason}
        </Notice>
      ) : (
        <Notice tone="ok" title="Walrus Memory is live">
          Writes are submitted to {data.backend}. Relayer health:{" "}
          {data.health.detail}
        </Notice>
      )}

      {verifyResult ? (
        <Notice tone="info" title="Recall re-verification">
          {verifyResult}
        </Notice>
      ) : null}

      <Panel
        title="Backend state"
        hint="Configured account vs. confirmed service, and submitted vs. confirmed writes, stated separately."
      >
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={BACKEND_STATE_TONE[data.status.state]}>
            {BACKEND_STATE_LABEL[data.status.state]}
          </Pill>
          <span className="mono text-[0.6875rem] text-paper-500">
            {data.backend}
          </span>
        </div>
        <div className="mt-2 grid gap-1 text-[0.75rem] leading-relaxed text-paper-300">
          <div>
            Relayer transport:{" "}
            <span className="mono">
              {data.status.reachable ? "reachable" : "not reached"}
            </span>
          </div>
          <div>
            Credentials accepted:{" "}
            <span className="mono">
              {data.status.authenticated ? "yes" : "no / unverified"}
            </span>
          </div>
          {typeof data.status.namespaceMemoryCount === "number" ? (
            <div>
              Memories in namespace{" "}
              <span className="mono">{data.backend}</span>{" "}
              <span className="mono">(authoritative, relayer-reported)</span>:{" "}
              <span className="mono">{data.status.namespaceMemoryCount}</span>
            </div>
          ) : null}
          <div className="text-paper-400">{data.status.detail}</div>
        </div>
      </Panel>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Metric
          label="Mainnet writes completed"
          value={`${completedLive.length} / 10`}
          tone={completedLive.length >= 10 ? "ok" : "bad"}
          sub="Writes this instance submitted and confirmed. The counter reads this instance's own ledger; a fresh deployment starts at zero even though earlier Mainnet writes persist in the namespace below."
        />
        <Metric
          label="Recall verified"
          value={recallVerifiedLive.length}
          tone={recallVerifiedLive.length >= 10 ? "ok" : "bad"}
          sub="Mainnet writes a recall query returned back."
        />
        <Metric
          label="Simulated writes"
          value={data.writes.length - liveWrites.length}
          tone="warn"
          sub="Not stored on Walrus Mainnet and excluded from the required count."
        />
        <Metric
          label="Failed writes"
          value={failed.length}
          tone={failed.length ? "bad" : "ok"}
          sub="Writes that did not complete. Never counted as successful."
        />
      </div>

      <Panel
        title="Write log"
        hint={`${data.writes.length} write attempt(s). Newest first.`}
      >
        {data.writes.length === 0 ? (
          <EmptyState title="No memory writes yet">
            Run the demonstrations to produce incidents and lessons.
          </EmptyState>
        ) : (
          <div
            className="scroll-x"
            role="region"
            aria-label="Write log"
            tabIndex={0}
          >
            <table className="data">
              <thead>
                <tr>
                  <th>Kind</th>
                  <th>State</th>
                  <th>Recall</th>
                  <th>Blob ID</th>
                  <th>Backend</th>
                  <th>Job</th>
                  <th>Requested</th>
                </tr>
              </thead>
              <tbody>
                {[...data.writes].reverse().map((w) => (
                  <tr key={w.writeId}>
                    <td>
                      <span className="mono text-[0.75rem]">{w.kind}</span>
                    </td>
                    <td>
                      <Pill tone={STATE_TONE[w.state]}>{w.state}</Pill>
                    </td>
                    <td>
                      {w.recallVerified ? (
                        <Pill tone="ok">
                          verified{w.recallMatches ? ` (${w.recallMatches})` : ""}
                        </Pill>
                      ) : w.state === "completed" ? (
                        <Pill tone="warn">not found</Pill>
                      ) : (
                        <span className="text-paper-500">—</span>
                      )}
                    </td>
                    <td className="mono max-w-[16rem] truncate text-[0.6875rem]">
                      {w.blobId ?? "—"}
                    </td>
                    <td>
                      <Pill tone={w.backend === "simulated" ? "warn" : "ok"}>
                        {w.backend}
                      </Pill>
                    </td>
                    <td className="mono max-w-[12rem] truncate text-[0.6875rem] text-paper-500">
                      {w.jobId ?? "—"}
                    </td>
                    <td className="mono whitespace-nowrap text-[0.6875rem] text-paper-500">
                      {w.requestedAt.slice(11, 19)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        title="Record contents"
        hint="The exact text submitted to the memory backend, kept for auditability. The structured record is embedded as JSON so it round-trips through recall."
      >
        {data.writes.length === 0 ? (
          <EmptyState title="Nothing written yet" />
        ) : (
          <div className="space-y-2">
            {[...data.writes].reverse().slice(0, 8).map((w) => (
              <details key={w.writeId} className="rounded border hairline">
                <summary className="mono cursor-pointer px-4 py-3 text-[0.6875rem] text-paper-300">
                  {w.writeId} · {w.kind} · {w.state}
                  {w.blobId ? ` · ${w.blobId}` : ""}
                </summary>
                <pre className="code border-0 border-t hairline">{w.text}</pre>
              </details>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
