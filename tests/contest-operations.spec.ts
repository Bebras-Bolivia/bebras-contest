import { test, expect, type APIRequestContext } from "@playwright/test";
import {
  API,
  SEEDED_TASK,
  SCORING_TASKS,
  createApprovedTeacher,
  createContest,
  createPracticeTask,
  loginAdmin,
  loginAdminPage,
  playHeaders,
  resetE2EClock,
  setE2EClock,
} from "./support/helpers";

test.afterEach(async ({ request }) => resetE2EClock(request));

type Contest = { id: string; startsAt: string; endsAt: string };

/** Desafío con tres preguntas y dos estudiantes inscritos por su maestro. */
async function contestWithStudents(
  request: APIRequestContext,
  names: string[],
  overrides: Record<string, unknown> = {},
) {
  const adminHeaders = await loginAdmin(request);
  const startsAt = new Date(Date.now() + 2 * 3600000);
  const contest = (await createContest(request, adminHeaders, {
    registrationStartsAt: "",
    registrationEndsAt: "",
    startsAt: startsAt.toISOString(),
    endsAt: new Date(startsAt.getTime() + 3600000).toISOString(),
    durationMinutes: 30,
    tasks: SCORING_TASKS.map(({ taskId }) => ({ taskId })),
    ...overrides,
  })) as Contest;
  const teacher = await createApprovedTeacher(request, adminHeaders);
  const group = await request
    .post(`${API}/api/groups`, {
      headers: teacher.headers,
      data: { contestId: contest.id, name: "Operación", category: SEEDED_TASK.category },
    })
    .then((r) => r.json());

  const students: Record<string, { code: string; headers: Record<string, string> }> = {};
  for (const name of names) {
    const team = await request
      .post(`${API}/api/groups/${group.id}/teams`, {
        headers: teacher.headers,
        data: {
          participationMode: "individual",
          grade: SEEDED_TASK.grade,
          memberOneFirstName: name,
          memberOneLastName: "Operación",
        },
      })
      .then((r) => r.json());
    const session = await request
      .post(`${API}/api/play/session`, { data: { personalCode: team.personalCode } })
      .then((r) => r.json());
    students[name] = {
      code: team.personalCode,
      headers: playHeaders(session.sessionToken),
    };
  }
  return { adminHeaders, contest, teacher, group, students };
}

const at = (iso: string, deltaMs: number) => new Date(new Date(iso).getTime() + deltaMs);

test("antes de empezar el intento no trae los enunciados y trae la hora del servidor", async ({
  request,
}) => {
  const { contest, students } = await contestWithStudents(request, ["Ana"]);
  const { headers } = students.Ana;

  const waiting = await request.get(`${API}/api/play/attempt`, { headers }).then((r) => r.json());
  expect(waiting.status).toBe("pending");
  expect(waiting.tasks).toEqual([]);
  expect(waiting.taskCount).toBe(SCORING_TASKS.length);
  expect(waiting.rules.scoring).toHaveLength(3);

  const clock = at(contest.startsAt, 90000);
  await setE2EClock(request, clock);
  const started = await request.post(`${API}/api/play/start`, { headers });
  expect(started.ok(), await started.text()).toBe(true);
  // Dos toques seguidos no reinician el reloj.
  const first = await request.get(`${API}/api/play/attempt`, { headers }).then((r) => r.json());
  await setE2EClock(request, at(contest.startsAt, 120000));
  await request.post(`${API}/api/play/start`, { headers });
  const second = await request.get(`${API}/api/play/attempt`, { headers }).then((r) => r.json());
  expect(second.startedAt).toBe(first.startedAt);

  expect(second.serverNow).toBe(at(contest.startsAt, 120000).toISOString());
  expect(second.tasks).toHaveLength(SCORING_TASKS.length);
  const serialized = JSON.stringify(second.tasks);
  expect(serialized).not.toContain("correctAnswerId");
  expect(serialized).not.toContain("explanationBlocks");

  const beat = await request.post(`${API}/api/play/heartbeat`, { headers }).then((r) => r.json());
  expect(beat).toMatchObject({ ok: true, suspended: false, status: "in_progress" });
  expect(beat.endsAt).toBe(second.endsAt);
});

