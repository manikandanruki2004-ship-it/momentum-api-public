import { test, expect } from "@playwright/test";

const SITE = "https://therandomhuman-hub.github.io/momentum-api-public/";
const API = "https://momentum-api-public.manikandanruki2004.workers.dev";

test("public demo renders and preview works", async ({ page }) => {
  await page.goto(SITE, { waitUntil: "domcontentloaded" });
  await expect(page).toHaveTitle(/Momentum API/i);
  await expect(page.getByRole("heading", { name: /Find GitHub projects/i })).toBeVisible();
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.locator("tbody tr").first()).toBeVisible();
});

test("billing binding health is reachable", async ({ request }) => {
  const response = await request.get(`${API}/billing/health`);
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.status).toBe("ok");
  expect(body.service).toBe("momentum-billing");
});

test("gateway protected routes reject anonymous calls safely", async ({ request }) => {
  const response = await request.get(`${API}/auth/me`);
  expect(response.status()).toBe(401);
  const body = await response.json();
  expect(body.error?.code).toBe("UNAUTHORIZED");
  expect(body.error?.request_id).toBeTruthy();
});
