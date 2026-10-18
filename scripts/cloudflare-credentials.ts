import { randomBytes } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertIgnored, protectPath } from "./cloudflare-cli";

const root = fileURLToPath(new URL("../", import.meta.url));
const target = process.argv[2];
const action = process.argv[3] ?? "prepare";
if (!["local", "production"].includes(target ?? "") || !["prepare", "seed", "upload"].includes(action)) {
  throw new Error("Uso: bun scripts/cloudflare-credentials.ts local|production prepare|seed|upload");
}
if (target === "local" && action === "upload") throw new Error("Local utiliza .dev.vars.");
// La autenticacion es Firebase y se verifica con claves publicas: el Worker ya no
// guarda ningun secreto de runtime. Solo queda la contrasena del bootstrap, que
// nunca sale del proceso local.
if (action === "upload") throw new Error("No hay secrets de runtime que subir: la autenticación usa Firebase y FIREBASE_PROJECT_ID es una var de wrangler.jsonc.");
const folder = resolve(root, ".wrangler", "credentials");
const path = resolve(folder, `${target}.json`);
assertIgnored(path);
if (target !== "local" && action !== "prepare") {
  try { await access(path); }
  catch {
    throw new Error("Faltan las credenciales originales del entorno remoto. Recupéralas del respaldo privado; no generes otras para un entorno existente.");
  }
}
await mkdir(folder, { recursive: true, mode: 0o700 });
protectPath(folder, true);
try {
  await writeFile(path, JSON.stringify({
    SEED_ADMIN_PASSWORD: randomBytes(24).toString("base64url"),
  }, null, 2), { flag: "wx", mode: 0o600 });
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
}
protectPath(path);
let secrets: { SEED_ADMIN_PASSWORD: string };
try { secrets = JSON.parse(await readFile(path, "utf8")); }
catch { throw new Error("No se pudo leer el archivo de credenciales JSON."); }
if (!secrets || typeof secrets.SEED_ADMIN_PASSWORD !== "string" || !secrets.SEED_ADMIN_PASSWORD.trim()) throw new Error("Archivo de credenciales incompleto o inválido.");
if (action === "seed") {
  const child = Bun.spawn(["bun", "scripts/cloudflare-seed.ts", "--target", target!], {
    cwd: root,
    env: { ...process.env, SEED_ADMIN_PASSWORD: secrets.SEED_ADMIN_PASSWORD },
    stdout: "inherit", stderr: "inherit",
  });
  if (await child.exited) throw new Error("Falló el bootstrap; las credenciales se conservaron.");
}
console.log(`Credenciales ${target} conservadas en .wrangler/credentials/${target}.json (excluido de Git).`);