test("no se puede editar una tarea mientras se rinde un desafío que la usa", async ({
  request,
}) => {
  const adminHeaders = await loginAdmin(request);
  const task = await createPracticeTask(request, adminHeaders, "multiple_choice", {
    difficulties: { "8–10": "easy" },
  });
  const startsAt = new Date(Date.now() + 2 * 3600000);
  const contest = (await createContest(request, adminHeaders, {
    startsAt: startsAt.toISOString(),
    endsAt: new Date(startsAt.getTime() + 3600000).toISOString(),
    tasks: [{ taskId: task.id }],
  })) as Contest;

  const edit = () =>
    request.put(`${API}/api/tasks/${task.id}`, {
      headers: adminHeaders,
      data: { ...task, title: `${task.title} editada` },
    });

  await setE2EClock(request, at(contest.startsAt, 60000));
  const running = await edit();
  expect(running.status()).toBe(409);
  expect((await running.json()).code).toBe("TASK_IN_RUNNING_CONTEST");

  await setE2EClock(request, at(contest.endsAt, 60000));
  const after = await edit();
  expect(after.ok(), await after.text()).toBe(true);
});

test("una pausa que pasa la hora de cierre se mantiene y al reanudar devuelve el tiempo", async ({
  request,
}) => {
  const { adminHeaders, contest, students } = await contestWithStudents(request, ["Beto"]);
  const { headers } = students.Beto;

  await setE2EClock(request, at(contest.startsAt, 60000));
  await request.post(`${API}/api/play/start`, { headers });
  const before = await request.get(`${API}/api/play/attempt`, { headers }).then((r) => r.json());

  const paused = await request.post(`${API}/api/contests/${contest.id}/suspend`, {
    headers: adminHeaders,
  });
  expect(paused.ok(), await paused.text()).toBe(true);

  const beat = await request.post(`${API}/api/play/heartbeat`, { headers }).then((r) => r.json());
  expect(beat.suspended).toBe(true);
  const blocked = await request.post(`${API}/api/play/answer`, {
    headers,
    data: { taskId: SCORING_TASKS[0].taskId, payload: { selected: ["B"] } },
  });
  expect(blocked.status()).toBe(409);
  expect((await request.post(`${API}/api/play/submit`, { headers })).status()).toBe(409);

  // Pasa la hora de cierre con la prueba pausada: sigue pausada y sin resultados.
  const pauseMs = 70 * 60000;
  await setE2EClock(request, at(contest.startsAt, 60000 + pauseMs));
  const still = await request
    .get(`${API}/api/contests/${contest.id}`, { headers: adminHeaders })
    .then((r) => r.json());
  expect(still.state).toBe("suspendida");
  expect(still.resultsPublishedAt).toBeNull();

  const resumed = await request.post(`${API}/api/contests/${contest.id}/resume`, {
    headers: adminHeaders,
  });
  expect(resumed.ok(), await resumed.text()).toBe(true);
  const contestAfter = await resumed.json();
  expect(contestAfter.state).toBe("abierta");
  expect(new Date(contestAfter.endsAt).getTime() - new Date(contest.endsAt).getTime()).toBe(pauseMs);

  const after = await request.get(`${API}/api/play/attempt`, { headers }).then((r) => r.json());
  expect(new Date(after.endsAt).getTime() - new Date(before.endsAt).getTime()).toBe(pauseMs);
  const saved = await request.post(`${API}/api/play/answer`, {
    headers,
    data: { taskId: SCORING_TASKS[0].taskId, payload: { selected: ["B"] } },
  });
  expect(saved.status()).toBe(204);
});

