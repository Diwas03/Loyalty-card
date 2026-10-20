import { waitUntil } from "@vercel/functions";
import { createHostedApp } from "../src/hosted-app.js";
import { hostedPool } from "../src/hosted-db.js";
import type { Request, Response } from "express";
let app: ReturnType<typeof createHostedApp>;
export default function handler(req: Request, res: Response) {
  try {
    app ??= createHostedApp(hostedPool(), (p) =>
      waitUntil(
        p.catch(() =>
          console.error(
            "Background wallet delivery could not finish; durable job remains recoverable",
          ),
        ),
      ),
    );
    return app(req, res);
  } catch {
    res
      .status(503)
      .json({
        error: "Hosted database is not configured. Complete the hosting setup.",
      });
  }
}
