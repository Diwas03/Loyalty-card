import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";
const command = process.argv[2] || "unit";
const flags =
  command === "browser"
    ? ["tests/browser-smoke.ts"]
    : command === "scanner"
      ? ["tests/scan-browser.ts"]
    : command === "hosted"
      ? ["--test", "tests/hosted.integration.ts"]
      : ["--test", "tests/*.test.ts"];
let container;
let env = { ...process.env };
function docker(args) {
  const r = spawnSync("docker", args, { encoding: "utf8" });
  if (r.status !== 0)
    throw Error(
      "Docker command failed; start Docker Desktop or set TEST_DATABASE_URL to a disposable local coffee_test database.",
    );
  return r.stdout.trim();
}
try {
  if (!env.TEST_DATABASE_URL) {
    container = "coffee-test-" + randomBytes(6).toString("hex");
    const password = randomBytes(24).toString("hex");
    docker([
      "run",
      "--rm",
      "-d",
      "--name",
      container,
      "-p",
      "127.0.0.1::5432",
      "-e",
      "POSTGRES_DB=coffee_test",
      "-e",
      "POSTGRES_PASSWORD=" + password,
      "--tmpfs",
      "/var/lib/postgresql/data",
      "postgres:17-alpine",
    ]);
    let ready = false;
    for (let n = 0; n < 120; n++) {
      const r = spawnSync(
        "docker",
        [
          "exec",
          container,
          "pg_isready",
          "-U",
          "postgres",
          "-d",
          "coffee_test",
        ],
        { stdio: "ignore" },
      );
      if (r.status === 0) {
        ready = true;
        break;
      }
      await pause(250);
    }
    if (!ready) throw Error("Test database startup timed out");
    const port = docker(["port", container, "5432/tcp"]).split(":").at(-1);
    env.TEST_DATABASE_URL = `postgres://postgres:${password}@127.0.0.1:${port}/coffee_test`;
  }
  const child = spawn(process.execPath, ["--import", "tsx", ...flags], {
    stdio: "inherit",
    env,
  });
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => child.kill(signal));
  const code = await new Promise((resolve) =>
    child.once("exit", (code) => resolve(code ?? 1)),
  );
  process.exitCode = code;
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  if (container) spawnSync("docker", ["stop", container], { stdio: "ignore" });
}
