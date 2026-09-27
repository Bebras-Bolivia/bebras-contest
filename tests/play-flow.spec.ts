import { test, expect, request } from "@playwright/test";
import {
  API,
  loginAdmin,
  createContest,
  joinContestSession,
  openContest,
  playHeaders,
  SCORING_TASKS,
  resetE2EClock,
  setE2EClock,
} from "./support/helpers";

test.afterEach(async ({ request }) => resetE2EClock(request));

test("student starts, answers and submits without seeing the score", async ({
  page,
}) => {
  const api = await request.newContext();
  const headers = await loginAdmin(api);
  const contest = await createContest(api, headers);
  const { sessionToken } = await joinContestSession(
    api,
    headers,
    contest.id,
    contest.picked.grade,
  );
  await api.dispose();

  await page.addInitScript((token) => {
    window.localStorage.setItem("bebras_play_session", token);
  }, sessionToken);
  await page.goto("/");
  await page.goto("/rendir");

  const siteHeader = page.locator('[data-site-chrome="header"]');
  const siteFooter = page.locator('[data-site-chrome="footer"]');
  const startButton = page.getByRole("button", { name: /Empezar/i });
  await expect(startButton).toBeVisible();
  await expect(siteHeader).toBeVisible();
  await expect(siteFooter).toBeVisible();
  await startButton.click();
  await expect(siteHeader).toBeHidden();
  await expect(siteFooter).toBeHidden();

  await expect(page.getByText("Tarea 1", { exact: true })).toBeVisible({
    timeout: 15000,
  });
  await expect(siteHeader).toBeHidden();
  await expect(siteFooter).toBeHidden();
  await expect(page.getByText(/\d{2}:\d{2}/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Entregar" })).toBeVisible();

  const exitDialogPromise = page.waitForEvent("dialog");
  await page.close({ runBeforeUnload: true });
  const exitDialog = await exitDialogPromise;
  expect(exitDialog.type()).toBe("beforeunload");
  await exitDialog.dismiss();
  expect(page.isClosed()).toBe(false);
  await expect(page).toHaveURL(/\/rendir$/);
  await expect(page.getByText("Tarea 1", { exact: true })).toBeVisible();

  const firstOption = page.locator("button[aria-pressed]").first();
  if (await firstOption.count()) {
    await firstOption.click();
  }

  await page.getByRole("button", { name: "Entregar" }).first().click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Entregar" }).click();

  await expect(page.getByText("¡Terminaste!", { exact: true })).toBeVisible({
    timeout: 15000,
  });

  await expect(page.getByText(/Puntaje:/i)).toBeHidden();
  await expect(page.getByText(/se publicarán/i)).toBeVisible();
  await expect(siteHeader).toBeVisible();
  await expect(siteFooter).toBeVisible();
});

test("finishes the attempt and says so when the time runs out", async ({
  page,
}) => {
  const api = await request.newContext();
  const headers = await loginAdmin(api);
  const contest = await createContest(api, headers, { durationMinutes: 30 });
  const { sessionToken } = await joinContestSession(
    api,
    headers,
    contest.id,
    contest.picked.grade,
  );

  await page.addInitScript((token) => {
    window.localStorage.setItem("bebras_play_session", token);
  }, sessionToken);
  await page.goto("/rendir");
  await page.getByRole("button", { name: /Empezar/i }).click();
  await expect(page.getByText("Tarea 1", { exact: true })).toBeVisible({
    timeout: 15000,
  });

  // El reloj de pruebas pasa el cierre del intento: al volver a la pantalla, el
  // servidor ya lo entregó y el equipo tiene que enterarse de por qué.
  const attempt = await api
    .get(`${API}/api/play/attempt`, { headers: playHeaders(sessionToken) })
    .then((response) => response.json());
  await setE2EClock(api, new Date(new Date(attempt.endsAt).getTime() + 1000));
  await api.dispose();
  await page.goto("/rendir");

  await expect(page.getByText("Se acabó el tiempo")).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByText(/Entregamos tus respuestas/)).toBeVisible();
  await expect(page.getByText("¡Terminaste!", { exact: true })).toBeHidden();
});

test("keeps site chrome hidden while an active attempt loads on mobile", async ({
  page,
}) => {
  const api = await request.newContext();
  const headers = await loginAdmin(api);
  const contest = await createContest(api, headers);
  const { sessionToken } = await joinContestSession(
    api,
    headers,
    contest.id,
    contest.picked.grade,
  );
  const started = await api.post(`${API}/api/play/start`, {
    headers: playHeaders(sessionToken),
    data: {},
  });
  expect(started.ok(), await started.text()).toBe(true);
  await api.dispose();

  let releaseAttempt: (() => void) | undefined;
  const attemptReleased = new Promise<void>((resolve) => {
    releaseAttempt = resolve;
  });
  await page.route(`${API}/api/play/attempt`, async (route) => {
    await attemptReleased;
    await route.continue();
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript((token) => {
    window.localStorage.setItem("bebras_play_session", token);
  }, sessionToken);
  await page.goto("/rendir");

  const siteHeader = page.locator('[data-site-chrome="header"]');
  const siteFooter = page.locator('[data-site-chrome="footer"]');
  await expect(siteHeader).toBeHidden();
  await expect(siteFooter).toBeHidden();

  releaseAttempt?.();
  await expect(page.getByText("Tarea 1", { exact: true })).toBeVisible({
    timeout: 15000,
  });
  await expect(siteHeader).toBeHidden();
  await expect(siteFooter).toBeHidden();
  await expect(page.getByText(/\d{2}:\d{2}/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Entregar" })).toBeVisible();
});

test("serializes answer saves for the same task", async ({ page }) => {
  const api = await request.newContext();
  const headers = await loginAdmin(api);
  const contest = await createContest(api, headers);
  const { sessionToken } = await joinContestSession(
    api,
    headers,
    contest.id,
    contest.picked.grade,
  );
  const savedPayloads: Array<{ payload: { selected: string[] } }> = [];
  let activeRequests = 0;
  let maximumActiveRequests = 0;
  let markFirstSaveStarted: (() => void) | undefined;
  const firstSaveStarted = new Promise<void>((resolve) => {
    markFirstSaveStarted = resolve;
  });

  await page.route(`${API}/api/play/answer`, async (route) => {
    activeRequests += 1;
    maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
    savedPayloads.push(
      route.request().postDataJSON() as { payload: { selected: string[] } },
    );

    if (savedPayloads.length === 1) {
      markFirstSaveStarted?.();
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }

    try {
      const response = await route.fetch();
      await route.fulfill({ response });
    } finally {
      activeRequests -= 1;
    }
  });

  await page.addInitScript((token) => {
    window.localStorage.setItem("bebras_play_session", token);
  }, sessionToken);
  await page.goto("/rendir");
  await page.getByRole("button", { name: /Empezar/i }).click();
  await expect(page.getByText("Tarea 1", { exact: true })).toBeVisible({
    timeout: 15000,
  });

  const options = page.locator("button[aria-pressed]");
  await options.first().click();
  await firstSaveStarted;
  await options.last().click();

  await expect
    .poll(() => savedPayloads.length, { timeout: 5000 })
    .toBeGreaterThanOrEqual(2);
  expect(maximumActiveRequests).toBe(1);
  expect(savedPayloads[0].payload.selected).not.toEqual(
    savedPayloads[1].payload.selected,
  );

  await api.dispose();
});

test("blocks submission until failed answers can be saved", async ({
  page,
}) => {
  const api = await request.newContext();
  const headers = await loginAdmin(api);
  const contest = await createContest(api, headers);
  const { sessionToken } = await joinContestSession(
    api,
    headers,
    contest.id,
    contest.picked.grade,
  );
  let failAnswerRequests = true;
  let answerRequests = 0;
  let submitRequests = 0;

  await page.route(`${API}/api/play/answer`, async (route) => {
    answerRequests += 1;
    if (failAnswerRequests) {
      await route.fulfill({
        status: 503,
        json: { message: "Temporary save failure" },
      });
      return;
    }
    await route.continue();
  });
  await page.route(`${API}/api/play/submit`, async (route) => {
    submitRequests += 1;
    await route.continue();
  });

  await page.addInitScript((token) => {
    window.localStorage.setItem("bebras_play_session", token);
  }, sessionToken);
  await page.goto("/rendir");
  await page.getByRole("button", { name: /Empezar/i }).click();
  await expect(page.getByText("Tarea 1", { exact: true })).toBeVisible({
    timeout: 15000,
  });
  await page.locator("button[aria-pressed]").first().click();

  await page.getByRole("button", { name: "Entregar" }).first().click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Entregar" })
    .click();
  await expect(page.locator("button[aria-pressed]").first()).toBeDisabled();
  await expect(
    page.getByText(
      "No pudimos entregar el desafío. Revisa la conexión e inténtalo nuevamente.",
    ),
  ).toBeVisible({ timeout: 10000 });
  expect(answerRequests).toBeGreaterThanOrEqual(3);
  expect(submitRequests).toBe(0);
  await expect(
    page.getByRole("button", { name: "Entregar" }).first(),
  ).toBeEnabled();
  await expect(page.getByRole("button", { name: /Reintentar/i })).toHaveCount(
    0,
  );

  failAnswerRequests = false;
  await page.getByRole("button", { name: "Entregar" }).first().click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Entregar" })
    .click();

  await expect(page.getByText("¡Terminaste!", { exact: true })).toBeVisible({
    timeout: 15000,
  });
  expect(submitRequests).toBe(1);

  await api.dispose();
});

test("closes the one by one flow with a finish button", async ({ page }) => {
  const api = await request.newContext();
  const headers = await loginAdmin(api);
  const contest = await createContest(api, headers, {
    tasks: SCORING_TASKS.map(({ taskId }) => ({ taskId })),
  });
  const { sessionToken } = await joinContestSession(
    api,
    headers,
    contest.id,
    contest.picked.grade,
  );
  await api.dispose();

  await page.addInitScript((token) => {
    window.localStorage.setItem("bebras_play_session", token);
  }, sessionToken);
  await page.goto("/rendir");
  await page.getByRole("button", { name: /Empezar/i }).click();

  const stepLabel = page.getByText(/^Tarea \d+ de 3$/);
  await expect(stepLabel).toHaveText("Tarea 1 de 3", { timeout: 15000 });

  const nextButton = page.getByRole("button", { name: "Siguiente" });
  await nextButton.click();
  await expect(stepLabel).toHaveText("Tarea 2 de 3");
  await nextButton.click();
  await expect(stepLabel).toHaveText("Tarea 3 de 3");

  await expect(nextButton).toBeHidden();
  const finishButton = page.getByRole("button", { name: "Terminar" });
  await expect(finishButton).toBeEnabled();

  await finishButton.click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Entregar" }).click();

  await expect(page.getByText("¡Terminaste!", { exact: true })).toBeVisible({
    timeout: 15000,
  });
});

test("pauses the student view while the contest is suspended", async ({
  page,
}) => {
  const api = await request.newContext();
  const headers = await loginAdmin(api);
  const contest = await createContest(api, headers);
  const { sessionToken } = await joinContestSession(
    api,
    headers,
    contest.id,
    contest.picked.grade,
  );
  await api.post(`${API}/api/play/start`, {
    headers: playHeaders(sessionToken),
    data: {},
  });

  const suspended = await api.post(
    `${API}/api/contests/${contest.id}/suspend`,
    { headers },
  );
  expect(suspended.ok(), await suspended.text()).toBe(true);

  await page.addInitScript((token) => {
    window.localStorage.setItem("bebras_play_session", token);
  }, sessionToken);
  await page.goto("/rendir");

  const notice = page.getByText("El desafío está suspendido");
  await expect(notice).toBeVisible({ timeout: 15000 });
  await expect(page.locator('[data-site-chrome="header"]')).toBeHidden();
  await expect(page.locator('[data-site-chrome="footer"]')).toBeHidden();
  await expect(page.getByRole("button", { name: "Entregar" })).toBeDisabled();

  const resumed = await api.post(`${API}/api/contests/${contest.id}/resume`, {
    headers,
  });
  expect(resumed.ok(), await resumed.text()).toBe(true);
  await api.dispose();

  await expect(notice).toBeHidden({ timeout: 20000 });
  await expect(page.getByRole("button", { name: "Entregar" })).toBeEnabled();
});

test("keeps a single open session per student", async () => {
  const api = await request.newContext();
  const headers = await loginAdmin(api);
  const contest = await createContest(api, headers);
  const student = await joinContestSession(
    api,
    headers,
    contest.id,
    contest.picked.grade,
  );

  // Volver a entrar con el código se queda con la sesión y cierra la anterior.
  const secondDevice = await api.post(`${API}/api/play/session`, {
    data: { personalCode: student.personalCode },
  });
  expect(secondDevice.ok(), await secondDevice.text()).toBe(true);
  const secondToken = (await secondDevice.json()).sessionToken as string;
  const replaced = await api.get(`${API}/api/play/attempt`, {
    headers: playHeaders(student.sessionToken),
  });
  expect(replaced.status()).toBe(401);
  student.sessionToken = secondToken;

  const withCode = await api.post(`${API}/api/play/start`, {
    data: { personalCode: student.personalCode },
  });
  expect(withCode.status()).toBe(409);

  const withSession = await api.post(`${API}/api/play/start`, {
    headers: playHeaders(student.sessionToken),
    data: {},
  });
  expect(withSession.ok(), await withSession.text()).toBe(true);

  const attemptResponse = await api.get(`${API}/api/play/attempt`, {
    headers: playHeaders(student.sessionToken),
  });
  expect(attemptResponse.ok(), await attemptResponse.text()).toBe(true);
  const attempt = await attemptResponse.json();
  await setE2EClock(
    api,
    new Date(new Date(attempt.startedAt).getTime() + 60000),
  );

  const takeover = await api.post(`${API}/api/play/session`, {
    data: { personalCode: student.personalCode },
  });
  expect(takeover.ok(), await takeover.text()).toBe(true);
  const takeoverToken = (await takeover.json()).sessionToken as string;
  expect(takeoverToken).not.toBe(student.sessionToken);

  const abandoned = await api.get(`${API}/api/play/attempt`, {
    headers: playHeaders(student.sessionToken),
  });
  expect(abandoned.status()).toBe(401);

  const stillPlaying = await api.get(`${API}/api/play/attempt`, {
    headers: playHeaders(takeoverToken),
  });
  expect(stillPlaying.ok(), await stillPlaying.text()).toBe(true);
  expect((await stillPlaying.json()).status).toBe("in_progress");

  await api.post(`${API}/api/play/session/close`, {
    headers: playHeaders(takeoverToken),
  });

  const afterClose = await api.post(`${API}/api/play/session`, {
    data: { personalCode: student.personalCode },
  });
  expect(afterClose.ok(), await afterClose.text()).toBe(true);

  await api.dispose();
});

test("enters with the personal code handed out at enrolment", async ({
  page,
}) => {
  const api = await request.newContext();
  const headers = await loginAdmin(api);
  const contest = await createContest(api, headers);
  const group = await api
    .post(`${API}/api/groups`, {
      headers,
      data: { contestId: contest.id, name: "PW Group" },
    })
    .then((r) => r.json());

  const registered = await api.post(`${API}/api/play/join`, {
    data: {
      accessCode: group.accessCode,
      participationMode: "individual",
      grade: contest.picked.grade,
      memberOneFirstName: "Ana",
      memberOneLastName: "Quispe",
    },
  });
  expect(registered.ok(), await registered.text()).toBe(true);
  const personalCode = (await registered.json()).personalCode as string;
  await openContest(api, contest);
  await api.dispose();

  await page.goto("/entrar");
  await page.waitForFunction(
    () => {
      const island = document.querySelector(
        'astro-island[component-url*="join-form"]',
      );
      return island !== null && !island.hasAttribute("ssr");
    },
    null,
    { timeout: 30000 },
  );

  const codeInput = page.getByLabel("Tu código");
  await codeInput.fill(personalCode.toLowerCase());
  await expect(codeInput).toHaveValue(personalCode);
  await page.getByRole("button", { name: "Continuar" }).click();

  await expect(page).toHaveURL(/\/rendir$/);
  await expect(page.getByRole("button", { name: /Empezar/i })).toBeVisible({
    timeout: 15000,
  });

  const openSession = (body: Record<string, string>) =>
    page.evaluate(async (data) => {
      const response = await fetch("http://localhost:3100/api/play/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      return response.status;
    }, body);

  // El codigo del grupo solo inscribe: no abre la prueba de nadie.
  expect(await openSession({ personalCode: group.accessCode })).toBe(409);
  expect(await openSession({ personalCode: "ZZZZZZZZ" })).toBe(404);
});
