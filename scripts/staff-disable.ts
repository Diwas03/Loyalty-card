import "dotenv/config";
import { openDb } from "../src/db.js";

const username = process.argv[2]?.toLowerCase();
if (!username) throw new Error("Usage: npm run staff-disable -- username");

const db = openDb();
try {
  const { rows: accRows } = await db.query(
    "SELECT role, enabled FROM staff_accounts WHERE username = $1",
    [username],
  );
  const account = accRows[0];
  if (!account) throw new Error("Account not found");

  if (account.role === "owner" && account.enabled) {
    const { rows } = await db.query(
      "SELECT COUNT(*) AS n FROM staff_accounts WHERE role = 'owner' AND enabled = 1",
    );
    if (Number(rows[0].n) <= 1)
      throw new Error("Create another owner before disabling the last owner");
  }

  await db.query("UPDATE staff_accounts SET enabled = 0 WHERE username = $1", [
    username,
  ]);
  await db.query("DELETE FROM sessions WHERE username = $1", [username]);
  console.log("Account disabled and sessions revoked.");
} finally {
  await db.end();
}
