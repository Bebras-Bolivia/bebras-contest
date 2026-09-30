import { test, expect, request } from "@playwright/test";
import {
  API,
  SCORING_TASKS,
  loginAdmin,
  createContest,
  joinContest,
  joinContestSession,
  playHeaders,
  loginAdminPage,
  resetE2EClock,
  setE2EClock,
} from "./support/helpers";

test.afterEach(async ({ request }) => resetE2EClock(request));

test("results are released when the contest closes and can be hidden and republished", async ({
  page,
}) => {
  const api = await request.newContext();
  const headers = await loginAdmin(api);

  const endsAt = new Date(Date.now() + 90000);
  const contest = await createContest(api, headers, {
    durationMinutes: 1,
    startsAt: new Date(Date.now() - 60000).toISOString(),
    endsAt: endsAt.toISOString(),
    tasks: SCORING_TASKS.map(({ taskId }) => ({ taskId })),
  });

  const participant = await joinContestSession(
    api,
    headers,
    contest.id,
    contest.picked.grade,
  );
  const studentHeaders = playHeaders(participant.sessionToken);
  const expiredPersonalCode = await joinContest(
    api,
    headers,
    contest.id,
    contest.picked.grade,
    "Expired",
  );

  const expiredStart = await api.post(`${API}/api/play/start`, {
    data: { personalCode: expiredPersonalCode },
  });
  expect(expiredStart.ok(), await expiredStart.text()).toBe(true);
  const expiredAttempt = await api
    .get(`${API}/api/play/attempt/${expiredPersonalCode}`)
    .then((r) => r.json());
  expect(expiredAttempt.status).toBe("in_progress");
  await api.post(`${API}/api/play/start`, {
    headers: studentHeaders,
    data: {},
  });
  for (const [task, selected] of [
    [SCORING_TASKS[0], "B"],
    [SCORING_TASKS[1], "A"],
  ] as const) {
    const answer = await api.post(`${API}/api/play/answer`, {
      headers: studentHeaders,
      data: {
        taskId: task.taskId,
        payload: { selected: [selected] },
      },
    });
    expect(answer.status(), await answer.text()).toBe(204);
  }
  await api.post(`${API}/api/play/submit`, {
    headers: studentHeaders,
    data: {},
  });

  const beforePublish = await api
    .get(`${API}/api/play/attempt`, { headers: studentHeaders })
    .then((r) => r.json());
  expect(beforePublish.status).toBe("finished");
  expect(beforePublish.resultsPublished).toBe(false);
  expect(beforePublish.result).toBeNull();

  const tooEarly = await api.post(
    `${API}/api/contests/${contest.id}/consolidate`,
    { headers },
  );
  expect(tooEarly.status()).toBe(409);

  await setE2EClock(api, new Date(endsAt.getTime() + 2000));

  const consolidated = await api.post(
    `${API}/api/contests/${contest.id}/consolidate`,
    { headers },
  );
  expect(consolidated.ok()).toBe(true);
  const consolidatedContest = await consolidated.json();
  expect(consolidatedContest.state).toBe("consolidada");
  expect(consolidatedContest.closedAttempts).toBe(1);

  // Consultar los resultados ya cerrados los publica solos (una sola vez).
  const adminResults = await api
    .get(`${API}/api/contests/${contest.id}/results`, { headers })
    .then((r) => r.json());
  expect(adminResults.state).toBe("publicada");
  const expiredResult = adminResults.rows.find(
    (row: { elapsedSeconds: number | null }) => row.elapsedSeconds === 60,
  );
  expect(expiredResult?.elapsedSeconds).toBe(60);

  const afterRelease = await api
    .get(`${API}/api/play/attempt`, { headers: studentHeaders })
    .then((r) => r.json());
  expect(afterRelease.resultsPublished).toBe(true);
  expect(afterRelease.result.rankPosition).toBe(1);
  expect(afterRelease.result.totalScore).toBe(
    contest.initialScores[contest.categories[0]] +
      contest.tasks[0].maxScore +
      contest.tasks[1].minScore,
  );
  expect(afterRelease.result.correctCount).toBe(1);
  expect(afterRelease.result.answeredCount).toBe(2);
  expect(
    afterRelease.tasks.map((task: { correct: boolean | null }) => task.correct),
  ).toEqual([true, false, null]);

  // El administrador los oculta desde la pantalla de resultados.
  await loginAdminPage(page);
  await page.goto(`/desafios/resultados?id=${contest.id}`);
  await page.getByRole("button", { name: "Ocultar resultados" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Ocultar resultados" })
    .click();
  await expect(
    page.getByRole("button", { name: "Publicar resultados" }),
  ).toBeVisible();

  const afterUnpublish = await api
    .get(`${API}/api/play/attempt`, { headers: studentHeaders })
    .then((r) => r.json());
  expect(afterUnpublish.resultsPublished).toBe(false);
  expect(afterUnpublish.result).toBeNull();

  // Ocultados a mano, no vuelven a publicarse solos.
  await api.get(`${API}/api/public-contests`);
  const stillHidden = await api
    .get(`${API}/api/contests/${contest.id}`, { headers })
    .then((r) => r.json());
  expect(stillHidden.state).toBe("consolidada");

  await page.getByRole("button", { name: "Publicar resultados" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Publicar resultados" })
    .click();
  await expect(
    page.getByRole("button", { name: "Ocultar resultados" }),
  ).toBeVisible();

  // El estudiante ve su resultado y el estado de cada respuesta.
  await page.evaluate((sessionToken) => {
    window.localStorage.setItem("bebras_play_session", sessionToken);
  }, participant.sessionToken);
  await page.goto("/rendir");
  await expect(page.getByText("¡Terminaste!", { exact: true })).toBeVisible();
  const expectedStatuses = ["Correcta", "Incorrecta", "Sin responder"];
  for (const [index, task] of afterRelease.tasks.entries()) {
    const row = page.locator("li").filter({ hasText: task.title });
    await expect(
      row.getByText(expectedStatuses[index], { exact: true }),
    ).toBeVisible();
  }

  await api.dispose();
});
