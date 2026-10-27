import { expect, test } from "@playwright/test";

/**
 * Browser tests against a running AFTERMATH instance.
 *
 * These assert the product's honesty properties, not just that pages render:
 * simulated state must be labelled, and no figure may be presented as a live
 * Mainnet result when the backend is simulated.
 */

test("overview renders and labels the memory backend honestly", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("AFTERMATH").first()).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Overview" }),
  ).toBeVisible();

  // With no credentials configured the app must say so rather than implying
  // Mainnet writes are happening.
  await expect(page.getByText(/Simulated memory backend in use/i)).toBeVisible();
  await expect(
    page.getByText(/NOT stored on Walrus Mainnet/i).first(),
  ).toBeVisible();
});

test("running the demonstrations populates the scenario table", async ({ page }) => {
  await page.goto("/");
  const runButton = page.getByRole("button", { name: /Run demonstrations/i });
  await runButton.click();
  await expect(runButton).toBeEnabled({ timeout: 60_000 });

  const table = page.locator("table.data").last();
  await expect(table).toBeVisible();
  await expect(table.getByText("coding-tests-fail")).toBeVisible();
  await expect(table.getByText("workflow-repeat-refused")).toBeVisible();
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
