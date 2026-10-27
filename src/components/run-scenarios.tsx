"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function RunScenariosButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/scenarios/run", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      startTransition(() => router.refresh());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  }

  const busy = running || pending;

  return (
    <div className="flex items-center gap-3">
      {error ? (
        <span className="mono text-[0.6875rem] text-signal-bad">{error}</span>
      ) : null}
      <button className="action primary" onClick={run} disabled={busy}>
        {busy ? "Running…" : "Run demonstrations"}
      </button>
    </div>
  );
}
