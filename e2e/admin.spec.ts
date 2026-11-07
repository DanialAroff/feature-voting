import { expect, test } from "@playwright/test";
import { ADMIN, ALICE, BOB } from "./env";
import { createRequest, loginAs, unique } from "./helpers";

test("admin moves a request along; the badge and timeline follow", async ({ page }) => {
  await loginAs(page, ALICE);
  const request = await createRequest(page);
  await page.goto(`/requests/${request.id}`);
  // Hidden for non-admins (the API enforces it regardless).
  await expect(page.getByRole("button", { name: "Update status" })).toHaveCount(0);

  await loginAs(page, ADMIN);
  await page.reload();
  await page.getByLabel("Status (admin)").selectOption({ label: "Planned" });
  await page.getByRole("button", { name: "Update status" }).click();
  await expect(page.getByText("Status set to Planned.")).toBeVisible();

  const progress = page.getByRole("region", { name: "Progress" });
  await expect(progress).toContainText("Under Review → Planned");
  await page.reload();
  await expect(progress).toContainText("Under Review → Planned");
  await expect(page.getByLabel("Status (admin)")).toHaveValue("planned");
});

test("admin merges a duplicate; votes combine and the old link redirects", async ({ page }) => {
  await loginAs(page, ALICE);
  const duplicate = await createRequest(page, unique("Duplicate"));
  const keep = await createRequest(page, unique("Original"));

  // Bob votes only on the duplicate; Alice (author) voted on both.
  await loginAs(page, BOB);
  expect((await page.request.put(`/api/requests/${duplicate.id}/vote`)).ok()).toBeTruthy();

  await loginAs(page, ADMIN);
  await page.goto(`/requests/${duplicate.id}`);
  await page.getByLabel("Request number to keep").fill(String(keep.id));
  await page.getByRole("button", { name: "Preview" }).click();
  await page.getByRole("button", { name: `Confirm merge into #${keep.id}` }).click();

  await expect(page).toHaveURL(new RegExp(`/requests/${keep.id}\\?mergedFrom=${duplicate.id}$`));
  await expect(page.getByRole("status")).toContainText(`#${duplicate.id}`);
  // Alice's two votes collapse into one, Bob's moves over: 2 distinct voters.
  await expect(page.getByRole("button", { name: "Vote for this request (2 votes)" })).toBeVisible();

  await page.goto(`/requests/${duplicate.id}`);
  await expect(page).toHaveURL(new RegExp(`/requests/${keep.id}\\?mergedFrom=${duplicate.id}$`));
});
