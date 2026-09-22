import { resolve } from "node:path";

import {
  assertCloudflareRemoteContext,
  parseCloudflareRemoteArgs,
  remoteBranch,
  type CloudflareRemoteEnvironment,
} from "./cloudflare-remote-options";

const root = resolve(import.meta.dir, "..");

async function output(command: string[]): Promise<string> {
  const child = Bun.spawn(command, {
    cwd: root,
    env: process.env,
    stdout: "pipe",
    stderr: "inherit",
  });
  const text = await new Response(child.stdout).text();
  if ((await child.exited) !== 0) {
    throw new Error(`Falló el comando: ${command.join(" ")}`);
  }
  return text.trim();
}

async function run(command: string[]): Promise<void> {
  const child = Bun.spawn(command, {
    cwd: root,
    env: {
      ...process.env,
      WRANGLER_SEND_METRICS: "false",
      WRANGLER_WRITE_LOGS: "false",
    },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await child.exited) !== 0) {
    throw new Error(`Falló el comando: ${command.join(" ")}`);
  }
}

async function assertRemoteContext(environment: CloudflareRemoteEnvironment) {
  const branch = remoteBranch(
    process.env.WORKERS_CI,
    process.env.WORKERS_CI_BRANCH,
    await output(["git", "branch", "--show-current"]),
  );
  const dirty = (await output(["git", "status", "--porcelain"])) !== "";
  assertCloudflareRemoteContext(environment, branch, dirty);
}

async function applyMigrations(environment: CloudflareRemoteEnvironment) {
  await run([
    "bun",
    "x",
    "--no-install",
    "wrangler",
    "d1",
    "migrations",
    "apply",
    "DB",
    "--env",
    environment,
    "--remote",
    "--config",
    "wrangler.jsonc",
  ]);
}

async function main() {
  const { operation, environment } = parseCloudflareRemoteArgs(
    process.argv.slice(2),
  );
  await assertRemoteContext(environment);

  if (operation === "bootstrap") {
    await run([
      "bun",
      "scripts/cloudflare-seed.ts",
      "--target",
      environment,
      "--config",
      "wrangler.jsonc",
    ]);
    return;
  }

  await applyMigrations(environment);
  if (operation === "migrations") return;

  await run(["bun", "scripts/cloudflare-migrations-check.ts", environment]);
  await run(["bun", "scripts/cloudflare-build.ts", environment]);
  await run([
    "bun",
    "x",
    "--no-install",
    "wrangler",
    "deploy",
    "--env",
    environment,
    "--config",
    "wrangler.jsonc",
  ]);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
