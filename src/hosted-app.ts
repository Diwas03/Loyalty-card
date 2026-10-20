import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { randomBytes, timingSafeEqual } from "node:crypto";
import QRCode from "qrcode";
import { verifyPassword, passwordHash } from "./auth.js";
import { readiness, baseUrl, publicBaseUrl } from "./config.js";
import { saveGoogle } from "./google.js";
import { validJoinToken } from "./customer-token.js";
import {
  type HostedDB,
  digest,
  goal,
  readMember,
  publicMember,
  deliverHosted,
} from "./hosted-db.js";
export function createHostedApp(
  db: HostedDB,
  background: (p: Promise<unknown>) => void = () => {},
) {
  const app = express();
  app.disable("x-powered-by");
  if (process.env.VERCEL === "1") app.set("trust proxy", 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          "script-src": ["'self'"],
          "upgrade-insecure-requests": null,
        },
      },
    }),
  );
  app.use(express.json({ limit: "32kb" }));
  app.use(cookieParser());
  app.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use("/api", (req, res, next) => {
    if (req.path.startsWith("/cron/")) {
      next();
      return;
    }
    if (
      req.method !== "GET" &&
      (!req.is("application/json") ||
        !req.body ||
        Array.isArray(req.body) ||
        (req.get("origin") && req.get("origin") !==
          (publicBaseUrl() || (!process.env.VERCEL ? `http://${req.get("host")}` : undefined))))
    ) {
      res.status(403).json({ error: "Same-origin JSON required" });
      return;
    }
    next();
  });
  const cookie = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: !!publicBaseUrl(),
    path: "/",
  };
  const staff: express.RequestHandler = async (req, res, next) => {
    try {
      const token =
        typeof req.cookies.staff === "string" ? req.cookies.staff : "";
      const row = (
        await db.query(
          "SELECT s.username,a.role,a.enabled,coalesce(p.shop_id,'default') AS shop_id FROM coffee.sessions s LEFT JOIN coffee.staff_accounts a USING(username) LEFT JOIN coffee.staff_profiles p ON p.username=s.username WHERE token_hash=$1 AND expires>$2",
          [digest(token), Date.now()],
        )
      ).rows[0];
      if (
        !row ||
        (row.username !== "legacy" && !row.enabled) ||
        (row.username === "legacy" &&
          (await db.query("SELECT 1 FROM coffee.staff_accounts LIMIT 1"))
            .rowCount)
      ) {
        res.status(401).json({ error: "Staff sign-in required" });
        return;
      }
      res.locals.actor = row.username;
      res.locals.shopId = row.shop_id;
      res.locals.role = row.username === "legacy" ? "owner" : row.role;
      next();
    } catch (e) {
      next(e);
    }
  };
  async function allowed(
    req: express.Request,
    key: string,
    limit: number,
    window: number,
  ) {
    return (
      await db.query("SELECT coffee.allow_request($1,$2,$3) AS ok", [
        key + ":" + digest(req.ip || req.socket.remoteAddress || "unknown"),
        limit,
        window,
      ])
    ).rows[0].ok;
  }
  async function register(req: express.Request, res: express.Response, first: boolean) {
    const username = typeof req.body.username === "string" ? req.body.username.trim().toLowerCase() : "";
    const fullName = typeof req.body.fullName === "string" ? req.body.fullName.trim() : "";
    if (username === "legacy" || !/^[a-z0-9._-]{3,40}$/.test(username) || !fullName || fullName.length > 80 ||
        typeof req.body.password !== "string" || req.body.password.length < 12 || req.body.password.length > 200) {
      res.status(400).json({ error: "Enter a name, a 3–40 character username, and a password of 12–200 characters." });
      return;
    }
    try {
      const shopName = typeof req.body.shopName === "string" ? req.body.shopName.trim() : "My Coffee Shop";
      if (first && (!shopName || shopName.length > 80)) {
        res.status(400).json({ error: "Enter a shop name of 1–80 characters." });
        return;
      }
      const result = first
        ? await db.query("SELECT coffee.register_shop($1,$2,$3,$4) AS account", [username, passwordHash(req.body.password), fullName, shopName])
        : await db.query("SELECT coffee.register_shop_staff($1,$2,$3,$4) AS account", [username, passwordHash(req.body.password), fullName, res.locals.shopId]);
      res.status(201).json(result.rows[0].account);
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        res.status(409).json({ error: "That username is already in use. Choose another or sign in." });
        return;
      }
      throw error;
    }
  }
  app.post("/api/setup/owner", async (req, res) => {
    if (!(await allowed(req, "owner-setup", 5, 60000))) {
      res.status(429).json({ error: "Too many attempts. Try again in one minute." });
      return;
    }
    await register(req, res, true);
  });
  app.post("/api/staff/accounts", staff, async (req, res) => {
    if (res.locals.role !== "owner") {
      res.status(403).json({ error: "Owner access required" });
      return;
    }
    if (!(await allowed(req, "create-staff", 20, 60000))) {
      res.status(429).json({ error: "Too many accounts created. Try again in one minute." });
      return;
    }
    await register(req, res, false);
  });
  app.post("/api/login", async (req, res) => {
    if (!(await allowed(req, "login", 5, 60000))) {
      res
        .status(429)
        .json({ error: "Too many attempts. Try again in one minute." });
      return;
    }
    const username =
      typeof req.body.username === "string"
        ? req.body.username.trim().toLowerCase()
        : "legacy";
    const account = (
      await db.query(
        "SELECT * FROM coffee.staff_accounts WHERE username=$1 AND enabled=true",
        [username],
      )
    ).rows[0];
    const named = !!(
      await db.query("SELECT 1 FROM coffee.staff_accounts LIMIT 1")
    ).rowCount;
    const hash =
      account?.password_hash ||
      (!named && username === "legacy"
        ? process.env.STAFF_PASSWORD_HASH
        : undefined);
    if (!named && (!hash || !/^[^:]+:[a-f0-9]{64}$/i.test(hash))) {
      res.status(503).json({
        error:
          "Staff sign-in has not been set up. Contact the shop owner.",
      });
      return;
    }
    if (
      !verifyPassword(
        req.body.password,
        hash || "0000000000000000:" + "0".repeat(64),
      )
    ) {
      res.status(401).json({ error: "Invalid username or password" });
      return;
    }
    const token = randomBytes(32).toString("hex");
    await db.query("INSERT INTO coffee.sessions VALUES($1,$2,$3)", [
      digest(token),
      username,
      Date.now() + 8 * 3600000,
    ]);
    res.cookie("staff", token, {
      ...cookie,
      sameSite: "strict",
      maxAge: 8 * 3600000,
    });
    res.json({ ok: true });
  });
  app.get("/api/staff/me", staff, (_req, res) =>
    res.json({ username: res.locals.actor, role: res.locals.role, accountsEnabled: true, scanStamping: true, shopId: res.locals.shopId }),
  );
  app.post("/api/logout", staff, async (req, res) => {
    await db.query("DELETE FROM coffee.sessions WHERE token_hash=$1", [
      digest(req.cookies.staff),
    ]);
    res.clearCookie("staff", cookie).json({ ok: true });
  });
  app.get("/healthz", async (_req, res) => {
    await db.query("SELECT stamp_goal FROM coffee.programme WHERE id=1");
    res.json({ status: "ok", schema: "coffee" });
  });
  app.get("/api/config", async (_req, res) =>
    res.json({
      ...readiness(),
      apple: {
        enabled: false,
        missing: ["Hosted mode supports Google Wallet and browser cards"],
      },
      stampGoal: await goal(db),
    }),
  );
  app.get("/api/demo", (_req, res) =>
    res
      .status(404)
      .json({ error: "Open /join.html or your private membership link" }),
  );
  const shopId = (value: unknown) => typeof value === "string" && value ? value : "default";
  const shopToken = (token: string, shop: string) => digest(shop === "default" ? token : token + ":" + shop);
  async function shopInfo(id: string) {
    return (await db.query("SELECT id,name,color,stamp_goal FROM coffee.shops WHERE id=$1", [id])).rows[0];
  }
  app.get("/api/shop", async (req, res) => {
    const shop = await shopInfo(shopId(req.query.shop));
    if (!shop) { res.status(404).json({ error: "Shop not found" }); return; }
    res.json({ id: shop.id, name: shop.name, color: shop.color, stampGoal: shop.stamp_goal,
      joinUrl: publicBaseUrl() ? baseUrl() + "/join.html?shop=" + encodeURIComponent(shop.id) : null, googleEnabled: readiness().google.enabled });
  });
  app.get("/shop-qr.png", async (req, res) => {
    const shop = await shopInfo(shopId(req.query.shop));
    if (!shop) { res.sendStatus(404); return; }
    res.type("png").send(await QRCode.toBuffer(baseUrl() + "/join.html?shop=" + encodeURIComponent(shop.id), { width: 720, margin: 4 }));
  });
  app.get("/api/staff/shop", staff, async (_req, res) => res.json(await shopInfo(res.locals.shopId)));
  app.post("/api/staff/shop", staff, async (req, res) => {
    if (res.locals.role !== "owner") { res.status(403).json({ error: "Owner access required" }); return; }
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    if (!name || name.length > 80 || typeof req.body.color !== "string" || !/^#[a-fA-F0-9]{6}$/.test(req.body.color)) {
      res.status(400).json({ error: "Enter a shop name and a valid color." }); return;
    }
    await db.query("UPDATE coffee.shops SET name=$1,color=$2 WHERE id=$3", [name, req.body.color, res.locals.shopId]);
    res.json(await shopInfo(res.locals.shopId));
  });
  app.get("/api/customer-session", async (req, res) => {
    let token = req.cookies.coffee_customer;
    if (!validJoinToken(token)) {
      token = randomBytes(32).toString("hex");
      res.cookie("coffee_customer", token, {
        ...cookie,
        maxAge: 365 * 24 * 3600000,
      });
    }
    const shop = shopId(req.query.shop);
    await db.query(
      "UPDATE coffee.customer_enrollments e SET token_hash=$1 FROM coffee.members m WHERE e.member_id=m.id AND m.shop_id=$3 AND e.token_hash=$2",
      [shopToken(token, shop), token, shop],
    );
    const row = (
      await db.query(
        "SELECT e.member_id FROM coffee.customer_enrollments e JOIN coffee.members m ON m.id=e.member_id WHERE m.shop_id=$3 AND (e.token_hash=$1 OR e.token_hash=$2) ORDER BY CASE WHEN e.token_hash=$1 THEN 0 ELSE 1 END LIMIT 1",
        [shopToken(token, shop), token, shop],
      )
    ).rows[0];
    const m = row ? await readMember(db, row.member_id) : null;
    res.json({ member: m ? publicMember(m) : null });
  });
  app.post("/api/join", async (req, res, next) => {
    if (!(await allowed(req, "join", 30, 900000))) {
      res.status(429).json({ error: "Too many enrollments. Try again later." });
      return;
    }
    if (
      req.body.accept !== true ||
      !validJoinToken(req.cookies.coffee_customer)
    ) {
      res.status(400).json({
        error:
          "Confirm membership and allow cookies; refresh this page to start",
      });
      return;
    }
    if (typeof req.body.name !== "string" || !req.body.name.trim() || req.body.name.trim().length > 80) {
      res.status(400).json({ error: "Use a nickname of 1–80 characters" });
      return;
    }
    try {
      const shop = shopId(req.body.shopId);
      if (!(await shopInfo(shop))) { res.status(404).json({ error: "Shop not found" }); return; }
      await db.query(
        "UPDATE coffee.customer_enrollments e SET token_hash=$1 FROM coffee.members m WHERE e.member_id=m.id AND m.shop_id=$3 AND e.token_hash=$2",
        [shopToken(req.cookies.coffee_customer, shop), req.cookies.coffee_customer, shop],
      );
      const raw = (
        await db.query("SELECT coffee.enroll_customer($1,$2,$3) AS m", [
          req.body.name,
          shopToken(req.cookies.coffee_customer, shop),
          shop,
        ])
      ).rows[0].m;
      const m = await readMember(db, raw.id);
      res.json({
        member: publicMember(m),
        customerUrl: "/?member=" + encodeURIComponent(m.id),
        walletUrl: readiness().google.enabled
          ? "/wallet/google/" + encodeURIComponent(m.id)
          : null,
      });
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/members/:id", async (req, res) => {
    const m = await readMember(db, String(req.params.id));
    if (!m) {
      res.status(404).json({ error: "Membership not found" });
      return;
    }
    res.json(publicMember(m));
  });
  app.get("/api/members/:id/qr", async (req, res) => {
    if (!(await readMember(db, String(req.params.id)))) {
      res.sendStatus(404);
      return;
    }
    res
      .type("png")
      .send(
        await QRCode.toBuffer(String(req.params.id), { width: 320, margin: 3 }),
      );
  });
  app.get("/api/staff/members", staff, async (req, res) => {
    const q = String(req.query.q || "").slice(0, 80);
    res.json(
      (
        await db.query(
          'SELECT m.id,m.name,stamps,rewards,stamp_goal AS "stampGoal" FROM coffee.members m JOIN coffee.shops p ON p.id=m.shop_id WHERE m.shop_id=$2 AND (position(lower($1) in lower(m.name))>0 OR m.id=$1) ORDER BY version DESC LIMIT 50',
          [q, res.locals.shopId],
        )
      ).rows,
    );
  });
  app.post("/api/staff/enroll", staff, async (req, res) => {
    try {
      const raw = (
        await db.query("SELECT coffee.enroll_customer($1,NULL,$2) AS m", [
          req.body.name,
          res.locals.shopId,
        ])
      ).rows[0].m;
      res.status(201).json(publicMember(await readMember(db, raw.id)));
    } catch {
      res.status(400).json({ error: "Use a nickname of 1–80 characters" });
    }
  });
  app.get("/api/staff/members/:id", staff, async (req, res) => {
    const id = String(req.params.id),
      m = await readMember(db, id);
    if (!m || m.shop_id !== res.locals.shopId) {
      res.status(404).json({ error: "Membership not found" });
      return;
    }
    const [history, deliveries] = await Promise.all([
      db.query(
        "SELECT kind,result,actor,created_at FROM coffee.operations WHERE member_id=$1 ORDER BY created_at DESC,key LIMIT 50",
        [id],
      ),
      db.query(
        "SELECT id,provider,version,status,attempts,next_at,error FROM coffee.jobs WHERE member_id=$1 ORDER BY id DESC LIMIT 20",
        [id],
      ),
    ]);
    res.json({
      ...publicMember(m),
      history: history.rows,
      deliveries: deliveries.rows,
    });
  });
  app.post("/api/staff/members/:id/scan", staff, async (req, res, next) => {
    const id = String(req.params.id), key = req.get("Idempotency-Key");
    const member = await readMember(db, id);
    if (!member || member.shop_id !== res.locals.shopId) { res.status(404).json({ error: "Membership not found" }); return; }
    if (!key || !/^[a-zA-Z0-9-]{16,100}$/.test(key)) {
      res.status(400).json({ error: "A valid scan request key is required" });
      return;
    }
    if (!(await allowed(req, "scan", 60, 60000))) {
      res.status(429).json({ error: "Too many scans. Please wait a minute and retry." });
      return;
    }
    try {
      const result = (await db.query("SELECT coffee.scan_purchase($1,$2,$3) AS result", [id, key, res.locals.actor])).rows[0].result;
      res.json(result);
      if (result.awarded) background(deliverHosted(db, id));
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (["Membership not found", "Idempotency key already used for another action"].includes(message)) {
        res.status(message === "Membership not found" ? 404 : 409).json({ error: message });
      } else next(error);
    }
  });
  app.post("/api/staff/members/:id/:action", staff, async (req, res) => {
    const action = String(req.params.action),
      id = String(req.params.id),
      key = req.get("Idempotency-Key");
    const member = await readMember(db, id);
    if (!member || member.shop_id !== res.locals.shopId) { res.status(404).json({ error: "Membership not found" }); return; }
    if (
      !["purchase", "redeem"].includes(action) ||
      !key ||
      !/^[a-zA-Z0-9-]{16,100}$/.test(key) ||
      req.body.confirm !== true
    ) {
      res.status(400).json({
        error:
          "Valid action, explicit confirmation and Idempotency-Key required",
      });
      return;
    }
    try {
      const result = (
        await db.query("SELECT coffee.mutate_member($1,$2,$3,$4) AS result", [
          id,
          action,
          key,
          res.locals.actor,
        ])
      ).rows[0].result;
      res.json(result);
      background(deliverHosted(db, id));
    } catch (e) {
      const reason = e instanceof Error ? e.message : "";
      res.status(409).json({
        error: [
          "No reward available",
          "Membership not found",
          "Idempotency key already used for another action",
        ].includes(reason)
          ? reason
          : "Could not record action; retry with the same request key",
      });
    }
  });
  app.get("/api/staff/programme", staff, async (_req, res) =>
    res.json({ stampGoal: await goal(db, res.locals.shopId) }),
  );
  app.post("/api/staff/programme", staff, async (req, res) => {
    if (res.locals.role !== "owner") {
      res.status(403).json({ error: "Owner access required" });
      return;
    }
    if (
      !Number.isInteger(req.body.stampGoal) ||
      req.body.stampGoal < 2 ||
      req.body.stampGoal > 100
    ) {
      res
        .status(400)
        .json({ error: "Choose a whole number between 2 and 100" });
      return;
    }
    try {
      const r = (
        await db.query("SELECT coffee.change_shop_goal($1,$2,$3) AS result", [
          res.locals.shopId,
          req.body.stampGoal,
          res.locals.actor,
        ])
      ).rows[0].result;
      res.json(r);
      background(deliverHosted(db));
    } catch {
      res.status(409).json({
        error: "Could not change goal; check current customer progress",
      });
    }
  });
  app.post("/api/staff/jobs/:job/retry", staff, async (req, res) => {
    if (res.locals.role !== "owner") {
      res.status(403).json({ error: "Owner access required" });
      return;
    }
    const j = (
      await db.query(
        "UPDATE coffee.jobs SET status='pending',next_at=0,error=NULL WHERE id=$1 AND member_id IN (SELECT id FROM coffee.members WHERE shop_id=$2) AND status IN ('retry','blocked','waiting-save','failed') RETURNING member_id",
        [req.params.job, res.locals.shopId],
      )
    ).rows[0];
    if (!j) {
      res.status(409).json({ error: "Job not retryable" });
      return;
    }
    res.json({ ok: true });
    background(deliverHosted(db, j.member_id));
  });
  app.get("/wallet/google/:id", async (req, res) => {
    if (!readiness().google.enabled) {
      res
        .status(503)
        .send("Google Wallet is not configured. Use your browser card.");
      return;
    }
    if (!(await allowed(req, "wallet", 15, 60000))) {
      res.status(429).send("Try again shortly");
      return;
    }
    const m = await readMember(db, String(req.params.id));
    if (!m) {
      res.sendStatus(404);
      return;
    }
    try {
      const link = await saveGoogle(m);
      await db.query(
        "INSERT INTO coffee.wallet_issuance VALUES($1,$2) ON CONFLICT(member_id) DO UPDATE SET created_at=excluded.created_at",
        [m.id, Date.now()],
      );
      await db.query(
        "UPDATE coffee.jobs SET status='pending',next_at=0 WHERE member_id=$1 AND status IN ('waiting-save','blocked','retry','failed')",
        [m.id],
      );
      res.redirect(link);
      background(deliverHosted(db, m.id));
    } catch {
      res
        .status(502)
        .send(
          "Google Wallet issuance failed. Check issuer access, credentials and test accounts.",
        );
    }
  });
  app.get("/wallet/apple/:id", (_req, res) =>
    res
      .status(503)
      .send(
        "Hosted mode uses Google Wallet and browser cards; Apple Wallet is not enabled.",
      ),
  );
  app.all("/api/cron/wallet-updates", async (req, res) => {
    const expected = process.env.CRON_SECRET,
      actual = req.get("authorization") || "";
    const target = "Bearer " + expected;
    if (
      !expected ||
      actual.length !== target.length ||
      !timingSafeEqual(Buffer.from(actual), Buffer.from(target))
    ) {
      res.sendStatus(401);
      return;
    }
    const results = await Promise.all([
      deliverHosted(db),
      deliverHosted(db),
      deliverHosted(db),
    ]);
    res.json({ claimed: results.filter(Boolean).length });
  });
  app.use(
    (
      err: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const status = (err as Error & { status?: number }).status;
      res.status(status === 400 || status === 413 ? status : 503).json({
        error:
          status === 400
            ? "Invalid JSON request"
            : "Service unavailable. Check database and server configuration.",
      });
    },
  );
  return app;
}
