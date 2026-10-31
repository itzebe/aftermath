import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";

// The console mounts components that read the Next router; provide a stub so the
// render does not depend on an app-router context.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
  usePathname: () => "/admin",
}));

import AdminPage from "@/app/admin/page";
import { clearAdminToken, getAdminToken } from "@/lib/admin-token";

/** Replace global.fetch and capture the requests the console makes. */
function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });
    return handler(url, init);
  }) as unknown as typeof fetch;
  return calls;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  clearAdminToken();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("admin console credential handling", () => {
  it("shows the password prompt and no operations before sign-in", () => {
    render(<AdminPage />);
    expect(screen.getByLabelText(/administrator token/i)).not.toBeNull();
    expect(screen.getByLabelText(/administrator token/i)).toHaveProperty(
      "type",
      "password",
    );
    // Gated operations are not revealed.
    expect(screen.queryByText(/Signed in as administrator/i)).toBeNull();
    expect(screen.queryByText(/Run the controlled scenarios/i)).toBeNull();
  });

  it("rejects an invalid credential and reveals no operations", async () => {
    mockFetch(() => json(401, { error: "unauthorized" }));
    render(<AdminPage />);

    const input = screen.getByLabelText(/administrator token/i);
    fireEvent.change(input, { target: { value: "wrong-token" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).not.toBeNull();
    });
    expect(screen.getByRole("alert").textContent).toMatch(/not accepted/i);
    expect(screen.queryByText(/Signed in as administrator/i)).toBeNull();
    // A rejected credential is never retained.
    expect(getAdminToken()).toBe("");
  });

  it("reports a fail-closed server as disabled", async () => {
    mockFetch(() => json(503, { error: "admin_disabled" }));
    render(<AdminPage />);

    fireEvent.change(screen.getByLabelText(/administrator token/i), {
      target: { value: "anything" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/disabled/i);
    });
    expect(getAdminToken()).toBe("");
  });

  it("reveals the operations after a valid credential and never persists it", async () => {
    const sessionCalls: string[] = [];
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    mockFetch((url) => {
      sessionCalls.push(url);
      return json(200, { ok: true });
    });

    render(<AdminPage />);
    fireEvent.change(screen.getByLabelText(/administrator token/i), {
      target: { value: "the-real-token" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText(/Signed in as administrator/i)).not.toBeNull();
    });
    expect(sessionCalls).toContain("/api/admin/session");
    // The credential is held in memory only.
    expect(getAdminToken()).toBe("the-real-token");
    // The password field is gone once signed in.
    expect(screen.queryByLabelText(/administrator token/i)).toBeNull();
    // No browser storage was written with the token.
    const wroteStorage = setItem.mock.calls.some((c) => c[0] === "aftermath.adminToken");
    expect(wroteStorage).toBe(false);
  });

  it("discards the credential on sign-out", async () => {
    mockFetch(() => json(200, { ok: true }));
    render(<AdminPage />);

    fireEvent.change(screen.getByLabelText(/administrator token/i), {
      target: { value: "the-real-token" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    await waitFor(() => {
      expect(screen.getByText(/Signed in as administrator/i)).not.toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));
    await waitFor(() => {
      expect(screen.getByLabelText(/administrator token/i)).not.toBeNull();
    });
    expect(getAdminToken()).toBe("");
  });
});
