import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

type QueryResult = {
  results?: { name?: unknown }[];
  success?: boolean;
  meta?: { changed_db?: boolean; rows_written?: number };
};

export function appliedMigrationsFromQuery(output: string): string[] {
  let body: unknown;
  try {
    body = JSON.parse(output);
  } catch {
    throw new Error("Wrangler no devolvió JSON válido al consultar D1.");
  }
  if (!Array.isArray(body) || body.length !== 1) {
    throw new Error("Respuesta inesperada al consultar las migraciones de D1.");
  }
  const query = body[0] as QueryResult;
  if (
    query.success !== true ||
    !Array.isArray(query.results) ||
    query.meta?.changed_db !== false ||
    query.meta?.rows_written !== 0
  ) {
    throw new Error("La consulta de migraciones D1 no fue de solo lectura.");
  }
  const names = query.results.map((row) => row.name);
  if (names.some((name) => typeof name !== "string")) {
    throw new Error("D1 devolvió un historial de migraciones inválido.");
  }
  return names as string[];
}

export function compareMigrations(local: string[], applied: string[]) {
  const localSet = new Set(local);
  const appliedSet = new Set(applied);
  return {
    pending: local.filter((name) => !appliedSet.has(name)),
    unknown: applied.filter((name) => !localSet.has(name)),
  };
}

async function main() {
  const target = process.argv[2];
  if (target !== "production") {
    throw new Error(
      "Uso: bun scripts/cloudflare-migrations-check.ts production",
    );
  }

  const local = (await readdir(join(root, "backend", "migrations")))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const child = Bun.spawn(
    [
      "bun",
      "x",
      "--no-install",
      "wrangler",
      "d1",
      "execute",
      "DB",
      "--env",
      target,
      "--remote",
      "--command",
      "SELECT name FROM d1_migrations ORDER BY id",
      "--json",
      "--config",
      "wrangler.jsonc",
    ],
    {
      cwd: root,
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (stderr.trim()) console.error(stderr.trim());
  if (code !== 0) throw new Error(`No se pudo consultar D1 ${target}.`);

  const applied = appliedMigrationsFromQuery(stdout);
  const comparison = compareMigrations(local, applied);
  if (comparison.unknown.length) {
    throw new Error(
      `D1 ${target} registra migraciones ausentes del repositorio: ${comparison.unknown.join(", ")}.`,
    );
  }
  if (comparison.pending.length) {
    throw new Error(
      `D1 ${target} tiene migraciones pendientes: ${comparison.pending.join(", ")}. ` +
        "El paso automático de aplicación no las completó.",
    );
  }
  console.log(`D1 ${target}: ${applied.length} migraciones aplicadas, sin pendientes.`);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
