import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";
import { config } from "dotenv";
config({ quiet: true });
const name = "coffee-loyalty-local",
  volume = "coffee-loyalty-local-data",
  file = "data/local-runtime.json";
function docker(args, optional = false) {
  const r = spawnSync("docker", args, { encoding: "utf8" });
  if (r.status !== 0 && !optional)
    throw Error(
      "Docker is unavailable or could not start the local database. Start Docker Desktop and retry.",
    );
  return r;
}
async function database() {
  mkdirSync("data", { recursive: true, mode: 0o700 });
  let state;
  if (existsSync(file)) {
    state = JSON.parse(readFileSync(file, "utf8"));
    if (typeof state.password !== "string" || state.password.length < 32)
      throw Error(
        "Invalid local runtime configuration; preserve it and check your local database setup.",
      );
  } else {
    if (docker(["volume", "inspect", volume], true).status === 0)
      throw Error(
        "A persistent local database volume exists but its credential file is missing. Restore data/local-runtime.json; refusing to replace the database.",
      );
    state = { password: randomBytes(32).toString("hex") };
    writeFileSync(file, JSON.stringify(state), { mode: 0o600, flag: "wx" });
  }
  const existing = docker(["inspect", name], true);
  if (existing.status === 0) {
    const c = JSON.parse(existing.stdout)[0];
    if (c.Config.Labels?.["coffee.local-runner"] !== "true")
      throw Error("Container name already in use by another application");
    docker(["start", name]);
  } else
    docker([
      "run",
      "-d",
      "--name",
      name,
      "--label",
      "coffee.local-runner=true",
      "-p",
      "127.0.0.1::5432",
      "--mount",
      `type=volume,source=${volume},target=/var/lib/postgresql/data`,
      "-e",
      "POSTGRES_DB=coffee_local",
      "-e",
      "POSTGRES_USER=coffee",
      "-e",
      "POSTGRES_PASSWORD=" + state.password,
      "postgres:17-alpine",
    ]);
  let ready = false;
  for (let n = 0; n < 120; n++) {
    if (
      docker(
        [
          "exec",
          name,
          "pg_isready",
          "-h",
          "127.0.0.1",
          "-U",
          "coffee",
          "-d",
          "coffee_local",
        ],
        true,
      ).status === 0
    ) {
      ready = true;
      break;
    }
    await pause(250);
  }
  if (!ready)
    throw Error(
      "Local Postgres did not become ready. Inspect Docker logs for " + name,
    );
  const port = docker(["port", name, "5432/tcp"])
    .stdout.trim()
    .split(":")
    .at(-1);
  return {
    ...process.env,
    DATABASE_URL: `postgres://coffee:${state.password}@127.0.0.1:${port}/coffee_local`,
    PUBLIC_BASE_URL: "",
    VERCEL_ENV: "development",
    APPLE_WALLET_ENABLED: "false",
  };
}
let children = [],
  stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const c of children) c.kill("SIGTERM");
}
try {
  const mode = process.argv[2] || "start";
  if (mode === "stop") {
    docker(["stop", name]);
    console.log("Local database stopped. Its persistent volume was retained.");
  } else {
    const env = await database();
    if (mode === "staff") {
      const args = process.argv.slice(3);
      if (!args.length)
        throw Error("Usage: npm run local:staff -- owner owner");
      const child = spawn(
        process.execPath,
        ["--import", "tsx", "scripts/staff-account.ts", ...args],
        { env, stdio: "inherit" },
      );
      process.exitCode = await new Promise((r) =>
        child.once("exit", (code) => r(code ?? 1)),
      );
    } else {
      if (mode !== "start") throw Error("Unknown local runner mode");
      // Complete migration before the worker starts; both processes share the same isolated local database.
      const migration = spawn(
        process.execPath,
        [
          "--import",
          "tsx",
          "--input-type=module",
          "-e",
          "const {openDb,migrate}=await import('./src/db.ts');const db=openDb();try{await migrate(db);}finally{await db.end();}",
        ],
        { env, stdio: "inherit" },
      );
      if (
        await new Promise((r) => migration.once("exit", (code) => r(code ?? 1)))
      )
        throw Error("Local database migration failed");
      for (const file of ["src/server.ts", "src/worker.ts"])
        children.push(
          spawn(process.execPath, ["--import", "tsx", file], {
            env,
            stdio: "inherit",
          }),
        );
      console.log(
        "Local coffee app starting on port " +
          (env.PORT || 3000) +
          ". Real wallet saving requires separate public HTTPS configuration.",
      );
      console.log(
        "To set your staff login, run in another terminal: npm run local:staff -- owner owner",
      );
      console.log(
        "Ctrl+C stops app and worker. Postgres data remains; npm run local:stop stops its container.",
      );
      for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, stop);
      await Promise.all(
        children.map(
          (c) =>
            new Promise((resolve) => {
              c.once("error", () => {
                process.exitCode = 1;
                stop();
                resolve();
              });
              c.once("exit", (code, signal) => {
                if (!stopping) {
                  process.exitCode = code || 1;
                  stop();
                }
                resolve();
              });
            }),
        ),
      );
    }
  }
} catch (e) {
  stop();
  console.error(e.message);
  process.exitCode = 1;
}
