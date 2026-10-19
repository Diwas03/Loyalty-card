import "dotenv/config";
import { openDb } from "./db.js";
import { runOne } from "./queue.js";
const db = openDb();
let running = false;
setInterval(async () => {
  if (running) return;
  running = true;
  try {
    for (let n = 0; n < 20 && (await runOne(db)); n++);
  } catch (e) {
    console.error(
      "Queue worker error",
      e instanceof Error ? e.message : "unknown",
    );
  } finally {
    running = false;
  }
}, 1000);
console.log(
  "Wallet worker running; missing credentials produce blocked jobs, never simulated delivery.",
);
