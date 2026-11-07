import { expect, test } from "@playwright/test";
import { ALICE, BOB } from "./env";
import { createRequest, loginAs } from "./helpers";

test("vote and unvote; the count survives a reload", async ({ page }) => {
  await loginAs(page, ALICE);
  const request = await createRequest(page);
  await loginAs(page, BOB);
  await page.goto(`/requests/${request.id}`);

  const notVoted = page.getByRole("button", { name: "Vote for this request (1 vote)" });
  const voted = page.getByRole("button", { name: "Remove your vote (2 votes)" });

  await notVoted.click();
  await expect(voted).toHaveAttribute("aria-pressed", "true");
  // aria-busy clears once the server has confirmed; reloading earlier would cancel the request.
  await expect(voted).toHaveAttribute("aria-busy", "false");
  await page.reload();
  await expect(voted).toBeVisible();

  await voted.click();
  await expect(notVoted).toHaveAttribute("aria-pressed", "false");
  await expect(notVoted).toHaveAttribute("aria-busy", "false");
  await page.reload();
  await expect(notVoted).toBeVisible();
});

test("rapid clicks settle on the last click, in the UI and on the server", async ({ page }) => {
  await loginAs(page, ALICE);
  const request = await createRequest(page);
  await loginAs(page, BOB);
  await page.goto(`/requests/${request.id}`);

  // Vote, unvote, vote in quick succession: the last intent is "voted".
  await page.getByRole("button", { name: "Vote for this request (1 vote)" }).click({ clickCount: 3, delay: 0 });
  const voted = page.getByRole("button", { name: "Remove your vote (2 votes)" });
  await expect(voted).toHaveAttribute("aria-busy", "false");
  await page.reload();
  await expect(voted).toBeVisible();
});

test("logged-out vote button leads to login", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /Log in to vote/ }).first().click();
  await expect(page).toHaveURL(/\/login\?next=/);
});
