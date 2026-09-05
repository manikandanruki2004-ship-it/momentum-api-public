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

test("billing and auth service bindings are reachable", async ({ request }) => {
  const billing = await request.get(`${API}/billing/health`);
  expect(billing.status()).toBe(200);
  expect((await billing.json()).service).toBe("momentum-billing");

  const auth = await request.get(`${API}/auth/health`);
  expect(auth.status()).toBe(200);
  expect((await auth.json()).service).toBe("momentum-auth");
});

test("gateway protected routes reject anonymous calls safely", async ({ request }) => {
  const response = await request.get(`${API}/auth/me`);
  expect(response.status()).toBe(401);
  const body = await response.json();
  expect(body.error?.code).toBe("UNAUTHORIZED");
  expect(body.error?.request_id).toBeTruthy();
});

test("gateway rejects invalid momentum query parameters at the boundary", async ({ request }) => {
  const response = await request.get(`${API}/v1/momentum?min_stars=-1`);
  expect(response.status()).toBe(400);
  const body = await response.json();
  expect(body.error?.code).toBe("INVALID_QUERY");
  expect(body.error?.request_id).toBeTruthy();
});
