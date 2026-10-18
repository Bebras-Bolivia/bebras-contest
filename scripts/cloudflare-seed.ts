import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { readFileSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { withLocalD1, runStatements, type Statement } from "./cloudflare-local-d1";
import { privateDirectory, runWrangler, type CliRunner } from "./cloudflare-cli";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export function isScriptMain(relativePath: string): boolean {
  return !!process.argv[1] && resolve(process.argv[1]) === resolve(ROOT, relativePath);
}
const backendRequire = createRequire(join(ROOT, "backend/package.json"));
export type Target = "local" | "production";
type Options = { target: Target; config: string; check: boolean };
export const ADMINS = [
  { name: "Marko", email: "marko@bebras.bo" },
  { name: "Steven", email: "steven@bebras.bo" },
  { name: "Vladimir", email: "vladimir@bebras.bo" },
];

export function parseOptions(args: string[], tasks = false): Options {
  let target: Target | undefined;
  let config = resolve(ROOT, "wrangler.jsonc");
  let check = false;
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (seen.has(arg)) throw new Error("Parámetro repetido.");
    seen.add(arg);
    if (arg === "--target") {
      const value = args[++i];
      if (!["local", "production"].includes(value)) throw new Error("Target inválido.");
      target = value as Target;
    } else if (arg === "--config") {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error("Falta ruta --config.");
      config = resolve(ROOT, value);
    } else if (arg === "--check") check = true;
    else throw new Error("Parámetro desconocido; consulta --help.");
  }
  if (!target) throw new Error("Es obligatorio --target local|production.");
  if (tasks && target !== "local") throw new Error("El catálogo de tareas sólo admite --target local.");
  return { target, config, check };
}

