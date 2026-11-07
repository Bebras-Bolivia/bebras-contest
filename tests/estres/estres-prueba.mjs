// Prueba de estrés de la prueba vinculada: muchos estudiantes entran con el
// código personal de un desafío (de mentira) a una prueba que lo tiene como
// origen y la rinden, sobre el Worker y la D1 reales. La prueba copia las
// preguntas de la «Prueba del Desafío Bebras 2026» de producción.
//
//   node tests/estres/estres-prueba.mjs
//
// Variables: ESTUDIANTES (1500), VISITANTES (100), API (https://bebrasbolivia.org),
// EN_VUELO (400), ESPERA_INICIO_S (120), SALIDA (archivo JSON), CONSERVAR (1 para no borrar).
//
// No usa cuentas: el desafío, sus grupos y los estudiantes se escriben en la
// D1 de producción con Wrangler, y los estudiantes entran con su código
// personal como en el concurso. Al terminar se borra el desafío con todo lo
// que cuelga de él.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const API = process.env.API ?? "https://bebrasbolivia.org";
const STUDENTS = Number(process.env.ESTUDIANTES ?? 400);
const VISITORS = Number(process.env.VISITANTES ?? 50);
const SPREAD_S = Number(process.env.ENTRADA_S ?? 90);
const PUBLIC_TEST = process.env.PRUEBA ?? "c45aa7139b739b9dc69ba8bf9";
const MAX_IN_FLIGHT = Number(process.env.EN_VUELO ?? 400);
const START_DELAY_MS = Number(process.env.ESPERA_INICIO_S ?? 120) * 1000;
const HEARTBEAT_MS = 30_000;
const GROUP_SIZE = 40;
const KEEP = process.env.CONSERVAR === "1";
const CATEGORIES = [
  { name: "Guacamayo", grades: ["P1", "P2"] },
  { name: "Capibara", grades: ["P3", "P4"] },
  { name: "Titi", grades: ["P5", "P6"] },
  { name: "Jucumari", grades: ["S1", "S2"] },
  { name: "Yaguareté", grades: ["S3", "S4"] },
  { name: "Kuntur", grades: ["S5", "S6"] },
];
const SCORING = {
  easy: { correct: 6, wrong: -2 },
  medium: { correct: 9, wrong: -3 },
  hard: { correct: 12, wrong: -4 },
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const random = (min, max) => min + Math.random() * (max - min);
const work = mkdtempSync(join(tmpdir(), "bebras-estres-"));

// ---- D1 de producción ----

function wrangler(args) {
  return execFileSync(
    "bun",
    ["x", "wrangler", "d1", "execute", "DB", "--env", "production", "--remote", "--config", "wrangler.jsonc", ...args],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
}

function query(sql) {
  const out = wrangler(["--json", "--command", sql.replace(/\s+/g, " ")]);
  return JSON.parse(out.slice(out.indexOf("[")))[0].results;
}

function runFile(statements) {
  const file = join(work, `lote-${randomUUID()}.sql`);
  writeFileSync(file, statements.join(";\n") + ";\n");
  wrangler(["--yes", "--file", file]);
}

const text = (value) => (value === null ? "NULL" : `'${String(value).replaceAll("'", "''")}'`);
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const usedCodes = new Set();
function code(length) {
  for (;;) {
    const value = Array.from({ length }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
    if (!usedCodes.has(value)) {
      usedCodes.add(value);
      return `E${value.slice(1)}`;
    }
  }
}

// ---- Medición ----

const metrics = new Map();
let inFlight = 0;
const waiting = [];

async function acquire() {
  if (inFlight < MAX_IN_FLIGHT) {
    inFlight += 1;
    return;
  }
  await new Promise((resolve) => waiting.push(resolve));
  inFlight += 1;
}

function release() {
  inFlight -= 1;
  waiting.shift()?.();
}

const timeline = [];
const loadStartedAt = { value: 0 };

function record(name, ms, status) {
  const entry = metrics.get(name) ?? { durations: [], statuses: {}, errors: [] };
  entry.durations.push(ms);
  entry.statuses[status] = (entry.statuses[status] ?? 0) + 1;
  metrics.set(name, entry);
  if (loadStartedAt.value) {
    timeline.push({ t: Math.round((performance.now() - loadStartedAt.value) / 1000), ms: Math.round(ms), ok: String(status).startsWith("2") });
  }
}

async function call(name, path, { method = "GET", body, session } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (session) headers["x-play-session"] = session;
  await acquire();
  const started = performance.now();
  let status = "red";
  try {
    const response = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    status = response.status;
    const raw = await response.text();
    let data = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = { message: raw.slice(0, 120) };
    }
    record(name, performance.now() - started, status);
    if (!response.ok) {
      const entry = metrics.get(name);
      if (entry.errors.length < 5) entry.errors.push(`${status}: ${data?.message ?? raw.slice(0, 120)}`);
    }
    return { ok: response.ok, status, data };
  } catch (error) {
    record(name, performance.now() - started, status);
    const entry = metrics.get(name);
    if (entry.errors.length < 5) entry.errors.push(String(error?.message ?? error));
    return { ok: false, status, data: null };
  } finally {
    release();
  }
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function summarize() {
  return [...metrics.entries()].map(([name, entry]) => {
    const sorted = [...entry.durations].sort((a, b) => a - b);
    const failed = Object.entries(entry.statuses)
      .filter(([status]) => !String(status).startsWith("2"))
      .reduce((sum, [, count]) => sum + count, 0);
    return {
      endpoint: name,
      peticiones: sorted.length,
      fallidas: failed,
      p50_ms: Math.round(percentile(sorted, 50)),
      p95_ms: Math.round(percentile(sorted, 95)),
      p99_ms: Math.round(percentile(sorted, 99)),
      max_ms: Math.round(sorted.at(-1) ?? 0),
      estados: entry.statuses,
      errores: entry.errors,
    };
  });
}

// ---- Preparación ----

function correctPayload(task) {
  if (task.answerType === "short_text") return { text: task.shortAnswer };
  const [mode, list] = task.correctAnswerId.includes(":") ? task.correctAnswerId.split(":") : ["single", task.correctAnswerId];
  const ids = list.split(",").filter(Boolean);
  return { selected: mode === "all" ? ids : [ids[0]] };
}

function wrongPayload(task) {
  if (task.answerType === "short_text") return { text: "respuesta equivocada" };
  const correct = correctPayload(task).selected;
  return { selected: [task.ids.find((id) => !correct.includes(id))] };
}

function prepare() {
  const rows = query(`SELECT ct.category, ct.taskDraftId AS id, ct.position, ct.difficulty, ct.minScore, ct.noAnswerScore, ct.maxScore,
      t.answerType, t.correctAnswerId, t.shortAnswer,
      (SELECT group_concat(json_extract(value, '$.id')) FROM json_each(t.answers)) AS ids
    FROM "ContestTask" ct JOIN "TaskDraft" t ON t.id = ct.taskDraftId WHERE ct.contestId = ${text(PUBLIC_TEST)} ORDER BY ct.category, ct.position`);
  if (rows.length === 0) throw new Error("No encontré las preguntas de la prueba pública.");
  const byCategory = {};
  for (const category of CATEGORIES) {
    byCategory[category.name] = rows
      .filter((row) => row.category === category.name)
      .map((row) => ({ ...row, ids: String(row.ids ?? "").split(",").filter(Boolean) }));
  }

  const now = new Date();
  const iso = (date) => date.toISOString();
  const sourceId = `estres-${randomUUID()}`;
  const testId = `estres-${randomUUID()}`;
  const sourceTitle = `[Ensayo] Carga origen ${iso(now).slice(0, 16)}`;
  const testTitle = `[Ensayo] Carga prueba ${iso(now).slice(0, 16)}`;
  const names = text(JSON.stringify(CATEGORIES.map((c) => c.name)));
  const statements = [
    `INSERT INTO "Contest" ("id", "title", "categories", "durationMinutes", "startsAt", "endsAt", "scoring", "publishedAt", "showScoreOnSubmit", "showTotalScore", "createdAt", "updatedAt")
     VALUES (${text(sourceId)}, ${text(sourceTitle)}, ${names}, 45, ${text(iso(new Date(Date.now() + 30 * 864e5)))}, ${text(iso(new Date(Date.now() + 31 * 864e5)))}, ${text(JSON.stringify(SCORING))}, ${text(iso(now))}, 1, 1, ${text(iso(now))}, ${text(iso(now))})`,
    `INSERT INTO "Contest" ("id", "title", "categories", "durationMinutes", "startsAt", "endsAt", "scoring", "publishedAt", "isTest", "linkedContestId", "showFeedback", "showSolutions", "showScoreOnSubmit", "showTotalScore", "createdAt", "updatedAt")
     VALUES (${text(testId)}, ${text(testTitle)}, ${names}, 45, ${text(iso(new Date(Date.now() - 120_000)))}, ${text(iso(new Date(Date.now() + 2 * 3600_000)))}, ${text(JSON.stringify(SCORING))}, ${text(iso(now))}, 1, ${text(sourceId)}, 1, 1, 1, 1, ${text(iso(now))}, ${text(iso(now))})`,
  ];
  for (const category of CATEGORIES) {
    for (const task of byCategory[category.name]) {
      statements.push(`INSERT INTO "ContestTask" ("id", "contestId", "category", "taskDraftId", "position", "difficulty", "minScore", "noAnswerScore", "maxScore", "options", "createdAt")
        VALUES (${text(randomUUID())}, ${text(testId)}, ${text(category.name)}, ${text(task.id)}, ${task.position}, ${text(task.difficulty)}, ${task.minScore}, ${task.noAnswerScore}, ${task.maxScore}, '{}', ${text(iso(now))})`);
    }
  }

  const students = [];
  const groupCount = Math.ceil(STUDENTS / GROUP_SIZE);
  for (let group = 0; group < groupCount; group += 1) {
    const category = CATEGORIES[group % CATEGORIES.length];
    const groupId = randomUUID();
    statements.push(`INSERT INTO "ContestGroup" ("id", "contestId", "name", "category", "accessCode", "recoveryCode", "createdAt", "updatedAt")
      VALUES (${text(groupId)}, ${text(sourceId)}, ${text(`Carga ${group + 1}`)}, ${text(category.name)}, ${text(code(6))}, ${text(code(10))}, ${text(iso(now))}, ${text(iso(now))})`);
    const values = [];
    const attempts = [];
    for (let seat = 0; seat < GROUP_SIZE && students.length < STUDENTS; seat += 1) {
      const index = students.length;
      const teamId = randomUUID();
      const personalCode = code(8);
      values.push(`(${text(teamId)}, ${text(groupId)}, 'individual', ${text(category.grades[index % 2])}, ${text(`Estudiante${index + 1}`)}, 'Prueba Carga', ${text(personalCode)}, ${text(iso(now))}, ${text(iso(now))})`);
      attempts.push(`(${text(randomUUID())}, ${text(teamId)}, 'pending', 'online', ${text(iso(now))}, ${text(iso(now))})`);
      students.push({ name: `Estudiante${index + 1}`, code: personalCode, category: category.name });
    }
    statements.push(`INSERT INTO "Team" ("id", "groupId", "participationMode", "grade", "memberOneFirstName", "memberOneLastName", "personalCode", "createdAt", "updatedAt") VALUES ${values.join(", ")}`);
    statements.push(`INSERT INTO "Attempt" ("id", "teamId", "status", "mode", "createdAt", "updatedAt") VALUES ${attempts.join(", ")}`);
  }

  for (let start = 0; start < statements.length; start += 40) {
    runFile(statements.slice(start, start + 40));
  }
  return { sourceId, testId, byCategory, students };
}

// ---- Carga ----

const SUPPORTED = new Set(["multiple_choice", "short_text"]);

async function student(student, byCategory, testId, deadline) {
  const tasks = byCategory[student.category];
  const plan = { answered: 0, submitted: Math.random() < 0.7 };

  await sleep(random(0, SPREAD_S * 1000));
  await call("ofrecer pruebas", "/api/play/practices", { method: "POST", body: { personalCode: student.code } });
  const session = await call("entrar a la prueba", "/api/play/linked-session", {
    method: "POST",
    body: { personalCode: student.code, contestId: testId },
  });
  if (!session.ok) return { ...student, plan, failed: "entrar" };
  const token = session.data.sessionToken;

  let beating = true;
  const heartbeat = (async () => {
    await sleep(random(0, HEARTBEAT_MS));
    while (beating) {
      await call("latido", "/api/play/heartbeat", { method: "POST", session: token });
      await sleep(HEARTBEAT_MS);
    }
  })();

  try {
    await call("cargar el intento", "/api/play/attempt", { session: token });
    const started = await call("empezar", "/api/play/start", { method: "POST", session: token });
    if (!started.ok) return { ...student, plan, failed: "empezar" };
    await call("cargar el intento", "/api/play/attempt", { session: token });

    for (const task of tasks) {
      if (Date.now() > deadline) break;
      await sleep(random(2500, 8000));
      if (!SUPPORTED.has(task.answerType) || Math.random() < 0.1) continue;
      const correct = Math.random() < 0.55;
      const saved = await call("guardar respuesta", "/api/play/answer", {
        method: "POST",
        body: { taskId: task.id, payload: correct ? correctPayload(task) : wrongPayload(task) },
        session: token,
      });
      if (saved.ok) plan.answered += 1;
    }

    if (plan.submitted) {
      const done = await call("entregar", "/api/play/submit", { method: "POST", session: token });
      if (!done.ok) plan.submitted = false;
      await call("cargar el intento", "/api/play/attempt", { session: token });
    }
  } finally {
    beating = false;
    await heartbeat;
  }
  return { ...student, plan };
}

const load = { running: true };

async function visitor() {
  while (load.running) {
    await call("portada", "/api/public-contests");
    await sleep(random(5000, 15000));
  }
}

async function main() {
  console.log(`Prueba de estrés de la prueba vinculada: ${STUDENTS} estudiantes y ${VISITORS} visitantes contra ${API}`);
  let started = performance.now();
  const { sourceId, testId, byCategory, students } = prepare();
  const setupS = (performance.now() - started) / 1000;
  console.log(`Preparado en ${setupS.toFixed(1)} s (origen ${sourceId}, prueba ${testId})`);

  try {
    loadStartedAt.value = performance.now();
    started = performance.now();
    const deadline = Date.now() + (SPREAD_S + 240) * 1000;
    const visitors = Array.from({ length: VISITORS }, async () => {
      await sleep(random(0, 10_000));
      await visitor();
    });
    const runs = await Promise.all(students.map((item) => student(item, byCategory, testId, deadline)));
    load.running = false;
    await Promise.all(visitors);
    const loadS = (performance.now() - started) / 1000;
    const loadMetrics = summarize();

    const rows = query(`SELECT a."status" AS status, COUNT(*) AS n FROM "Attempt" a JOIN "Team" t ON t."id" = a."teamId"
      JOIN "ContestGroup" g ON g."id" = t."groupId" WHERE g."contestId" = ${text(testId)} GROUP BY a."status"`);
    const answers = query(`SELECT COUNT(*) AS n FROM "AttemptAnswer" an JOIN "Attempt" a ON a."id" = an."attemptId" JOIN "Team" t ON t."id" = a."teamId"
      JOIN "ContestGroup" g ON g."id" = t."groupId" WHERE g."contestId" = ${text(testId)}`)[0]?.n ?? null;
    const requests = loadMetrics.reduce((sum, item) => sum + item.peticiones, 0);
    const failed = loadMetrics.reduce((sum, item) => sum + item.fallidas, 0);
    const perSecond = new Map();
    for (const point of timeline) {
      const bucket = perSecond.get(point.t) ?? { peticiones: 0, fallidas: 0, ms: [] };
      bucket.peticiones += 1;
      if (!point.ok) bucket.fallidas += 1;
      bucket.ms.push(point.ms);
      perSecond.set(point.t, bucket);
    }
    const report = {
      fecha: new Date().toISOString(),
      api: API,
      estudiantes: students.length,
      visitantes: VISITORS,
      entraron_a_la_prueba: runs.filter((run) => !run.failed).length,
      entregaron: runs.filter((run) => run.plan.submitted).length,
      fallaron_al_entrar_o_empezar: runs.filter((run) => run.failed).length,
      respuestas_enviadas: runs.reduce((sum, run) => sum + run.plan.answered, 0),
      respuestas_guardadas_en_la_base: answers,
      intentos_por_estado: rows,
      preparacion_s: Number(setupS.toFixed(1)),
      carga_s: Number(loadS.toFixed(1)),
      peticiones: requests,
      peticiones_fallidas: failed,
      peticiones_por_segundo_media: Number((requests / loadS).toFixed(1)),
      preguntas_por_categoria: Object.fromEntries(Object.entries(byCategory).map(([name, list]) => [name, list.length])),
      carga: loadMetrics,
      por_segundo: [...perSecond.entries()].sort((a, b) => a[0] - b[0]).map(([t, bucket]) => {
        const sorted = bucket.ms.sort((a, b) => a - b);
        return { t, peticiones: bucket.peticiones, fallidas: bucket.fallidas, p50_ms: percentile(sorted, 50), p95_ms: percentile(sorted, 95) };
      }),
    };
    console.table(loadMetrics.map(({ estados, errores, ...row }) => row));
    console.log(JSON.stringify({ ...report, carga: undefined, por_segundo: undefined }, null, 2));
    if (process.env.SALIDA) writeFileSync(process.env.SALIDA, JSON.stringify(report, null, 2));
  } finally {
    if (!KEEP) {
      runFile([`DELETE FROM "Contest" WHERE "id" = ${text(testId)}`]);
      runFile([`DELETE FROM "Contest" WHERE "id" = ${text(sourceId)}`]);
      const left = query(`SELECT COUNT(*) AS n FROM "ContestGroup" WHERE "contestId" IN (${text(testId)}, ${text(sourceId)})`)[0].n;
      const contestsLeft = query(`SELECT COUNT(*) AS n FROM "Contest" WHERE "id" IN (${text(testId)}, ${text(sourceId)})`)[0].n;
      console.log(`Datos de la prueba borrados (grupos restantes: ${left}, desafíos restantes: ${contestsLeft}).`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
