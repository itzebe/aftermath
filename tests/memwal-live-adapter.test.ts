import { describe, expect, it, vi } from "vitest";
import {
  MemWalMemoryAdapter,
  type MemWalClientLike,
} from "@/lib/adapters/memwal-memory";
import type { AftermathConfig } from "@/lib/config";
import { CorrectiveLessonRecordSchema } from "@/lib/schemas";

/**
 * The live adapter's logic is tested at the network boundary, which is the only
 * place a stand-in is justified: the real client needs credentials and a live
 * relayer. Everything above the boundary — the state machine, the blob-id
 * handling, the failure handling — is the real adapter code.
 */

function config(overrides: Partial<AftermathConfig["memory"]> = {}): AftermathConfig {
  return {
    memory: {
      serverUrl: "https://relayer.memory.walrus.xyz",
      accountId: "0xaccount",
      privateKey: "0xkey",
      namespace: "aftermath",
      forceSimulated: false,
      ...overrides,
    },
    tatum: { rpcUrl: "https://sui-mainnet.gateway.tatum.io", grpcUrl: "https://sui-mainnet-grpc.gateway.tatum.io", graphqlUrl: "https://sui-mainnet.gateway.tatum.io/graphql", apiKey: null, timeoutMs: 12000 },
    dbPath: ":memory:",
    harnessDir: "/tmp/aftermath-harness",
  };
}

function lesson() {
  return CorrectiveLessonRecordSchema.parse({
    type: "corrective_lesson",
    domain: "coding",
    failure_pattern: "unsupported_completion_claim",
    observation: "claimed a fix without running the tests",
    verified_evidence: "test process exited non-zero",
    corrective_rule: "Require the test run before accepting a fix.",
    scope: "coding:report_bug_fixed",
    validation_status: "validated",
    rule_version: 1,
    incident_id: "inc-1",
    evidence_reference: "test_run:calc.test.js",
    created_at: new Date().toISOString(),
    provenance: "simulated",
  });
}

interface StubOptions {
  healthOk?: boolean;
  status?: "pending" | "running" | "uploaded" | "done" | "failed" | "not_found";
  statusError?: string;
  rememberThrows?: boolean;
  waitThrows?: boolean;
  blobId?: string;
  recallFindsBlob?: boolean;
  /** Omit listNamespaces entirely to model a client without the credential probe. */
  omitListNamespaces?: boolean;
  /** Make the authenticated probe fail in a specific way. */
  authProbe?: "ok" | "auth" | "upstream" | "network";
  /** Memory count the relayer reports for the configured namespace. */
  namespaceMemoryCount?: number;
}

function authError(kind: "auth" | "upstream" | "network"): Error {
  if (kind === "auth") {
    const e = new Error(
      "401 from relayer: typically wrong private key, key not registered on this account",
    ) as Error & { status?: number; serverCode?: string };
    e.status = 401;
    e.serverCode = "AUTH_REJECTED";
    return e;
  }
  if (kind === "upstream") {
    const e = new Error(
      "Walrus Memory temporarily cannot verify credentials (upstream unavailable).",
    ) as Error & { status?: number; serverCode?: string };
    e.status = 503;
    e.serverCode = "AUTH_UPSTREAM_UNAVAILABLE";
    return e;
  }
  return new Error("fetch failed: socket hang up");
}

