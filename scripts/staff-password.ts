import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { randomBytes, scryptSync } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
if (!process.stdin.isTTY)
  throw new Error(
    "Run in an interactive local terminal; never supply your password in chat.",
  );
const hidden = new Writable({
  write(_chunk, _encoding, cb) {
    cb();
  },
});
const rl = createInterface({
  input: process.stdin,
  output: hidden,
  terminal: true,
});
process.stdout.write("New staff password (12+ characters; input hidden): ");
const password = await rl.question("");
process.stdout.write("\n");
rl.close();
if (password.length < 12 || password.length > 200)
  throw new Error("Use 12–200 characters.");
const salt = randomBytes(16).toString("hex");
const hash = salt + ":" + scryptSync(password, salt, 32).toString("hex");
let text = existsSync(".env")
  ? readFileSync(".env", "utf8")
  : readFileSync(".env.example", "utf8");
text = /^STAFF_PASSWORD_HASH=.*$/m.test(text)
  ? text.replace(/^STAFF_PASSWORD_HASH=.*$/m, "STAFF_PASSWORD_HASH=" + hash)
  : text + "\nSTAFF_PASSWORD_HASH=" + hash + "\n";
writeFileSync(".env", text, { mode: 0o600 });
chmodSync(".env", 0o600);
console.log("Updated only STAFF_PASSWORD_HASH in .env. Restart the server.");
