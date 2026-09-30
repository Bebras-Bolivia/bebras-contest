import { test, expect, type APIRequestContext } from "@playwright/test";
import {
  API,
  createApprovedTeacher,
  createPracticeTask,
  createScoringTask,
  loginAdmin,
  loginPage,
  playHeaders,
  resetE2EClock,
} from "./support/helpers";

test.beforeEach(async ({ request }) => resetE2EClock(request));

function schedule(offsetMinutes = -1, lengthMinutes = 90) {
  const startsAt = new Date(Date.now() + offsetMinutes * 60000);
  return {
    startsAt: startsAt.toISOString(),
    endsAt: new Date(startsAt.getTime() + lengthMinutes * 60000).toISOString(),
  };
}

async function releasedTitiTasks(
  request: APIRequestContext,
  headers: Record<string, string>,
) {
  // Tareas de práctica con dificultad para Titi (10–12).
  const first = await createPracticeTask(request, headers, "multiple_choice");
  const second = await createPracticeTask(request, headers, "short_text");
  return [first, second] as Array<{ id: string; answerType: string }>;
}

test("una práctica necesita horario y solo usa preguntas liberadas", async ({
  request,
}) => {
  const adminHeaders = await loginAdmin(request);
  const teacher = await createApprovedTeacher(request, adminHeaders);
  const tasks = await releasedTitiTasks(request, adminHeaders);
  const base = {
    title: "Práctica sin horario",
    category: "Titi",
    durationMinutes: 20,
    tasks: tasks.map((task) => task.id),
  };

  const withoutSchedule = await request.post(`${API}/api/practices`, {
    headers: teacher.headers,
    data: base,
  });
  expect(withoutSchedule.status()).toBe(400);
  expect((await withoutSchedule.json()).message).toContain("cuándo empieza");

  const tooShort = await request.post(`${API}/api/practices`, {
    headers: teacher.headers,
    data: { ...base, ...schedule(-1, 10) },
  });
  expect(tooShort.status()).toBe(400);

  // Una tarea reservada para los desafíos oficiales no entra en una práctica.
  const privateTask = await createScoringTask(request, adminHeaders, "easy", 1);
  const withPrivate = await request.post(`${API}/api/practices`, {
    headers: teacher.headers,
    data: { ...base, ...schedule(), tasks: [privateTask.taskId] },
  });
  expect(withPrivate.status()).toBe(400);

  const byAdmin = await request.post(`${API}/api/practices`, {
    headers: adminHeaders,
    data: { ...base, ...schedule() },
  });
  expect(byAdmin.status()).toBe(403);
});

test("el maestro arma una práctica, su estudiante la rinde con su nombre y ve el resultado", async ({
  page,
  request,
}) => {
  const adminHeaders = await loginAdmin(request);
  const teacher = await createApprovedTeacher(request, adminHeaders);
  const other = await createApprovedTeacher(request, adminHeaders);
  const tasks = await releasedTitiTasks(request, adminHeaders);

  const created = await request.post(`${API}/api/practices`, {
    headers: teacher.headers,
    data: {
      title: "Repaso del viernes",
      category: "Titi",
      durationMinutes: 20,
      tasks: tasks.map((task) => task.id),
      ...schedule(),
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const practice = await created.json();
  expect(practice.accessCode).toMatch(/^[A-Z0-9]{6}$/);
  expect(practice.state).toBe("abierta");

  // Solo su dueño la ve.
  const mine = (await request
    .get(`${API}/api/practices`, { headers: teacher.headers })
    .then((r) => r.json())) as Array<{ id: string }>;
  expect(mine.some((item) => item.id === practice.id)).toBe(true);
  const theirs = (await request
    .get(`${API}/api/practices`, { headers: other.headers })
    .then((r) => r.json())) as Array<{ id: string }>;
  expect(theirs.some((item) => item.id === practice.id)).toBe(false);
  const foreignDelete = await request.delete(`${API}/api/practices/${practice.id}`, {
    headers: other.headers,
  });
  expect(foreignDelete.status()).toBe(404);

  const entered = await request.post(
    `${API}/api/play/practice/${practice.accessCode}/enter`,
    { data: { name: "carla rojas" } },
  );
  expect(entered.status()).toBe(201);
  const entry = await entered.json();
  expect(entry.memberOneFirstName).toBe("Carla");
  const headers = playHeaders(entry.sessionToken);

  // Con la sesión viva, el mismo nombre en otro equipo espera.
  const twin = await request.post(
    `${API}/api/play/practice/${practice.accessCode}/enter`,
    { data: { name: "Carla Rojas" } },
  );
  expect(twin.status()).toBe(409);

  expect((await request.post(`${API}/api/play/start`, { headers })).ok()).toBe(true);
  const attempt = await request
    .get(`${API}/api/play/attempt`, { headers })
    .then((r) => r.json());
  expect(attempt.tasks).toHaveLength(2);
  for (const task of attempt.tasks as Array<{ taskId: string; answerType: string }>) {
    const payload =
      task.answerType === "short_text" ? { text: "bebras" } : { selected: ["B"] };
    const saved = await request.post(`${API}/api/play/answer`, {
      headers,
      data: { taskId: task.taskId, payload },
    });
    expect(saved.status()).toBe(204);
  }
  expect((await request.post(`${API}/api/play/submit`, { headers })).ok()).toBe(true);

  const finished = await request
    .get(`${API}/api/play/attempt`, { headers })
    .then((r) => r.json());
  expect(finished.status).toBe("finished");
  expect(finished.showTotalScore).toBe(true);
  expect(finished.showSolutions).toBe(true);
  expect(finished.result.correctCount).toBe(2);
  expect(finished.tasks.every((task: { correct: boolean }) => task.correct)).toBe(true);

  await loginPage(page, teacher.identity, /\/perfil\/?$/);
  await page.goto("/mis-practicas");
  await expect(page.getByText("Repaso del viernes")).toBeVisible();
  await expect(page.getByText(practice.accessCode).first()).toBeVisible();

  const removed = await request.delete(`${API}/api/practices/${practice.id}`, {
    headers: teacher.headers,
  });
  expect(removed.status()).toBe(204);
});
