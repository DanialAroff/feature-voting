import { expect, test } from "@playwright/test";
import { ALICE } from "./env";
import { loginAs, unique } from "./helpers";

test("browse seeded requests and filter by status while logged out", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Dark mode" })).toBeVisible();
  // Logged-out visitors see counts but are sent to log in to vote.
  await expect(page.getByRole("link", { name: /Log in to vote/ }).first()).toBeVisible();

  await page.getByLabel("Status").selectOption({ label: "Declined" });
  await expect(page).toHaveURL(/status=declined/);
  await expect(page.getByRole("link", { name: "Blockchain-based voting" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Dark mode" })).toHaveCount(0);
});

test("submit a request, land on it with your own vote, then find it by search", async ({ page }) => {
  const title = unique("Offline mode");
  await loginAs(page, ALICE);
  await page.goto("/requests/new");

  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Description").fill("Keep working while the connection drops.");
  await page.getByRole("button", { name: "Submit request" }).click();

  await expect(page).toHaveURL(/\/requests\/\d+$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(title);
  // Authors automatically vote for their own request (D4).
  const vote = page.getByRole("button", { name: "Remove your vote (1 vote)" });
  await expect(vote).toHaveAttribute("aria-pressed", "true");

  await page.goto("/");
  await page.getByRole("searchbox", { name: "Search" }).fill(title);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByText("1 request", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: title })).toBeVisible();
});

test("an invalid request shows field errors and is not submitted", async ({ page }) => {
  await loginAs(page, ALICE);
  await page.goto("/requests/new");

  await page.getByLabel("Title").fill("ab");
  await page.getByLabel("Description").fill("Too short a title.");
  await page.getByRole("button", { name: "Submit request" }).click();

  await expect(page.getByText("Title must be at least 3 characters")).toBeVisible();
  await expect(page.getByLabel("Title")).toHaveAttribute("aria-invalid", "true");
  await expect(page).toHaveURL(/\/requests\/new$/);
});
