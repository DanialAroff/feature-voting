import { expect, test } from "@playwright/test";
import { ALICE, BOB } from "./env";
import { createRequest, loginAs, unique } from "./helpers";

test("authors edit their own request", async ({ page }) => {
  await loginAs(page, ALICE);
  const request = await createRequest(page);
  await page.goto(`/requests/${request.id}`);

  await page.getByRole("link", { name: "Edit" }).click();
  const title = unique("Renamed");
  await page.getByLabel("Title").fill(title);
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page).toHaveURL(new RegExp(`/requests/${request.id}$`));
  await expect(page.getByRole("heading", { level: 1 })).toContainText(title);
});

test("other users cannot edit someone else's request", async ({ page }) => {
  await loginAs(page, ALICE);
  const request = await createRequest(page);

  await loginAs(page, BOB);
  await page.goto(`/requests/${request.id}`);
  await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);

  await page.goto(`/requests/${request.id}/edit`);
  await expect(page.getByRole("main").getByRole("alert")).toContainText("You can only edit your own requests.");
});
