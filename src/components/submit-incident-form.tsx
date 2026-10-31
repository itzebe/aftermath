"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import type { SafeguardRecord } from "@/lib/schemas";
import { SafeguardRecordView } from "@/components/safeguard-record";
import { Notice } from "@/components/ui";
import { adminHeaders } from "@/lib/admin-token";

/**
 * The incident submission form — the product's front door.
 *
 * It shows the pipeline's stages as they genuinely happen (validate, parse,
 * look up, diagnose, retrieve, propose, verify, preserve) and then renders the
 * resulting Safeguard Record. A transient dependency failure is surfaced as a
 * retryable condition with no verdict recorded, never as a completed
 * investigation.
 */

const STAGES = [
  "Validating the submission",
  "Parsing the material (rule-based)",
  "Reading the material (AI-assisted, if configured)",
  "Consulting connected sources",
  "Assembling the evidence assessment",
  "Retrieving related memories",
  "Proposing a safeguard",
  "Verifying against the decision engine",
  "Preserving the record",
];

interface ApiError {
  error: string;
  detail?: string;
  retryable?: boolean;
  retryAfterMs?: number;
  issues?: { path: string; message: string }[];
}

export function SubmitIncidentForm({ sample }: { sample?: string }) {
  const [text, setText] = useState("");
  const [service, setService] = useState("");
  const [expected, setExpected] = useState("");
  const [actual, setActual] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState(-1);
  const [error, setError] = useState<ApiError | null>(null);
  const [record, setRecord] = useState<SafeguardRecord | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (busy) return;
      setBusy(true);
      setError(null);
      setRecord(null);
      setStage(0);

      // The stages are a progress indication, not a claim about server
      // internals: they advance on a timer while the single request is in
      // flight, and the final state is decided by the response, never the timer.
      const timer = setInterval(() => {
        setStage((s) => (s < STAGES.length - 1 ? s + 1 : s));
      }, 900);

      try {
        const res = await fetch("/api/incidents/submit", {
          method: "POST",
          headers: adminHeaders({ "content-type": "application/json" }),
          body: JSON.stringify({
            text,
            ...(service ? { service } : {}),
            ...(expected ? { expectedBehavior: expected } : {}),
            ...(actual ? { actualBehavior: actual } : {}),
          }),
        });
        const data = (await res.json()) as { record?: SafeguardRecord } & ApiError;
        if (!res.ok || !data.record) {
          setError(
            data.error
              ? data
              : { error: "unknown_error", detail: "The investigation did not complete." },
          );
          return;
        }
        setRecord(data.record);
        requestAnimationFrame(() =>
          resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
        );
      } catch (err) {
        setError({ error: "network_error", detail: (err as Error).message });
      } finally {
        clearInterval(timer);
        setStage(-1);
        setBusy(false);
      }
    },
    [busy, text, service, expected, actual],
  );

  return (
    <div className="space-y-8">
      <form onSubmit={submit} className="panel p-6 md:p-8">
        <div className="flex flex-col gap-6">
          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <label htmlFor="incident-text" className="heading text-[0.9375rem]">
                Incident material
              </label>
              <span className="mono text-[0.6875rem] text-paper-600">
                required · {text.length.toLocaleString()}/20,000
              </span>
            </div>
            <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-paper-500">
              Paste the real material — an error, a stack trace, a log excerpt, a
              failed request. It is parsed with rules and never executed. Do not
              paste secrets.
            </p>
            <textarea
              id="incident-text"
              className="field mt-3"
              rows={10}
              required
              maxLength={20000}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                "Paste the error, stack trace, or log excerpt here.\n\nExample:\n2026-03-01T10:00:00Z ERROR checkout-service POST /v1/charge returned 503 Service Unavailable after retry"
              }
            />
            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                className="link-quiet mono text-[0.75rem]"
                onClick={() => sample && setText(sample)}
              >
                Use a sample incident
              </button>
              <button
                type="button"
                className="link-quiet mono text-[0.75rem]"
                aria-expanded={advanced}
                aria-controls="incident-context"
                onClick={() => setAdvanced((v) => !v)}
              >
                {advanced ? "Hide" : "Add"} context fields
              </button>
            </div>
          </div>

          {advanced ? (
            <div
              id="incident-context"
              className="grid gap-4 border-t hairline pt-6 sm:grid-cols-3"
            >
              <div>
                <label htmlFor="incident-service" className="label mb-2 block">
                  Service
                </label>
                <input
                  id="incident-service"
                  className="field"
                  maxLength={200}
                  value={service}
                  onChange={(e) => setService(e.target.value)}
                  placeholder="checkout-service"
                />
              </div>
              <div>
                <label htmlFor="incident-expected" className="label mb-2 block">
                  Expected behaviour
                </label>
                <input
                  id="incident-expected"
                  className="field"
                  maxLength={2000}
                  value={expected}
                  onChange={(e) => setExpected(e.target.value)}
                  placeholder="Charge completes once"
                />
              </div>
              <div>
                <label htmlFor="incident-actual" className="label mb-2 block">
                  Actual behaviour
                </label>
                <input
                  id="incident-actual"
                  className="field"
                  maxLength={2000}
                  value={actual}
                  onChange={(e) => setActual(e.target.value)}
                  placeholder="Charge never completed"
                />
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-t hairline pt-6">
            <button
              type="submit"
              className="action primary"
              disabled={busy || text.trim().length === 0}
            >
              {busy ? "Investigating…" : "Investigate incident"}
            </button>
            <span className="max-w-md text-[0.8125rem] leading-snug text-paper-500">
              You will get a Safeguard Record: evidence, hypotheses, a proposed
              safeguard, and how to verify it.
            </span>
          </div>
        </div>

        {busy ? (
          <ol className="mt-6 border-t hairline pt-6" aria-live="polite">
            {STAGES.map((s, i) => (
              <li
                key={s}
                className={`mono flex items-center gap-2.5 py-1 text-[0.75rem] ${
                  i < stage
                    ? "text-paper-500"
                    : i === stage
                      ? "stage-active text-signal-info"
                      : "text-paper-500"
                }`}
              >
                <span aria-hidden className="w-3">
                  {i < stage ? "✓" : i === stage ? "▸" : "·"}
                </span>
                {s}
              </li>
            ))}
          </ol>
        ) : null}

        {error ? (
          <div className="mt-6 border-t hairline pt-6">
            <Notice
              tone={error.retryable ? "warn" : "bad"}
              title={
                error.retryable
                  ? "A dependency was transiently unavailable"
                  : error.error === "invalid_submission"
                    ? "The submission was rejected"
                    : error.error === "unauthorized"
                      ? "Administrator token required"
                      : error.error === "admin_disabled"
                        ? "Submission is disabled"
                        : error.error === "rate_limited"
                          ? "Too many requests"
                          : error.error === "payload_too_large"
                            ? "The submission was too large"
                            : "The investigation did not complete"
              }
            >
              {error.detail ?? "Unknown error."}
              {error.error === "unauthorized" ? (
                <>
                  {" "}
                  Enter the administrator token in the header (the{" "}
                  <span className="mono">Admin</span> control) and try again.
                </>
              ) : null}
              {error.error === "admin_disabled" ? (
                <>
                  {" "}
                  The server has no <span className="mono">AFTERMATH_ADMIN_TOKEN</span>{" "}
                  configured, so incident submission is switched off.
                </>
              ) : null}
              {error.retryable ? (
                <>
                  {" "}
                  No verdict has been recorded for this incident. This is a
                  transport condition, not a result — retrying is safe and will
                  not create a duplicate record.
                </>
              ) : null}
              {error.issues && error.issues.length > 0 ? (
                <ul className="mt-2 list-disc pl-4">
                  {error.issues.map((i) => (
                    <li key={i.path} className="mono text-[0.75rem]">
                      {i.path}: {i.message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </Notice>
          </div>
        ) : null}
      </form>

      <div ref={resultRef} className="scroll-mt-24">
        {record ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="label">Investigation complete</div>
              <Link href="/records" className="link-quiet text-[0.8125rem]">
                View all records →
              </Link>
            </div>
            <SafeguardRecordView record={record} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
