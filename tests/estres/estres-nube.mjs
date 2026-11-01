// Prueba de estrés contra producción: muchos estudiantes rindiendo a la vez
// sobre el Worker y la D1 reales.
//
//   node tests/estres/estres-nube.mjs
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
const STUDENTS = Number(process.env.ESTUDIANTES ?? 1500);
const VISITORS = Number(process.env.VISITANTES ?? 100);
const MAX_IN_FLIGHT = Number(process.env.EN_VUELO ?? 400);
const START_DELAY_MS = Number(process.env.ESPERA_INICIO_S ?? 120) * 1000;
const HEARTBEAT_MS = 30_000;
const GROUP_SIZE = 40;
const KEEP = process.env.CONSERVAR === "1";
const CATEGORIES = [
  { name: "Capibara", range: "8–10", grades: ["P3", "P4"] },
  { name: "Titi", range: "10–12", grades: ["P5", "P6"] },
  { name: "Jucumari", range: "12–14", grades: ["S1", "S2"] },
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
  const rows = query(`SELECT id, answerType, correctAnswerId, shortAnswer, difficulties,
      (SELECT group_concat(json_extract(value, '$.id')) FROM json_each(answers)) AS ids
    FROM "TaskDraft" WHERE answerType IN ('multiple_choice', 'short_text')`);
  const byCategory = {};
  for (const category of CATEGORIES) {
    byCategory[category.name] = rows
      .map((row) => ({ ...row, ids: String(row.ids ?? "").split(",").filter(Boolean), difficulties: JSON.parse(row.difficulties) }))
      .filter((task) =>
        SCORING[task.difficulties[category.range]] &&
        (task.answerType === "short_text" ? task.shortAnswer : task.ids.length > 1 && task.correctAnswerId),
      )
      .slice(0, 12)
      .map((task) => ({ ...task, difficulty: task.difficulties[category.range] }));
  }

  const now = new Date();
  const startsAt = new Date(Date.now() + START_DELAY_MS);
  const endsAt = new Date(startsAt.getTime() + 60 * 60_000);
  const contestId = `estres-${randomUUID()}`;
  const iso = (date) => date.toISOString();
  const statements = [
    `INSERT INTO "Contest" ("id", "title", "categories", "durationMinutes", "startsAt", "endsAt", "scoring", "publishedAt", "showScoreOnSubmit", "showTotalScore", "createdAt", "updatedAt")
     VALUES (${text(contestId)}, ${text(`Prueba de carga ${iso(now).slice(0, 16)}`)}, ${text(JSON.stringify(CATEGORIES.map((c) => c.name)))}, 45,
     ${text(iso(startsAt))}, ${text(iso(endsAt))}, ${text(JSON.stringify(SCORING))}, ${text(iso(now))}, 1, 1, ${text(iso(now))}, ${text(iso(now))})`,
  ];
  for (const category of CATEGORIES) {
    byCategory[category.name].forEach((task, index) => {
      const scores = SCORING[task.difficulty];
      statements.push(`INSERT INTO "ContestTask" ("id", "contestId", "category", "taskDraftId", "position", "difficulty", "minScore", "noAnswerScore", "maxScore", "options", "createdAt")
        VALUES (${text(randomUUID())}, ${text(contestId)}, ${text(category.name)}, ${text(task.id)}, ${index + 1}, ${text(task.difficulty)}, ${scores.wrong}, 0, ${scores.correct}, '{}', ${text(iso(now))})`);
    });
  }

  const students = [];
  const groupCount = Math.ceil(STUDENTS / GROUP_SIZE);
  for (let group = 0; group < groupCount; group += 1) {
    const category = CATEGORIES[group % CATEGORIES.length];
    const groupId = randomUUID();
    statements.push(`INSERT INTO "ContestGroup" ("id", "contestId", "name", "category", "accessCode", "recoveryCode", "createdAt", "updatedAt")
      VALUES (${text(groupId)}, ${text(contestId)}, ${text(`Carga ${group + 1}`)}, ${text(category.name)}, ${text(code(6))}, ${text(code(10))}, ${text(iso(now))}, ${text(iso(now))})`);
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
  return { contestId, byCategory, students, startsAtMs: startsAt.getTime() };
}

// ---- Carga ----

async function student(student, byCategory, startsAtMs, deadline) {
  const tasks = byCategory[student.category];
  const plan = { answers: {}, submitted: Math.random() < 0.7 };

  await sleep(random(0, Math.max(1000, startsAtMs - Date.now() - 15_000)));
  const session = await call("entrar con el código", "/api/play/session", { method: "POST", body: { personalCode: student.code } });
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
    await call("pantalla de espera", "/api/play/attempt", { session: token });
    await sleep(Math.max(0, startsAtMs - Date.now()) + random(500, 5500));
    await call("cargar el intento", "/api/play/attempt", { session: token });
    const started = await call("empezar", "/api/play/start", { method: "POST", session: token });
    if (!started.ok) return { ...student, plan, failed: "empezar" };
    await call("cargar el intento", "/api/play/attempt", { session: token });

    for (const task of tasks) {
      if (Date.now() > deadline) break;
      await sleep(random(4000, 15000));
      const roll = Math.random();
      if (roll < 0.1) continue;
      const correct = roll < 0.65;
      const saved = await call("guardar respuesta", "/api/play/answer", {
        method: "POST",
        body: { taskId: task.id, payload: correct ? correctPayload(task) : wrongPayload(task) },
        session: token,
      });
      if (saved.ok) plan.answers[task.id] = correct;
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
    await call("ranking", "/api/public-ranking");
    await sleep(random(5000, 15000));
  }
}

function expectedScore(tasks, answers) {
  let total = tasks.reduce((sum, task) => sum - SCORING[task.difficulty].wrong, 0);
  let correct = 0;
  for (const task of tasks) {
    if (!(task.id in answers)) continue;
    total += answers[task.id] ? SCORING[task.difficulty].correct : SCORING[task.difficulty].wrong;
    if (answers[task.id]) correct += 1;
  }
  return { total, correct, answered: Object.keys(answers).length };
}

async function main() {
  console.log(`Prueba de estrés: ${STUDENTS} estudiantes y ${VISITORS} visitantes contra ${API}`);
  let started = performance.now();
  const { contestId, byCategory, students, startsAtMs } = prepare();
  const setupS = (performance.now() - started) / 1000;
  console.log(`Preparado en ${setupS.toFixed(1)} s (${contestId}); empieza a las ${new Date(startsAtMs).toLocaleTimeString()}`);

  try {
    loadStartedAt.value = performance.now();
    started = performance.now();
    const deadline = startsAtMs + 10 * 60_000;
    const visitors = Array.from({ length: VISITORS }, async () => {
      await sleep(random(0, 10_000));
      await visitor();
    });
    const runs = await Promise.all(students.map((item) => student(item, byCategory, startsAtMs, deadline)));
    load.running = false;
    await Promise.all(visitors);
    const loadS = (performance.now() - started) / 1000;
    const loadMetrics = summarize();
    metrics.clear();
    loadStartedAt.value = 0;

    // Cierre: se adelanta el fin y la primera consulta pública cierra los
    // intentos abiertos, calcula el ranking y publica los resultados.
    runFile([`UPDATE "Contest" SET "endsAt" = ${text(new Date(Date.now() - 1000).toISOString())} WHERE "id" = ${text(contestId)}`]);
    started = performance.now();
    const closing = await call("cierre y ranking", "/api/public-contests");
    const closeMs = performance.now() - started;

    const rows = query(`SELECT t."memberOneFirstName" AS name, a."status", r."totalScore", r."correctCount", r."answeredCount", r."rankPosition", g."category"
      FROM "Team" t JOIN "ContestGroup" g ON g."id" = t."groupId" JOIN "Attempt" a ON a."teamId" = t."id" LEFT JOIN "Result" r ON r."attemptId" = a."id"
      WHERE g."contestId" = ${text(contestId)}`);
    const byName = new Map(rows.map((row) => [row.name, row]));
    const mismatches = [];
    for (const run of runs) {
      const row = byName.get(run.name);
      const expected = expectedScore(byCategory[run.category], run.plan.answers);
      if (!row || row.status !== "finished" || row.totalScore !== expected.total || row.correctCount !== expected.correct || row.answeredCount !== expected.answered) {
        mismatches.push({ estudiante: run.name, esperado: expected, obtenido: row ?? null });
      }
    }
    const rankProblems = [];
    for (const category of CATEGORIES) {
      const ranked = rows.filter((row) => row.category === category.name && row.rankPosition).sort((a, b) => a.rankPosition - b.rankPosition);
      ranked.forEach((row, position) => {
        if (row.rankPosition !== position + 1) rankProblems.push(`${category.name}: puesto ${row.rankPosition} en la posición ${position + 1}`);
        if (position > 0 && ranked[position - 1].totalScore < row.totalScore) rankProblems.push(`${category.name}: puesto ${row.rankPosition} supera al anterior`);
      });
    }

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
      entregaron: runs.filter((run) => run.plan.submitted).length,
      fallaron_al_entrar_o_empezar: runs.filter((run) => run.failed).length,
      preparacion_s: Number(setupS.toFixed(1)),
      carga_s: Number(loadS.toFixed(1)),
      peticiones: requests,
      peticiones_fallidas: failed,
      peticiones_por_segundo_media: Number((requests / loadS).toFixed(1)),
      cierre: { ms: Math.round(closeMs), estado: closing.status },
      verificacion: {
        filas: rows.length,
        puntajes_distintos: mismatches.length,
        ejemplos: mismatches.slice(0, 5),
        problemas_de_ranking: rankProblems.length,
        ejemplos_ranking: rankProblems.slice(0, 5),
      },
      desafio: contestId,
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
      runFile([`DELETE FROM "Contest" WHERE "id" = ${text(contestId)}`]);
      const left = query(`SELECT COUNT(*) AS n FROM "ContestGroup" WHERE "contestId" = ${text(contestId)}`)[0].n;
      console.log(`Datos de la prueba borrados (grupos restantes: ${left}).`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
