/**
 * Creates a fresh in-memory PostgreSQL pool (via pg-mem) for each test,
 * with the full schema applied. Use instead of openDb(":memory:").
 */
import { newDb } from "pg-mem";
import { migrate } from "../src/db.js";
import type { Pool } from "pg";

export async function memDb(): Promise<Pool> {
  const db = newDb();
  // pg-mem exposes a pg-compatible Pool adapter
  const pool = db.adapters.createPg().Pool as unknown as typeof import("pg").Pool;
  // @ts-ignore — pg-mem's pool is interface-compatible
  const p: Pool = new pool();
  await migrate(p);
  return p;
}
