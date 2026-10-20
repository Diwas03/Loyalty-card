import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { randomBytes, timingSafeEqual } from "node:crypto";
import QRCode from "qrcode";
import { verifyPassword } from "./auth.js";
import { readiness, baseUrl } from "./config.js";
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
        (req.get("origin") && req.get("origin") !== baseUrl()))
    ) {
      res.status(403).json({ error: "Same-origin JSON required" });
      return;
    }
    next();
  });
  const cookie = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: !!process.env.PUBLIC_BASE_URL,
    path: "/",
  };
  const staff: express.RequestHandler = async (req, res, next) => {
    try {
      const token =
        typeof req.cookies.staff === "string" ? req.cookies.staff : "";
      const row = (
        await db.query(
          "SELECT s.username,a.role,a.enabled FROM coffee.sessions s LEFT JOIN coffee.staff_accounts a USING(username) WHERE token_hash=$1 AND expires>$2",
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
    res.json({ username: res.locals.actor, role: res.locals.role }),
  );
  app.post("/api/logout", staff, async (req, res) => {
    await db.query("DELETE FROM coffee.sessions WHERE token_hash=$1", [
      digest(req.cookies.staff),
    ]);
    res.clearCookie("staff", cookie).json({ ok: true });
  });
  app.get("/healthz", async (_req, res) => {
    await db.query("SELECT 1");
    res.json({ status: "ok" });
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
  app.get("/api/shop", async (_req, res) =>
    res.json({
      name: "Demo Coffee Shop",
      stampGoal: await goal(db),
      joinUrl: baseUrl() + "/join.html",
      googleEnabled: readiness().google.enabled,
    }),
  );
  app.get("/shop-qr.png", async (_req, res) =>
    res
      .type("png")
      .send(
        await QRCode.toBuffer(baseUrl() + "/join.html", {
          width: 720,
          margin: 4,
        }),
      ),
  );
  app.get("/api/customer-session", async (req, res) => {
    let token = req.cookies.coffee_customer;
    if (!validJoinToken(token)) {
      token = randomBytes(32).toString("hex");
      res.cookie("coffee_customer", token, {
        ...cookie,
        maxAge: 365 * 24 * 3600000,
      });
    }
    const row = (
      await db.query(
        "SELECT member_id FROM coffee.customer_enrollments WHERE token_hash=$1",
        [digest(token)],
      )
    ).rows[0];
    const m = row ? await readMember(db, row.member_id) : null;
    res.json({ member: m ? publicMember(m) : null });
  });
  app.post("/api/join", async (req, res) => {
    if (!(await allowed(req, "join", 30, 900000))) {
      res.status(429).json({ error: "Too many enrollments. Try again later." });
      return;
    }
    if (
      req.body.accept !== true ||
      !validJoinToken(req.cookies.coffee_customer)
    ) {
      res
        .status(400)
        .json({
          error:
            "Confirm membership and allow cookies; refresh this page to start",
        });
      return;
    }
    try {
      const raw = (
        await db.query("SELECT coffee.enroll_customer($1,$2) AS m", [
          req.body.name,
          digest(req.cookies.coffee_customer),
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
    } catch {
      res.status(400).json({ error: "Use a nickname of 1–80 characters" });
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
          'SELECT m.id,name,stamps,rewards,stamp_goal AS "stampGoal" FROM coffee.members m CROSS JOIN coffee.programme p WHERE position(lower($1) in lower(name))>0 OR m.id=$1 ORDER BY version DESC LIMIT 50',
          [q],
        )
      ).rows,
    );
  });
  app.post("/api/staff/enroll", staff, async (req, res) => {
    try {
      const raw = (
        await db.query("SELECT coffee.enroll_customer($1) AS m", [
          req.body.name,
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
    if (!m) {
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
  app.post("/api/staff/members/:id/:action", staff, async (req, res) => {
    const action = String(req.params.action),
      id = String(req.params.id),
      key = req.get("Idempotency-Key");
    if (
      !["purchase", "redeem"].includes(action) ||
      !key ||
      !/^[a-zA-Z0-9-]{16,100}$/.test(key) ||
      req.body.confirm !== true
    ) {
      res
        .status(400)
        .json({
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
      res
        .status(409)
        .json({
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
    res.json({ stampGoal: await goal(db) }),
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
        await db.query("SELECT coffee.change_goal($1,$2) AS result", [
          req.body.stampGoal,
          res.locals.actor,
        ])
      ).rows[0].result;
      res.json(r);
      background(deliverHosted(db));
    } catch {
      res
        .status(409)
        .json({
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
        "UPDATE coffee.jobs SET status='pending',next_at=0,error=NULL WHERE id=$1 AND status IN ('retry','blocked','waiting-save','failed') RETURNING member_id",
        [req.params.job],
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
      res
        .status(status === 400 || status === 413 ? status : 503)
        .json({
          error:
            status === 400
              ? "Invalid JSON request"
              : "Service unavailable. Check database and server configuration.",
        });
    },
  );
  return app;
}
