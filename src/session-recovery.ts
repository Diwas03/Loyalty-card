import type { Request, Response } from "express";
import { publicBaseUrl } from "./config.js";

// This cookie can only restore a short-lived bearer session. It never authenticates
// a customer endpoint or a staff mutation directly.
export const recoveryCookie = "loyalty_workspace";
const options = () => ({ httpOnly: true, secure: !!publicBaseUrl(), sameSite: "strict" as const, path: "/api/staff/session" });
export function rememberWorkspace(res: Response, token: string) {
  res.cookie(recoveryCookie, token, { ...options(), maxAge: 30 * 60000 });
}
export function forgetWorkspace(res: Response) {
  res.clearCookie(recoveryCookie, options());
}
export function workspaceToken(req: Request): string {
  const token = req.cookies?.[recoveryCookie];
  return typeof token === "string" && /^[a-f0-9]{64}$/.test(token) ? token : "";
}
