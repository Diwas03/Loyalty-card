import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import QRCode from "qrcode";
import { type DB, type Member, member, transact } from "./db.js";
import { readiness } from "./config.js";
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
});
export function createApp(db: DB) {
  const app = express();
  app.disable("x-powered-by");
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
  // All mutating browser requests require same-origin JSON, including login. Apple callbacks use separate authenticated routes.
  app.use("/api", (req, res, next) => {
    if (
      req.method !== "GET" &&
      (!req.is("application/json") ||
        (req.get("origin") &&
          req.get("origin") !==
            (process.env.PUBLIC_BASE_URL
              ? new URL(process.env.PUBLIC_BASE_URL).origin
              : `http://${req.get("host")}`)))
    ) {
      res.status(403).json({ error: "Same-origin JSON required" });
      return;
    }
    next();
  });
  const staff: express.RequestHandler = (req, res, next) => {
    const s = db
      .prepare("SELECT expires FROM sessions WHERE token=?")
      .get(req.cookies.staff || "");
    if (!s || Number(s.expires) < Date.now()) {
      res.status(401).json({ error: "Staff sign-in required" });
      return;
    }
    next();
  };
  app.post(
    "/api/login",
    rateLimit({ windowMs: 60000, limit: 5 }),
    (req, res) => {
      const hash = process.env.STAFF_PASSWORD_HASH;
      if (!hash) {
        res.status(503).json({
          error: "Staff login disabled: configure STAFF_PASSWORD_HASH",
        });
        return;
      }
      const [salt, expected] = hash.split(":");
      if (
        typeof req.body.password !== "string" ||
        req.body.password.length > 200 ||
        !salt ||
        !expected ||
        !safe(scryptSync(req.body.password, salt, 32).toString("hex"), expected)
      ) {
        res.status(401).json({ error: "Invalid password" });
        return;
      }
      const token = randomBytes(32).toString("hex");
      db.prepare("INSERT INTO sessions VALUES(?,?)").run(
        token,
        Date.now() + 8 * 3600000,
      );
      res.cookie("staff", token, {
        httpOnly: true,
        sameSite: "strict",
        secure: !!process.env.PUBLIC_BASE_URL,
        maxAge: 8 * 3600000,
      });
      res.json({ ok: true });
    },
  );
  app.post("/api/logout", staff, (req, res) => {
    db.prepare("DELETE FROM sessions WHERE token=?").run(req.cookies.staff);
    res.clearCookie("staff");
    res.json({ ok: true });
  });
  app.get("/api/demo", (_req, res) => {
    if (
      process.env.PUBLIC_BASE_URL &&
      process.env.DEMO_PUBLIC_CUSTOMER !== "true"
    ) {
      res.status(404).json({
        error: "Use your private customer link /?member=MEMBERSHIP_ID",
      });
      return;
    }
    res.json(
      publicMember(db.prepare("SELECT * FROM members LIMIT 1").get() as Member),
    );
  });
  app.get("/api/config", (_req, res) => res.json(readiness()));
  app.get("/api/members/:id", (req, res) => {
    const m = member(db, String(req.params.id));
    if (!m) {
      res.status(404).json({ error: "Membership not found" });
      return;
    }
    res.json(publicMember(m));
  });
  app.get("/api/members/:id/qr", async (req, res) => {
    if (!member(db, String(req.params.id))) {
      res.sendStatus(404);
      return;
    }
    res
      .type("png")
      .send(
        await QRCode.toBuffer(String(req.params.id), { width: 320, margin: 3 }),
      );
  });
  app.get("/api/staff/members/:id", staff, (req, res) => {
    const m = member(db, String(req.params.id));
    if (!m) {
      res.status(404).json({ error: "Membership not found" });
      return;
    }
    res.json({
      ...publicMember(m),
      deliveries: db
        .prepare(
          "SELECT provider,version,status,attempts,error,next_at FROM jobs WHERE member_id=? ORDER BY id DESC LIMIT 20",
        )
        .all(m.id),
    });
  });
  app.post("/api/staff/members/:id/:action", staff, (req, res) => {
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
      res.json(transact(db, id, action, key));
    } catch (e) {
      res.status(409).json({ error: (e as Error).message });
    }
  });
  app.get("/wallet/google/:id", async (req, res) => {
    if (!readiness().google.enabled) {
      res
        .status(503)
        .send(
          "Real Google Wallet disabled: missing server credentials. Browser card remains available.",
        );
      return;
    }
    const m = member(db, String(req.params.id));
    if (!m) {
      res.sendStatus(404);
      return;
    }
    try {
      res.set("Cache-Control", "no-store").redirect(await saveGoogle(m));
    } catch {
      res
        .status(502)
        .send(
          "Google Wallet issuance failed. Check issuer approval, test accounts, credentials and network.",
        );
    }
  });
  app.get("/wallet/apple/:id", (req, res) => {
    if (!readiness().apple.enabled) {
      res
        .status(503)
        .send(
          "Real Apple Wallet disabled: missing signing credentials or public HTTPS URL.",
        );
      return;
    }
    const m = member(db, String(req.params.id));
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
  });
  const passAuth: express.RequestHandler = (req, res, next) => {
    const m = member(db, String(req.params.serial));
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
  };
  app.post(
    "/apple/v1/devices/:device/registrations/:type/:serial",
    passAuth,
    (req, res) => {
      const token = req.body.pushToken;
      if (typeof token !== "string" || !/^[a-fA-F0-9]{32,256}$/.test(token)) {
        res.sendStatus(400);
        return;
      }
      const prior = db
        .prepare("SELECT 1 FROM registrations WHERE device=? AND member_id=?")
        .get(String(req.params.device), String(req.params.serial));
      db.prepare(
        "INSERT INTO registrations VALUES(?,?,?) ON CONFLICT(device,member_id) DO UPDATE SET push_token=excluded.push_token",
      ).run(String(req.params.device), String(req.params.serial), token);
      res.sendStatus(prior ? 200 : 201);
    },
  );
  app.delete(
    "/apple/v1/devices/:device/registrations/:type/:serial",
    passAuth,
    (req, res) => {
      db.prepare(
        "DELETE FROM registrations WHERE device=? AND member_id=?",
      ).run(String(req.params.device), String(req.params.serial));
      res.sendStatus(200);
    },
  );
  app.get("/apple/v1/devices/:device/registrations/:type", (req, res) => {
    if (String(req.params.type) !== process.env.APPLE_PASS_TYPE_ID) {
      res.sendStatus(404);
      return;
    }
    const since = req.query.passesUpdatedSince;
    if (since !== undefined && !/^\d+$/.test(String(since))) {
      res.sendStatus(400);
      return;
    }
    const rows = db
      .prepare(
        "SELECT m.id,m.version FROM members m JOIN registrations r ON r.member_id=m.id WHERE r.device=? AND m.version>?",
      )
      .all(String(req.params.device), Number(since || 0));
    if (!rows.length) {
      res.sendStatus(204);
      return;
    }
    res.json({
      serialNumbers: rows.map((r) => r.id),
      lastUpdated: String(Math.max(...rows.map((r) => Number(r.version)))),
    });
  });
  app.get("/apple/v1/passes/:type/:serial", passAuth, (req, res) => {
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
  });
  app.post("/apple/v1/log", (_req, res) => res.sendStatus(200)); // Do not retain potentially sensitive device diagnostics.
  app.get("/staff.html", (req, res, next) => {
    const session = db
      .prepare("SELECT expires FROM sessions WHERE token=?")
      .get(req.cookies.staff || "");
    if (!session || Number(session.expires) < Date.now()) {
      res.redirect("/login.html");
      return;
    }
    next();
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
      console.error(err.message);
      res.status(500).json({ error: "Internal error" });
    },
  );
  return app;
}
