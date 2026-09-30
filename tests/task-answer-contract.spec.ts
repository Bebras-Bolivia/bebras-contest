import { expect, test } from "@playwright/test";
import {
  API,
  createPracticeTask,
  createContest,
  joinContestSession,
  loginAdmin,
  loginAdminPage,
  playHeaders,
  resetE2EClock,
  setE2EClock,
} from "./support/helpers";

test.afterEach(async ({ request }) => resetE2EClock(request));

test("private drafts use authenticated preview/check, preserve the storage contract and hide solutions", async ({
  request,
}) => {
  const headers = await loginAdmin(request);
  const task = await createPracticeTask(request, headers, "short_text", {
    isPractice: false,
    country: "Alemania",
    year: 2024,
    sourceTaskCode: " 2024-DE-04a ",
  });
  expect(task.sourceTaskCode).toBe("2024-DE-04a");
  expect(task.answerConfig).toEqual({});
  expect(task.answerKey).toEqual({});
  // Ya no se pueden firmar tokens propios: la identidad la emite Firebase. El
  // rechazo por rol se cubre contra el Worker en las pruebas de sesion.
  const forged = { authorization: "Bearer no.es.un.token" };
  for (const auth of [
    { headers: {}, status: 401 },
    { headers: forged, status: 401 },
  ]) {
    expect(
      (
        await request.get(`${API}/api/tasks/${task.id}/preview`, {
          headers: auth.headers,
        })
      ).status(),
    ).toBe(auth.status);
    expect(
      (
        await request.post(`${API}/api/tasks/${task.id}/check`, {
          headers: auth.headers,
          data: { payload: { text: "Bebras" } },
        })
      ).status(),
    ).toBe(auth.status);
  }
  expect(
    (await request.get(`${API}/api/practice/tasks/${task.id}`)).status(),
  ).toBe(404);
  expect(
    (
      await request.post(`${API}/api/practice/tasks/${task.id}/check`, {
        data: { payload: { text: "Bebras" } },
      })
    ).status(),
  ).toBe(404);
  const preview = await request.get(`${API}/api/tasks/${task.id}/preview`, {
    headers,
  });
  expect(preview.ok()).toBe(true);
  const safe = await preview.json();
  expect(safe.answerConfig).toEqual({});
  expect(safe).not.toHaveProperty("sourceTaskCode");
  for (const key of [
    "answerKey",
    "correctAnswerId",
    "shortAnswer",
    "dragDropSolutions",
  ])
    expect(safe).not.toHaveProperty(key);
  for (const [payload, correct] of [
    [{ text: " BEBRAS " }, true],
    [{ text: "Wrong" }, false],
    [{ text: "" }, false],
  ] as const) {
    const check = await request.post(`${API}/api/tasks/${task.id}/check`, {
      headers,
      data: { payload },
    });
    expect(check.status()).toBe(200);
    expect(await check.json()).toMatchObject({ correct });
  }
  expect(
    (
      await request.post(`${API}/api/tasks/${task.id}/check`, {
        headers,
        data: { payload: { text: [] } },
      })
    ).status(),
  ).toBe(400);
  for (const field of ["answerConfig", "answerKey"]) {
    const invalid = await request.put(`${API}/api/tasks/${task.id}`, {
      headers,
      data: { ...task, [field]: { secret: "solution" } },
    });
    expect(invalid.status()).toBe(400);
  }
  const update = await request.put(`${API}/api/tasks/${task.id}`, {
    headers,
    data: { ...task, title: "Contrato reabierto" },
  });
  expect(update.status()).toBe(200);
  const reopened = await request.get(`${API}/api/tasks/${task.id}`, {
    headers,
  });
  expect(await reopened.json()).toMatchObject({
    title: "Contrato reabierto",
    answerConfig: {},
    answerKey: {},
    shortAnswer: "Bebras",
    sourceTaskCode: "2024-DE-04a",
    isPractice: false,
  });

  const invalidSourceCode = await request.put(`${API}/api/tasks/${task.id}`, {
    headers,
    data: { ...task, sourceTaskCode: "2024 DE 04a" },
  });
  expect(invalidSourceCode.status()).toBe(400);
  expect(await invalidSourceCode.json()).toEqual({
    message:
      "El código original debe tener un formato como 2024-DE-04a y no superar 64 caracteres.",
  });
  expect(
    (
      await request.get(`${API}/api/tasks/missing/preview`, { headers })
    ).status(),
  ).toBe(404);
  expect(
    (
      await request.post(`${API}/api/tasks/missing/check`, {
        headers,
        data: { payload: {} },
      })
    ).status(),
  ).toBe(404);
});

