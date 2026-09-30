import { test, expect, type APIRequestContext } from "@playwright/test";
import ExcelJS from "exceljs";
import {
  API,
  SEEDED_TASK,
  SCORING_TASKS,
  createApprovedTeacher,
  createContest,
  loginAdmin,
  loginPage,
  playHeaders,
  resetE2EClock,
  setE2EClock,
} from "./support/helpers";

test.afterEach(async ({ request }) => resetE2EClock(request));

/** Desafío sin ventana de inscripción: se inscribe hasta que empieza la prueba. */
async function contestWithoutRegistrationWindow(
  request: APIRequestContext,
  headers: Record<string, string>,
) {
  const startsAt = new Date(Date.now() + 2 * 3600000);
  return createContest(request, headers, {
    registrationStartsAt: "",
    registrationEndsAt: "",
    startsAt: startsAt.toISOString(),
    endsAt: new Date(startsAt.getTime() + 3600000).toISOString(),
    durationMinutes: 30,
    showScoreOnSubmit: true,
    tasks: SCORING_TASKS.map(({ taskId }) => ({ taskId })),
  });
}

async function createGroup(
  request: APIRequestContext,
  headers: Record<string, string>,
  contestId: string,
  name: string,
) {
  const response = await request.post(`${API}/api/groups`, {
    headers,
    data: { contestId, name, category: SEEDED_TASK.category },
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()) as { id: string; accessCode: string };
}

function student(firstName: string, lastName = "Mamani Quispe") {
  return {
    participationMode: "individual",
    grade: SEEDED_TASK.grade,
    memberOneFirstName: firstName,
    memberOneLastName: lastName,
  };
}

test("el mismo nombre puede estar en dos grupos pero no dos veces en el mismo", async ({
  request,
}) => {
  const adminHeaders = await loginAdmin(request);
  const contest = await contestWithoutRegistrationWindow(request, adminHeaders);
  const first = await createApprovedTeacher(request, adminHeaders);
  const second = await createApprovedTeacher(request, adminHeaders);
  const groupA = await createGroup(request, first.headers, contest.id, "Grupo A");
  const groupB = await createGroup(request, second.headers, contest.id, "Grupo B");

  const inA = await request.post(`${API}/api/groups/${groupA.id}/teams`, {
    headers: first.headers,
    data: student("Juan"),
  });
  expect(inA.status(), await inA.text()).toBe(201);

  // Otro colegio con un estudiante que se llama igual: se inscribe.
  const inB = await request.post(`${API}/api/groups/${groupB.id}/teams`, {
    headers: second.headers,
    data: student("Juan"),
  });
  expect(inB.status(), await inB.text()).toBe(201);

  // El mismo nombre dos veces en el mismo grupo, sin tildes de diferencia.
  const repeated = await request.post(`${API}/api/groups/${groupA.id}/teams`, {
    headers: first.headers,
    data: student("JUÁN", "mamani quispe"),
  });
  expect(repeated.status()).toBe(409);
  expect((await repeated.json()).message).toContain("ya está en este grupo");

  // Y tampoco se revela nada del otro colegio al estudiante que se inscribe solo.
  const selfJoin = await request.post(`${API}/api/play/join`, {
    data: { accessCode: groupB.accessCode, ...student("Ana") },
  });
  expect(selfJoin.status()).toBe(201);
});

test("autoinscribirse con un nombre repetido no entrega el código de otro", async ({
  request,
}) => {
  const adminHeaders = await loginAdmin(request);
  const contest = await contestWithoutRegistrationWindow(request, adminHeaders);
  const teacher = await createApprovedTeacher(request, adminHeaders);
  const group = await createGroup(request, teacher.headers, contest.id, "Grupo");

  const original = await request.post(`${API}/api/play/join`, {
    data: { accessCode: group.accessCode, ...student("Lucía") },
  });
  expect(original.status()).toBe(201);
  const { personalCode } = await original.json();

  const impostor = await request.post(`${API}/api/play/join`, {
    data: { accessCode: group.accessCode, ...student("lucia") },
  });
  expect(impostor.status()).toBe(409);
  const body = await impostor.text();
  expect(body).not.toContain(personalCode);
  expect(body).toContain("pídele tu código personal a tu maestro");
});

test("sin ventana propia, la inscripción cierra cuando empieza la prueba", async ({
  request,
}) => {
  const adminHeaders = await loginAdmin(request);
  const contest = await contestWithoutRegistrationWindow(request, adminHeaders);
  const teacher = await createApprovedTeacher(request, adminHeaders);
  const group = await createGroup(request, teacher.headers, contest.id, "Grupo");

  const before = await request.post(`${API}/api/groups/${group.id}/teams`, {
    headers: teacher.headers,
    data: student("Antes"),
  });
  expect(before.status()).toBe(201);

  await setE2EClock(request, new Date(new Date(contest.startsAt).getTime() + 60000));

  const lateTeam = await request.post(`${API}/api/groups/${group.id}/teams`, {
    headers: teacher.headers,
    data: student("Tarde"),
  });
  expect(lateTeam.status()).toBe(409);
  expect((await lateTeam.json()).message).toContain("la prueba ya empezó");

  const lateJoin = await request.post(`${API}/api/play/join`, {
    data: { accessCode: group.accessCode, ...student("Tarde") },
  });
  expect(lateJoin.status()).toBe(409);

  const lateGroup = await request.post(`${API}/api/groups`, {
    headers: teacher.headers,
    data: { contestId: contest.id, name: "Tarde", category: SEEDED_TASK.category },
  });
  expect(lateGroup.status()).toBe(409);

  // Tampoco se quita a nadie ni se elimina el grupo con la prueba en curso.
  const teams = (await request
    .get(`${API}/api/groups/${group.id}`, { headers: teacher.headers })
    .then((r) => r.json())) as { teams: Array<{ id: string }> };
  const removeTeam = await request.delete(`${API}/api/teams/${teams.teams[0].id}`, {
    headers: teacher.headers,
  });
  expect(removeTeam.status()).toBe(409);
  const removeGroup = await request.delete(`${API}/api/groups/${group.id}`, {
    headers: teacher.headers,
  });
  expect(removeGroup.status()).toBe(409);
});

test("un maestro no ve ni toca los grupos de otro", async ({ request }) => {
  const adminHeaders = await loginAdmin(request);
  const contest = await contestWithoutRegistrationWindow(request, adminHeaders);
  const owner = await createApprovedTeacher(request, adminHeaders);
  const intruder = await createApprovedTeacher(request, adminHeaders);
  const group = await createGroup(request, owner.headers, contest.id, "Privado");

  for (const [method, path] of [
    ["get", `/api/groups/${group.id}`],
    ["get", `/api/groups/${group.id}/results`],
    ["get", `/api/groups/${group.id}/results.xlsx`],
    ["get", `/api/groups/${group.id}/roster-template`],
    ["patch", `/api/groups/${group.id}`],
    ["delete", `/api/groups/${group.id}`],
    ["post", `/api/groups/${group.id}/teams`],
  ] as const) {
    const response = await request[method](`${API}${path}`, {
      headers: intruder.headers,
      data: method === "get" || method === "delete" ? undefined : student("Intruso"),
    });
    expect(response.status(), `${method} ${path}`).toBe(404);
  }

  const list = (await request
    .get(`${API}/api/groups`, { headers: intruder.headers })
    .then((r) => r.json())) as Array<{ id: string }>;
  expect(list.some((item) => item.id === group.id)).toBe(false);

  const renamed = await request.patch(`${API}/api/groups/${group.id}`, {
    headers: owner.headers,
    data: { name: "x".repeat(81) },
  });
  expect(renamed.status()).toBe(400);
});

test("los resultados del grupo se muestran al terminar y se descargan en Excel", async ({
  page,
  request,
}) => {
  const adminHeaders = await loginAdmin(request);
  const contest = await contestWithoutRegistrationWindow(request, adminHeaders);
  const teacher = await createApprovedTeacher(request, adminHeaders);
  const group = await createGroup(request, teacher.headers, contest.id, "Resultados");

  const codes: Record<string, string> = {};
  for (const name of ["Alba", "Bruno", "Ciro"]) {
    const team = await request.post(`${API}/api/groups/${group.id}/teams`, {
      headers: teacher.headers,
      data: student(name, "Prueba"),
    });
    codes[name] = (await team.json()).personalCode;
  }

  await setE2EClock(request, new Date(new Date(contest.startsAt).getTime() + 60000));
  const answersFor: Record<string, Array<"A" | "B">> = {
    Alba: ["B", "B", "B"],
    Bruno: ["B", "A"],
  };
  for (const [name, answers] of Object.entries(answersFor)) {
    const session = await request.post(`${API}/api/play/session`, {
      data: { personalCode: codes[name] },
    });
    const headers = playHeaders((await session.json()).sessionToken);
    expect((await request.post(`${API}/api/play/start`, { headers })).ok()).toBe(true);
    for (const [index, selected] of answers.entries()) {
      const saved = await request.post(`${API}/api/play/answer`, {
        headers,
        data: { taskId: SCORING_TASKS[index].taskId, payload: { selected: [selected] } },
      });
      expect(saved.status()).toBe(204);
    }
    if (name === "Alba") {
      expect((await request.post(`${API}/api/play/submit`, { headers })).ok()).toBe(true);
    }
  }

  // Durante la prueba el maestro solo ve el avance, sin aciertos.
  const live = await request
    .get(`${API}/api/groups/${group.id}/results`, { headers: teacher.headers })
    .then((r) => r.json());
  expect(live.showScores).toBe(false);
  expect(live.teams.every((team: { score: unknown; answers: unknown }) => team.score === null && team.answers === null)).toBe(true);

  // Al cerrar, los resultados se publican solos (Bruno queda cerrado por plazo).
  await setE2EClock(request, new Date(new Date(contest.endsAt).getTime() + 60000));
  const results = await request
    .get(`${API}/api/groups/${group.id}/results`, { headers: teacher.headers })
    .then((r) => r.json());
  expect(results.showScores).toBe(true);
  const byName = Object.fromEntries(
    results.teams.map((team: { memberOneFirstName: string }) => [team.memberOneFirstName, team]),
  );
  // Puntaje inicial 2 + 3 + 4 = 9; correcta suma 6, 9 o 12; incorrecta resta 2, 3 o 4.
  expect(byName.Alba.score).toBe(9 + 6 + 9 + 12);
  expect(byName.Bruno.score).toBe(9 + 6 - 3);
  expect(byName.Alba.answers).toEqual(["correct", "correct", "correct"]);
  expect(byName.Bruno.answers).toEqual(["correct", "wrong", "blank"]);
  expect(byName.Ciro.progress).toBe("not_started");
  expect(byName.Alba.rank).toBe(1);
  expect(byName.Bruno.rank).toBe(2);

  const download = await request.get(`${API}/api/groups/${group.id}/results.xlsx`, {
    headers: teacher.headers,
  });
  expect(download.ok()).toBe(true);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load((await download.body()) as unknown as ArrayBuffer);
  const sheet = workbook.getWorksheet(SEEDED_TASK.category)!;
  expect(sheet).toBeTruthy();
  const header = sheet.getRow(5).values as unknown[];
  expect(header).toContain("Puntaje");
  expect(header).toContain("Lugar");
  expect(header).toContain("P3");
  const rows = new Map<string, unknown[]>();
  sheet.eachRow((row, number) => {
    if (number > 5) rows.set(String(row.getCell(2).value), row.values as unknown[]);
  });
  expect(rows.get("Alba Prueba")).toEqual(expect.arrayContaining([codes.Alba, 36, 3, 1, "✓"]));
  expect(rows.get("Bruno Prueba")).toEqual(expect.arrayContaining([12, 1, 2, "✗", "—"]));
  expect(workbook.getWorksheet("Preguntas")).toBeTruthy();

  await loginPage(page, teacher.identity, /\/perfil\/?$/);
  await page.goto(`/grupos/ver?id=${group.id}&vista=resultados`);
  const [file] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Descargar Excel" }).click(),
  ]);
  expect(file.suggestedFilename()).toBe("resultados-Resultados.xlsx");
});

