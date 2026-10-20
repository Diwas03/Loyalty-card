/** Real Postgres per fixture. Row locking and rollback cannot be verified by pg-mem. */
import pg from "pg";
import { randomBytes } from "node:crypto";
import { migrate } from "../src/db.js";
export async function memDb(): Promise<pg.Pool> {
  const url = new URL(process.env.TEST_DATABASE_URL || "");
  if (
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    url.pathname !== "/coffee_test"
  )
    throw Error(
      "Run npm test, or set a disposable loopback TEST_DATABASE_URL ending /coffee_test",
    );
  const options = {
    connectionString: url.toString(),
    ssl: false as const,
    allowExitOnIdle: true,
    idleTimeoutMillis: 1000,
  };
  const admin = new pg.Pool(options);
  const name = "coffee_case_" + randomBytes(10).toString("hex");
  await admin.query(`CREATE DATABASE "${name}"`);
  url.pathname = "/" + name;
  const pool = new pg.Pool({ ...options, connectionString: url.toString() });
  const close = pool.end.bind(pool);
  pool.end = async () => {
    await close();
    try {
      for (let n = 0; ; n++) {
        try {
          await admin.query(`DROP DATABASE "${name}"`);
          break;
        } catch (e) {
          if (n >= 20) throw e;
          await new Promise((r) => setTimeout(r, 25));
        }
      }
    } finally {
      await admin.end();
    }
  };
  await migrate(pool);
  return pool;
}
