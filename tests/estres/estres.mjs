// Prueba de estrés del desafío: muchos estudiantes rindiendo a la vez.
//
// Corre contra el entorno local (`bun run dev:local`), que activa BEBRAS_E2E:
// cada respuesta trae la cabecera X-D1-Queries con las sentencias que mandó a
// D1, y el reloj de pruebas permite cerrar el desafío sin esperar.
//
//   node tests/estres/estres.mjs
//
// Variables: ESTUDIANTES (1600), VISITANTES (100), API (http://127.0.0.1:3000),
// ADMIN_EMAIL (marko@bebras.bo), ADMIN_PASSWORD (bebras123), SALIDA (archivo JSON).
//
// Crea un desafío «Prueba de estrés …» con sus grupos y estudiantes, que queda
// en la base local: se borra con tests/estres/limpiar.py.

import { writeFileSync } from "node:fs";

const API = process.env.API ?? "http://127.0.0.1:3000";
const AUTH_EMULATOR = process.env.AUTH_EMULATOR ?? "http://127.0.0.1:9099";
const STUDENTS = Number(process.env.ESTUDIANTES ?? 1600);
const VISITORS = Number(process.env.VISITANTES ?? 100);
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "marko@bebras.bo";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "bebras123";
const GROUP_SIZE = 40;
// Todos entran antes de la hora y, al abrirse, empiezan en los mismos 5 s.
const START_DELAY_MS = Number(process.env.ESPERA_INICIO_S ?? 90) * 1000;
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
// El proxy local de `wrangler dev` corta conexiones pasadas unas cientos a la
// vez («Network connection lost»); en Cloudflare no existe. Se limitan las
// peticiones en vuelo, como un balanceador: los estudiantes siguen activos a
// la vez, pero sus peticiones hacen fila. La espera se mide aparte.
const MAX_IN_FLIGHT = Number(process.env.EN_VUELO ?? 64);
const D1_LIMIT_PAID = 1000;
const D1_LIMIT_FREE = 50;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const random = (min, max) => min + Math.random() * (max - min);

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

function record(name, ms, status, queries, serverMs = ms) {
  const entry = metrics.get(name) ?? {
    durations: [],
    server: [],
    statuses: {},
    queries: [],
    errors: [],
  };
  entry.durations.push(ms);
  entry.server.push(serverMs);
  entry.statuses[status] = (entry.statuses[status] ?? 0) + 1;
  if (Number.isFinite(queries)) entry.queries.push(queries);
  metrics.set(name, entry);
}

async function call(name, path, { method = "GET", body, token, session } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (session) headers["x-play-session"] = session;
  const started = performance.now();
  await acquire();
  const sent = performance.now();
  let status = "red";
  let queries = NaN;
  try {
    const response = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    status = response.status;
    queries = Number(response.headers.get("x-d1-queries"));
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { message: text.slice(0, 120) };
    }
    record(name, performance.now() - started, status, queries, performance.now() - sent);
    if (!response.ok) {
      const entry = metrics.get(name);
      if (entry.errors.length < 5) entry.errors.push(`${status}: ${data?.message ?? text}`);
    }
    return { ok: response.ok, status, data };
  } catch (error) {
    record(name, performance.now() - started, status, queries, performance.now() - sent);
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
    const server = [...entry.server].sort((a, b) => a - b);
    const queries = [...entry.queries].sort((a, b) => a - b);
    const total = sorted.length;
    const failed = Object.entries(entry.statuses)
      .filter(([status]) => !String(status).startsWith("2"))
      .reduce((sum, [, count]) => sum + count, 0);
    return {
      endpoint: name,
      peticiones: total,
      fallidas: failed,
      p50_ms: Math.round(percentile(sorted, 50)),
      p95_ms: Math.round(percentile(sorted, 95)),
      p99_ms: Math.round(percentile(sorted, 99)),
      max_ms: Math.round(sorted.at(-1) ?? 0),
      servidor_p50_ms: Math.round(percentile(server, 50)),
      servidor_p95_ms: Math.round(percentile(server, 95)),
      consultas_d1_media: queries.length
        ? Number((queries.reduce((a, b) => a + b, 0) / queries.length).toFixed(1))
        : null,
      consultas_d1_max: queries.at(-1) ?? null,
      consultas_d1_total: queries.reduce((a, b) => a + b, 0),
      estados: entry.statuses,
      errores: entry.errors,
    };
  });
}

// ---- Preparación con la API real ----

async function adminToken() {
  const response = await fetch(
    `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=local`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
        returnSecureToken: true,
      }),
    },
  );
  const data = await response.json();
  if (!data.idToken) throw new Error(`No se pudo entrar como admin: ${JSON.stringify(data)}`);
  return data.idToken;
}

