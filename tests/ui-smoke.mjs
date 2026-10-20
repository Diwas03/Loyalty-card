import express from 'express';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const id = '12345678-1234-1234-1234-123456789abc';
const shop = { id: 'default', name: 'The Daily Grind', color: '#193d32', stampGoal: 8, joinUrl: 'https://example.com/join.html?shop=default' };
const member = { id, name: 'Alex Morgan', shopId: 'default', shopName: shop.name, shopColor: shop.color, stamps: 5, stampGoal: 8, rewards: 1, history: [], deliveries: [], referral: { code: "c".repeat(32), enabled: true, rewardKind: "stamps", rewardAmount: 1, invited: 2, credited: 1 } };
const app = express();
app.use(express.json());
app.get('/api/shop', (_req, res) => res.json(shop));
app.get('/api/customer-session', (_req, res) => res.json({ member: null }));
app.get('/api/members/:id', (_req, res) => res.json(member));
app.get('/api/members/:id/qr', (_req, res) => res.redirect('/logo.png'));
app.get('/shop-qr.png', (_req, res) => res.redirect('/logo.png'));
app.get('/api/staff/me', (_req, res) => res.json({ username: 'alex.owner', role: 'owner', accountsEnabled: true, scanStamping: true, businessDashboard: true, shopId: 'default' }));
app.get('/api/staff/overview', (_req, res) => res.json({ metrics: { customers: 42, active_customers: 18, purchases_24h: 7, available_rewards: 9, referrals: 6, credited_referrals: 4 }, recent: [{ id, name: 'Alex Morgan', kind: 'purchase', created_at: Date.now(), actor: 'alex.owner' }], regulars: [{ ...member, purchases: 12 }], updatedAt: Date.now() }));
app.get('/api/staff/referrals', (_req, res) => res.json({ settings: { referrals_enabled: true, referral_reward_kind: 'stamps', referral_reward_amount: 1 }, referrals: [] }));
app.get('/api/staff/shop' , (_req, res) => res.json(shop));
app.get('/api/staff/programme', (_req, res) => res.json({ stampGoal: 8 }));
app.get('/api/staff/members', (_req, res) => res.json([member, { ...member, id: '87654321-1234-1234-1234-123456789abc', name: 'Jordan Lee', stamps: 2, rewards: 0 }]));
app.get('/api/staff/members/:id', (_req, res) => res.json(member));
app.post('/api/login', async (_req, res) => { await new Promise(resolve => setTimeout(resolve, 250)); res.status(401).json({ error: 'Incorrect username or password.' }); });
app.use(express.static('public'));
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
await mkdir('/tmp/loyalty-ui', { recursive: true });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const [name, path] of Object.entries({ business: '/business/', home: '/', card: `/?member=${id}`, join: '/join.html?shop=default', login: '/business/login.html', register: '/business/register.html', staff: '/business/dashboard.html#customers', poster: '/shop.html?shop=default' })) {
      if (name === 'home') await page.goto(base + '/');
      if (name === "staff") await page.evaluate(() => sessionStorage.setItem("loyalty-staff-handoff", JSON.stringify({ token: "a".repeat(64), createdAt: Date.now() })));
      await page.goto(base + path);
      if (name === 'card') await page.locator('#card-progress').waitFor();
      if (['home','card','join'].includes(name)) assert.equal(await page.locator('nav a[href*="login"]').count(), 0);
      if (name === 'join') await page.waitForFunction(() => !document.querySelector('#submit').disabled);
      if (name === 'staff') await page.locator('#customers .customer-row').first().waitFor();
      if (name === 'staff') {
        for (const tab of ['overview', 'customers', 'scan', 'design', 'referrals', 'team']) {
          await page.locator('#tab-' + tab).click();
          assert.equal(await page.locator('#panel-' + tab).isVisible(), true);
          assert.equal(await page.locator('#tab-' + tab).getAttribute('aria-selected'), 'true');
          await page.screenshot({ path: `/tmp/loyalty-ui/dashboard-${tab}-${width}.png`, fullPage: true });
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${tab}: overflow at ${width}`);
        }
        await page.locator('#tab-customers').focus();
        await page.keyboard.press('ArrowRight');
        assert.equal(await page.locator('#tab-scan').getAttribute('aria-selected'), 'true');
        await page.locator('#tab-customers').click();
      }
      await page.screenshot({ path: `/tmp/loyalty-ui/${name}-${width}.png`, fullPage: true });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}: horizontal overflow at ${width}`);
      assert.equal(await page.locator('main').count(), 1, `${name}: main landmark`);
    }
  }
  await page.goto(base + '/business/login.html');
  await page.locator('#username').fill('alex.owner');
  await page.locator('#password').fill('test-password-only');
  await page.locator('#login button').click();
  await page.getByText('Incorrect username or password.').waitFor();
  assert.equal(await page.locator('#message').getAttribute('data-tone'), 'error');
  assert.equal(await page.locator('#login button').isEnabled(), true);
  await page.evaluate(() => sessionStorage.setItem("loyalty-staff-handoff", JSON.stringify({ token: "a".repeat(64), createdAt: Date.now() })));
  await page.goto(base + '/business/dashboard.html#customers');
  await page.locator('#customers .customer-row').first().click();
  await page.waitForFunction(() => document.querySelector('#customer-name').textContent === 'Alex Morgan');
  assert.equal(await page.locator('#purchase').isEnabled(), true);
  assert.equal(await page.locator('#redeem').isEnabled(), true);
  assert.equal(await page.locator('details.delivery-panel').getAttribute('open'), null);
  assert.deepEqual(errors, []);
  console.log('UI smoke passed: customer/business pages and all six dashboard tabs at 375/768/1440px, no overflow or JS errors, login recovery and customer selection.');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
