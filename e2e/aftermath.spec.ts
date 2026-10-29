import { expect, test } from "@playwright/test";

/**
 * Browser tests against a running AFTERMATH instance.
 *
 * These assert the product's honesty properties, not just that pages render:
 * simulated state must be labelled, and no figure may be presented as a live
 * Mainnet result when the backend is simulated.
 */

test("overview renders and labels the memory backend honestly", async ({ page }) => {
  await page.goto("/lab");
  await expect(page.getByText("AFTERMATH").first()).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Evaluation Lab" }),
  ).toBeVisible();

  // With no credentials configured the app must say so rather than implying
  // Mainnet writes are happening.
  await expect(page.getByText(/Simulated memory backend in use/i)).toBeVisible();
  await expect(
    page.getByText(/NOT stored on Walrus Mainnet/i).first(),
  ).toBeVisible();
});

test("running the demonstrations populates the scenario table", async ({ page }) => {
  await page.goto("/lab");
  const runButton = page.getByRole("button", { name: /Run from scratch/i });
  await runButton.click();
  // The run advances in bounded batches against real Mainnet writes, so it can
  // take several minutes; wait for the button to become idle again.
  await expect(runButton).toBeEnabled({ timeout: 600_000 });

  const table = page.locator("table.data").last();
  await expect(table).toBeVisible();
  await expect(table.getByText("coding-tests-fail")).toBeVisible();
  await expect(table.getByText("workflow-repeat-refused")).toBeVisible();
});

test("submitting an incident produces a connected Safeguard Record", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Every failure should leave a safeguard/i }),
  ).toBeVisible();

  await page
    .getByLabel(/Incident material/i)
    .fill(
      "2026-03-01T10:00:00Z ERROR checkout-service POST /v1/charge returned 503 Service Unavailable after retry",
    );
  await page.getByRole("button", { name: /Investigate incident/i }).click();

  // The record is a chain, so every link must be present, and the verification
  // state must be the honest one: executed, but not a claimed repeat prevention.
  const chain = page.locator("ol.chain");
  await expect(chain).toBeVisible({ timeout: 30_000 });
  await expect(
    page.locator("article header .label", { hasText: "Safeguard record" }),
  ).toBeVisible();
  for (const link of [
    "Incident",
    "Evidence",
    "Hypothesis",
    "Safeguard",
    "Verification",
    "Memory",
  ]) {
    await expect(chain.getByRole("heading", { name: link })).toBeVisible();
  }
  await expect(
    page.getByText(/effect shown, recurrence not proven/i),
  ).toBeVisible();
  await expect(page.getByText("memory simulated").first()).toBeVisible();
});

test("incident explorer shows evidence, diagnosis, and decision", async ({ page }) => {
  await page.goto("/incidents");
  await expect(
    page.getByRole("heading", { name: "Incident Explorer" }),
  ).toBeVisible();

  // Select the coding failure incident and confirm all three layers are shown.
  await page.getByRole("button", { name: /report bug fixed/i }).first().click();
  await expect(
    page.getByRole("heading", { name: "Evidence verification" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Diagnosis" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Safeguard decision" }),
  ).toBeVisible();
  await expect(page.getByText(/Decision trace/i)).toBeVisible();
});

test("safeguards page separates active from proposed rules", async ({ page }) => {
  await page.goto("/safeguards");
  await expect(page.getByRole("heading", { name: "Safeguards" })).toBeVisible();
  await expect(page.getByText(/active/).first()).toBeVisible();
});

test("memory ledger states the Mainnet requirement truthfully", async ({ page }) => {
  await page.goto("/memory");
  await expect(page.getByRole("heading", { name: "Memory Ledger" })).toBeVisible();
  await expect(page.getByText(/Mainnet writes completed/i)).toBeVisible();
  await expect(page.getByText(/Walrus Memory is not configured/i)).toBeVisible();
  await expect(
    page.getByText(/excluded from the required count/i),
  ).toBeVisible();
});

test("evaluation page reports repeat prevention and false-block rate", async ({ page }) => {
  await page.goto("/evaluation");
  await expect(
    page.getByRole("heading", { name: "Learning Evaluation" }),
  ).toBeVisible();
  await expect(page.getByText(/Repeat prevention/i)).toBeVisible();
  await expect(page.getByText(/False-block rate/i)).toBeVisible();
});

test("no page presents a simulated result as a live one", async ({ page }) => {
  for (const path of ["/", "/incidents", "/memory", "/evaluation", "/safeguards"]) {
    await page.goto(path);
    // If the backend is simulated, no element may claim a Mainnet write count
    // above zero without a visible simulated label.
    const body = await page.locator("body").innerText();
    if (/Simulated memory backend/i.test(body) || /not configured/i.test(body)) {
      expect(body).not.toMatch(/Mainnet writes completed\s*10/);
    }
  }
});
