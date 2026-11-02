import { requireLocalOperator } from "./environment-safety.js";
import "dotenv/config";
import { openDb, migrate } from "./db.js";
import { runOne } from "./queue.js";

requireLocalOperator("Standalone runtime initialization");
process.env.EXTERNAL_DELIVERY_ENABLED="false";
const db = openDb();
await migrate(db);

let running = false,
  stopping = false;

const timer = setInterval(async () => {
  if (running || stopping) return;
  running = true;
  try {
    for (let n = 0; n < 20 && !stopping && (await runOne(db)); n++);
  } catch (e) {
    console.error(
      "Queue worker error",
      "server_error",
    );
  } finally {
    running = false;
    if (stopping) await db.end();
  }
}, 1000);

console.log(
  "Wallet worker running; missing credentials produce blocked jobs, never simulated delivery.",
);

for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    stopping = true;
    clearInterval(timer);
    if (!running) db.end();
  });
