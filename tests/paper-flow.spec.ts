import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { PDFDocument } from "../frontend/node_modules/pdf-lib";
import { getPlatformProxy } from "wrangler";
import type { LocalD1 } from "../scripts/cloudflare-local-d1";
import {
  API,
  createApprovedTeacher,
  createContest,
  createPracticeTask,
  DRAG_DROP_CORRECT_PLACEMENTS,
  loginAdmin,
  loginAdminPage,
  loginPage,
  playHeaders,
  resetE2EClock,
  setE2EClock,
} from "./support/helpers";

test.afterEach(async ({ request }) => resetE2EClock(request));

const owned = {
  contests: [] as string[],
  tasks: [] as string[],
  teachers: [] as Awaited<ReturnType<typeof createApprovedTeacher>>[],
};

test.afterAll(async ({ request }) => {
  const platform = await getPlatformProxy<{
    DB: LocalD1;
    UPLOADS: { delete(key: string): Promise<void> };
  }>({
    configPath: resolve("tests/wrangler.e2e.jsonc"),
    persist: { path: resolve("tests/.wrangler/state/v3") },
    remoteBindings: false,
  });
  try {
    const db = platform.env.DB;
    for (const teacher of owned.teachers) {
      const documents = (await db
        .prepare('SELECT "letterFilename" FROM "User" WHERE "id" = ?')
        .bind(teacher.id)
        .all()) as { results: Array<{ letterFilename: string | null }> };
      for (const document of documents.results) {
        if (document.letterFilename) {
          await platform.env.UPLOADS.delete(document.letterFilename);
        }
      }
    }
    for (const [table, ids] of [
      ["Contest", owned.contests],
      ["TaskDraft", owned.tasks],
      ["User", owned.teachers.map((teacher) => teacher.id)],
    ] as const) {
      for (const id of ids) {
        await db
          .prepare(`DELETE FROM "${table}" WHERE "id" = ?`)
          .bind(id)
          .run();
      }
    }
  } finally {
    await platform.dispose();
  }
  for (const teacher of owned.teachers) {
    const deleted = await request.post(
      `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:delete?key=${process.env.E2E_FIREBASE_API_KEY}`,
      { data: { idToken: teacher.identity.token } },
    );
    expect(deleted.ok(), await deleted.text()).toBe(true);
  }
});