function stubClient(opts: StubOptions = {}) {
  const blobId = opts.blobId ?? "blob-abc123";
  const calls = { remember: 0, wait: 0, recall: 0, idempotencyKeys: [] as (string | undefined)[] };
  const client: MemWalClientLike = {
    health: vi.fn(async () => ({
      status: opts.healthOk === false ? "down" : "ok",
      relayerVersion: "0.1.0",
    })),
    remember: vi.fn(async (_text: string, o?: { idempotencyKey?: string }) => {
      calls.remember += 1;
      calls.idempotencyKeys.push(o?.idempotencyKey);
      if (opts.rememberThrows) throw new Error("relayer refused: insufficient WAL");
      return { job_id: "job-1", status: "accepted" };
    }),
    getRememberStatus: vi.fn(async () => ({
      job_id: "job-1",
      status: opts.status ?? "running",
      error: opts.statusError,
    })),
    waitForRememberJob: vi.fn(async () => {
      calls.wait += 1;
      if (opts.waitThrows) throw new Error("job failed: embedding rejected");
      return { id: "job-1", blob_id: blobId, owner: "0xowner", namespace: "aftermath" };
    }),
    recall: vi.fn(async () => {
      calls.recall += 1;
      const finds = opts.recallFindsBlob ?? true;
      return {
        results: finds
          ? [{ blob_id: blobId, text: "whatever", distance: 0.1 }]
          : [{ blob_id: "some-other-blob", text: "unrelated", distance: 0.9 }],
      };
    }),
  };
  if (!opts.omitListNamespaces) {
    client.listNamespaces = vi.fn(async () => {
      const probe = opts.authProbe ?? "ok";
      if (probe !== "ok") throw authError(probe);
      return {
        namespaces: [
          { name: "aftermath", memory_count: opts.namespaceMemoryCount ?? 0 },
        ],
        has_more: false,
      };
    });
  }
  return { client, calls };
}

function adapter(stub: MemWalClientLike, overrides?: Partial<AftermathConfig["memory"]>) {
  return new MemWalMemoryAdapter(config(overrides), () => stub);
}

describe("MemWalMemoryAdapter backend identification", () => {
  it("identifies the Mainnet relayer as memwal-mainnet", () => {
    const { client } = stubClient();
    expect(adapter(client).backend).toBe("memwal-mainnet");
  });

  it("identifies the staging relayer separately", () => {
    const { client } = stubClient();
    expect(
      adapter(client, { serverUrl: "https://relayer-staging.memory.walrus.xyz" }).backend,
    ).toBe("memwal-staging");
  });

  it("never labels itself simulated", () => {
    const { client } = stubClient();
    const a = adapter(client);
    expect(a.isLive).toBe(true);
    expect(a.provenance).toBe("live");
  });
});

describe("MemWalMemoryAdapter write lifecycle", () => {
  it("treats an accepted job as completed only after the job finishes", async () => {
    const { client, calls } = stubClient({ status: "running" });
    const receipt = await adapter(client).rememberLesson(lesson());
    expect(receipt.state).toBe("completed");
    expect(calls.remember).toBe(1);
    expect(calls.wait).toBe(1);
  });

  it("records the blob id returned by the relayer", async () => {
    const { client } = stubClient({ blobId: "blob-xyz" });
    const receipt = await adapter(client).rememberLesson(lesson());
    expect(receipt.blobId).toBe("blob-xyz");
    expect(receipt.owner).toBe("0xowner");
    expect(receipt.namespace).toBe("aftermath");
  });

  it("marks a write recall-verified only when recall returns the blob", async () => {
    const found = stubClient({ recallFindsBlob: true });
    const a1 = await adapter(found.client).rememberLesson(lesson());
    expect(a1.recallVerified).toBe(true);

    const notFound = stubClient({ recallFindsBlob: false });
    const a2 = await adapter(notFound.client).rememberLesson(lesson());
    expect(a2.state).toBe("completed");
    expect(a2.recallVerified).toBe(false);
  });

  it("marks the write failed when the relayer rejects the job", async () => {
    const { client } = stubClient({ rememberThrows: true });
    const receipt = await adapter(client).rememberLesson(lesson());
    expect(receipt.state).toBe("failed");
    expect(receipt.error).toMatch(/insufficient WAL/);
    expect(receipt.blobId).toBeUndefined();
  });

  it("marks the write failed when the job errors after acceptance", async () => {
    const { client } = stubClient({ waitThrows: true });
    const receipt = await adapter(client).rememberLesson(lesson());
    expect(receipt.state).toBe("failed");
    expect(receipt.jobId).toBe("job-1");
    expect(receipt.error).toMatch(/embedding rejected/);
  });

  it("returns failed without a blob id when the backend is unhealthy", async () => {
    const { client, calls } = stubClient({ healthOk: false });
    const receipt = await adapter(client).rememberLesson(lesson());
    expect(receipt.state).toBe("failed");
    expect(calls.remember).toBe(0);
  });

  it("surfaces a relayer-reported job failure from the status read", async () => {
    const { client } = stubClient({ status: "failed", statusError: "blob upload failed" });
    const receipt = await adapter(client).rememberLesson(lesson());
    expect(receipt.state).toBe("failed");
    expect(receipt.error).toMatch(/blob upload failed/);
  });

  it("never reports a completed write without a blob id", async () => {
    const { client } = stubClient();
    const receipt = await adapter(client).rememberLesson(lesson());
    if (receipt.state === "completed") {
      expect(receipt.blobId).toBeTruthy();
    }
  });
});

