import { expect, test } from "@playwright/test";
import { ADMIN, ALICE, PASSWORD } from "./env";
import { loginAs, unique } from "./helpers";

test("register, log out and log back in", async ({ page }) => {
  const name = unique("Tester");
  const email = `${name.replace(/\W+/g, ".").toLowerCase()}@example.com`;

  await page.goto("/register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Display name").fill(name);
  await page.getByLabel("Password").fill("a-long-password");
  await page.getByRole("button", { name: "Create account" }).click();

  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByText(name)).toBeVisible();

  await nav.getByRole("button", { name: "Log out" }).click();
  await expect(nav.getByRole("link", { name: "Log in" })).toBeVisible();

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("a-long-password");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(nav.getByText(name)).toBeVisible();
});

test("wrong password shows an error and stays logged out", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ALICE);
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Log in" }).click();

  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Log in" })).toBeVisible();
});

test("a protected page sends you to log in, then back", async ({ page }) => {
  await page.goto("/requests/new");
  await expect(page).toHaveURL(/\/login\?next=%2Frequests%2Fnew|\/login\?next=\/requests\/new/);

  await page.getByLabel("Email").fill(ALICE);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/requests\/new$/);
});

test("usage stats are admin-only", async ({ page }) => {
  await loginAs(page, ALICE);
  await page.goto("/admin/stats");
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(/only available to administrators/);
  await expect(page.getByRole("link", { name: "Stats" })).toHaveCount(0);

  await loginAs(page, ADMIN);
  await page.goto("/");
  await page.getByRole("link", { name: "Stats" }).click();
  await expect(page.getByRole("heading", { name: "Totals" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Most-voted requests" })).toBeVisible();
});
