"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { SubmitIncidentForm } from "@/components/submit-incident-form";
import { RunScenariosButton } from "@/components/run-scenarios";
import { Notice, PageHeader, Section } from "@/components/ui";
import { SUBMISSION_SAMPLES } from "@/lib/samples";
import {
  adminHeaders,
  clearAdminToken,
  hasAdminToken,
  onAdminTokenChange,
  setAdminToken,
} from "@/lib/admin-token";

/**
 * The administrator console.
 *
 * Administrative operations (incident submission, the scenario run, and memory
 * recall) write to Walrus Memory Mainnet or spend model quota, so they are
 * gated server-side by `AFTERMATH_ADMIN_TOKEN`. This console is the one
 * intentional place an operator presents that credential; it is a route of its
 * own (`/admin`) and is never rendered in the public app frame.
 *
 * The credential is held in memory for the lifetime of this page only (see
 * `@/lib/admin-token`). It is never prepopulated, never persisted to
 * browser-readable storage, never logged, and never rendered back. A successful
 * sign-in reveals the operations; signing out discards the token and returns the
 * password prompt.
 */

export default function AdminPage() {
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    setAuthed(hasAdminToken());
    return onAdminTokenChange(() => setAuthed(hasAdminToken()));
  }, []);

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Operator"
        title="Admin console"
        lead="Administrative operations write to Walrus Memory Mainnet or spend model quota, so they require the deployment's administrator token. This console is the only place the token is entered; it is held in memory for this page and never persisted."
      />
      {authed ? <Console /> : <SignIn />}
    </div>
  );
}

/**
 * The password prompt. Shown whenever no token is held. Submits the credential
 * to `GET /api/admin/session`, which validates it with the same server-side gate
 * the write endpoints use and performs no work, so a wrong token cannot trigger
 * a write.
 */
function SignIn() {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const candidate = value.trim();
      if (!candidate || busy) return;
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/admin/session", {
          headers: { authorization: `Bearer ${candidate}` },
        });
        if (res.ok) {
          // Only a credential the server accepted is retained.
          setAdminToken(candidate);
          setValue("");
          return;
        }
        if (res.status === 503) {
          setError(
            "Administration is disabled: the server has no administrator token configured.",
          );
        } else if (res.status === 401) {
          setError("That token was not accepted.");
        } else {
          setError(`Sign-in failed (HTTP ${res.status}). Try again.`);
        }
      } catch (err) {
        setError(`Sign-in failed: ${(err as Error).message}`);
      } finally {
        setBusy(false);
      }
    },
    [busy, value],
  );

  return (
    <div className="panel mx-auto w-full max-w-md p-6 md:p-8">
      <h2 className="heading text-[1.125rem]">Administrator sign-in</h2>
      <p className="mt-2 text-[0.8125rem] leading-relaxed text-paper-500">
        Enter the deployment&apos;s{" "}
        <span className="mono">AFTERMATH_ADMIN_TOKEN</span>. It is checked
        against the server, held in memory for this page only, and never written
        to storage or logs.
      </p>
      <form onSubmit={submit} className="mt-5">
        <label
          htmlFor="admin-password"
          className="mono block text-[0.6875rem] uppercase tracking-[0.15em] text-paper-500"
        >
          Administrator token
        </label>
        <input
          id="admin-password"
          type="password"
          autoComplete="off"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="paste token"
          aria-describedby="admin-password-help"
          className="field mt-1.5"
        />
        <p
          id="admin-password-help"
          className="mt-2 text-[0.75rem] leading-snug text-paper-600"
        >
          The value is never displayed again after sign-in.
        </p>
        <div className="mt-4 flex items-center gap-3">
          <button
            type="submit"
            className="action primary"
            disabled={busy || value.trim().length === 0}
          >
            {busy ? "Checking…" : "Sign in"}
          </button>
          <Link href="/" className="link-quiet text-[0.8125rem]">
            Back to the site
          </Link>
        </div>
        {error ? (
          <div className="mt-4" role="alert" aria-live="assertive">
            <Notice tone="bad" title="Sign-in failed">
              {error}
            </Notice>
          </div>
        ) : null}
      </form>
    </div>
  );
}

/** The authenticated console: the gated operations, plus sign-out. */
function Console() {
  const signOut = useCallback(() => clearAdminToken(), []);

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b hairline pb-5">
        <div className="flex items-center gap-2.5">
          <span className="dot bg-signal-ok" aria-hidden />
          <span className="text-[0.875rem] text-paper-300">
            Signed in as administrator
          </span>
          <span className="mono text-[0.6875rem] text-paper-600">
            token held in memory for this page only
          </span>
        </div>
        <button type="button" className="action" onClick={signOut}>
          Sign out
        </button>
      </div>

      <Section
        eyebrow="Workspace"
        title="Investigate an incident"
        lead="Submit real incident material and get a Safeguard Record. The material is parsed with rules and never executed."
      >
        <SubmitIncidentForm samples={SUBMISSION_SAMPLES} />
      </Section>

      <Section
        eyebrow="Demonstration"
        title="Run the controlled scenarios"
        lead="Advance the resumable demonstration. It writes real records to Walrus Memory Mainnet, so it runs only for a signed-in operator."
      >
        <div className="space-y-3">
          <Notice tone="warn" title="This performs real Walrus Memory Mainnet writes">
            Each batch preserves real records on Mainnet. Progress is durable, so
            a run can be resumed; it is never presented as complete until the
            relayer confirms each write.
          </Notice>
          <RunScenariosButton />
        </div>
      </Section>

      <Section
        eyebrow="Integrity"
        title="Memory recall"
        lead="Confirm that stored lessons are retrievable through the deployed instance. This reaches the Walrus Memory relayer but writes nothing."
      >
        <RecallCheck />
      </Section>
    </div>
  );
}

/** A single read-only recall query, mirroring the Memory Ledger's re-verify. */
function RecallCheck() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const run = useCallback(async () => {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/memory-verify", {
        method: "POST",
        headers: adminHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ query: "safeguard", limit: 10 }),
      });
      const d = (await res.json()) as {
        count?: number;
        backend?: string;
        isLive?: boolean;
        error?: string;
        detail?: string;
      };
      if (!res.ok) {
        setResult(
          d.error === "unauthorized"
            ? "Administrator token required or no longer valid. Sign in again."
            : d.error === "admin_disabled"
              ? "Memory verification is disabled: the server has no administrator token configured."
              : `Verification failed: ${d.detail ?? d.error ?? `HTTP ${res.status}`}`,
        );
        return;
      }
      setResult(
        `Recall returned ${d.count ?? 0} stored lesson(s) from ${d.backend} (live=${d.isLive}).`,
      );
    } catch (e) {
      setResult(`Verification failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="space-y-3">
      <button type="button" className="action" onClick={run} disabled={busy}>
        {busy ? "Re-verifying…" : "Re-verify recall"}
      </button>
      {result ? (
        <div role="status" aria-live="polite">
          <Notice tone="info" title="Recall re-verification">
            {result}
          </Notice>
        </div>
      ) : null}
    </div>
  );
}
