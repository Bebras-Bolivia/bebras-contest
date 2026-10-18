import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ADMINS, insert, parseOptions, prismaDate, schoolStatements, remoteBootstrapSql, remoteExecuteArgs, executeRemoteBootstrap, executeStatements } from "./cloudflare-seed";
import { catalogStatements } from "./cloudflare-seed-tasks";
import { withLocalD1, runStatements } from "./cloudflare-local-d1";
import { clearTeams } from "../backend/scripts/clear-teams";
import { seedSchools } from "../backend/prisma/seed";

test("targets locales explícitos y parámetros separados del SQL", () => {
  for (const args of [[], ["--target", "unknown"], ["--target", "local", "--remote"], ["--target", "local", "--skip-oversized"]]) assert.throws(() => parseOptions(args));
  const value = "O'Brien'); DROP TABLE User; --";
  const statement = insert("School", "codUe", { codUe: "001", name: value });
  assert.ok(!statement.sql.includes(value));
  assert.deepEqual(statement.params, ["001", value]);
  assert.equal(prismaDate(new Date("2026-01-01Z")), "2026-01-01T00:00:00.000+00:00");
  assert.ok(schoolStatements().length > 10_000);
});

test("bootstrap remoto explícito: production, SQL escapado, límites y limpieza sin red", async () => {
  const value = "O'Brien?'); DROP TABLE User; --";
  const statement = insert("School", "codUe", { codUe: "001", name: value });
  assert.ok(remoteBootstrapSql(statement).includes("O''Brien?''"));
  for (const target of ["production"]) {
    const options = parseOptions(["--target", target]);
    assert.throws(() => parseOptions(["--target", target], true));
    await assert.rejects(executeStatements(options, [statement]));
    const args = remoteExecuteArgs(options, "seed.sql");
    assert.deepEqual(args.slice(5, 8), ["--env", target, "--remote"]);
    let temp = "";
    executeRemoteBootstrap(options, [statement], args => {
      temp = args[args.indexOf("--file") + 1];
      assert.equal(readFileSync(temp, "utf8"), remoteBootstrapSql(statement));
      assert.ok(!args.includes(value));
    });
    assert.ok(!existsSync(temp));
    assert.throws(() => executeRemoteBootstrap(options, [statement], args => {
      temp = args[args.indexOf("--file") + 1];
      throw new Error("simulated failure");
    }));
    assert.ok(!existsSync(temp));
    executeRemoteBootstrap({ ...options, check: true }, [statement], () => assert.fail("--check invocó CLI"));
  }
  assert.throws(() => remoteBootstrapSql(insert("TaskDraft", "id", { id: "task" })));
  assert.throws(() => remoteBootstrapSql(insert("User", "email", { email: "a", role: "admin" }, ["role"])));
  assert.throws(() => remoteBootstrapSql(insert("School", "codUe", { codUe: "x", name: "x".repeat(100_000) })));
});

test("las 43 filas caben; imágenes >100KB son parámetros", () => {
  const { statements, sizes } = catalogStatements();
  assert.equal(statements.length, 43);
  assert.ok(sizes.every(s => s.rowBytes <= 2_000_000 && s.sqlBytes < 100_000));
  assert.equal(sizes.filter(s => s.rowBytes > 100_000).length, 32);
  assert.ok(statements.some(s => s.params.some(p => typeof p === "string" && Buffer.byteLength(p) > 100_000)));
});