test("el curso de un estudiante se corrige hasta que empieza a rendir", async ({
  request,
}) => {
  const adminHeaders = await loginAdmin(request);
  const contest = await contestWithoutRegistrationWindow(request, adminHeaders);
  const teacher = await createApprovedTeacher(request, adminHeaders);
  const group = await createGroup(request, teacher.headers, contest.id, "Grupo");
  const enrolled = await request.post(`${API}/api/groups/${group.id}/teams`, {
    headers: teacher.headers,
    data: student("Curso"),
  });
  expect(enrolled.status()).toBe(201);
  const team = (await enrolled.json()) as { id: string; personalCode: string };
  const edit = (grade: string, firstName = "Curso") =>
    request.put(`${API}/api/teams/${team.id}`, {
      headers: teacher.headers,
      data: { ...student(firstName), grade },
    });

  // Antes de rendir, el curso se corrige sin problema.
  expect((await edit("P4")).status()).toBe(200);
  expect((await edit(SEEDED_TASK.grade)).status()).toBe(200);

  await setE2EClock(request, new Date(new Date(contest.startsAt).getTime() + 60000));
  const session = await request.post(`${API}/api/play/session`, {
    data: { personalCode: team.personalCode },
  });
  expect(session.ok(), await session.text()).toBe(true);
  const { sessionToken } = await session.json();
  const started = await request.post(`${API}/api/play/start`, {
    headers: playHeaders(sessionToken),
    data: {},
  });
  expect(started.ok(), await started.text()).toBe(true);

  // Ya rindiendo, cambiar el curso lo pasaría a otra categoría.
  const locked = await edit("P4");
  expect(locked.status()).toBe(409);
  expect(await locked.json()).toMatchObject({
    code: "TEAM_GRADE_LOCKED",
    field: "grade",
  });
  // El nombre sí se puede corregir.
  const renamed = await edit(SEEDED_TASK.grade, "Cursito");
  expect(renamed.status(), await renamed.text()).toBe(200);
});
