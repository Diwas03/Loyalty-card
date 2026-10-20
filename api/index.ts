import { waitUntil } from "@vercel/functions";
import { createHostedApp } from "../src/hosted-app.js";
import { hostedPool } from "../src/hosted-db.js";
import { initializeHosted, startupFailure } from "../src/hosted-runtime.js";
import type { Request, Response } from "express";
let ready: Promise<ReturnType<typeof createHostedApp>> | undefined;
async function prepare() {
  const db = hostedPool();
  try {
    await initializeHosted(db);
  } catch (error) {
    await db.end();
    throw error;
  }
  return createHostedApp(db, (p) =>
    waitUntil(p.catch(() => console.error("Background wallet delivery could not finish; durable job remains recoverable"))),
  );
}
export default async function handler(req: Request, res: Response) {
  try {
    ready ??= prepare().catch((error) => { ready = undefined; throw error; });
    const app = await ready;
    return app(req, res);
  } catch (error) {
    const code = (error as { code?: string }).code;
    console.error("Hosted initialization failed", code && /^[A-Z0-9_]{2,40}$/i.test(code) ? code : "configuration");
    res
      .status(503)
      .json({
        error: "Hosted database is not configured. Complete the hosting setup.",
        reason: startupFailure(error),
      });
  }
}