describe("MemWalMemoryAdapter idempotency", () => {
  it("keys a lesson by its content, so a retry is idempotent", async () => {
    const { client, calls } = stubClient();
    const a = adapter(client);
    // A retry resends the *same* lesson. Building a fresh lesson would embed a
    // new timestamp and therefore genuinely different content.
    const retry = lesson();
    await a.rememberLesson(retry);
    await a.rememberLesson(retry);
    expect(calls.idempotencyKeys[0]).toBe(calls.idempotencyKeys[1]);
    expect(calls.idempotencyKeys[0]).toMatch(/^lesson:[0-9a-f]{32}$/);
  });

  it("gives distinct lessons in one run distinct idempotency keys", async () => {
    // Two different incidents can produce lessons with the same class
    // (domain/pattern/scope/version) but different observations. Keying on the
    // class alone made the relayer reject the second with a 409
    // "idempotency_key was already used for a request with different content".
    const { client, calls } = stubClient();
    const a = adapter(client);
    const l1 = lesson();
    const l2 = { ...lesson(), observation: "a different observation", incident_id: "inc-2" };
    await a.rememberLesson(l1);
    await a.rememberLesson(l2);
    expect(calls.idempotencyKeys[0]).not.toBe(calls.idempotencyKeys[1]);
  });

  it("sends a distinct idempotency key per incident", async () => {
    const { client, calls } = stubClient();
    const incident = {
      domain: "finance" as const,
      actionType: "report_sui_transaction_success",
      executionId: "e1",
      intendedOutcome: "confirm",
      evidenceReferences: [],
      relevantContext: {},
      provenance: "simulated" as const,
      incidentId: "inc-42",
      createdAt: new Date().toISOString(),
      currentStatus: "open" as const,
    };
    await adapter(client).rememberIncident(incident);
    expect(calls.idempotencyKeys[0]).toBe("incident:inc-42");
  });
});

describe("MemWalMemoryAdapter recall", () => {
  it("returns an empty list rather than throwing when the relayer is unhealthy", async () => {
    const { client } = stubClient({ healthOk: false });
    expect(await adapter(client).recallRelevantLessons("anything")).toEqual([]);
  });

  it("parses a corrective lesson out of recalled text", async () => {
    const text = [
      "corrective_lesson:coding:unsupported_completion_claim",
      "Require the test run before accepting a fix.",
      JSON.stringify(lesson()),
    ].join("\n");
    const client: MemWalClientLike = {
      health: async () => ({ status: "ok" }),
      remember: async () => ({ job_id: "j", status: "accepted" }),
      getRememberStatus: async () => ({ job_id: "j", status: "done" }),
      waitForRememberJob: async () => ({ id: "j", blob_id: "b", owner: "o", namespace: "n" }),
      recall: async () => ({
        results: [{ blob_id: "b", text, distance: 0.05, created_at: "2026-01-01T00:00:00Z" }],
      }),
    };
    const hits = await adapter(client).recallRelevantLessons("require tests");
    expect(hits).toHaveLength(1);
    expect(hits[0].record?.type).toBe("corrective_lesson");
    expect(hits[0].record?.domain).toBe("coding");
  });

  it("does not fabricate a record from unparseable recalled text", async () => {
    const client: MemWalClientLike = {
      health: async () => ({ status: "ok" }),
      remember: async () => ({ job_id: "j", status: "accepted" }),
      getRememberStatus: async () => ({ job_id: "j", status: "done" }),
      waitForRememberJob: async () => ({ id: "j", blob_id: "b", owner: "o", namespace: "n" }),
      recall: async () => ({ results: [{ blob_id: "b", text: "free prose", distance: 0.2 }] }),
    };
    const hits = await adapter(client).recallRelevantLessons("anything");
    expect(hits[0].record).toBeUndefined();
  });
});