export function sqlValue(value: unknown): string {
  if (value === null) return "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && !value.includes("\0")) return `'${value.replaceAll("'", "''")}'`;
  throw new Error("Valor SQL inválido en la semilla.");
}

function identifier(value: string): string {
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(value)) throw new Error("Identificador SQL inválido.");
  return `"${value}"`;
}

export function insert(table: "User" | "School" | "TaskDraft", key: string, row: Record<string, unknown>, update: string[] = []): Statement {
  const columns = Object.keys(row);
  const params = columns.map(c => { sqlValue(row[c]); return typeof row[c] === "boolean" ? Number(row[c]) : row[c] as string | number | null; });
  return { sql: `INSERT INTO ${identifier(table)} (${columns.map(identifier).join(",")}) VALUES (${columns.map(() => "?").join(",")}) ON CONFLICT (${identifier(key)}) DO ${update.length ? `UPDATE SET ${update.map(c => `${identifier(c)}=excluded.${identifier(c)}`).join(",")}` : "NOTHING"};`, params };
}

export function prismaDate(date = new Date()): string {
  // @prisma/adapter-d1 7.6.0 conversion.mapArg (not Unix milliseconds).
  return date.toISOString().replace("Z", "+00:00");
}

export function schoolStatements(): Statement[] {
  const text = gunzipSync(readFileSync(join(ROOT, "backend/prisma/seed/schools.ndjson.gz"))).toString("utf8");
  const columns = ["codUe", "codLe", "name", "dep", "pro", "sec", "dis", "depend", "nivel", "area", "latitud", "longitud", "matricula"];
  const required = new Set(["codUe", "name", "dep", "pro", "sec", "dis"]);
  const numbers = new Set(["latitud", "longitud", "matricula"]);
  const codes = new Set<string>();
  const statements = text.split("\n").filter((line) => line.trim()).map((line, index) => {
    const source = JSON.parse(line);
    const row: Record<string, unknown> = {};
    for (const key of columns) {
      const value = source[key];
      if (required.has(key) ? typeof value !== "string" : value !== null && (numbers.has(key) ? typeof value !== "number" || !Number.isFinite(value) : typeof value !== "string")) {
        throw new Error(`Colegio inválido en línea ${index + 1}, campo ${key}.`);
      }
      row[key] = value;
    }
    if (!source.codUe.trim() || !source.name.trim() || !source.dep.trim() || codes.has(source.codUe)) throw new Error(`Código duplicado o colegio incompleto en línea ${index + 1}.`);
    if (source.matricula !== null && !Number.isSafeInteger(source.matricula)) throw new Error("Matrícula inválida.");
    codes.add(source.codUe);
    return insert("School", "codUe", row);
  });
  if (!statements.length) throw new Error("Snapshot de colegios vacío.");
  return statements;
}

export function remoteBootstrapSql(statement: Statement): string {
  // Only generated, additive essential seeds can take the remote CLI path.
  const match = statement.sql.match(/^INSERT INTO "(User|School)" \((?:"[A-Za-z][A-Za-z0-9]*",?)+\) VALUES \((?:\?,?)+\) ON CONFLICT \("(email|codUe)"\) DO NOTHING;$/);
  if (!match || (match[1] === "User" ? match[2] !== "email" : match[2] !== "codUe")) throw new Error("Remoto sólo admite bootstrap aditivo de admins y colegios.");
  let index = 0;
  const sql = statement.sql.replace(/\?/g, () => sqlValue(statement.params[index++]));
  if (index !== statement.params.length || Buffer.byteLength(sql) > 100_000) throw new Error("SQL remoto inválido o excede 100 KB.");
  return sql;
}

export function remoteExecuteArgs(options: Options, file: string): string[] {
  if (options.target !== "production") throw new Error("Ambiente remoto explícito requerido.");
  return ["d1", "execute", "DB", "--config", options.config, "--env", options.target, "--remote", "--file", file, "--yes"];
}

export function executeRemoteBootstrap(options: Options, statements: Statement[], runner: CliRunner = runWrangler): void {
  remoteExecuteArgs(options, "validation.sql");
  const sql = statements.map(remoteBootstrapSql);
  if (options.check) return;
  const directory = privateDirectory("seed-");
  try {
    const file = join(directory, "seed.sql");
    for (let start = 0; start < sql.length; start += 250) {
      writeFileSync(file, sql.slice(start, start + 250).join("\n"), { mode: 0o600 });
      runner(remoteExecuteArgs(options, file));
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

export async function executeStatements(options: Options, statements: Statement[], bootstrapRemote = false): Promise<void> {
  if (options.target !== "local") {
    if (!bootstrapRemote) throw new Error("Esta herramienta sólo admite D1 local.");
    executeRemoteBootstrap(options, statements);
    console.log(`Bootstrap ${options.target}: ${statements.length} sentencias${options.check ? " validadas sin ejecutar" : " completadas"}.`);
    return;
  }
  if (statements.some(({ sql, params }) => Buffer.byteLength(sql) > 100_000 || params.length > 100)) throw new Error("Una sentencia supera los límites D1.");
  if (options.check) {
    console.log(`Validación: ${statements.length} sentencias; target ${options.target}; sin ejecutar Wrangler.`);
    return;
  }
  if (!existsSync(options.config)) throw new Error("No existe la configuración Wrangler. Indica --config con el archivo del Worker que declara DB.");
  await withLocalD1(options.config, db => runStatements(db, statements));
  console.log("Semilla local completada.");
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  if (args.length === 1 && args[0] === "--help") {
    console.log("bun scripts/cloudflare-seed.ts --target local|production [--config ruta] [--check]\nSólo los 3 admins y colegios. Requiere SEED_ADMIN_PASSWORD explícito, incluso con --check.");
    return;
  }
  const options = parseOptions(args);
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password?.trim()) throw new Error("Define SEED_ADMIN_PASSWORD explícitamente en el entorno.");
  const schools = schoolStatements();
  const bcrypt = backendRequire("bcryptjs") as { hash(password: string, rounds: number): Promise<string> };
  const passwordHash = await bcrypt.hash(password, 10);
  const date = prismaDate();
  const admins = ADMINS.map((admin) => insert("User", "email", {
    ...admin, passwordHash, role: "admin", status: "approved", createdAt: date, updatedAt: date,
  }));
  console.log(`Bootstrap: ${admins.length} admins y ${schools.length} colegios.`);
  await executeStatements(options, [...admins, ...schools], true);
}

if (isScriptMain("scripts/cloudflare-seed.ts")) main().catch(() => {
  // Do not serialize errors from input files, bcrypt or child processes (may contain data).
  console.error("Seed falló. Revisa --help, target explícito, SEED_ADMIN_PASSWORD, snapshot, configuración y esquema D1. Ningún registro existente se reemplaza; puedes reintentar.");
  process.exitCode = 1;
});