test("D1 colegios: snapshot completo, omisión por conteo y --force restaura datos", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bebras-schools-test-"));
  const config = join(dir, "wrangler.jsonc");
  writeFileSync(config, JSON.stringify({ name: "schools-test", compatibility_date: "2026-09-01", d1_databases: [{ binding: "DB", database_name: "schools-test", database_id: "00000000-0000-0000-0000-000000000002" }] }));
  try {
    await withLocalD1(config, async db => {
      const snapshot = schoolStatements();
      const columns = snapshot[0].sql.match(/\((.*?)\) VALUES/)![1];
      await db.prepare(`CREATE TABLE School (${columns.split(",").map(c => `${c} ${c === '"codUe"' ? "TEXT PRIMARY KEY" : ""}`).join(",")})`).run();
      await seedSchools(db, false);
      assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM School").all()).results[0].n, snapshot.length);
      await db.prepare("UPDATE School SET name = 'modified'").run();
      await seedSchools(db, false);
      assert.equal((await db.prepare("SELECT name FROM School LIMIT 1").all()).results[0].name, "modified");
      await seedSchools(db, true);
      assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM School WHERE name = 'modified'").all()).results[0].n, 0);
    }, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("D1 local real: 43 tareas íntegras, reintentos, conflictos y rollback de limpieza", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bebras-d1-test-"));
  const config = join(dir, "wrangler.jsonc");
  writeFileSync(config, JSON.stringify({ name: "seed-test", compatibility_date: "2026-09-01", d1_databases: [{ binding: "DB", database_name: "seed-test", database_id: "00000000-0000-0000-0000-000000000001", remote: true }] }));
  try {
    await withLocalD1(config, async db => {
      const { statements } = catalogStatements();
      const columns = statements[0].sql.match(/\((.*?)\) VALUES/)![1];
      await db.prepare(`CREATE TABLE TaskDraft (${columns.split(",").map(c => `${c} ${c === '"id"' ? "TEXT PRIMARY KEY" : ""}`).join(",")})`).run();
      await runStatements(db, statements);
      await runStatements(db, statements);
      const saved = await db.prepare("SELECT * FROM TaskDraft ORDER BY id").all();
      assert.equal(saved.results.length, 43);
      const names = columns.split(",").map(c => c.replaceAll('"', ""));
      for (const row of saved.results) {
        const original = statements.find(s => s.params[0] === row.id)!;
        assert.ok(original);
        assert.deepEqual(names.map(name => row[name]), original.params);
      }
      await db.prepare('CREATE TABLE User (email TEXT PRIMARY KEY, passwordHash TEXT, updatedAt TEXT, role TEXT)').run();
      await db.prepare('CREATE TABLE School (codUe TEXT PRIMARY KEY, name TEXT UNIQUE)').run();
      const initial = [insert("User", "email", { email: ADMINS[0].email, passwordHash: "original", updatedAt: "date", role: "teacher" }), insert("School", "codUe", { codUe: "001", name: "O'Brien'); DROP TABLE User; --" })];
      await runStatements(db, initial);
      await runStatements(db, [insert("User", "email", { email: ADMINS[0].email, passwordHash: "replacement", updatedAt: "new", role: "admin" }), insert("School", "codUe", { codUe: "001", name: "replacement" })]);
      assert.deepEqual((await db.prepare("SELECT * FROM User").all()).results[0], { email: ADMINS[0].email, passwordHash: "original", updatedAt: "date", role: "teacher" });
      assert.equal((await db.prepare("SELECT name FROM School").all()).results[0].name, initial[1].params[1]);
      await assert.rejects(runStatements(db, [insert("School", "codUe", { codUe: "002", name: initial[1].params[1] })]));
      for (const table of ["AttemptAnswer", "Result", "Attempt", "Team"]) {
        await db.prepare(`CREATE TABLE "${table}" (id INTEGER PRIMARY KEY)`).run();
        await db.prepare(`INSERT INTO "${table}" VALUES (1)`).run();
      }
      await db.prepare('CREATE TABLE Blocker (teamId INTEGER REFERENCES Team(id))').run();
      await db.prepare('INSERT INTO Blocker VALUES (1)').run();
      await assert.rejects(clearTeams(db));
      assert.equal((await db.prepare("SELECT * FROM AttemptAnswer").all()).results.length, 1);
      await db.prepare("DELETE FROM Blocker").run();
      assert.equal(await clearTeams(db), 1);
      assert.equal((await db.prepare("SELECT * FROM AttemptAnswer").all()).results.length, 0);
    }, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
