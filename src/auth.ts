import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { DB } from "./db.js";

export function passwordHash(password: string) {
  if (password.length < 12 || password.length > 200)
    throw new Error("Use a password of 12–200 characters");
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(password, salt, 32).toString("hex");
}

export function verifyPassword(password: unknown, hash: string) {
  if (typeof password !== "string" || password.length > 200) return false;
  const [salt, expected] = hash.split(":");
  if (!salt || !expected) return false;
  const actual = scryptSync(password, salt, 32).toString("hex");
  return (
    actual.length === expected.length &&
    timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
  );
}

export async function setStaff(
  db: DB,
  username: string,
  password: string,
  role = "staff",
) {
  if (
    username.toLowerCase() === "legacy" ||
    !/^[a-zA-Z0-9._-]{3,40}$/.test(username) ||
    !["staff", "owner"].includes(role)
  )
    throw new Error("Use a 3–40 character username and staff or owner role");

  await db.query(
    `INSERT INTO staff_accounts (username, password_hash, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (username) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           role = EXCLUDED.role,
           enabled = 1`,
    [username.toLowerCase(), passwordHash(password), role],
  );
  await db.query(
    "DELETE FROM sessions WHERE username = $1 OR username = 'legacy'",
    [username.toLowerCase()],
  );
}
