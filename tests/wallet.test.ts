delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { importSPKI, jwtVerify } from "jose";
import { transact, type Member } from "../src/db.js";
import { applePass } from "../src/apple.js";
import { saveGoogle, updateGoogle } from "../src/google.js";
import { runOne } from "../src/queue.js";
import { memDb } from "./helpers.js";

test("Apple pass ZIP, identity, barcode, manifest and CMS signature using synthetic local CA (not an Apple-issued pass)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "coffee-signing-"));
  const cmd = (...args: string[]) =>
    execFileSync("openssl", args, { cwd: dir, stdio: "pipe" });
  try {
    cmd(
      "req", "-x509", "-newkey", "rsa:2048", "-nodes",
      "-keyout", "root.key", "-out", "root.pem", "-days", "1",
      "-subj", "/CN=Local test CA",
    );
    cmd(
      "req", "-new", "-newkey", "rsa:2048", "-nodes",
      "-keyout", "signer.key", "-out", "signer.csr",
      "-subj", "/CN=Local Test Pass",
    );
    cmd(
      "x509", "-req", "-in", "signer.csr", "-CA", "root.pem",
      "-CAkey", "root.key", "-CAcreateserial",
      "-out", "signer.pem", "-days", "1",
    );
    Object.assign(process.env, {
      APPLE_PASS_TYPE_ID: "pass.test.coffee",
      APPLE_TEAM_ID: "TESTTEAM01",
      APPLE_CERT_FILE: join(dir, "signer.pem"),
      APPLE_KEY_FILE: join(dir, "signer.key"),
      APPLE_WWDR_FILE: join(dir, "root.pem"),
      PUBLIC_BASE_URL: "https://coffee.example",
    });
    const db = await memDb();
    const { rows } = await db.query("SELECT * FROM members LIMIT 1");
    const m = rows[0] as Member;
    writeFileSync(join(dir, "pass.pkpass"), applePass(m));
    execFileSync("python3", [
      "-c",
      `import zipfile,hashlib,json,sys
p=zipfile.ZipFile(sys.argv[1]);manifest=json.loads(p.read('manifest.json'))
for name,digest in manifest.items(): assert hashlib.sha1(p.read(name)).hexdigest()==digest
p.extractall(sys.argv[2])`,
      join(dir, "pass.pkpass"),
      join(dir, "unpacked"),
    ]);
    cmd(
      "cms", "-verify", "-binary", "-inform", "DER",
      "-in", "unpacked/signature",
      "-content", "unpacked/manifest.json",
      "-CAfile", "root.pem",
      "-out", "verified.json",
    );
    const pass = JSON.parse(
      readFileSync(join(dir, "unpacked/pass.json"), "utf8"),
    );
    assert.equal(pass.serialNumber, m.id);
    assert.equal(pass.passTypeIdentifier, "pass.test.coffee");
    assert.equal(pass.barcodes[0].message, m.id);
    assert.equal(pass.webServiceURL, "https://coffee.example/apple");
    assert.equal(pass.authenticationToken, m.apple_token);
    assert.equal(pass.storeCard.primaryFields[0].value, "0 / 8");
    await transact(db, m.id, "purchase", "synthetic-test-purchase");
    const { rows: updatedRows } = await db.query(
      "SELECT * FROM members LIMIT 1",
    );
    const updated = updatedRows[0] as Member;
    writeFileSync(join(dir, "updated.pkpass"), applePass(updated));
    const updatedJson = JSON.parse(
      execFileSync("python3", [
        "-c",
        "import zipfile,sys;print(zipfile.ZipFile(sys.argv[1]).read('pass.json').decode())",
        join(dir, "updated.pkpass"),
      ]).toString(),
    );
    assert.equal(updatedJson.serialNumber, pass.serialNumber);
    assert.equal(updatedJson.authenticationToken, pass.authenticationToken);
    assert.equal(updatedJson.storeCard.primaryFields[0].value, "1 / 8");
    await db.end();
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("Google signed save JWT and stable REST object updates using a local HTTP stub (not a live Google integration)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "coffee-google-"));
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  writeFileSync(
    join(dir, "service.json"),
    JSON.stringify({
      client_email: "test@example.iam.gserviceaccount.com",
      private_key: privateKey,
    }),
  );
  Object.assign(process.env, {
    GOOGLE_ISSUER_ID: "123456",
    GOOGLE_SERVICE_ACCOUNT_FILE: join(dir, "service.json"),
    PUBLIC_BASE_URL: "https://coffee.example",
  });
  const calls: { url: string; method: string; body: unknown }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method || "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    });
    if (url.includes("oauth2"))
      return new Response(JSON.stringify({ access_token: "local-test-only" }));
    return new Response("{}", { status: 200 });
  };
  try {
    const db = await memDb();
    const { rows } = await db.query("SELECT * FROM members LIMIT 1");
    const m = rows[0] as Member;
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = readFileSync(
      join(dir, "service.json"),
      "utf8",
    );
    delete process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
    const url = await saveGoogle(m);
    const { payload } = await jwtVerify(
      url.split("/").at(-1)!,
      await importSPKI(publicKey, "RS256"),
      { issuer: "test@example.iam.gserviceaccount.com", audience: "google" },
    );
    assert.equal(payload.typ, "savetowallet");
    assert.deepEqual(payload.origins, ["coffee.example"]);
    assert.deepEqual((payload.payload as any).loyaltyObjects, [
      { id: `123456.${m.id}`, classId: "123456.demo_coffee" },
    ]);
    const cls = calls.find((c) => c.url.endsWith("/loyaltyClass"))!.body as any;
    assert.equal(
      cls.programLogo.sourceUri.uri,
      "https://coffee.example/logo.png",
    );
    await transact(db, m.id, "purchase", "google-local-test-key");
    const { rows: updatedRows } = await db.query(
      "SELECT * FROM members LIMIT 1",
    );
    await updateGoogle(updatedRows[0] as Member);
    const patch = calls.find((c) => c.method === "PATCH")! as any;
    assert.ok(patch.url.endsWith(m.id));
    assert.equal(patch.body.barcode.value, m.id);
    assert.equal(patch.body.loyaltyPoints.balance.string, "1/8");
    assert.equal(patch.body.secondaryLoyaltyPoints.balance.int, 0);
    await db.end();
  } finally {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    globalThis.fetch = original;
    rmSync(dir, { recursive: true });
  }
});

test("missing credentials block delivery honestly and preserve balance", async () => {
  delete process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
  const db = await memDb();
  const { rows } = await db.query("SELECT * FROM members LIMIT 1");
  const m = rows[0] as Member;
  await transact(db, m.id, "purchase", "missing-credentials-test");
  await runOne(db);
  const { rows: jobs } = await db.query(
    "SELECT status FROM jobs ORDER BY id LIMIT 1",
  );
  assert.equal(jobs[0].status, "blocked");
  const { rows: mRows } = await db.query("SELECT stamps FROM members");
  assert.equal(Number(mRows[0].stamps), 1);
  await db.end();
});
