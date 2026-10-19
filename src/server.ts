import "dotenv/config";
import { openDb } from "./db.js";
import { createApp } from "./app.js";
const db = openDb();
createApp(db).listen(Number(process.env.PORT || 3000), "0.0.0.0", () =>
  console.log(
    "Demo Coffee server running on port " + (process.env.PORT || 3000),
  ),
);