test("al cerrar se publican solos puntajes, ranking y certificados, también de quien no entregó", async ({
  request,
}) => {
  const { adminHeaders, contest, students } = await contestWithStudents(request, [
    "Ana",
    "Beto",
    "Carla",
  ]);
  await setE2EClock(request, at(contest.startsAt, 60000));

  const answer = async (name: string, taskIndex: number, selected: "A" | "B") => {
    const response = await request.post(`${API}/api/play/answer`, {
      headers: students[name].headers,
      data: { taskId: SCORING_TASKS[taskIndex].taskId, payload: { selected: [selected] } },
    });
    expect(response.status()).toBe(204);
  };

  for (const name of ["Ana", "Beto"]) {
    await request.post(`${API}/api/play/start`, { headers: students[name].headers });
  }
  // Ana: todas bien y entrega. Beto: cambia una correcta por incorrecta, deja
  // una vacía y no entrega. Carla: no empieza.
  await answer("Ana", 0, "B");
  await answer("Ana", 1, "B");
  await answer("Ana", 2, "B");
  await request.post(`${API}/api/play/submit`, { headers: students.Ana.headers });
  await answer("Beto", 0, "B");
  await answer("Beto", 1, "B");
  await answer("Beto", 1, "A");

  // Antes del cierre nadie tiene puesto: el ranking se arma al consolidar.
  const early = await request
    .get(`${API}/api/contests/${contest.id}/results`, { headers: adminHeaders })
    .then((r) => r.json());
  expect(early.rows.every((row: { rankPosition: number | null }) => row.rankPosition === null)).toBe(true);

  await setE2EClock(request, at(contest.endsAt, 60000));
  const keyResponse = await request
    .post(`${API}/api/admin/certificates/key`, { headers: adminHeaders })
    .then((r) => r.json());
  await request.get(`${API}/api/public-contests`);

  const results = await request
    .get(`${API}/api/contests/${contest.id}/results`, { headers: adminHeaders })
    .then((r) => r.json());
  expect(results.state).toBe("publicada");
  const byName = Object.fromEntries(
    results.rows.map((row: { memberOneFirstName: string }) => [row.memberOneFirstName, row]),
  );
  expect(byName.Ana).toMatchObject({ status: "finished", totalScore: 36, correctCount: 3, answeredCount: 3, rankPosition: 1 });
  expect(byName.Beto).toMatchObject({ status: "finished", totalScore: 12, correctCount: 1, answeredCount: 2, rankPosition: 2 });
  expect(byName.Carla).toMatchObject({ status: "pending", totalScore: null, rankPosition: null });

  const anaView = await request
    .get(`${API}/api/play/attempt`, { headers: students.Ana.headers })
    .then((r) => r.json());
  expect(anaView.resultsPublished).toBe(true);
  expect(anaView.result.rankPosition).toBe(1);

  // La portada muestra solo el desafío con resultados más reciente: si en la
  // base quedó otro de una corrida anterior, se ocultan sus resultados.
  type Ranking = Array<{
    id: string;
    categories: Array<{ rows: Array<{ name: string; rank: number }> }>;
  }>;
  let ranking: Ranking = [];
  for (let round = 0; round < 20; round += 1) {
    ranking = await request.get(`${API}/api/public-ranking`).then((r) => r.json());
    const newer = ranking[0];
    if (!newer || newer.id === contest.id) break;
    await request.post(`${API}/api/contests/${newer.id}/results/unpublish`, {
      headers: adminHeaders,
    });
  }
  const mine = ranking.find((item) => item.id === contest.id);
  expect(mine?.categories[0].rows.map((row) => row.name)).toEqual(["Ana O.", "Beto O."]);

  const exported = await request
    .get(`${API}/api/certificates/export?key=${keyResponse.key}`)
    .then((r) => r.json());
  const certificates = exported.certificates.filter(
    (item: { contestId: string }) => item.contestId === contest.id,
  );
  expect(certificates).toHaveLength(2);
  expect(certificates.find((item: { participants: string[] }) => item.participants[0] === "Ana Operación")).toMatchObject({
    code: students.Ana.code,
    rank: 1,
    rankOf: 2,
    score: 36,
  });
});

test("el editor avisa cuando un desafío oficial usa preguntas públicas en Práctica", async ({
  page,
  request,
}) => {
  const adminHeaders = await loginAdmin(request);
  const publicTask = await createPracticeTask(request, adminHeaders, "multiple_choice", {
    difficulties: { "8–10": "easy" },
  });
  // Una tarea propia y privada: las compartidas pueden haber cambiado de
  // visibilidad en otra prueba.
  const privateTask = await createPracticeTask(request, adminHeaders, "multiple_choice", {
    difficulties: { "8–10": "easy" },
    isPractice: false,
  });
  const contest = await createContest(request, adminHeaders, {
    registrationStartsAt: "",
    registrationEndsAt: "",
    tasks: [{ taskId: publicTask.id }, { taskId: privateTask.id }],
  });

  await loginAdminPage(page);
  await page.goto(`/desafios/preguntas?id=${contest.id}&categoria=${SEEDED_TASK.category}`);
  await expect(page.getByRole("heading", { name: "Preguntas" })).toBeVisible();
  await expect(
    page.getByText("Una de las preguntas elegidas es pública en Práctica", { exact: false }),
  ).toBeVisible();
});