function correctPayload(task) {
  if (task.answerType === "short_text") return { text: task.shortAnswer };
  const raw = String(task.correctAnswerId ?? "");
  const [mode, list] = raw.includes(":") ? raw.split(":") : ["single", raw];
  const ids = list.split(",").filter(Boolean);
  return { selected: mode === "all" ? ids : [ids[0]] };
}

function wrongPayload(task) {
  if (task.answerType === "short_text") return { text: "respuesta equivocada" };
  const correct = correctPayload(task).selected;
  const other = task.answers.map((answer) => answer.id).find((id) => !correct.includes(id));
  return { selected: [other] };
}

async function mapLimit(items, limit, run) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        results[index] = await run(items[index], index);
      }
    }),
  );
  return results;
}

async function prepare(token) {
  const tasks = (await call("admin: tareas", "/api/tasks", { token })).data;
  const byCategory = {};
  for (const category of CATEGORIES) {
    byCategory[category.name] = tasks
      .filter(
        (task) =>
          ["multiple_choice", "short_text"].includes(task.answerType) &&
          SCORING[task.difficulties?.[category.range]] &&
          (task.answerType === "short_text"
            ? task.shortAnswer
            : task.answers.length > 1 && task.correctAnswerId),
      )
      .slice(0, 12)
      .map((task) => ({ ...task, difficulty: task.difficulties[category.range] }));
  }

  const startsAt = new Date(Date.now() + 10 * 60_000);
  const payload = {
    title: `Prueba de estrés ${new Date().toISOString().slice(0, 16)}`,
    categories: CATEGORIES.map((category) => category.name),
    durationMinutes: 45,
    startsAt: startsAt.toISOString(),
    endsAt: new Date(startsAt.getTime() + 60 * 60_000).toISOString(),
    tasks: CATEGORIES.flatMap((category) =>
      byCategory[category.name].map((task) => ({ taskId: task.id, category: category.name })),
    ),
  };
  const created = await call("admin: crear desafío", "/api/contests", {
    method: "POST",
    body: payload,
    token,
  });
  if (!created.ok) throw new Error(`No se creó el desafío: ${JSON.stringify(created.data)}`);
  const contest = created.data;
  const published = await call("admin: publicar", `/api/contests/${contest.id}/publish`, {
    method: "POST",
    token,
  });
  if (!published.ok) throw new Error(`No se publicó: ${JSON.stringify(published.data)}`);

  const groupCount = Math.ceil(STUDENTS / GROUP_SIZE);
  const groups = await mapLimit(
    Array.from({ length: groupCount }, (_, index) => index),
    10,
    async (index) => {
      const category = CATEGORIES[index % CATEGORIES.length];
      const result = await call("maestro: crear grupo", "/api/groups", {
        method: "POST",
        body: { contestId: contest.id, category: category.name, name: `Estrés ${index + 1}` },
        token,
      });
      if (!result.ok) throw new Error(`No se creó el grupo: ${JSON.stringify(result.data)}`);
      return { ...result.data, category };
    },
  );

  const seats = Array.from({ length: STUDENTS }, (_, index) => ({
    index,
    group: groups[Math.floor(index / GROUP_SIZE)],
  }));
  const students = (
    await mapLimit(seats, 20, async ({ index, group }) => {
      const grade = group.category.grades[index % 2];
      const result = await call("maestro: inscribir", `/api/groups/${group.id}/teams`, {
        method: "POST",
        body: {
          participationMode: "individual",
          grade,
          memberOneFirstName: `Estudiante${index + 1}`,
          memberOneLastName: `Prueba Estres`,
        },
        token,
      });
      return result.ok
        ? {
            name: `Estudiante${index + 1}`,
            code: result.data.personalCode,
            category: group.category.name,
          }
        : null;
    })
  ).filter(Boolean);

  // La rendición abre en unos segundos, con la misma edición que usa el
  // administrador: así se mide también la espera y la avalancha del inicio.
  const startsAtMs = Date.now() + START_DELAY_MS;
  const opened = await call("admin: fijar inicio", `/api/contests/${contest.id}`, {
    method: "PUT",
    body: { ...payload, startsAt: new Date(startsAtMs).toISOString() },
    token,
  });
  if (!opened.ok) throw new Error(`No se fijó el inicio: ${JSON.stringify(opened.data)}`);

  return { contest: opened.data, byCategory, students, startsAtMs };
}

// ---- Carga ----

