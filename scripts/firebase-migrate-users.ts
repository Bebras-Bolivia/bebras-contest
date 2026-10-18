/**
 * Migra a Firebase Authentication las cuentas que todavia viven solo en D1.
 *
 * Conserva la contrasena actual: bcrypt viaja tal cual con `--hash-algo=BCRYPT`,
 * asi que nadie tiene que restablecerla. El correo NO se marca como verificado:
 * quien nunca lo confirmo sigue el flujo normal de verificacion de Firebase.
 *
 * Despues del alta guarda el UID en `User.firebaseUid`, que es la unica relacion
 * entre ambos sistemas.
 *
 *   bun scripts/firebase-migrate-users.ts --target production --check
 *   bun scripts/firebase-migrate-users.ts --target production
 *
 * `--mark-verified` es la excepcion, no el camino normal: reimporta las cuentas
 * ya migradas indicadas con `--user <correo-o-uid>` y `emailVerified: true`.
 * Solo tiene sentido cuando su correo no puede recibir el enlace de Firebase y
 * por eso la verificacion normal es imposible.
 */
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

import { privateDirectory, protectPath } from "./cloudflare-cli";
import {
  matchesMigrationUser,
  selectedMigrationUsers,
} from "./firebase-migrate-users-options";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const check = args.includes("--check");
const markVerified = args.includes("--mark-verified");
const selectedUsers = selectedMigrationUsers(args);
const targetIndex = args.indexOf("--target");
const target = targetIndex >= 0 ? args[targetIndex + 1] : undefined;

if (target !== "production") {
  throw new Error(
    "Uso: bun scripts/firebase-migrate-users.ts --target production [--check] [--mark-verified --user <correo-o-uid> ...]",
  );
}
if (markVerified && !selectedUsers.length) {
  throw new Error("--mark-verified requiere al menos un --user <correo-o-uid>.");
}
if (!markVerified && selectedUsers.length) {
  throw new Error("--user solo puede usarse junto con --mark-verified.");
}

// Cada entorno tiene su propio proyecto Firebase para no compartir usuarios; en
// .firebaserc el alias se llama igual que el entorno.
const FIREBASE_PROJECT = target;

interface Row {
  id: number;
  email: string;
  name: string | null;
  passwordHash: string;
  firebaseUid: string | null;
}

function wranglerBin() {
  const require = createRequire(join(root, "package.json"));
  return join(dirname(require.resolve("wrangler/package.json")), "bin/wrangler.js");
}

/** Como `runWrangler`, pero devolviendo stdout porque hace falta leer filas. */
function captureWrangler(args: string[]): string {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    WRANGLER_WRITE_LOGS: "false",
    WRANGLER_LOG_SANITIZE: "true",
    WRANGLER_SEND_METRICS: "false",
  };
  const result = spawnSync("node", [wranglerBin(), ...args], {
    cwd: root,
    env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error("Wrangler falló; salida suprimida para proteger datos.");
  }
  return result.stdout ?? "";
}

function readRows(): Row[] {
  const stdout = captureWrangler([
    "d1",
    "execute",
    "DB",
    "--env",
    target!,
    "--remote",
    "--json",
    "--command",
    markVerified
      ? "SELECT id, email, name, passwordHash, firebaseUid FROM User WHERE passwordHash <> '' AND firebaseUid IS NOT NULL ORDER BY id"
      : "SELECT id, email, name, passwordHash, firebaseUid FROM User WHERE passwordHash <> '' AND firebaseUid IS NULL ORDER BY id",
  ]);
  const start = stdout.indexOf("[");
  if (start < 0) throw new Error("Respuesta inesperada de Wrangler.");
  const payload = JSON.parse(stdout.slice(start)) as { results: Row[] }[];
  const rows = payload.flatMap((entry) => entry.results ?? []);
  if (!markVerified) return rows;

  const selected = rows.filter((row) =>
    selectedUsers.some((selector) => matchesMigrationUser(selector, row)),
  );
  const missing = selectedUsers.filter(
    (selector) => !selected.some((row) => matchesMigrationUser(selector, row)),
  );
  if (missing.length) {
    throw new Error(`No se encontraron cuentas migradas para: ${missing.join(", ")}`);
  }
  return selected;
}

