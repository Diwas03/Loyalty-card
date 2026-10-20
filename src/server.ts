import "dotenv/config";
import { openDb } from "./db.js";
import { createApp } from "./app.js";
const db = openDb();
const server = createApp(db).listen(
  Number(process.env.PORT || 3000),
  "0.0.0.0",
  () =>
    console.log(
      "Demo Coffee server running on port " + (process.env.PORT || 3000),
    ),
);

for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => server.close(() => db.close()));
