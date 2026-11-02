"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { SubmitIncidentForm } from "@/components/submit-incident-form";
import { Loading, Notice } from "@/components/ui";

/**
 * The public investigation workspace.
 *
 * AFTERMATH's core act is investigating an incident, so the front door mounts
 * the submission form directly rather than sending a visitor to an operator
 * sign-in. Whether an anonymous visitor may actually submit is decided
 * server-side (`api/public-submit-guard`) and reported by `GET /api/config`;
 * this component renders the form only when submission is genuinely available,
 * and states the honest reason when it is not. It never fabricates availability
 * and never presents the operator credential as a requirement for the product.
 */

const SAMPLE = `2026-03-01T10:00:00Z ERROR checkout-service
POST /v1/charge returned 503 Service Unavailable
retrying (attempt 2/3)...
2026-03-01T10:00:07Z WARN checkout-service charge status: unknown
2026-03-01T10:00:08Z INFO agent "the charge completed successfully"`;

interface ConfigSummary {
  publicSubmission?: { available: boolean; reason: string };
}

type State =
  | { kind: "loading" }
  | { kind: "available" }
  | { kind: "unavailable"; reason: string }
  | { kind: "error"; message: string };

export function PublicInvestigation() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/config")
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as ConfigSummary | null;
        if (cancelled) return;
        if (!res.ok || !body?.publicSubmission) {
          setState({
            kind: "unavailable",
            reason: "The server did not report whether public submission is available.",
          });
          return;
        }
        setState(
          body.publicSubmission.available
            ? { kind: "available" }
            : { kind: "unavailable", reason: body.publicSubmission.reason },
        );
      })
      .catch((err: Error) => {
        if (!cancelled) setState({ kind: "error", message: err.message });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === "loading") {
    return (
      <div className="panel p-6 md:p-8">
        <Loading label="Checking whether public submission is available…" />
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <Notice tone="warn" title="Could not reach the investigation service">
        {state.message} Reload the page to try again.
      </Notice>
    );
  }

  if (state.kind === "unavailable") {
    return (
      <Notice tone="info" title="Public submission is not enabled on this deployment">
        {state.reason} You can still read every published Safeguard Record, the
        learning loop, and the live system state without an account — browse the{" "}
        <Link href="/records" className="link-quiet">
          Safeguard Records
        </Link>{" "}
        or open the{" "}
        <Link href="/learning" className="link-quiet">
          Learning Loop
        </Link>
        . An operator can sign in from the{" "}
        <Link href="/admin" className="link-quiet">
          admin console
        </Link>
        .
      </Notice>
    );
  }

  return <SubmitIncidentForm sample={SAMPLE} anonymous />;
}
