import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { firebaseWebConfig } from "../scripts/firebase-config";

type Env = Record<string, string>;

const root = resolve(import.meta.dir, "..");
const tests = resolve(root, "tests");
const frontend = resolve(root, "frontend");
const backendUrl = "http://localhost:3100";
const frontendUrl = "http://localhost:4421";
const wranglerConfig = resolve(tests, "wrangler.e2e.jsonc");
const wranglerState = resolve(tests, ".wrangler");
const testArtifacts = [wranglerState];
const adminEmail = process.env.E2E_ADMIN_EMAIL ?? "marko@bebras.bo";
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? "bebras-e2e-only";

/**
 * Modo rápido: reaprovecha la base sembrada y los servidores que ya estén
 * escuchando. Sirve mientras se itera sobre un módulo; la corrida completa y
 * reproducible sigue siendo la de siempre, sin la bandera.
 */
const fast = process.argv.includes("--rapido");
const serversOnly = process.argv.includes("--servidores");
const testEnv = {
  ...process.env,
  // La sesion la emite Firebase; el proyecto tiene que ser uno de pruebas o el
  // emulador de Auth, nunca `bebras-bo`. Ver docs/firebase-auth.md.
  ...firebaseWebConfig.staging,
  PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: "http://127.0.0.1:9099",
  FIREBASE_PROJECT_ID: "bebras-bo-staging",
  E2E_FIREBASE_API_KEY: firebaseWebConfig.staging.PUBLIC_FIREBASE_API_KEY,
  FIREBASE_AUTH_EMULATOR_HOST: "http://127.0.0.1:9099",
  E2E_ADMIN_EMAIL: adminEmail,
  E2E_ADMIN_PASSWORD: adminPassword,
  SEED_ADMIN_PASSWORD: adminPassword,
  E2E_REUSE_SERVERS: fast || serversOnly ? "1" : "0",
  BEBRAS_E2E: "1",
};

/**
 * Dos siembras: el catálogo verificado, que usan las pruebas de las tareas
 * reales, y las fixtures sintéticas, que salieron del catálogo para no viajar
 * en una siembra normal.
 */
async function seedTasks() {
  await run(
    [
      "bun",
      "scripts/cloudflare-seed-tasks.ts",
      "--target",
      "local",
      "--config",
      wranglerConfig,
    ],
    root,
  );
  await run(
    [
      "bun",
      "backend/prisma/seed-test-tasks.ts",
      "--target",
      "local",
      "--config",
      wranglerConfig,
    ],
    root,
  );
}

function cleanupTestArtifacts() {
  for (const file of testArtifacts) {
    rmSync(file, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  }
}

async function prepareDatabase() {
  await run(
    [
      "bun",
      "x",
      "--no-install",
      "wrangler",
      "d1",
      "migrations",
      "apply",
      "DB",
      "--local",
      "--config",
      wranglerConfig,
    ],
    root,
  );
  await run(
    [
      "bun",
      "scripts/cloudflare-seed.ts",
      "--target",
      "local",
      "--config",
      wranglerConfig,
    ],
    root,
  );
  await seedTasks();
}

async function run(command: string[], cwd: string, extraEnv: Env = {}) {
  const child = Bun.spawn(command, {
    cwd,
    env: { ...testEnv, ...extraEnv },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await child.exited;

  if (exitCode !== 0) {
    throw new Error(`Falló el comando: ${command.join(" ")}`);
  }
}

/** Deja Firebase, backend y frontend de prueba levantados para corridas rápidas. */
async function startServers() {
  console.log(
    "Firebase y servidores de prueba en los puertos 9099, 3100 y 4421.\n" +
      "Déjalos abiertos y corre las pruebas con: bun run test:e2e:rapido\n",
  );

  if (!existsSync(wranglerState)) {
    await prepareDatabase();
  }

  // Los mismos puertos y variables que usa playwright.config.ts al levantarlos.
  const definitions = [
    {
      command: [
        "bun",
        "x",
        "--no-install",
        "firebase",
        "emulators:start",
        "--only",
        "auth",
        "--project",
        "bebras-bo-staging",
      ],
      cwd: root,
      env: {},
    },
    {
      command: [
        "bun",
        "x",
        "--no-install",
        "wrangler",
        "dev",
        "--config",
        wranglerConfig,
      ],
      cwd: root,
      env: {},
    },
    {
      command: ["bun", "run", "dev", "--", "--port", "4421"],
      cwd: frontend,
      env: { PUBLIC_API_BASE_URL: backendUrl },
    },
  ];
  const servers = definitions.map((definition) => ({
    ...definition,
    child: Bun.spawn(definition.command, {
      cwd: definition.cwd,
      env: { ...testEnv, ...definition.env },
      detached: process.platform !== "win32",
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    }),
  }));
  let stopping = false;
  const stopServers = () => {
    stopping = true;
    for (const { child } of servers) {
      try {
        if (process.platform === "win32") {
          Bun.spawnSync(["taskkill", "/PID", String(child.pid), "/T", "/F"], {
            stdout: "ignore",
            stderr: "ignore",
          });
        } else {
          process.kill(-child.pid, "SIGTERM");
        }
      } catch {
        // Another server may already have stopped and triggered cleanup.
      }
    }
  };
  const interrupt = () => {
    process.exitCode = 130;
    stopServers();
  };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);

  try {
    await Promise.all(
      servers.map(async ({ child, command }) => {
        const exitCode = await child.exited;
        if (!stopping) {
          throw new Error(
            `El servidor terminó inesperadamente (${exitCode}): ${command.join(" ")}`,
          );
        }
      }),
    );
  } finally {
    stopServers();
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
    await Promise.allSettled(servers.map(({ child }) => child.exited));
  }
}

async function main() {
  if (serversOnly) {
    await startServers();
    return;
  }

  const playwrightArgs = process.argv
    .slice(2)
    .filter((argument) => argument !== "--" && argument !== "--rapido");

  if (!fast) {
    cleanupTestArtifacts();
  }

  try {
    if (!fast || !existsSync(wranglerState)) {
      await prepareDatabase();
    }

    await run(
      ["bun", "x", "--no-install", "playwright", "test", ...playwrightArgs],
      root,
    );
  } finally {
    if (!fast) {
      cleanupTestArtifacts();
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