async function fixture(request: APIRequestContext) {
  const admin = await loginAdmin(request);
  const teacher = await createApprovedTeacher(request, admin);
  owned.teachers.push(teacher);
  const tasks = [];
  for (const answerType of [
    "multiple_choice",
    "drag_drop",
    "short_text",
  ] as const) {
    tasks.push(
      await createPracticeTask(request, admin, answerType, {
        isPractice: false,
        title: `Papel ${answerType}`,
        difficulties: { "8–10": "easy" },
      }),
    );
    owned.tasks.push(tasks[tasks.length - 1].id);
  }
  const starts = Date.now() + 72 * 3600000;
  const contest = await createContest(request, admin, {
    registrationStartsAt: "",
    registrationEndsAt: "",
    startsAt: new Date(starts).toISOString(),
    endsAt: new Date(starts + 3600000).toISOString(),
    resultsAt: new Date(starts + 2 * 3600000).toISOString(),
    durationMinutes: 30,
    showScoreOnSubmit: true,
    showFeedbackOnSubmit: true,
    tasks: tasks.map((task) => ({ taskId: task.id })),
  });
  owned.contests.push(contest.id);
  const created = await request.post(`${API}/api/groups`, {
    headers: teacher.headers,
    data: { contestId: contest.id, name: "Papel E2E", category: "Capibara" },
  });
  expect(created.status(), await created.text()).toBe(201);
  const group = (await created.json()) as { id: string };
  const students: Array<{
    id: string;
    personalCode: string;
    memberOneFirstName: string;
  }> = [];
  for (const name of ["Alba", "Bruno"]) {
    const enrolled = await request.post(`${API}/api/groups/${group.id}/teams`, {
      headers: teacher.headers,
      data: {
        participationMode: "individual",
        grade: "P3",
        memberOneFirstName: name,
        memberOneLastName: "Prueba",
      },
    });
    expect(enrolled.status(), await enrolled.text()).toBe(201);
    students.push(await enrolled.json());
  }
  const answers = {
    [tasks[0].id]: { selected: ["B"] },
    [tasks[1].id]: { placements: DRAG_DROP_CORRECT_PLACEMENTS },
    [tasks[2].id]: { text: "Bebras" },
  };
  return { admin, teacher, tasks, contest, starts, group, students, answers };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

async function entry(page: Page, data: Fixture, index = 0) {
  await loginPage(page, data.teacher.identity, /\/perfil\/?$/);
  await page.goto(
    `/grupos/papel?id=${data.group.id}&equipo=${data.students[index].id}`,
  );
  await expect(
    page.getByRole("button", { name: "Guardar", exact: true }),
  ).toBeEnabled();
}

async function paper(request: APIRequestContext, data: Fixture, index = 0) {
  const response = await request.get(
    `${API}/api/teams/${data.students[index].id}/paper`,
    { headers: data.teacher.headers },
  );
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

async function session(request: APIRequestContext, data: Fixture, index = 0) {
  const response = await request.post(`${API}/api/play/session`, {
    data: { personalCode: data.students[index].personalCode },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return playHeaders((await response.json()).sessionToken);
}

test("imprime desde las 48 horas, identifica cada hoja y descarga seis páginas carta; admin imprime antes", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120000);
  const data = await fixture(request);
  await setE2EClock(request, new Date(data.starts - 48 * 3600000 - 1));
  await loginPage(page, data.teacher.identity, /\/perfil\/?$/);
  await page.goto(`/grupos/ver?id=${data.group.id}`);
  await expect(
    page.getByText("¿Sin internet en el aula?", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Imprimir la prueba", exact: true })
    .click();
  await expect(
    page.getByText(/La prueba se puede imprimir desde el/),
  ).toBeVisible();
  await expect(page.locator(".pp-sheet")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Descargar PDF" })).toHaveCount(
    0,
  );
  const denied = await request.get(`${API}/api/groups/${data.group.id}/paper`, {
    headers: data.teacher.headers,
  });
  expect(await denied.json()).toMatchObject({
    canPrint: false,
    categories: [{ tasks: [] }],
  });

  const adminContext = await page
    .context()
    .browser()!
    .newContext({ baseURL: new URL(page.url()).origin });
  try {
    const adminPage = await adminContext.newPage();
    await loginAdminPage(adminPage);
    await adminPage.goto(
      new URL(`/grupos/imprimir?id=${data.group.id}`, page.url()).href,
    );
    await expect(adminPage.locator(".pp-sheet")).toHaveCount(6);
  } finally {
    await adminContext.close();
  }

  await setE2EClock(request, new Date(data.starts - 48 * 3600000));
  await page.reload();
  await expect(page.locator(".pp-cover")).toHaveCount(1);
  await expect(page.locator(".pp-task")).toHaveCount(3);
  await expect(page.locator(".pp-answersheet")).toHaveCount(2);
  for (const student of data.students) {
    const sheet = page
      .locator(".pp-answersheet")
      .filter({ hasText: student.personalCode });
    await expect(sheet).toHaveCount(1);
    await expect(sheet).toContainText(`${student.memberOneFirstName} Prueba`);
  }
  for (const task of data.tasks)
    await expect(
      page.locator(".pp-task").filter({ hasText: task.title }),
    ).toHaveCount(1);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Descargar PDF" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  const path = testInfo.outputPath("prueba.pdf");
  await download.saveAs(path);
  const pdf = await PDFDocument.load(await readFile(path));
  expect(pdf.getPageCount()).toBe(6);
  for (const sheet of pdf.getPages())
    expect(sheet.getSize()).toEqual({ width: 612, height: 792 });
});

test("carga tres tipos, corrige y cuenta en resultados; excluye la rendición en línea en ambos sentidos", async ({
  page,
  request,
}) => {
  const data = await fixture(request);
  await setE2EClock(request, new Date(data.starts));
  await entry(page, data);
  await page.getByRole("button", { name: "Opción B", exact: true }).click();
  await page
    .getByRole("button", { name: "Lugar 1: pieza B", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Lugar 2: pieza A", exact: true })
    .click();
  await page.getByRole("textbox", { name: "Lo que escribió" }).fill("Bebras");
  const [saved] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().endsWith(`/teams/${data.students[0].id}/paper`) &&
        r.request().method() === "PUT",
    ),
    page.getByRole("button", { name: "Guardar", exact: true }).click(),
  ]);
  expect(saved.ok(), await saved.text()).toBe(true);
  expect(await saved.json()).toEqual({ answeredCount: 3, taskCount: 3 });
  await expect(page.getByText(/Hoja cargada el/)).toBeVisible();
  expect(await paper(request, data)).toMatchObject({
    mode: "paper",
    status: "finished",
    answers: data.answers,
  });
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Opción B", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("textbox", { name: "Lo que escribió" }),
  ).toHaveValue("Bebras");
  for (const name of ["Lugar 1: pieza B", "Lugar 2: pieza A"]) {
    await expect(
      page.getByRole("button", { name, exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  }

  const paperSession = await session(request, data);
  const attempt = await request.get(`${API}/api/play/attempt`, {
    headers: paperSession,
  });
  expect(attempt.ok(), await attempt.text()).toBe(true);
  expect(await attempt.json()).toMatchObject({
    status: "finished",
    answers: data.answers,
    result: { totalScore: 24, correctCount: 3, answeredCount: 3 },
    tasks: data.tasks.map(() => ({ correct: true })),
  });
  expect(
    (
      await request.post(`${API}/api/play/start`, {
        headers: paperSession,
        data: {},
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await request.post(`${API}/api/play/answer`, {
        headers: paperSession,
        data: { taskId: data.tasks[0].id, payload: { selected: ["A"] } },
      })
    ).status(),
  ).toBe(409);
  const onlineSession = await session(request, data, 1);
  expect(
    (
      await request.post(`${API}/api/play/start`, {
        headers: onlineSession,
        data: {},
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await request.post(`${API}/api/play/submit`, { headers: onlineSession })
    ).ok(),
  ).toBe(true);
  const rejected = await request.put(
    `${API}/api/teams/${data.students[1].id}/paper`,
    { headers: data.teacher.headers, data: { answers: data.answers } },
  );
  expect(rejected.status()).toBe(409);
  expect(await rejected.json()).toMatchObject({
    message: expect.stringContaining("rindió en línea"),
  });
  expect(await paper(request, data, 1)).toMatchObject({
    mode: "online",
    status: "finished",
    answers: {},
  });

  await setE2EClock(request, new Date(data.starts + 2 * 3600000 + 1));
  const results = await request.get(
    `${API}/api/groups/${data.group.id}/results`,
    { headers: data.teacher.headers },
  );
  expect(results.ok(), await results.text()).toBe(true);
  expect(
    (await results.json()).teams.find(
      (team: { id: string }) => team.id === data.students[0].id,
    ),
  ).toMatchObject({
    paper: true,
    progress: "finished",
    score: 24,
    answers: ["correct", "correct", "correct"],
    rank: 1,
  });
  await page.goto(`/grupos/ver?id=${data.group.id}&vista=resultados`);
  await expect(
    page.getByRole("listitem").filter({ hasText: "Alba Prueba" }),
  ).toContainText("en papel");
});

test("confirma hojas en blanco, avisa al cambiar de estudiante y quitar restaura el intento", async ({
  page,
  request,
}) => {
  const data = await fixture(request);
  await setE2EClock(request, new Date(data.starts));
  await entry(page, data);
  const dialog = page.getByRole("alertdialog");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(dialog).toContainText("¿Guardar la hoja en blanco?");
  expect(await paper(request, data)).toMatchObject({
    status: "pending",
    answers: {},
  });
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  await page.getByRole("button", { name: "Opción B", exact: true }).click();
  await page.getByRole("combobox").selectOption(data.students[1].id);
  await expect(dialog).toContainText("¿Dejar esta hoja sin guardar?");
  await dialog.getByRole("button", { name: "Seguir aquí" }).click();
  await expect(page.getByRole("combobox")).toHaveValue(data.students[0].id);
  await expect(
    page.getByRole("button", { name: "Opción B", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("combobox").selectOption(data.students[1].id);
  await dialog.getByRole("button", { name: "Dejarla", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Opción B", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  expect(await paper(request, data)).toMatchObject({
    status: "pending",
    answers: {},
  });
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Guardar en blanco", exact: true })
    .click();
  await expect(page.getByText(/Hoja cargada el/)).toBeVisible();
  expect(await paper(request, data, 1)).toMatchObject({
    mode: "paper",
    status: "finished",
    answers: {},
  });
  const blank = await request.get(`${API}/api/play/attempt`, {
    headers: await session(request, data, 1),
  });
  expect(blank.ok(), await blank.text()).toBe(true);
  expect(await blank.json()).toMatchObject({
    status: "finished",
    result: { totalScore: 6, correctCount: 0, answeredCount: 0 },
  });
  await page.getByRole("button", { name: "Opción B", exact: true }).click();
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect
    .poll(async () => (await paper(request, data, 1)).answers)
    .toEqual({ [data.tasks[0].id]: { selected: ["B"] } });
  await expect(
    page.getByRole("button", { name: "Guardar", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Quitar lo cargado" }).click();
  await expect(dialog).toContainText("¿Quitar la hoja cargada?");
  await dialog.getByRole("button", { name: "Quitar", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Quitar lo cargado" }),
  ).toHaveCount(0);
  expect(await paper(request, data, 1)).toEqual({
    mode: "online",
    status: "pending",
    savedAt: null,
    answers: {},
  });
  const results = await request.get(
    `${API}/api/groups/${data.group.id}/results`,
    { headers: data.teacher.headers },
  );
  expect(
    (await results.json()).teams.find(
      (team: { id: string }) => team.id === data.students[1].id,
    ),
  ).toMatchObject({ paper: false, progress: "not_started", score: null });
  expect(
    (
      await request.post(`${API}/api/play/start`, {
        headers: await session(request, data, 1),
        data: {},
      })
    ).ok(),
  ).toBe(true);
});

test("respeta inicio, publicación diferida y propiedad del maestro", async ({
  page,
  request,
}) => {
  const data = await fixture(request);
  const path = `${API}/api/teams/${data.students[0].id}/paper`;
  const save = () =>
    request.put(path, {
      headers: data.teacher.headers,
      data: { answers: data.answers },
    });
  await setE2EClock(request, new Date(data.starts - 1));
  const early = await save();
  expect(early.status()).toBe(409);
  expect(await early.json()).toMatchObject({
    message: expect.stringContaining("desde que empieza"),
  });
  await loginPage(page, data.teacher.identity, /\/perfil\/?$/);
  await page.goto(`/grupos/papel?id=${data.group.id}`);
  await expect(
    page.getByText(/Las hojas se cargan desde que empieza/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Opción B", exact: true }),
  ).toBeDisabled();
  const other = await createApprovedTeacher(request, data.admin);
  owned.teachers.push(other);
  await setE2EClock(request, new Date(data.starts));
  for (const [method, url] of [
    ["get", `${API}/api/groups/${data.group.id}/paper`],
    ["get", path],
    ["put", path],
    ["delete", path],
  ] as const) {
    const response = await request[method](url, {
      headers: other.headers,
      ...(method === "put" ? { data: { answers: data.answers } } : {}),
    });
    expect(response.status(), `${method} ${url}`).toBe(404);
  }
  expect(await paper(request, data)).toMatchObject({
    status: "pending",
    answers: {},
  });
  await setE2EClock(request, new Date(data.starts + 3600000 + 1));
  expect((await save()).ok()).toBe(true);
  await setE2EClock(request, new Date(data.starts + 2 * 3600000 + 1));
  const closed = await save();
  expect(closed.status()).toBe(409);
  expect(await closed.json()).toMatchObject({
    message: expect.stringContaining("Los resultados ya se calcularon"),
  });
  expect(
    (await request.delete(path, { headers: data.teacher.headers })).status(),
  ).toBe(409);
  expect(await paper(request, data)).toMatchObject({
    mode: "paper",
    status: "finished",
    answers: data.answers,
  });
  await page.clock.setFixedTime(new Date(data.starts + 2 * 3600000 + 1));
  await page.reload();
  await expect(
    page.getByText(
      "Los resultados ya se calcularon: ya no se pueden cargar hojas.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Opción B", exact: true }),
  ).toBeDisabled();
});
