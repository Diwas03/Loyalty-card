import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { hostedPool } from "../src/hosted-db.js";
import { passwordHash } from "../src/auth.js";
const [username, role = "staff"] = process.argv.slice(2);
if (
  !username ||
  username === "legacy" ||
  !/^[a-zA-Z0-9._-]{3,40}$/.test(username) ||
  !["staff", "owner", "disable"].includes(role)
)
  throw Error("Usage: npm run hosted:staff -- username [staff|owner|disable]");
const db = hostedPool();
const client = await db.connect();
try {
  let hash = "";
  if (role !== "disable") {
    if (!process.stdin.isTTY)
      throw Error(
        "Use an interactive terminal. Never send a password in chat.",
      );
    const rl = createInterface({
      input: process.stdin,
      output: new Writable({
        write(_c, _e, cb) {
          cb();
        },
      }),
      terminal: true,
    });
    process.stdout.write("Hosted staff password (hidden): ");
    const p = await rl.question("");
    rl.close();
    process.stdout.write("\n");
    hash = passwordHash(p);
  }
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(7342101)");
  const name = username.toLowerCase();
  const existing = (
    await client.query(
      "SELECT role,enabled FROM coffee.staff_accounts WHERE username=$1",
      [name],
    )
  ).rows[0];
  if (
    existing?.role === "owner" &&
    existing.enabled &&
    role !== "owner" &&
    Number(
      (
        await client.query(
          "SELECT count(*) FROM coffee.staff_accounts WHERE role='owner' AND enabled=true",
        )
      ).rows[0].count,
    ) <= 1
  )
    throw Error("Create another owner first");
  if (role === "disable") {
    if (!existing) throw Error("Account not found");
    await client.query(
      "UPDATE coffee.staff_accounts SET enabled=false WHERE username=$1",
      [name],
    );
  } else
    await client.query(
      "INSERT INTO coffee.staff_accounts VALUES($1,$2,$3,true) ON CONFLICT(username) DO UPDATE SET password_hash=excluded.password_hash,role=excluded.role,enabled=true",
      [name, hash, role],
    );
  await client.query(
    "DELETE FROM coffee.sessions WHERE username=$1 OR username='legacy'",
    [name],
  );
  await client.query("COMMIT");
  console.log("Hosted staff updated; sessions revoked.");
} catch (e) {
  await client.query("ROLLBACK");
  throw e;
} finally {
  client.release();
  await db.end();
}
