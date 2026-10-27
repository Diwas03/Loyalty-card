import { chromium } from "playwright";
import express from "express";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { memDb } from "./helpers.js";
import { initializeHosted } from "../src/hosted-runtime.js";
import { createHostedApp } from "../src/hosted-app.js";

delete process.env.PUBLIC_BASE_URL;
delete process.env.VERCEL;
const db = await memDb();
await initializeHosted(db);
const app = createHostedApp(db);
app.get("/vendor/zxing/zxing-browser.min.js", (_req,res) => res.type("js").send(`window.ZXingBrowser={BrowserQRCodeReader:class {async decodeFromVideoDevice(a,b,callback){window.frame=id=>callback({getText:()=>id},null,{stop(){}});return {stop(){}}}}}`));
app.use(express.static("public"));
const server = app.listen(0,"127.0.0.1");
await new Promise<void>(resolve=>server.once("listening",resolve));
const origin = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
const browser = await chromium.launch({ executablePath:process.env.CHROMIUM_PATH });
mkdirSync("data/upgrade-screenshots",{recursive:true});
try {
  const context = await browser.newContext({ reducedMotion:"reduce" });
  const page = await context.newPage(); const errors:string[]=[];
  page.on("pageerror",error=>errors.push(error.message));
  page.on("dialog",dialog=>dialog.accept());
  const setup = await page.request.post(origin+"/api/setup/owner",{data:{username:"pilot-owner",fullName:"Pilot Owner",shopName:"Thimphu Coffee and a long business name",password:"pilot-test-password"}});
  assert.equal(setup.status(),201);
  await page.goto(origin+"/business/login.html");
  await page.locator("#username").fill("pilot-owner"); await page.locator("#password").fill("pilot-test-password");
  await page.locator("#login button").click(); await page.waitForURL("**/business/dashboard.html*");
  await page.locator("#identity").filter({hasText:"pilot-owner"}).waitFor();
  await page.reload(); await page.locator("#identity").filter({hasText:"pilot-owner"}).waitFor();
  const member=(await db.query("SELECT coffee.enroll_customer('Pilot Customer',NULL,'default') AS m")).rows[0].m;
  await page.locator("#tab-scan").click(); await page.locator("#scan").click();
  await page.evaluate(id=>(window as any).frame(id),member.id);
  await page.locator("#customer-name").filter({hasText:"Pilot Customer"}).waitFor();
  assert.equal((await db.query("SELECT stamps FROM coffee.members WHERE id=$1",[member.id])).rows[0].stamps,0);
  await page.locator("#purchase").click();
  await page.waitForFunction(()=>document.querySelector("#balance")?.textContent?.startsWith("1 / 8"));
  await page.locator("#customer-secondary-actions > summary").click();
  await page.locator("#correction input[name=delta]").fill("-1"); await page.locator("#correction input[name=reason]").fill("Counter correction");
  await page.locator("#correction button").first().click();
  await page.waitForFunction(()=>document.querySelector("#message")?.textContent?.includes("Correction saved"));
  await page.locator("#tab-reports").click(); await page.locator("#report-status").filter({hasText:"Not tracked"}).waitFor();
  for(const width of [320,390,768,1024,1440]) {
    await page.setViewportSize({width,height:900});
    await page.evaluate(()=>scrollTo(0,0));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`overflow at ${width}`);
    await page.screenshot({path:`data/upgrade-screenshots/reports-${width}.png`,fullPage:true});
  }
  await page.locator("#tab-scan").click();
  await page.evaluate(()=>{(window as any).ZXingBrowser.BrowserQRCodeReader=class {async decodeFromVideoDevice(){throw Error("Permission denied")}}});
  await page.locator("#scan").click(); await page.locator("#scan-feedback").filter({hasText:"Camera unavailable"}).waitFor();
  await page.locator("#member").fill(member.id); await page.locator("#lookup button").click();
  await page.locator("#customer-name").filter({hasText:"Pilot Customer"}).waitFor();
  const customerContext=await browser.newContext({viewport:{width:390,height:844}});
  const card=await customerContext.newPage(); card.on("pageerror",error=>errors.push(error.message));
  await card.goto(origin+"/?member="+member.id);
  await card.locator("#card-tools > summary").click();
  await card.locator("#transfer-card").click();
  await card.waitForFunction(()=>Boolean((document.querySelector('input[aria-label="Private single-use transfer link, valid for ten minutes"]') as HTMLInputElement)?.value));
  const transferUrl=await card.getByLabel("Private single-use transfer link, valid for ten minutes").inputValue();
  const restoredContext=await browser.newContext(); const restored=await restoredContext.newPage();
  await restored.goto(transferUrl); await restored.locator("#restore").click();
  await restored.waitForURL(url=>url.searchParams.get("member")===member.id);
  await restored.locator("#reward-history").waitFor();
  const recovered=(await restored.request.get(origin+"/api/customer-session?shop=default"));
  assert.equal((await recovered.json()).member.id,member.id);
  await card.screenshot({path:"data/upgrade-screenshots/customer-390.png",fullPage:true});
  await restored.goto(transferUrl); await restored.locator("#restore").click();
  await restored.locator("#message").filter({hasText:"already used"}).waitFor();
  assert.ok(await restored.locator("#restore").isDisabled());
  await customerContext.close(); await restoredContext.close();
  // Delayed lookup responses must never replace a more recently verified member.
  const second=(await db.query("SELECT coffee.enroll_customer('Second Customer',NULL,'default') AS m")).rows[0].m;
  await page.locator('#tab-scan').click();
  await page.route('**/api/staff/members/'+member.id,async route=>{await new Promise(resolve=>setTimeout(resolve,300));await route.continue();});
  await page.locator('#member').fill(member.id);await page.locator('#lookup button').click();
  assert.ok(await page.locator('#purchase').isDisabled());
  await page.locator('#member').fill(second.id);await page.locator('#lookup button').click();
  await page.locator('#customer-name').filter({hasText:'Second Customer'}).waitFor();
  await page.waitForTimeout(450);assert.equal(await page.locator('#customer-name').innerText(),'Second Customer');
  await page.unroute('**/api/staff/members/'+member.id);
  for(const width of [320,390,768,1024,1440]) { await page.setViewportSize({width,height:900});await page.evaluate(()=>scrollTo(0,0));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:`data/upgrade-screenshots/counter-${width}.png`,fullPage:true}); }
  await page.setViewportSize({width:1440,height:900});

