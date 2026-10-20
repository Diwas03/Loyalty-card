import { join, joinedMember } from "./join.js";
import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";
import { randomBytes, timingSafeEqual } from "node:crypto";
import QRCode from "qrcode";
import {
  type DB,
  type Member,
  member,
  transact,
  enroll,
  setGoal,
} from "./db.js";
import { verifyPassword } from "./auth.js";
import { readiness, baseUrl, publicBaseUrl } from "./config.js";
import { saveGoogle } from "./google.js";
import { applePass } from "./apple.js";

const safe = (a: string, b: string) => {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
const publicMember = (m: Member) => ({
  id: m.id,
  name: m.name,
  stamps: m.stamps,
  rewards: m.rewards,
  version: m.version,
  stampGoal: m.stamp_goal || 8,
});

export function createApp(db: DB) {
  const app = express();
  app.disable("x-powered-by");
  // Set only for a trusted, single reverse-proxy hop (e.g. Render). Never trust arbitrary forwarding chains.
  if (process.env.TRUST_PROXY_HOPS === "1") app.set("trust proxy", 1);
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

  // All mutating browser requests require same-origin JSON, including login.
  app.use("/api", (req, res, next) => {
    if (
      req.method !== "GET" &&
      (!req.is("application/json") ||
        (req.get("origin") &&
          req.get("origin") !==
            (publicBaseUrl() ? publicBaseUrl() : `http://${req.get("host")}`)))
    ) {
      res.status(403).json({ error: "Same-origin JSON required" });
      return;
    }
    if (
      req.method !== "GET" &&
      (!req.body || typeof req.body !== "object" || Array.isArray(req.body))
    ) {
      res.status(400).json({ error: "JSON object required" });
      return;
    }
    next();
  });

  // Staff session middleware
  const staff: express.RequestHandler = async (req, res, next) => {
    try {
      const token =
        typeof req.cookies.staff === "string" ? req.cookies.staff : "";
      const { rows } = await db.query(
        "SELECT * FROM sessions WHERE token = $1",
        [token],
      );
      const s = rows[0];
      if (!s || Number(s.expires) < Date.now()) {
        res.status(401).json({ error: "Staff sign-in required" });
        return;
      }
      if (s.username === "legacy") {
        const { rows: accs } = await db.query(
          "SELECT 1 FROM staff_accounts LIMIT 1",
        );
        if (accs.length) {
          res
            .status(401)
            .json({ error: "Sign in with your named staff account" });
          return;
        }
      }
      let account: { role: string; enabled: number } | undefined;
      if (s.username !== "legacy") {
        const { rows: accRows } = await db.query(
          "SELECT role, enabled FROM staff_accounts WHERE username = $1",
          [String(s.username)],
        );
        account = accRows[0];
      }
      if (s.username !== "legacy" && !account?.enabled) {
        res.status(401).json({ error: "Staff account disabled" });
        return;
      }
      res.locals.actor = String(s.username);
      res.locals.role = s.username === "legacy" ? "owner" : account!.role;
      next();
    } catch (e) {
      next(e);
    }
  };

  app.get("/api/shop", async (_req, res, next) => {
    try {
      let joinUrl: string | null = null;
      try {
        joinUrl = baseUrl() + "/join.html";
      } catch {}
      const { rows } = await db.query("SELECT stamp_goal FROM programme");
      res.json({
        name: "Demo Coffee Shop",
        stampGoal: Number(rows[0].stamp_goal),
        joinUrl,
        googleEnabled: readiness().google.enabled,
      });
    } catch (e) {
      next(e);
    }
  });

  app.get("/shop-qr.png", async (_req, res, next) => {
    try {
      let url: string;
      try {
        url = baseUrl() + "/join.html";
      } catch {
        res
          .status(503)
          .send("Set a real PUBLIC_BASE_URL before printing the shop QR");
        return;
      }
      res
        .type("png")
        .send(await QRCode.toBuffer(url, { width: 720, margin: 4 }));
    } catch (e) {
      next(e);
    }
  });

  app.get("/api/customer-session", async (_req, res, next) => {
    try {
      const req = _req;
      let token = req.cookies.coffee_customer;
      const valid = typeof token === "string" && /^[a-f0-9]{64}$/.test(token);
      if (!valid) {
        token = randomBytes(32).toString("hex");
        res.cookie("coffee_customer", token, {
          httpOnly: true,
          sameSite: "lax",
          secure: !!publicBaseUrl(),
          maxAge: 365 * 24 * 3600000,
          path: "/",
        });
      }
      const m = await joinedMember(db, token);
      res.json({ member: m ? publicMember(m) : null });
    } catch (e) {
      next(e);
    }
  });

  app.post(
    "/api/join",
    rateLimit({ windowMs: 15 * 60000, limit: 30 }),
    async (req, res, next) => {
      try {
        if (req.body.accept !== true) {
          res.status(400).json({
            error: "Please confirm you want to create a loyalty membership",
          });
          return;
        }
        const token = req.cookies.coffee_customer;
        if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) {
          res.status(400).json({ error: "Invalid session token" });
          return;
        }
        const name =
          typeof req.body.name === "string" ? req.body.name.trim() : "";
        const m = await join(db, token, name);
        res.json({
          member: publicMember(m),
          customerUrl: "/?member=" + encodeURIComponent(m.id),
          walletUrl: readiness().google.enabled
            ? "/wallet/google/" + encodeURIComponent(m.id)
            : null,
        });
      } catch (e) {
        res.status(400).json({ error: (e as Error).message });
      }
    },
  );

  app.post(
    "/api/login",
    rateLimit({ windowMs: 60000, limit: 5 }),
    async (req, res, next) => {
      try {
        const username =
          typeof req.body.username === "string"
            ? req.body.username.toLowerCase().trim()
            : "legacy";

        const { rows: accCount } = await db.query(
          "SELECT COUNT(*) AS n FROM staff_accounts",
        );
        const hasAccounts = Number(accCount[0].n) > 0;

        const { rows: accRows } = await db.query(
          "SELECT * FROM staff_accounts WHERE username = $1 AND enabled = 1",
          [username],
        );
        const account = accRows[0];

        const hash =
          account?.password_hash ||
          (!hasAccounts && username === "legacy"
            ? process.env.STAFF_PASSWORD_HASH
            : undefined);

        if (!hash && !hasAccounts && !process.env.STAFF_PASSWORD_HASH) {
          res.status(503).json({
            error:
              "Staff login disabled: configure STAFF_PASSWORD_HASH or run npm run staff-account",
          });
          return;
        }

        if (
          !verifyPassword(
            req.body.password,
            String(
              hash || "00000000000000000000000000000000:" + "0".repeat(64),
            ),
          )
        ) {
          res.status(401).json({ error: "Invalid username or password" });
          return;
        }

        await db.query("DELETE FROM sessions WHERE expires < $1", [Date.now()]);
        const token = randomBytes(32).toString("hex");
        await db.query(
          "INSERT INTO sessions (token, expires, username) VALUES ($1, $2, $3)",
          [token, Date.now() + 8 * 3600000, username],
        );
        res.cookie("staff", token, {
          httpOnly: true,
          sameSite: "strict",
          secure: !!publicBaseUrl(),
          maxAge: 8 * 3600000,
        });
        res.json({ ok: true });
      } catch (e) {
        next(e);
      }
    },
  );

  app.post("/api/logout", staff, async (req, res, next) => {
    try {
      await db.query("DELETE FROM sessions WHERE token = $1", [
        req.cookies.staff,
      ]);
      res.clearCookie("staff");
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  app.get("/api/demo", async (_req, res, next) => {
    try {
      if (
        process.env.PUBLIC_BASE_URL &&
        process.env.DEMO_PUBLIC_CUSTOMER !== "true"
      ) {
        res.status(404).json({
          error: "Use your private customer link /?member=MEMBERSHIP_ID",
        });
        return;
      }
      const { rows } = await db.query("SELECT id FROM members LIMIT 1");
      if (!rows.length) {
        res.status(404).json({ error: "No members" });
        return;
      }
      const m = await member(db, rows[0].id);
      res.json(publicMember(m!));
    } catch (e) {
      next(e);
    }
  });

  app.get("/api/config", async (_req, res, next) => {
    try {
      const { rows } = await db.query("SELECT stamp_goal FROM programme");
      res.json({
        ...readiness(),
        stampGoal: Number(rows[0].stamp_goal),
      });
    } catch (e) {
      next(e);
    }
  });

  app.get("/api/members/:id", async (req, res, next) => {
    try {
      const m = await member(db, String(req.params.id));
      if (!m) {
        res.status(404).json({ error: "Membership not found" });
        return;
      }
      res.json(publicMember(m));
    } catch (e) {
      next(e);
    }
  });

  app.get("/api/members/:id/qr", async (req, res, next) => {
    try {
      const m = await member(db, String(req.params.id));
      if (!m) {
        res.sendStatus(404);
        return;
      }
      res.type("png").send(
        await QRCode.toBuffer(String(req.params.id), {
          width: 320,
          margin: 3,
        }),
      );
    } catch (e) {
      next(e);
    }
  });

  app.get("/api/staff/programme", staff, async (_req, res, next) => {
    try {
      const { rows } = await db.query("SELECT stamp_goal FROM programme");
      res.json({ stampGoal: Number(rows[0].stamp_goal) });
    } catch (e) {
      next(e);
    }
  });

  app.post("/api/staff/programme", staff, async (req, res, next) => {
    try {
      if (res.locals.role !== "owner") {
        res.status(403).json({ error: "Owner access required" });
        return;
      }
      try {
        res.json(await setGoal(db, req.body.stampGoal, res.locals.actor));
      } catch (e) {
        res.status(409).json({ error: (e as Error).message });
      }
    } catch (e) {
      next(e);
    }
  });

  app.get("/healthz", async (_req, res, next) => {
    try {
      await db.query("SELECT 1");
      res.json({ status: "ok" });
    } catch {
      res.status(503).json({ status: "unavailable" });
    }
  });

  app.get("/api/staff/me", staff, (_req, res) =>
    res.json({ username: res.locals.actor, role: res.locals.role }),
  );

  app.get("/api/staff/members", staff, async (req, res, next) => {
    try {
      const q = String(req.query.q || "").slice(0, 80);
      const { rows } = await db.query(
        `SELECT members.id, name, stamps, rewards, stamp_goal AS "stampGoal"
         FROM members JOIN programme ON programme.id=1
         WHERE POSITION(LOWER($1) IN LOWER(name)) > 0 OR members.id = $2
         ORDER BY members.id DESC LIMIT 50`,
        [q, q],
      );
      res.json(rows);
    } catch (e) {
      next(e);
    }
  });

  app.post("/api/staff/enroll", staff, async (req, res, next) => {
    try {
      const m = await enroll(db, req.body.name);
      res.status(201).json(publicMember(m));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.post("/api/staff/jobs/:job/retry", staff, async (req, res, next) => {
    try {
      if (res.locals.role !== "owner") {
        res.status(403).json({ error: "Owner access required" });
        return;
      }
      const { rowCount } = await db.query(
        `UPDATE jobs SET status = 'pending', next_at = 0, error = NULL
         WHERE id = $1 AND status IN ('retry', 'blocked', 'waiting-save', 'failed')`,
        [String(req.params.job)],
      );
      if (!rowCount) {
        res
          .status(409)
          .json({ error: "Job is not retryable or is already running" });
        return;
      }
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  app.get("/api/staff/members/:id", staff, async (req, res, next) => {
    try {
      const m = await member(db, String(req.params.id));
      if (!m) {
        res.status(404).json({ error: "Membership not found" });
        return;
      }
      const { rows: history } = await db.query(
        `SELECT kind, result, actor, created_at
         FROM operations WHERE member_id = $1
         ORDER BY created_at DESC LIMIT 50`,
        [m.id],
      );
      const { rows: deliveries } = await db.query(
        `SELECT id, provider, version, status, attempts, error, next_at
         FROM jobs WHERE member_id = $1
         ORDER BY id DESC LIMIT 20`,
        [m.id],
      );
      res.json({
        ...publicMember(m),
        history: history.map((row) => ({
          ...row,
          result: JSON.parse(String(row.result)),
        })),
        deliveries,
      });
    } catch (e) {
      next(e);
    }
  });

  app.post("/api/staff/members/:id/:action", staff, async (req, res, next) => {
    try {
      const id = String(req.params.id),
        action = String(req.params.action);
      if (!["purchase", "redeem"].includes(action)) {
        res.sendStatus(404);
        return;
      }
      const key = req.get("Idempotency-Key");
      if (
        !key ||
        !/^[a-zA-Z0-9-]{16,100}$/.test(key) ||
        req.body.confirm !== true
      ) {
        res.status(400).json({
          error: "Explicit confirmation and valid Idempotency-Key required",
        });
        return;
      }
      try {
        res.json(await transact(db, id, action, key, res.locals.actor));
      } catch (e) {
        res.status(409).json({ error: (e as Error).message });
      }
    } catch (e) {
      next(e);
    }
  });

  app.use("/wallet", rateLimit({ windowMs: 60000, limit: 15 }));

  app.get("/wallet/google/:id", async (req, res, next) => {
    try {
      if (!readiness().google.enabled) {
        res
          .status(503)
          .send(
            "Real Google Wallet disabled: missing server credentials. Browser card remains available.",
          );
        return;
      }
      const m = await member(db, String(req.params.id));
      if (!m) {
        res.sendStatus(404);
        return;
      }
      try {
        const link = await saveGoogle(m);
        await db.query(
          "INSERT INTO wallet_issuance VALUES ($1, 'google', $2) ON CONFLICT (member_id, provider) DO UPDATE SET created_at = EXCLUDED.created_at",
          [m.id, Date.now()],
        );
        await db.query(
          `UPDATE jobs SET status = 'pending', next_at = 0
           WHERE member_id = $1 AND provider = 'google'
             AND status IN ('waiting-save', 'retry', 'blocked', 'failed')`,
          [m.id],
        );
        res.set("Cache-Control", "no-store").redirect(link);
      } catch {
        res
          .status(502)
          .send(
            "Google Wallet issuance failed. Check issuer approval, test accounts, credentials and network.",
          );
      }
    } catch (e) {
      next(e);
    }
  });

  app.get("/wallet/apple/:id", async (req, res, next) => {
    try {
      if (!readiness().apple.enabled) {
        res
          .status(503)
          .send(
            "Real Apple Wallet disabled: missing signing credentials or public HTTPS URL.",
          );
        return;
      }
      const m = await member(db, String(req.params.id));
      if (!m) {
        res.sendStatus(404);
        return;
      }
      try {
        res
          .set({
            "Content-Type": "application/vnd.apple.pkpass",
            "Content-Disposition": 'attachment; filename="demo-coffee.pkpass"',
            "Cache-Control": "no-store",
          })
          .send(applePass(m));
      } catch {
        res
          .status(502)
          .send(
            "Pass signing failed. Check certificate, private key and WWDR chain.",
          );
      }
    } catch (e) {
      next(e);
    }
  });

  // Apple Wallet callbacks
  const passAuth: express.RequestHandler = async (req, res, next) => {
    try {
      const m = await member(db, String(req.params.serial));
      if (
        String(req.params.type) !== process.env.APPLE_PASS_TYPE_ID ||
        !m ||
        !safe(req.get("authorization") || "", `ApplePass ${m.apple_token}`)
      ) {
        res.sendStatus(401);
        return;
      }
      res.locals.member = m;
      next();
    } catch (e) {
      next(e);
    }
  };

  app.post(
    "/apple/v1/devices/:device/registrations/:type/:serial",
    passAuth,
    async (req, res, next) => {
      try {
        const token = req.body.pushToken;
        if (typeof token !== "string" || !/^[a-fA-F0-9]{32,256}$/.test(token)) {
          res.sendStatus(400);
          return;
        }
        const { rows: prior } = await db.query(
          "SELECT 1 FROM registrations WHERE device = $1 AND member_id = $2",
          [String(req.params.device), String(req.params.serial)],
        );
        await db.query(
          `INSERT INTO registrations VALUES ($1, $2, $3)
           ON CONFLICT (device, member_id) DO UPDATE SET push_token = EXCLUDED.push_token`,
          [String(req.params.device), String(req.params.serial), token],
        );
        res.sendStatus(prior.length ? 200 : 201);
      } catch (e) {
        next(e);
      }
    },
  );

  app.delete(
    "/apple/v1/devices/:device/registrations/:type/:serial",
    passAuth,
    async (req, res, next) => {
      try {
        await db.query(
          "DELETE FROM registrations WHERE device = $1 AND member_id = $2",
          [String(req.params.device), String(req.params.serial)],
        );
        res.sendStatus(200);
      } catch (e) {
        next(e);
      }
    },
  );

  app.get(
    "/apple/v1/devices/:device/registrations/:type",
    async (req, res, next) => {
      try {
        if (String(req.params.type) !== process.env.APPLE_PASS_TYPE_ID) {
          res.sendStatus(404);
          return;
        }
        const since = req.query.passesUpdatedSince;
        if (since !== undefined && !/^\d+$/.test(String(since))) {
          res.sendStatus(400);
          return;
        }
        const { rows } = await db.query(
          `SELECT m.id, m.version FROM members m
           JOIN registrations r ON r.member_id = m.id
           WHERE r.device = $1 AND m.version > $2`,
          [String(req.params.device), Number(since || 0)],
        );
        if (!rows.length) {
          res.sendStatus(204);
          return;
        }
        res.json({
          serialNumbers: rows.map((r) => r.id),
          lastUpdated: String(Math.max(...rows.map((r) => Number(r.version)))),
        });
      } catch (e) {
        next(e);
      }
    },
  );

  app.get(
    "/apple/v1/passes/:type/:serial",
    passAuth,
    async (req, res, next) => {
      try {
        res
          .set({
            "Content-Type": "application/vnd.apple.pkpass",
            "Cache-Control": "no-store",
            "Last-Modified": new Date().toUTCString(),
          })
          .send(applePass(res.locals.member));
      } catch {
        res.sendStatus(503);
      }
    },
  );

  app.post("/apple/v1/log", (_req, res) => res.sendStatus(200));

  app.get("/staff.html", async (req, res, next) => {
    try {
      const token =
        typeof req.cookies.staff === "string" ? req.cookies.staff : "";
      const { rows } = await db.query(
        "SELECT * FROM sessions WHERE token = $1",
        [token],
      );
      const session = rows[0];
      if (!session || Number(session.expires) < Date.now()) {
        res.redirect("/login.html");
        return;
      }
      if (session.username === "legacy") {
        const { rows: accs } = await db.query(
          "SELECT 1 FROM staff_accounts LIMIT 1",
        );
        if (accs.length) {
          res.redirect("/login.html");
          return;
        }
      } else {
        const { rows: accs } = await db.query(
          "SELECT 1 FROM staff_accounts WHERE username = $1 AND enabled = 1",
          [String(session.username)],
        );
        if (!accs.length) {
          res.redirect("/login.html");
          return;
        }
      }
      next();
    } catch (e) {
      next(e);
    }
  });

  app.get("/logo.png", (_req, res) => {
    res
      .set("Cross-Origin-Resource-Policy", "cross-origin")
      .sendFile("logo.png", { root: "public" });
  });

  app.use("/vendor/zxing", express.static("node_modules/@zxing/browser/umd"));
  app.use(express.static("public"));

  app.use(
    (
      err: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const status = (err as Error & { status?: number }).status;
      if (status === 400 || status === 413) {
        res.status(status).json({
          error:
            status === 413 ? "Request body too large" : "Invalid JSON request",
        });
        return;
      }
      console.error("Request failed:", err.name);
      res.status(500).json({ error: "Internal error" });
    },
  );

  return app;
}
