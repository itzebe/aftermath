import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// The component renders a Next `Link`; stub it so the render does not depend on
// an app-router context.
vi.mock("next/link", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { PublicInvestigation } from "@/components/public-investigation";

function mockConfig(body: unknown, status = 200) {
  global.fetch = vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  ) as unknown as typeof fetch;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("public investigation workspace", () => {
  it("offers a Sui transaction sample that loads a real Mainnet digest", async () => {
    mockConfig({ publicSubmission: { available: true, reason: "ok" } });
    render(<PublicInvestigation />);

    // The form is revealed once the server reports submission is available.
    const textarea = await screen.findByLabelText(/Incident material/i);

    // The Tatum-backed finance path must be discoverable from the front door,
    // not only by a visitor who already knows to paste a Sui digest.
    const suiButton = screen.getByRole("button", {
      name: /Use a Sui transaction sample/i,
    });
    fireEvent.click(suiButton);

    await waitFor(() => {
      expect((textarea as HTMLTextAreaElement).value).toMatch(
        /[1-9A-HJ-NP-Za-km-z]{43,44}/,
      );
    });
    // The sample must carry a digest the digest extractor will actually pick up.
    expect((textarea as HTMLTextAreaElement).value).toMatch(
      /A9iiTMAxi5BY2uwxu4HnuonfF6A4hhGbaCK8HfTFK26x/,
    );
  });

  it("offers the incident sample alongside the Sui sample", async () => {
    mockConfig({ publicSubmission: { available: true, reason: "ok" } });
    render(<PublicInvestigation />);

    const textarea = (await screen.findByLabelText(
      /Incident material/i,
    )) as HTMLTextAreaElement;

    fireEvent.click(
      screen.getByRole("button", { name: /Use a sample incident/i }),
    );
    await waitFor(() => {
      expect(textarea.value).toMatch(/checkout-service/);
    });
  });

  it("states the honest reason and offers no form when submission is disabled", async () => {
    mockConfig({ publicSubmission: { available: false, reason: "disabled for now" } });
    render(<PublicInvestigation />);

    await screen.findByText(/Public submission is not enabled/i);
    expect(screen.queryByLabelText(/Incident material/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /Use a Sui transaction sample/i })).toBeNull();
  });
});
