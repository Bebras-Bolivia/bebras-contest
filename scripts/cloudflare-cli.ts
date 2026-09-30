import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export type CliRunner = (args: string[]) => void;

export function assertIgnored(file: string): void {
  if (spawnSync("git", ["check-ignore", "--quiet", file], { cwd: root, stdio: "ignore" }).status !== 0) throw new Error("El archivo privado debe estar ignorado por Git.");
}

export function protectPath(path: string, directory = false): void {
  if (process.platform === "win32") {
    // Por su ruta: desde Git Bash, «whoami» es el de Git y no devuelve el SID.
    const system32 = join(process.env.SystemRoot ?? "C:\\Windows", "System32");
    const who = spawnSync(join(system32, "whoami.exe"), ["/user", "/fo", "csv", "/nh"], { encoding: "utf8" });
    const sid = who.stdout?.match(/S-1-[0-9-]+/)?.[0];
    if (!sid || spawnSync(join(system32, "icacls.exe"), [path, "/inheritance:r", "/grant:r", `*${sid}:${directory ? "(OI)(CI)" : ""}F`], { stdio: "ignore" }).status !== 0) throw new Error("No se pudo proteger el SQL.");
  } else chmodSync(path, directory ? 0o700 : 0o600);
}

export const runWrangler: CliRunner = args => {
  const require = createRequire(join(root, "package.json"));
  const cli = join(dirname(require.resolve("wrangler/package.json")), "bin/wrangler.js");
  const env: NodeJS.ProcessEnv = { ...process.env, WRANGLER_WRITE_LOGS: "false", WRANGLER_LOG_SANITIZE: "true", WRANGLER_SEND_METRICS: "false" };
  delete env.SEED_ADMIN_PASSWORD;
  const result = spawnSync("node", [cli, ...args], { cwd: root, env, stdio: "ignore" });
  if (result.status !== 0) throw new Error("Wrangler falló; salida suprimida para proteger datos. Revisa configuración y esquema.");
};

export function privateDirectory(prefix: string): string {
  const base = join(root, ".wrangler");
  mkdirSync(base, { recursive: true });
  const directory = mkdtempSync(join(base, prefix));
  try {
    protectPath(directory, true);
    // Require an existing ignore rule; never leave a database dump in a tracked path.
    assertIgnored(join(directory, "dump.sql"));
    return directory;
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}
