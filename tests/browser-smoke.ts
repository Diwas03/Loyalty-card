delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { openDb } from "../src/db.js";
import { memDb } from "./helpers.js";
import { setStaff } from "../src/auth.js";
import { createApp } from "../src/app.js";
delete process.env.PUBLIC_BASE_URL;
delete process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
const db = await memDb();
const password = randomBytes(20).toString("hex");
await setStaff(db, "owner", password, "owner");
const server = createApp(db).listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const address = server.address() as { port: number };
const origin = `http://127.0.0.1:${address.port}`;
let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto(origin + "/staff.html");
  await page.locator("#username").fill("owner");
  await page.locator("#password").fill(password);
  await page.locator("#login button").click();
  await page.waitForURL("**/staff.html");
  const customer = await context.newPage();
  await customer.goto(origin + "/join.html");
  await customer.locator("#name").fill("Browser Test Customer");
  await customer.locator("#accept").check();
  await customer.locator("#submit").click();
  await customer.waitForURL(url => url.searchParams.has("member"));
  const link = new URL(customer.url()).pathname + new URL(customer.url()).search;
  await page.locator("#member").fill(new URL(customer.url()).searchParams.get("member")!);
  await page.locator("#lookup button").click();
  await page.waitForFunction(() => document.querySelector("#customer-name")?.textContent === "Browser Test Customer");
  let loseOnce = true;
  await page.route("**/api/staff/members/*/purchase", async (route) => {
    if (loseOnce) {
      loseOnce = false;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await page.locator("#purchase").click();
  await page.waitForFunction(() =>
    document
      .querySelector("#message")
      ?.textContent?.includes("request key is retained"),
  );
  await page.locator("#purchase").click();
  await page.waitForFunction(() =>
    document.querySelector("#balance")?.textContent?.startsWith("1 / 8"),
  );
  const card = await context.newPage();
  await card.setViewportSize({ width: 390, height: 844 });
  await card.goto(origin + link);
  await card.waitForFunction(
    () =>
      document.querySelector("#card-progress")?.textContent === "1 / 8 stamps",
  );
  for (let i = 2; i <= 8; i++) {
    await page.locator("#purchase").click();
    await page.waitForFunction(
      (expected) =>
        document.querySelector("#balance")?.textContent?.startsWith(expected),
      `${i % 8} / 8 stamps`,
    );
  }
  let conflictOnce = true;
  await page.route("**/api/staff/members/*/redeem", async (route) => {
    if (conflictOnce) {
      conflictOnce = false;
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ error: "No reward available" }),
      });
    } else await route.continue();
  });
  await page.locator("#redeem").click();
  await page.waitForFunction(() =>
    document
      .querySelector("#message")
      ?.textContent?.startsWith("Request rejected:"),
  );
  assert.equal(
    await page.evaluate(() => sessionStorage.getItem("coffeePending")),
    null,
  );
  await page.locator("#redeem").click();
  await page.waitForFunction(
    () =>
      document.querySelector("#balance")?.textContent ===
      "0 / 8 stamps · 0 available rewards",
  );
  await page.locator("#goal").fill("10");
  await page.locator("#programme button").click();
  await page.waitForFunction(
    () =>
      document.querySelector("#balance")?.textContent ===
      "0 / 10 stamps · 0 available rewards",
  );
  await card.waitForFunction(
    () =>
      document.querySelector("#card-progress")?.textContent === "0 / 10 stamps",
    {},
    { timeout: 12000 },
  );
  const newcomerContext = await browser.newContext();
  const newcomer = await newcomerContext.newPage();
  await newcomer.goto(origin + "/join.html");
  await newcomer.locator("#name").fill("QR newcomer");
  await newcomer.locator("#accept").check();
  await newcomer.locator("#submit").click();
  await newcomer.waitForURL((u) => u.searchParams.has("member"));
  const joinedURL = newcomer.url();
  await newcomer.goto(origin + "/join.html");
  await newcomer.locator("#submit").click();
  await newcomer.waitForURL(joinedURL);
  assert.equal(newcomer.url(), joinedURL);
  await newcomerContext.close();
  assert.equal(await page.locator("#history .activity").count(), 9);
  assert.ok(
    await card.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    "Mobile card must not overflow horizontally",
  );
  assert.deepEqual(errors, []);
  console.log(
    "Browser smoke passed: sign-in, enrollment, paid coffees, rollover, redemption, owner goal change, live customer refresh, activity history; no browser exceptions.",
  );
} finally {
  await browser?.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.end();
}
