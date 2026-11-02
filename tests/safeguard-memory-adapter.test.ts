import { describe, expect, it } from "vitest";
import { SimulatedMemoryAdapter } from "@/lib/adapters/simulated-memory";
import {
  parseSafeguardMemoryFromMemoryText,
  safeguardMemoryToMemoryText,
} from "@/lib/adapters/memory";
import { SafeguardMemoryRecordSchema } from "@/lib/schemas";
import type { SafeguardMemoryRecord } from "@/lib/schemas";

/**
 * The Safeguard Memory memory-text format.
 *
 * The text form is what is written to Walrus Memory and what a recall parses
 * back. It must round-trip every structured field, and — because the write's
 * idempotency key hashes this text — it must be byte-identical for the same
 * memory regardless of the wall-clock timestamp, or a retry would be rejected
 * as "different content" for a reused key.
 */

function memory(overrides: Partial<SafeguardMemoryRecord> = {}): SafeguardMemoryRecord {
  return SafeguardMemoryRecordSchema.parse({
    type: "safeguard_memory",
    memory_id: "safeguard-incident-unsupported_completion_claim",
    version: 1,
    origin_incident_id: "inc-1",
    domain: "incident",
    action_type: "validate_reported_success",
    failure_category: "unsupported_completion_claim",
    verified_failure: "A success claim was made with no authoritative record.",
    evidence: ["incident:inc-1", "incident:submission:e1"],
    root_cause: "The completion claim was not backed by a record.",
    corrective_rule: "Require authoritative verification before accepting success.",
    applies_when: [
      "domain=incident",
      "actionType=validate_reported_success",
      "failureCategory=unsupported_completion_claim",
    ],
    required_checks: ["Capture the authoritative record of the outcome."],
    action: "BLOCK",
    severity: "high",
    confidence: 0.85,
    limitations: ["Scoped to this domain and action type."],
    authoritative: true,
    support_basis: "Grounded in observed facts.",
    status: "active",
    created_at: "2026-01-01T00:00:00.000Z",
    provenance: "simulated",
    ...overrides,
  });
}

describe("safeguard memory text format", () => {
  it("round-trips every structured field through the memory text form", () => {
    const m = memory();
    const parsed = parseSafeguardMemoryFromMemoryText(safeguardMemoryToMemoryText(m));
    expect(parsed).toBeDefined();
    expect(parsed!.memory_id).toBe(m.memory_id);
    expect(parsed!.corrective_rule).toBe(m.corrective_rule);
    expect(parsed!.applies_when).toEqual(m.applies_when);
    expect(parsed!.required_checks).toEqual(m.required_checks);
    expect(parsed!.authoritative).toBe(true);
    expect(parsed!.failure_category).toBe("unsupported_completion_claim");
  });

  it("is byte-identical regardless of created_at (idempotency-key stability)", () => {
    const a = memory({ created_at: "2026-01-01T00:00:00.000Z" });
    const b = memory({ created_at: "2026-10-27T12:34:56.789Z" });
    expect(safeguardMemoryToMemoryText(a)).toBe(safeguardMemoryToMemoryText(b));
  });

  it("returns undefined for non-safeguard text", () => {
    expect(parseSafeguardMemoryFromMemoryText("just prose")).toBeUndefined();
    expect(
      parseSafeguardMemoryFromMemoryText('{"type":"corrective_lesson"}'),
    ).toBeUndefined();
  });

  it("rejects a structurally invalid safeguard record", () => {
    // A record claiming to be a safeguard but missing required fields must not
    // parse, so a malformed memory can never be enforced.
    const bad = '{"type":"safeguard_memory","memory_id":"m1"}';
    expect(parseSafeguardMemoryFromMemoryText(bad)).toBeUndefined();
  });
});

describe("SimulatedMemoryAdapter.rememberSafeguard", () => {
  it("completes a safeguard write and returns a blob id", async () => {
    const adapter = new SimulatedMemoryAdapter("aftermath");
    const receipt = await adapter.rememberSafeguard(memory());
    expect(receipt.state).toBe("completed");
    expect(receipt.blobId).toBeTruthy();
    expect(receipt.provenance).toBe("simulated");
  });

  it("recalls the safeguard with its structured record parsed", async () => {
    const adapter = new SimulatedMemoryAdapter("aftermath");
    await adapter.rememberSafeguard(memory());
    const hits = await adapter.recallRelevantLessons(
      "Require authoritative verification before accepting success",
      { limit: 5 },
    );
    const hit = hits.find((h) => h.safeguardMemory);
    expect(hit).toBeDefined();
    expect(hit!.safeguardMemory!.authoritative).toBe(true);
    expect(hit!.provenance).toBe("simulated");
  });

  it("is idempotent: the same safeguard writes under one deterministic id", async () => {
    const adapter = new SimulatedMemoryAdapter("aftermath");
    const a = await adapter.rememberSafeguard(memory());
    const b = await adapter.rememberSafeguard(memory());
    expect(a.writeId).toBe(b.writeId);
  });
});