async function student(student, byCategory, deadline, startsAtMs) {
  const tasks = byCategory[student.category];
  const plan = { answers: {}, submitted: Math.random() < 0.7 };

  // Llegan escalonados durante la espera, como en un laboratorio.
  await sleep(random(0, Math.max(1000, startsAtMs - Date.now() - 15_000)));
  const session = await call("estudiante: entrar", "/api/play/session", {
    method: "POST",
    body: { personalCode: student.code },
  });
  if (!session.ok) return { ...student, plan, failed: "entrar" };
  const token = session.data.sessionToken;

  let beating = true;
  const heartbeat = (async () => {
    while (beating) {
      await sleep(10_000);
      if (beating) await call("estudiante: latido", "/api/play/heartbeat", { method: "POST", session: token });
    }
  })();

  try {
    await call("estudiante: esperar inicio", "/api/play/attempt", { session: token });
    // La pantalla consulta al llegar la hora con un desfase de hasta 5 s.
    await sleep(Math.max(0, startsAtMs - Date.now()) + random(500, 5500));
    await call("estudiante: cargar intento", "/api/play/attempt", { session: token });
    const started = await call("estudiante: empezar", "/api/play/start", { method: "POST", session: token });
    if (!started.ok) return { ...student, plan, failed: "empezar" };
    await call("estudiante: cargar intento", "/api/play/attempt", { session: token });

    for (const task of tasks) {
      if (Date.now() > deadline) break;
      await sleep(random(1500, 6000));
      const roll = Math.random();
      if (roll < 0.1) continue;
      const correct = roll < 0.65;
      const payload = correct ? correctPayload(task) : wrongPayload(task);
      const saved = await call("estudiante: guardar respuesta", "/api/play/answer", {
        method: "POST",
        body: { taskId: task.id, payload },
        session: token,
      });
      if (saved.ok) plan.answers[task.id] = correct;
    }

    if (plan.submitted) {
      const done = await call("estudiante: entregar", "/api/play/submit", { method: "POST", session: token });
      if (!done.ok) plan.submitted = false;
      await call("estudiante: cargar intento", "/api/play/attempt", { session: token });
    }
  } finally {
    beating = false;
    await heartbeat;
  }
  return { ...student, plan };
}

const load = { running: true };

async function visitor(until) {
  while (load.running && Date.now() < until) {
    await call("visitante: portada", "/api/public-contests");
    await call("visitante: ranking", "/api/public-ranking");
    await sleep(random(3000, 8000));
  }
}

// ---- Verificación ----

function expectedScore(tasks, answers) {
  let total = tasks.reduce((sum, task) => sum - SCORING[task.difficulty].wrong, 0);
  let correct = 0;
  for (const task of tasks) {
    if (!(task.id in answers)) continue;
    if (answers[task.id]) {
      total += SCORING[task.difficulty].correct;
      correct += 1;
    } else {
      total += SCORING[task.difficulty].wrong;
    }
  }
  return { total, correct, answered: Object.keys(answers).length };
}