describe("MemWalMemoryAdapter credential status", () => {
  it("reports MAINNET_AUTH_CONFIRMED only after an authenticated call succeeds", async () => {
    const { client } = stubClient({ authProbe: "ok" });
    const s = await adapter(client).status();
    expect(s.state).toBe("MAINNET_AUTH_CONFIRMED");
    expect(s.authenticated).toBe(true);
    expect(s.reachable).toBe(true);
    expect(s.authFailed).toBe(false);
  });

  it("surfaces the authoritative namespace memory count from the signed call", async () => {
    // On a fresh deployment the local ledger is empty, so the relayer's own
    // count for the namespace is the honest way to show memories exist.
    const { client } = stubClient({ authProbe: "ok", namespaceMemoryCount: 26 });
    const s = await adapter(client).status();
    expect(s.namespaceMemoryCount).toBe(26);
    expect(s.detail).toMatch(/26 memories/i);
  });

  it("reports MAINNET_AUTH_FAILED when the relayer refuses the credentials", async () => {
    const { client } = stubClient({ authProbe: "auth" });
    const s = await adapter(client).status();
    expect(s.state).toBe("MAINNET_AUTH_FAILED");
    expect(s.authFailed).toBe(true);
    expect(s.authenticated).toBe(false);
    // The transport still worked; only the credentials were rejected.
    expect(s.reachable).toBe(true);
    expect(s.serverCode).toBe("AUTH_REJECTED");
  });

  it("treats an auth-upstream 503 as an outage, not a bad key", async () => {
    const { client } = stubClient({ authProbe: "upstream" });
    const s = await adapter(client).status();
    expect(s.state).toBe("MAINNET_UNAVAILABLE");
    expect(s.authUpstreamUnavailable).toBe(true);
    expect(s.authFailed).toBe(false);
    expect(s.authenticated).toBe(false);
  });

  it("never claims authentication when the probe fails for an unknown reason", async () => {
    const { client } = stubClient({ authProbe: "network" });
    const s = await adapter(client).status();
    expect(s.authenticated).toBe(false);
    expect(s.authFailed).toBe(false);
    expect(s.state).toBe("MAINNET_CONNECTED");
  });

  it("reports unreachable when neither the health nor the auth probe connects", async () => {
    const { client } = stubClient({ healthOk: false, authProbe: "network" });
    const s = await adapter(client).status();
    expect(s.reachable).toBe(false);
    expect(s.authenticated).toBe(false);
    expect(s.state).toBe("MAINNET_UNAVAILABLE");
  });

  it("still reports authenticated when only the health endpoint fails", async () => {
    // A working signed call is stronger evidence than a failing unauthenticated
    // probe, so authentication must win over the health check.
    const { client } = stubClient({ healthOk: false, authProbe: "ok" });
    const s = await adapter(client).status();
    expect(s.authenticated).toBe(true);
    expect(s.state).toBe("MAINNET_AUTH_CONFIRMED");
  });

  it("does not claim authentication when the client lacks the credential probe", async () => {
    const { client } = stubClient({ omitListNamespaces: true });
    const s = await adapter(client).status();
    expect(s.authenticated).toBe(false);
    expect(s.state).toBe("MAINNET_CONNECTED");
    expect(s.detail).toMatch(/unverified/i);
  });

  it("refuses to attempt a write when the credentials are already rejected", async () => {
    const { client, calls } = stubClient({ authProbe: "auth" });
    const receipt = await adapter(client).rememberLesson(lesson());
    expect(receipt.state).toBe("failed");
    expect(receipt.error).toMatch(/credentials rejected/i);
    // The signed write must not even be submitted.
    expect(calls.remember).toBe(0);
  });
});