/** El UID deriva del id de D1: reejecutar la migración no duplica identidades. */
function localId(row: Row) {
  return row.firebaseUid ?? `bebras-d1-${row.id}`;
}

const rows = readRows();

if (!rows.length) {
  console.log(
    markVerified
      ? "No hay cuentas migradas a las que marcar el correo."
      : "No hay cuentas pendientes de migrar.",
  );
  process.exit(0);
}

for (const row of rows) {
  if (!/^\$2[aby]\$/u.test(row.passwordHash)) {
    throw new Error(
      `La cuenta ${row.email} no usa bcrypt; revisar antes de importar.`,
    );
  }
}

console.log(
  markVerified
    ? `Cuentas a marcar con el correo verificado (${rows.length}):`
    : `Cuentas por migrar (${rows.length}):`,
);
for (const row of rows) console.log(`  ${localId(row)}  ${row.email}`);

if (markVerified) {
  console.log(
    "\nAviso: se afirmará una verificación que Firebase no realizó. Hacerlo solo\n" +
      "cuando esas direcciones no puedan recibir el enlace y quede constancia.",
  );
}

if (check) {
  console.log("\n--check: no se escribió nada en Firebase ni en D1.");
  process.exit(0);
}

const directory = privateDirectory("firebase-import-");

try {
  const file = join(directory, "users.json");
  writeFileSync(
    file,
    JSON.stringify({
      users: rows.map((row) => ({
        localId: localId(row),
        email: row.email,
        // Por defecto nunca se afirma una verificación que no ocurrió; solo
        // `--mark-verified` la fuerza, y es una decisión del operador.
        emailVerified: markVerified,
        displayName: row.name ?? undefined,
        passwordHash: Buffer.from(row.passwordHash, "utf8").toString("base64"),
      })),
    }),
    { mode: 0o600 },
  );
  protectPath(file);

  const require = createRequire(join(root, "package.json"));
  const firebaseCli = join(
    dirname(require.resolve("firebase-tools/package.json")),
    "lib/bin/firebase.js",
  );
  const firebase = spawnSync(
    "node",
    [
      firebaseCli,
      "auth:import",
      file,
      "--hash-algo=BCRYPT",
      "--project",
      FIREBASE_PROJECT,
    ],
    { cwd: root, encoding: "utf8" },
  );

  const output = `${firebase.stdout ?? ""}${firebase.stderr ?? ""}`;
  // En Windows firebase-tools puede abortar al cerrar el proceso (una asercion
  // de libuv) despues de haber importado bien, asi que manda lo que reporto el
  // importador y no su codigo de salida.
  if (!output.includes("Imported successfully")) {
    // La salida no incluye hashes, solo conteos y errores por cuenta: mostrarla
    // es lo que permite entender por que fallo.
    process.stderr.write(output);
    throw new Error(
      `firebase auth:import falló (${firebase.error?.message ?? `código ${firebase.status}`}); no se tocó D1.`,
    );
  }

  process.stdout.write(output);

  if (markVerified) {
    console.log(`\nListo: ${rows.length} cuenta(s) con el correo marcado como verificado.`);
    process.exit(0);
  }

  // Enlaza cada fila con su identidad recien creada. Aditivo y repetible.
  const sql = rows
    .map(
      (row) =>
        `UPDATE "User" SET "firebaseUid" = '${localId(row)}' WHERE "id" = ${row.id} AND "firebaseUid" IS NULL;`,
    )
    .join("\n");
  const sqlFile = join(directory, "link.sql");
  writeFileSync(sqlFile, `${sql}\n`, { mode: 0o600 });
  protectPath(sqlFile);

  captureWrangler([
    "d1",
    "execute",
    "DB",
    "--env",
    target!,
    "--remote",
    "--file",
    sqlFile,
  ]);

  console.log(`\nListo: ${rows.length} cuenta(s) migradas y enlazadas.`);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
