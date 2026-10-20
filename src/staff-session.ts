import type { Request } from "express";
/** Browser-wide cookies must never authenticate the customer PWA as staff. */
export function staffToken(req: Request): string {
  const match = /^Bearer ([a-f0-9]{64})$/.exec(req.get("Authorization") || "");
  return match?.[1] || "";
}