test("tester discards stale checks, clears feedback on changes/reset and retries request failures", async ({
  request,
  page,
}) => {
  const headers = await loginAdmin(request);
  const task = await createPracticeTask(request, headers, "short_text", {
    isPractice: false,
  });
  await loginAdminPage(page);
  await page.goto(`/tareas/probador?id=${task.id}`);
  const input = page.getByRole("textbox", {
    name: "Tu respuesta",
    exact: true,
  });
  const result = page
    .getByRole("status")
    .filter({ hasText: /Correcto|incorrecta/ });
  await input.fill("Bebras");
  let release!: () => void;
  let intercepted!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    intercepted = resolve;
  });
  let delivered!: () => void;
  const finished = new Promise<void>((resolve) => {
    delivered = resolve;
  });
  await page.route(
    `**/api/tasks/${task.id}/check`,
    async (route) => {
      const response = await route.fetch();
      intercepted();
      await gate;
      await route.fulfill({ response }).catch(() => undefined);
      delivered();
    },
    { times: 1 },
  );
  await page.getByRole("button", { name: "Comprobar", exact: true }).click();
  await started;
  await expect(
    page.getByRole("button", { name: "Comprobando…" }),
  ).toBeDisabled();
  await input.fill("Otra respuesta");
  release();
  await finished;
  await expect(result).toHaveCount(0);
  await page.getByRole("button", { name: "Comprobar", exact: true }).click();
  await expect(result.getByText("Respuesta incorrecta", { exact: true })).toBeVisible();
  await input.fill("Bebras");
  await expect(result).toHaveCount(0);
  await page.route(
    `**/api/tasks/${task.id}/check`,
    (route) =>
      route.fulfill({
        status: 503,
        json: { message: "Fallo temporal de prueba" },
      }),
    { times: 1 },
  );
  await page.getByRole("button", { name: "Comprobar", exact: true }).click();
  await expect(
    page.getByText("Fallo temporal de prueba", { exact: true }),
  ).toBeVisible();
  await expect(result).toHaveCount(0);
  await page.getByRole("button", { name: "Comprobar", exact: true }).click();
  await expect(result.getByText("¡Correcto!", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Reiniciar" }).click();
  await expect(input).toHaveValue("");
  await expect(result).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await input.fill("Bebras");
  await page.getByRole("button", { name: "Comprobar", exact: true }).click();
  await expect(result.getByText("¡Correcto!", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "test-results/task-contract-tester-mobile.png",
    fullPage: true,
  });
});

test("existing text and choice answers survive invalid saves and score identically in preview and contest", async ({
  request,
}) => {
  const headers = await loginAdmin(request);
  const cases = [
    {
      type: "multiple_choice",
      valid: { selected: ["B"] },
      invalid: { selected: ["unknown"] },
      empty: { selected: [] },
    },
    {
      type: "short_text",
      valid: { text: " BEBRAS " },
      invalid: { text: [] },
      empty: { text: " " },
    },
  ] as const;
  const tasks = [];
  for (const entry of cases)
    tasks.push(
      await createPracticeTask(request, headers, entry.type, {
        difficulties: { "8–10": "easy" },
      }),
    );
  const now = Date.now();
  const contest = await createContest(request, headers, {
    tasks: tasks.map((task) => ({ taskId: task.id })),
    registrationStartsAt: new Date(now - 3600000).toISOString(),
    registrationEndsAt: new Date(now + 3600000).toISOString(),
    startsAt: new Date(now + 7200000).toISOString(),
    endsAt: new Date(now + 14400000).toISOString(),
  });
  const student = await joinContestSession(
    request,
    headers,
    contest.id,
    "P3",
    "Contrato",
  );
  await setE2EClock(request, new Date(now + 7260000));
  const studentHeaders = playHeaders(student.sessionToken);
  expect(
    (
      await request.post(`${API}/api/play/start`, {
        headers: studentHeaders,
        data: {},
      })
    ).ok(),
  ).toBe(true);
  const answers: Record<string, unknown> = {};
  for (const [index, entry] of cases.entries()) {
    const taskId = tasks[index].id;
    const save = (payload: unknown) =>
      request.post(`${API}/api/play/answer`, {
        headers: studentHeaders,
        data: { taskId, payload },
      });
    expect((await save(entry.valid)).status()).toBe(204);
    expect((await save(entry.invalid)).status()).toBe(400);
    for (const [url, checkHeaders] of [
      [`${API}/api/practice/tasks/${taskId}/check`, {}],
      [`${API}/api/tasks/${taskId}/check`, headers],
    ] as const) {
      const invalidCheck = await request.post(url, {
        headers: checkHeaders,
        data: { payload: entry.invalid },
      });
      expect(invalidCheck.status()).toBe(400);
      const error = await invalidCheck.json();
      expect(error.message).toEqual(expect.any(String));
      expect(error).not.toHaveProperty("explanationBlocks");
    }
    const recovered = await request
      .get(`${API}/api/play/attempt`, { headers: studentHeaders })
      .then((r) => r.json());
    expect(recovered.answers[taskId]).toEqual(entry.valid);
    for (const task of recovered.tasks)
      expect(task).not.toHaveProperty("answerKey");
    expect((await save(entry.empty)).status()).toBe(204);
    const publicCheck = await request.post(
      `${API}/api/practice/tasks/${taskId}/check`,
      { data: { payload: entry.empty } },
    );
    expect(await publicCheck.json()).toMatchObject({ correct: false });
    expect((await save(entry.valid)).status()).toBe(204);
    answers[taskId] = entry.valid;
    const adminCheck = await request.post(`${API}/api/tasks/${taskId}/check`, {
      headers,
      data: { payload: entry.valid },
    });
    expect(await adminCheck.json()).toMatchObject({ correct: true });
  }
  const preview = await request
    .post(`${API}/api/contests/${contest.id}/preview/score`, {
      headers,
      data: { answers },
    })
    .then((r) => r.json());
  expect(preview).toMatchObject({
    correctCount: cases.length,
    answeredCount: cases.length,
  });
  expect(
    (
      await request.post(`${API}/api/play/submit`, {
        headers: studentHeaders,
        data: {},
      })
    ).ok(),
  ).toBe(true);
  const results = await request
    .get(`${API}/api/contests/${contest.id}/results`, { headers })
    .then((r) => r.json());
  expect(results.rows).toContainEqual(
    expect.objectContaining({
      memberOneFirstName: "Contrato",
      correctCount: cases.length,
      answeredCount: cases.length,
      totalScore: preview.totalScore,
    }),
  );
});