async function main() {
  console.log(
    `Prueba de estrés: ${STUDENTS} estudiantes y ${VISITORS} visitantes contra ${API} (hasta ${MAX_IN_FLIGHT} peticiones en vuelo)`,
  );
  const token = await adminToken();

  let started = performance.now();
  const { contest, byCategory, students, startsAtMs } = await prepare(token);
  const setupMs = performance.now() - started;
  console.log(
    `Preparado en ${(setupMs / 1000).toFixed(1)} s: ${students.length} estudiantes, preguntas ${CATEGORIES.map((c) => `${c.name} ${byCategory[c.name].length}`).join(", ")}`,
  );

  // Solo la carga cuenta para el rendimiento: se reinicia la medición.
  const setupMetrics = summarize();
  metrics.clear();

  started = performance.now();
  const deadline = startsAtMs + 10 * 60_000;
  const visitors = Array.from({ length: VISITORS }, () => visitor(deadline));
  const runs = await Promise.all(
    students.map((item) => student(item, byCategory, deadline, startsAtMs)),
  );
  load.running = false;
  const loadMs = performance.now() - started;
  console.log(`Carga terminada en ${(loadMs / 1000).toFixed(1)} s. Esperando a los visitantes…`);
  await Promise.all(visitors);
  const loadMetrics = summarize();
  metrics.clear();

  // Cierre: el reloj de pruebas pasa la hora de cierre y cualquier consulta
  // publica los resultados (cierra los intentos abiertos y arma el ranking).
  const closeAt = new Date(new Date(contest.endsAt).getTime() + 60_000);
  await call("reloj de pruebas", "/api/e2e/clock", {
    method: "PUT",
    body: { now: closeAt.toISOString() },
  });
  started = performance.now();
  const release = await call("cierre: publicar resultados", "/api/public-contests");
  const releaseMs = performance.now() - started;
  const results = await call("admin: resultados", `/api/contests/${contest.id}/results`, { token });
  await call("reloj de pruebas", "/api/e2e/clock", { method: "DELETE" });
  const closeMetrics = summarize();

  // Comparación de cada puntaje y cada puesto con lo que se respondió.
  const byName = new Map(
    (results.data?.rows ?? []).map((row) => [row.memberOneFirstName, row]),
  );
  const mismatches = [];
  const finishedRows = [];
  for (const run of runs) {
    const row = byName.get(run.name);
    if (!row) {
      mismatches.push({ estudiante: run.name, problema: "sin fila en resultados" });
      continue;
    }
    const expected = expectedScore(byCategory[run.category], run.plan.answers);
    if (row.status !== "finished") {
      mismatches.push({ estudiante: run.name, problema: `estado ${row.status}` });
      continue;
    }
    if (
      row.totalScore !== expected.total ||
      row.correctCount !== expected.correct ||
      row.answeredCount !== expected.answered
    ) {
      mismatches.push({
        estudiante: run.name,
        esperado: expected,
        obtenido: { total: row.totalScore, correct: row.correctCount, answered: row.answeredCount },
      });
    }
    finishedRows.push(row);
  }

  const rankProblems = [];
  for (const category of CATEGORIES) {
    const inCategory = finishedRows
      .filter((row) => row.category === category.name)
      .sort((left, right) => left.rankPosition - right.rankPosition);
    inCategory.forEach((row, position) => {
      if (row.rankPosition !== position + 1) {
        rankProblems.push(`${category.name}: puesto ${row.rankPosition} en la posición ${position + 1}`);
      }
      const previous = inCategory[position - 1];
      if (previous && previous.totalScore < row.totalScore) {
        rankProblems.push(`${category.name}: el puesto ${previous.rankPosition} tiene menos puntos que el ${row.rankPosition}`);
      }
    });
  }

  const loadQueries = loadMetrics.reduce((sum, item) => sum + item.consultas_d1_total, 0);
  const allRequests = loadMetrics.reduce((sum, item) => sum + item.peticiones, 0);
  const report = {
    fecha: new Date().toISOString(),
    estudiantes: students.length,
    peticiones_en_vuelo_max: MAX_IN_FLIGHT,
    visitantes: VISITORS,
    entregaron: runs.filter((run) => run.plan.submitted).length,
    sin_entregar: runs.filter((run) => !run.plan.submitted).length,
    fallaron_al_entrar_o_empezar: runs.filter((run) => run.failed).length,
    preparacion_s: Number((setupMs / 1000).toFixed(1)),
    carga_s: Number((loadMs / 1000).toFixed(1)),
    peticiones_carga: allRequests,
    peticiones_por_segundo: Number((allRequests / (loadMs / 1000)).toFixed(1)),
    consultas_d1_carga: loadQueries,
    consultas_d1_por_segundo: Number((loadQueries / (loadMs / 1000)).toFixed(1)),
    cierre: {
      ms: Math.round(releaseMs),
      estado: release.status,
      consultas_d1: Number.isFinite(closeMetrics.find((m) => m.endpoint === "cierre: publicar resultados")?.consultas_d1_max)
        ? closeMetrics.find((m) => m.endpoint === "cierre: publicar resultados").consultas_d1_max
        : null,
    },
    verificacion: {
      filas_revisadas: finishedRows.length,
      puntajes_distintos: mismatches.length,
      ejemplos: mismatches.slice(0, 5),
      problemas_de_ranking: rankProblems.length,
      ejemplos_ranking: rankProblems.slice(0, 5),
    },
    limites_d1: {
      pago_1000_por_peticion: loadMetrics
        .concat(closeMetrics)
        .filter((item) => (item.consultas_d1_max ?? 0) > D1_LIMIT_PAID)
        .map((item) => item.endpoint),
      gratis_50_por_peticion: loadMetrics
        .concat(closeMetrics)
        .filter((item) => (item.consultas_d1_max ?? 0) > D1_LIMIT_FREE)
        .map((item) => item.endpoint),
    },
    desafio: contest.id,
    carga: loadMetrics,
    cierre_detalle: closeMetrics,
    preparacion: setupMetrics,
  };

  console.table(
    loadMetrics.concat(closeMetrics).map(({ estados, errores, consultas_d1_total, ...row }) => row),
  );
  console.log(JSON.stringify({ ...report, carga: undefined, cierre_detalle: undefined, preparacion: undefined }, null, 2));
  if (process.env.SALIDA) writeFileSync(process.env.SALIDA, JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
