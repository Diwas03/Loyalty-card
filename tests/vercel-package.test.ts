import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, matchesGlob, resolve } from "node:path";
import { tmpdir } from "node:os";
import { memDb } from "./helpers.js";
import { initializeHosted } from "../src/hosted-runtime.js";

test("Vercel's explicit SQL package initializes every hosted schema and preserves memberships", async () => {
  const root = process.cwd();
  const config = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8"));
  const included = [config.functions["api/index.ts"].includeFiles].flat() as string[];
  const directory = mkdtempSync(join(tmpdir(), "loyalty-vercel-package-"));
  const db = await memDb();
  try {
    mkdirSync(join(directory, "supabase"));
    for (const file of readdirSync(join(root, "supabase"))) {
      const relative = "supabase/" + file;
      if (included.some(pattern => matchesGlob(relative, pattern))) {
        copyFileSync(join(root, relative), join(directory, relative));
      }
    }
    process.chdir(directory);
    await initializeHosted(db);
    for (const table of ["ledger", "issued_rewards", "business_memberships", "locations"]) {
      assert.ok((await db.query("SELECT to_regclass($1) AS name", ["coffee." + table])).rows[0].name);
    }
    const member = (await db.query("SELECT coffee.enroll_customer('Preserved fixture',NULL,'default') AS member")).rows[0].member;
    await initializeHosted(db);
    assert.equal((await db.query("SELECT name FROM coffee.members WHERE id=$1", [member.id])).rows[0].name, "Preserved fixture");
  } finally {
    process.chdir(root);
    await db.end();
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    rmSync(directory, { recursive: true, force: true });
  }
});