test("el administrador publica y oculta los resultados a mano", async ({ request }) => {
  const { adminHeaders, contest, students } = await contestWithStudents(request, ["Dora"]);
  const { headers } = students.Dora;
  await setE2EClock(request, at(contest.startsAt, 60000));
  await request.post(`${API}/api/play/start`, { headers });
  await request.post(`${API}/api/play/answer`, {
    headers,
    data: { taskId: SCORING_TASKS[0].taskId, payload: { selected: ["B"] } },
  });
  await request.post(`${API}/api/play/submit`, { headers });

  // Sin consolidar no se publica.
  const tooSoon = await request.post(`${API}/api/contests/${contest.id}/results/publish`, {
    headers: adminHeaders,
  });
  expect(tooSoon.status()).toBe(409);

  await setE2EClock(request, at(contest.endsAt, 60000));
  // Abrir el desafío ya publica solo; se oculta y se vuelve a publicar a mano.
  const opened = await request
    .get(`${API}/api/contests/${contest.id}`, { headers: adminHeaders })
    .then((r) => r.json());
  expect(opened.state).toBe("publicada");
  const hidden = await request.post(`${API}/api/contests/${contest.id}/results/unpublish`, {
    headers: adminHeaders,
  });
  expect((await hidden.json()).state).toBe("consolidada");
  const studentView = await request.get(`${API}/api/play/attempt`, { headers }).then((r) => r.json());
  expect(studentView.resultsPublished).toBe(false);
  expect(studentView.result).toBeNull();

  // Ocultarlos a mano no hace que vuelvan a publicarse solos.
  await request.get(`${API}/api/public-contests`);
  const still = await request
    .get(`${API}/api/contests/${contest.id}`, { headers: adminHeaders })
    .then((r) => r.json());
  expect(still.state).toBe("consolidada");

  const published = await request.post(`${API}/api/contests/${contest.id}/results/publish`, {
    headers: adminHeaders,
  });
  expect((await published.json()).state).toBe("publicada");
  const after = await request.get(`${API}/api/play/attempt`, { headers }).then((r) => r.json());
  expect(after.resultsPublished).toBe(true);
});

test("el código personal identifica al estudiante y a su grupo", async ({ request }) => {
  const { contest, group, students } = await contestWithStudents(request, ["Eva"]);
  const team = await request
    .get(`${API}/api/play/team/${students.Eva.code.toLowerCase()}`)
    .then((r) => r.json());
  expect(team).toMatchObject({
    personalCode: students.Eva.code,
    memberOneFirstName: "Eva",
    groupName: group.name,
    accessCode: group.accessCode,
  });
  expect(team.contestTitle).toBeTruthy();
  const missing = await request.get(`${API}/api/play/team/NOEXISTE`);
  expect(missing.status()).toBe(404);
  expect(contest.id).toBeTruthy();
});

test("probar el desafío como estudiante no crea intentos ni deja rastro", async ({
  page,
  request,
}) => {
  const adminHeaders = await loginAdmin(request);
  const contest = await createContest(request, adminHeaders, {
    tasks: SCORING_TASKS.map(({ taskId }) => ({ taskId })),
  });

  const preview = await request
    .get(`${API}/api/contests/${contest.id}/preview?categoria=${SEEDED_TASK.category}`, {
      headers: adminHeaders,
    })
    .then((r) => r.json());
  expect(preview.tasks).toHaveLength(SCORING_TASKS.length);
  expect(JSON.stringify(preview.tasks)).not.toContain("correctAnswerId");

  const scored = await request
    .post(`${API}/api/contests/${contest.id}/preview/score`, {
      headers: adminHeaders,
      data: {
        category: SEEDED_TASK.category,
        answers: { [SCORING_TASKS[0].taskId]: { selected: ["B"] }, [SCORING_TASKS[1].taskId]: { selected: ["A"] } },
      },
    })
    .then((r) => r.json());
  expect(scored).toMatchObject({ totalScore: 9 + 6 - 3, correctCount: 1, answeredCount: 2 });

  const results = await request
    .get(`${API}/api/contests/${contest.id}/results`, { headers: adminHeaders })
    .then((r) => r.json());
  expect(results.rows).toHaveLength(0);

  await loginAdminPage(page);
  await page.goto(`/desafios/probar?id=${contest.id}&categoria=${SEEDED_TASK.category}`);
  await expect(page.getByRole("link", { name: "Volver al desafío" })).toBeVisible();
  await expect(page.getByText(/Empezar/).first()).toBeVisible({ timeout: 15000 });
});