// Design-specific browser regressions, run with disposable fixtures above.
  await page.locator('#tab-design').click();
  await page.locator('#goal').fill('20');
  assert.match(await page.locator('#preview-scope').innerText(),/Saved reward target: 8/);
  await page.locator('#shop-name').fill('S'.repeat(80));
  await page.locator('#card-title').fill('T'.repeat(80));
  await page.locator('#card-tagline').fill('A'.repeat(120));
  await page.route('**/api/staff/shop',async route=>{if(route.request().method()==='POST')await route.fulfill({status:503,json:{error:'Design test unavailable'}});else await route.continue();});
  await page.locator('#save-design').click();
  await page.locator('#design-message').filter({hasText:'Design test unavailable'}).waitFor();
  assert.equal(await page.locator('#shop-name').inputValue(),'S'.repeat(80));
  await page.unroute('**/api/staff/shop');
  for(const width of [320,390,768,1024,1440]) {
    await page.setViewportSize({width,height:900});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`designer overflow ${width}`);
    await page.screenshot({path:`data/upgrade-screenshots/design-${width}.png`,fullPage:true});
  }
  const visual=await context.newPage();
  await visual.goto(origin+'/?member='+member.id);
  await visual.locator('#card-name').waitFor();
  for(const width of [320,390,768,1024,1440])for(const goal of [2,8,20,100]) {
    await visual.setViewportSize({width,height:900});
    await visual.evaluate(({goal,id})=>(window as any).CardUI.render(document.querySelector('#card'),{id,name:'N'.repeat(80),shopName:'S'.repeat(80),cardTitle:'T'.repeat(80),tagline:'A'.repeat(120),stampGoal:goal,stamps:goal-1,rewards:1,shopColor:'#193d32'}),{goal,id:member.id});
    assert.ok(await visual.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`card overflow ${width}/${goal}`);
    assert.equal(await visual.locator('#card .stamp').count(),goal<=12?goal:0);
    assert.ok(await visual.evaluate(()=>{const [a,b]=[...document.querySelector('.card-label')!.children].map(element=>element.getBoundingClientRect());return a.right<=b.left+1;}),'long brand labels must not overlap');
    if(goal>12)assert.equal(await visual.locator('#card progress').getAttribute('max'),String(goal));
    await visual.screenshot({path:`data/upgrade-screenshots/card-${width}-goal-${goal}.png`,fullPage:true});
  }
  await visual.goto(origin+'/');await visual.locator('#add-card').click();
  await visual.waitForFunction(()=>document.activeElement?.id==='add-card-title');
  await visual.evaluate(()=>window.dispatchEvent(new StorageEvent('storage',{key:'loyalty-cards'})));
  assert.equal(await visual.evaluate(()=>document.activeElement?.id),'add-card-title');
  for(let index=0;index<10;index++){await visual.keyboard.press('Tab');assert.ok(await visual.evaluate(()=>document.activeElement===document.body||document.querySelector('#add-card-dialog')!.contains(document.activeElement)),'native modal must keep background controls out of the tab sequence');}
  await visual.keyboard.press('Escape');assert.equal(await visual.evaluate(()=>document.activeElement?.id),'add-card');
  await visual.goto(origin+'/?member='+member.id);await visual.locator('#card-name').waitFor();
  await visual.locator('#card-tools > summary').click();await visual.locator('#share-card').focus();
  await visual.evaluate(()=>window.dispatchEvent(new Event('online')));
  await visual.waitForResponse(response=>response.url().includes('/api/members/'));
  assert.equal(await visual.evaluate(()=>document.activeElement?.id),'share-card');
  await visual.route('**/api/members/*',route=>route.fulfill({status:503,json:{error:'Offline'}}));
  await visual.goto(origin+'/?member=00000000-0000-4000-8000-000000000001');
  await visual.locator('#retry-card').waitFor();assert.equal(await visual.locator('.empty-state:visible').count(),0);
  await visual.unroute('**/api/members/*');
  await visual.goto(origin+'/shop.html');await visual.locator('#message').filter({hasText:'Printing is not ready'}).waitFor();assert.ok(await visual.locator('#print').isDisabled());
  await visual.route('**/api/recover',route=>route.abort('failed'));
  await visual.goto(origin+'/recover.html#synthetic-expired-transfer');assert.equal(new URL(visual.url()).hash,'');
  await visual.locator('#restore').click();await visual.locator('#restore').filter({hasText:'Retry restore'}).waitFor();assert.ok(await visual.locator('#restore').isEnabled());
  await visual.unroute('**/api/recover');await visual.route('**/api/recover',route=>route.fulfill({status:410,json:{error:'Transfer expired'}}));
  await visual.locator('#restore').click();await visual.locator('#message').filter({hasText:'Transfer expired'}).waitFor();assert.ok(await visual.locator('#restore').isDisabled());await visual.unroute('**/api/recover');
  await visual.route('**/api/shop?*',route=>route.fulfill({json:{name:'Synthetic poster readiness fixture',joinUrl:'https://example.test/join.html'}}));
  let releaseQR!:()=>void;const qrGate=new Promise<void>(resolve=>releaseQR=resolve);
  await visual.route('**/shop-qr.png?*',async route=>{await qrGate;await route.fulfill({contentType:'image/png',body:readFileSync('public/icons/icon-192.png')});});
  await visual.goto(origin+'/shop.html',{waitUntil:'domcontentloaded'});assert.ok(await visual.locator('#print').isDisabled());releaseQR();
  await visual.locator('#message').filter({hasText:'Ready to print'}).waitFor();assert.ok(await visual.locator('#print').isEnabled());await visual.unroute('**/api/shop?*');await visual.unroute('**/shop-qr.png?*');

  for(const route of ['/business/','/business/login.html','/business/register.html','/join.html','/recover.html'])for(const width of [390,1440]){await visual.setViewportSize({width,height:900});await visual.goto(origin+route);assert.ok(await visual.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),route+' overflow '+width);await visual.screenshot({path:'data/upgrade-screenshots/public-'+route.replaceAll('/','-').replaceAll('.','-')+'-'+width+'.png',fullPage:true});}
  await visual.close();
  await page.locator('#tab-scan').click();await page.locator('#member').fill(member.id);await page.locator('#lookup button').click();await page.locator('#customer-name').filter({hasText:'Pilot Customer'}).waitFor();
  page.removeAllListeners('dialog');
  page.once('dialog',async dialog=>{assert.match(dialog.message(),/Pilot Customer/);assert.match(dialog.message(),/Thimphu Coffee/);await dialog.dismiss();});
  const beforeCancel=(await db.query('SELECT stamps FROM coffee.members WHERE id=$1',[member.id])).rows[0].stamps;
  await page.locator('#purchase').click();assert.equal((await db.query('SELECT stamps FROM coffee.members WHERE id=$1',[member.id])).rows[0].stamps,beforeCancel);
  page.on('dialog',dialog=>dialog.accept());
  await page.setViewportSize({width:390,height:844});
  await page.locator('#section-toggle').click();await page.locator('#tab-overview').focus();await page.keyboard.press('End');assert.equal(await page.evaluate(()=>document.activeElement?.id),'tab-reports');
  await page.locator('#tab-reports').click();assert.equal(await page.locator('#section-navigation').getAttribute('open'),null);
  await page.setViewportSize({width:1440,height:900});

  await page.emulateMedia({forcedColors:'active'});await page.screenshot({path:'data/upgrade-screenshots/reports-forced-colors.png',fullPage:true});await page.emulateMedia({forcedColors:'none'});
  await page.evaluate(()=>document.documentElement.style.zoom='2');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'200% CSS zoom must reflow report');await page.screenshot({path:'data/upgrade-screenshots/reports-css-zoom-200.png',fullPage:true});await page.evaluate(()=>document.documentElement.style.zoom='');
  await page.locator("#tab-team").click();
  await page.locator("#locations-management > summary").click();
  await page.locator("#location-create input").fill("Paro counter");
  await page.locator("#location-create button").click();
  await page.locator("#message").filter({hasText:"Location created"}).waitFor();
  const newLocation=await page.locator("#workspace-picker option").filter({hasText:"Paro counter"}).getAttribute("value");
  await Promise.all([page.waitForEvent("load"),page.locator("#workspace-picker").selectOption(newLocation!)]);
  await page.waitForFunction(value=>(document.querySelector("#workspace-picker") as HTMLSelectElement)?.value===value,newLocation);
  assert.equal((await db.query("SELECT c.location_id FROM coffee.workspace_context c JOIN coffee.sessions s USING(token_hash) WHERE s.username='pilot-owner' ORDER BY s.expires DESC LIMIT 1")).rows[0].location_id,JSON.parse(newLocation!)[1]);
  await page.locator("#logout").click(); await page.waitForURL("**/business/login.html");
  await page.goto(origin+"/business/dashboard.html"); await page.waitForURL("**/business/login.html");
  assert.deepEqual(errors,[]);
  console.log("Upgrade browser checks passed: refresh/logout, scan identifies without credit, explicit purchase, correction, report, camera-denied lookup, reduced motion, 320/390/768/1024/1440 screenshots, save boundaries, long content/goals 2/8/20/100, dialog/focus and error states.");
} finally { await browser.close(); await new Promise<void>(resolve=>server.close(()=>resolve())); await db.end(); }
