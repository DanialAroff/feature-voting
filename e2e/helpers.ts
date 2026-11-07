import { expect, type Page } from "@playwright/test";
import { PASSWORD } from "./env";

// Unique per call, so parallel tests never collide on titles or emails.
export function unique(prefix: string) {
  return `${prefix} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// Setup shortcuts go through the API (page.request shares the browser's cookies);
// the behaviour under test is always driven through the UI.
export async function loginAs(page: Page, email: string) {
  const res = await page.request.post("/api/auth/login", { data: { email, password: PASSWORD } });
  expect(res.ok()).toBeTruthy();
}

export async function createRequest(page: Page, title = unique("E2E request")) {
  const res = await page.request.post("/api/requests", {
    data: { title, description: `Description for ${title}` },
  });
  expect(res.status()).toBe(201);
  const { request } = (await res.json()) as { request: { id: number; title: string } };
  return request;
}

export function voteButton(page: Page) {
  return page.getByRole("button", { name: /Vote for this request|Remove your vote/ }).first();
}
