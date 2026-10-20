import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { openDb } from "../src/db.js";
import { setStaff } from "../src/auth.js";

if (!process.stdin.isTTY)
  throw new Error(
    "Run in an interactive terminal. Never share passwords in chat.",
  );

const [username, role = "staff"] = process.argv.slice(2);
if (!username)
  throw new Error("Usage: npm run staff-account -- username [owner|staff]");

const hidden = new Writable({
  write(_c, _e, done) {
    done();
  },
});
const rl = createInterface({
  input: process.stdin,
  output: hidden,
  terminal: true,
});

process.stdout.write("New account password (12–200 characters; hidden): ");
const password = await rl.question("");
rl.close();
process.stdout.write("\n");

const db = openDb();
try {
  await setStaff(db, username, password, role);
  console.log("Staff account saved; old sessions for this account revoked.");
} finally {
  await db.end();
}
