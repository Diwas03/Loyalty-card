import "dotenv/config";
import { openDb } from "../src/db.js";
const username = process.argv[2]?.toLowerCase();
if (!username) throw new Error("Usage: npm run staff-disable -- username");
const db = openDb();
try {
  db.exec("BEGIN IMMEDIATE");
  const account = db
    .prepare("SELECT role,enabled FROM staff_accounts WHERE username=?")
    .get(username);
  if (!account) throw new Error("Account not found");
  if (
    account.role === "owner" &&
    account.enabled &&
    Number(
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM staff_accounts WHERE role='owner' AND enabled=1",
        )
        .get()!.n,
    ) <= 1
  )
    throw new Error("Create another owner before disabling the last owner");
  db.prepare("UPDATE staff_accounts SET enabled=0 WHERE username=?").run(
    username,
  );
  db.prepare("DELETE FROM sessions WHERE username=?").run(username);
  db.exec("COMMIT");
  console.log("Account disabled and sessions revoked.");
} catch (e) {
  db.exec("ROLLBACK");
  throw e;
} finally {
  db.close();
}
