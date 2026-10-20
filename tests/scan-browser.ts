import { chromium } from "playwright";
import express from "express";
import assert from "node:assert/strict";
import { memDb } from "./helpers.js";
import { initializeHosted } from "../src/hosted-runtime.js";
import { createHostedApp } from "../src/hosted-app.js";
import { passwordHash } from "../src/auth.js";

delete process.env.PUBLIC_BASE_URL;
delete process.env.VERCEL;
delete process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
const db = await memDb();
await initializeHosted(db);
await db.query("INSERT INTO coffee.staff_accounts VALUES($1,$2,$3,true)", ["scanner", passwordHash("browser-scanner-password"), "staff"]);
const member = (await db.query("SELECT coffee.enroll_customer('Scan customer') AS member")).rows[0].member;
const app = createHostedApp(db);
// Simulate repeated decoded frames, not a physical camera. The real API/database handle the purchase.
app.get("/vendor/zxing/zxing-browser.min.js", (_req, res) => res.type("js").send(`
window.ZXingBrowser={BrowserQRCodeReader:class {
 async decodeFromVideoDevice(id,video,callback){
  const controls={stop(){}};
  window.scanTestFrame=()=>{const result={getText:()=>window.scanTestId};callback(result,null,controls);callback(result,null,controls);};
  return controls;
 }
}};`));
app.use(express.static("public"));
const server = app.listen(0, "127.0.0.1");
await new Promise<void>(resolve => server.once("listening", resolve));
const origin = `http://127.0.0.1:${(server.address() as {port: number}).port}`;
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const page = await browser.newPage();
  let dialogs = 0;
  const errors: string[] = [];
  page.on("dialog", dialog => { dialogs++; void dialog.dismiss(); });
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin + "/login.html");
  await page.locator("#username").fill("scanner");
  await page.locator("#password").fill("browser-scanner-password");
  await page.locator("#login button").click();
  await page.waitForURL("**/staff.html");
  const scan = async () => {
    await page.locator("#scan").click();
    await page.evaluate(id => {
      const test = window as unknown as {scanTestId: string; scanTestFrame: () => void};
      test.scanTestId = id;
      test.scanTestFrame();
    }, member.id);
  };
  await scan();
  await page.waitForFunction(() => document.querySelector("#message")?.textContent?.startsWith("One stamp added"));
  assert.equal(Number((await db.query("SELECT stamps FROM coffee.members WHERE id=$1", [member.id])).rows[0].stamps), 1);
  await scan();
  await page.waitForFunction(() => document.querySelector("#message")?.textContent?.includes("No extra stamp"));
  assert.equal(Number((await db.query("SELECT stamps FROM coffee.members WHERE id=$1", [member.id])).rows[0].stamps), 1);
  await db.query("UPDATE coffee.scan_requests SET created_at=created_at-6000");
  let loseResponse = true;
  await page.route("**/api/staff/members/*/scan", async route => {
    if (loseResponse) { loseResponse = false; await route.fetch(); await route.abort("failed"); }
    else await route.continue();
  });
  await scan();
  await page.waitForFunction(() => document.querySelector("#message")?.textContent?.includes("request key is retained"));
  await page.reload();
  await scan();
  await page.waitForFunction(() => document.querySelector("#message")?.textContent?.startsWith("One stamp added"));
  assert.equal(Number((await db.query("SELECT stamps FROM coffee.members WHERE id=$1", [member.id])).rows[0].stamps), 2);
  assert.equal(await page.evaluate(() => sessionStorage.getItem("coffeePending")), null);
  await page.locator("#logout").click();
  await page.waitForURL("**/login.html");
  await page.goto(origin + "/register.html");
  for (const [name, value] of Object.entries({ shopName: "Browser Roasters", fullName: "Browser Owner", username: "browser-owner", password: "browser-owner-password", confirmPassword: "browser-owner-password" }))
    await page.locator(`[name=${name}]`).fill(value);
  await page.locator("#register button").click();
  await page.waitForURL("**/login.html?*");
  await page.locator("#password").fill("browser-owner-password");
  await page.locator("#login button").click();
  await page.waitForURL("**/staff.html");
  await page.locator("#shop-branding").waitFor({ state: "visible" });
  const me = await (await page.request.get(origin + "/api/staff/me")).json();
  assert.notEqual(me.shopId, "default");
  assert.equal(await page.locator("#shop-qr-link").getAttribute("href"), "/shop.html?shop=" + me.shopId);
  const customer = await browser.newContext();
  const card = await customer.newPage();
  await card.goto(origin + "/join.html?shop=" + me.shopId);
  await card.locator("#name").fill("New shop customer");
  await card.locator("#accept").check();
  await card.locator("#submit").click();
  await card.waitForURL(url => url.searchParams.has("member"));
  await card.waitForFunction(() => document.querySelector("nav a")?.textContent === "Browser Roasters");
  assert.equal(await card.locator("#card-progress").textContent(), "0 / 8 stamps");
  await customer.close();
  assert.equal(dialogs, 0);
  assert.deepEqual(errors, []);
  console.log("Browser flows passed: automatic stamping, repeated frames, rapid rescan protection, lost-response retry, new-shop registration, owner login and shop-specific customer enrollment. No confirmation dialog or browser exceptions.");
} finally {
  await browser?.close();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await db.end();
}
