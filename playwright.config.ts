import { defineConfig } from "@playwright/test";

const backendUrl = "http://localhost:3100";
const frontendUrl = "http://localhost:4421";
const backendEnv = {
  ...process.env,
  WRANGLER_SEND_METRICS: "false",
  WRANGLER_WRITE_LOGS: "false",
};
const frontendEnv = {
  ...process.env,
  PUBLIC_API_BASE_URL: backendUrl,
};
// En modo rápido se aprovechan los servidores que ya estén escuchando en los
// puertos de prueba, en vez de levantar y matar dos procesos en cada corrida.
const reuseServers = process.env.E2E_REUSE_SERVERS === "1";

/**
 * Las pruebas se agrupan por módulo para poder correr solo el pedazo que se
 * está tocando: `bun run test:e2e:tareas`, `...:desafios`, etc. Sin
 * `--project` corren todos. Cada archivo pertenece a un solo módulo; si se
 * agrega uno nuevo hay que listarlo, o no lo corre nadie.
 */
const modules = {
  tareas: [
    "task-authoring.spec.ts",
    "task-answer-contract.spec.ts",
    "drag-drop-solutions.spec.ts",
    "image-hotspot.spec.ts",
    "assignment-answers.spec.ts",
    "authoring-refinement.spec.ts",
    "drag-drop-player-refinement.spec.ts",
  ],
  desafios: [
    "contest-lifecycle.spec.ts",
    "results-publication.spec.ts",
    "scoring.spec.ts",
  ],
  grupos: ["groups-validation.spec.ts", "join-validation.spec.ts"],
  juego: ["play-flow.spec.ts"],
  practica: ["practice-api.spec.ts", "practice-player.spec.ts"],
  cuentas: [
    "email-action.spec.ts",
    "login-validation.spec.ts",
    "registration.spec.ts",
    "registration-validation.spec.ts",
  ],
  interfaz: ["navigation-layout.spec.ts", "responsive-cards.spec.ts"],
};

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./tests/global-setup.ts",
  timeout: 60000,
  fullyParallel: false,
  workers: 1,
  projects: Object.entries(modules).map(([name, testMatch]) => ({
    name,
    testMatch,
  })),
  use: {
    baseURL: frontendUrl,
    headless: true,
  },
  webServer: [
    {
      command:
        "bun x --no-install firebase emulators:start --only auth --project bebras-bo-staging",
      url: "http://127.0.0.1:9099/emulator/v1/projects/bebras-bo-staging/config",
      reuseExistingServer: reuseServers,
      timeout: 120000,
    },
    {
      command:
        "bun x --no-install wrangler dev --config tests/wrangler.e2e.jsonc",
      url: `${backendUrl}/health`,
      env: backendEnv,
      reuseExistingServer: reuseServers,
      timeout: 60000,
    },
    {
      command: "cd frontend && bun run dev -- --port 4421",
      url: frontendUrl,
      env: frontendEnv,
      reuseExistingServer: reuseServers,
      timeout: 120000,
    },
  ],
});
