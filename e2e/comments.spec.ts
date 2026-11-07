import { expect, test } from "@playwright/test";
import { ADMIN, ALICE, BOB } from "./env";
import { createRequest, loginAs, unique } from "./helpers";

test("users comment and admins post an official response", async ({ page }) => {
  await loginAs(page, ALICE);
  const request = await createRequest(page);

  await loginAs(page, BOB);
  await page.goto(`/requests/${request.id}`);
  const comment = unique("Me too, please");
  await page.getByLabel("Add a comment").fill(comment);
  await page.getByRole("button", { name: "Post comment" }).click();
  await expect(page.getByText("Comment posted.")).toBeVisible();
  await expect(page.getByText(comment)).toBeVisible();
  await expect(page.getByRole("heading", { name: "1 comment" })).toBeVisible();
  // Only admins can post official responses.
  await expect(page.getByLabel("Post as official response")).toHaveCount(0);

  await loginAs(page, ADMIN);
  await page.reload();
  const response = unique("Planned for next quarter.");
  await page.getByLabel("Add a comment").fill(response);
  await page.getByLabel("Post as official response").check();
  await page.getByRole("button", { name: "Post comment" }).click();
  await expect(page.getByText("Official response posted.")).toBeVisible();

  // Pinned above the description, as well as appearing in the thread.
  await expect(page.getByRole("complementary", { name: "Official response" })).toContainText(response);
  await expect(page.getByRole("heading", { name: "2 comments" })).toBeVisible();
});
