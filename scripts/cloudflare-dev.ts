import { fileURLToPath } from "node:url";
import { firebaseWebConfig } from "./firebase-config";

const root = fileURLToPath(new URL("../", import.meta.url));
const firebase = firebaseWebConfig.staging;
const projectId = firebase.PUBLIC_FIREBASE_PROJECT_ID;

/**
 * `--auth-local` cambia Firebase Auth de staging por su emulador, para que
 * nada salga de la maquina. El backend solo acepta tokens del emulador con
 * `BEBRAS_E2E`, la misma bandera que usan las pruebas.
 */
const authLocal = process.argv.includes("--auth-local");
const emulator = "http://127.0.0.1:9099";
const localPassword = process.env.LOCAL_AUTH_PASSWORD || "bebras123";

const env = {
  ...process.env,
  ...firebase,
  PUBLIC_API_BASE_URL: "http://localhost:3000",
  PUBLIC_REGISTRATION_ONLY: "false",
  ...(authLocal ? { PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: emulator } : {}),
};

const wrangler =
  "bun x --no-install wrangler dev --local " +
  `--var FIREBASE_PROJECT_ID:${projectId} --config wrangler.jsonc` +
  (authLocal
    ? ` --var FIREBASE_AUTH_EMULATOR_HOST:${emulator} --var BEBRAS_E2E:1`
    : "");

const names = authLocal ? "auth,backend,frontend" : "backend,frontend";
const colors = authLocal ? "yellow,blue,magenta" : "blue,magenta";
const commands = [
  ...(authLocal
    ? [`bun x --no-install firebase emulators:start --only auth --project ${projectId}`]
    : []),
  wrangler,
  "bun run --cwd frontend dev",
];

console.log(
  authLocal
    ? "Desarrollo local: Firebase Auth Emulator + Worker/D1/R2 locales."
    : "Desarrollo local: Firebase Auth staging + Worker/D1/R2 locales.",
);
const child = Bun.spawn(
  ["bun", "x", "--no-install", "concurrently", "-k", "-n", names, "-c", colors, ...commands],
  { cwd: root, env, stdin: "inherit", stdout: "inherit", stderr: "inherit" },
);

if (authLocal) void seedEmulatorAccounts();

process.exit(await child.exited);

type LocalUser = { email: string; name: string | null; firebaseUid: string | null };

/**
 * El emulador arranca vacio. Se le cargan las cuentas de la D1 local con el
 * mismo UID que ya tienen enlazado; con otro UID el backend responderia
 * UID_CONFLICT. Todas comparten la contrasena local y el correo verificado.
 */
async function seedEmulatorAccounts() {
  let users: LocalUser[];
  try {
    users = await readLocalUsers();
  } catch {
    console.error("[auth] No se pudieron leer los usuarios de la D1 local.");
    return;
  }

  if (!(await waitForEmulator())) {
    console.error("[auth] El emulador de Firebase Auth no respondio.");
    return;
  }

  let created = 0;
  for (const user of users) {
    const response = await fetch(
      `${emulator}/identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts`,
      {
        method: "POST",
        headers: { authorization: "Bearer owner", "content-type": "application/json" },
        body: JSON.stringify({
          ...(user.firebaseUid ? { localId: user.firebaseUid } : {}),
          email: user.email,
          emailVerified: true,
          password: localPassword,
          displayName: user.name ?? undefined,
        }),
      },
    );
    if (response.ok) created += 1;
  }

  console.log(
    `[auth] ${created} de ${users.length} cuentas locales cargadas en el emulador. ` +
      `Contrasena: ${localPassword}`,
  );
}

async function readLocalUsers(): Promise<LocalUser[]> {
  const query = Bun.spawn(
    [
      "bun", "x", "--no-install", "wrangler", "d1", "execute", "DB", "--local",
      "--json", "--config", "wrangler.jsonc",
      "--command", "SELECT email, name, firebaseUid FROM User",
    ],
    { cwd: root, stdout: "pipe", stderr: "ignore" },
  );
  const output = await new Response(query.stdout).text();
  if ((await query.exited) !== 0) throw new Error("wrangler d1 execute");
  const [result] = JSON.parse(output) as [{ results: LocalUser[] }];
  return result.results;
}

async function waitForEmulator() {
  for (let i = 0; i < 90; i += 1) {
    try {
      const response = await fetch(`${emulator}/emulator/v1/projects/${projectId}/config`);
      if (response.ok) return true;
    } catch {
      // Todavia arrancando.
    }
    await Bun.sleep(1000);
  }
  return false;
}
