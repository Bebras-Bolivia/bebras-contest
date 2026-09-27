import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  API,
  DRAG_DROP_BACKGROUND,
  createContest,
  joinContestSession,
  loginAdmin,
  loginAdminPage,
  playHeaders,
  resetE2EClock,
  setE2EClock,
  taskBlock,
} from "./support/helpers";

const targets = Array.from({ length: 12 }, (_, index) => ({
  id: `position-${index + 1}`,
  x: 15 + (index % 4) * 23,
  y: 20 + Math.floor(index / 4) * 30,
  snapRadius: 8,
}));

const items = ["a", "b-one", "b-two"].map((id, index) => ({
  id,
  label: `Ficha ${id}`,
  image: {
    id: `image-${id}`,
    name: `${id}.svg`,
    // The B pieces deliberately use different image URLs.
    url: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><rect width="60" height="60" fill="${index ? "#60a5fa" : "#f87171"}"/><text x="20" y="40">${id}</text></svg>`)}`,
  },
  widthPercent: 8,
  equivalenceKey: index ? "letter-b" : "letter-a",
  correctTargetId: targets[index].id,
}));

const primary = {
  a: "position-1",
  "b-one": "position-2",
  "b-two": "position-3",
};
const alternative = {
  a: "position-8",
  "b-one": "position-10",
  "b-two": "position-12",
};
const swapped = {
  a: "position-8",
  "b-one": "position-12",
  "b-two": "position-10",
};
const incorrect = {
  a: "position-10",
  "b-one": "position-8",
  "b-two": "position-12",
};
const partial = { a: "position-8" };
const solutions = [{ id: "another-subset", placements: alternative }];

function taskData() {
  return {
    title: `PW arrastre con destinos libres ${Date.now()}`,
    categories: ["Algoritmos y programación"],
    difficulties: { "8–10": "easy" },
    bodyBlocks: [taskBlock("body", "Coloca las tres fichas en el tablero.")],
    challengeBlocks: [taskBlock("challenge", "Quedarán posiciones vacías.")],
    explanationBlocks: [
      taskBlock("explanation", "Hay dos configuraciones válidas."),
    ],
    answerType: "drag_drop",
    answers: [],
    correctAnswerId: "",
    dragDropBackground: DRAG_DROP_BACKGROUND,
    dragDropItems: items,
    dragDropTargets: targets,
    dragDropSolutions: solutions,
    isPractice: true,
  };
}

async function createTask(
  api: APIRequestContext,
  headers: Record<string, string>,
) {
  const response = await api.post(`${API}/api/tasks`, {
    headers,
    data: taskData(),
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

function expectPrivateSolutionsAbsent(task: Record<string, unknown>) {
  expect(task).not.toHaveProperty("dragDropSolutions");
  expect(task).not.toHaveProperty("answerKey");
  expect(task.dragDropItems).toHaveLength(3);
  expect(task.dragDropTargets).toHaveLength(12);
  for (const item of task.dragDropItems as Record<string, unknown>[]) {
    expect(item).not.toHaveProperty("correctTargetId");
    expect(item).not.toHaveProperty("equivalenceKey");
    expect(item).not.toHaveProperty("targetX");
    expect(item).not.toHaveProperty("targetY");
  }
}

test.afterEach(async ({ request }) => resetE2EClock(request));

test("saves and reopens three pieces, twelve independent targets and alternative subsets", async ({
  request,
}) => {
  const headers = await loginAdmin(request);
  const created = await createTask(request, headers);
  expect(created.dragDropItems).toEqual(items);
  expect(created.dragDropTargets).toEqual(targets);
  expect(created.dragDropSolutions).toEqual(solutions);

  const reopened = await request.get(`${API}/api/tasks/${created.id}`, {
    headers,
  });
  expect(reopened.ok(), await reopened.text()).toBe(true);
  const saved = await reopened.json();
  expect(saved.dragDropItems).toEqual(items);
  expect(saved.dragDropTargets).toEqual(targets);
  expect(saved.dragDropSolutions).toEqual(solutions);

  const updated = await request.put(`${API}/api/tasks/${created.id}`, {
    headers,
    data: { ...saved, title: `${saved.title} editada` },
  });
  expect(updated.ok(), await updated.text()).toBe(true);
  const afterUpdate = await request.get(`${API}/api/tasks/${created.id}`, {
    headers,
  });
  expect(afterUpdate.ok(), await afterUpdate.text()).toBe(true);
  expect(await afterUpdate.json()).toMatchObject({
    dragDropItems: items,
    dragDropTargets: targets,
    dragDropSolutions: solutions,
  });

  const publicResponse = await request.get(
    `${API}/api/practice/tasks/${created.id}`,
  );
  expect(publicResponse.ok(), await publicResponse.text()).toBe(true);
  expectPrivateSolutionsAbsent(await publicResponse.json());
});

test("grades each complete solution and equivalent pieces without accepting mixed or partial solutions", async ({
  request,
}) => {
  const headers = await loginAdmin(request);
  const task = await createTask(request, headers);
  const cases = [
    { placements: primary, correct: true },
    { placements: alternative, correct: true },
    { placements: swapped, correct: true },
    {
      placements: {
        a: "position-1",
        "b-one": "position-3",
        "b-two": "position-2",
      },
      correct: true,
    },
    { placements: incorrect, correct: false },
    { placements: { ...primary, a: "position-8" }, correct: false },
    { placements: partial, correct: false },
    { placements: {}, correct: false },
  ];
  for (const { placements, correct } of cases) {
    const response = await request.post(
      `${API}/api/practice/tasks/${task.id}/check`,
      {
        data: { payload: { placements } },
      },
    );
    expect(response.ok(), await response.text()).toBe(true);
    expect(await response.json(), JSON.stringify(placements)).toMatchObject({
      correct,
    });
  }
});

test("rejects incomplete, colliding and unknown solution configurations without changing the saved task", async ({
  request,
}) => {
  const headers = await loginAdmin(request);
  const task = await createTask(request, headers);
  const invalidConfigurations = [
    { dragDropTargets: targets.slice(0, 2) },
    { dragDropSolutions: [{ id: "partial", placements: partial }] },
    {
      dragDropSolutions: [
        {
          id: "collision",
          placements: { ...alternative, "b-two": "position-10" },
        },
      ],
    },
    {
      dragDropSolutions: [
        { id: "unknown-target", placements: { ...alternative, a: "unknown" } },
      ],
    },
    {
      dragDropSolutions: [
        {
          id: "unknown-item",
          placements: { ...alternative, stranger: "position-4" },
        },
      ],
    },
    {
      dragDropItems: items.map((item, index) =>
        index ? item : { ...item, correctTargetId: "" },
      ),
    },
  ];
  for (const invalidConfiguration of invalidConfigurations) {
    const response = await request.put(`${API}/api/tasks/${task.id}`, {
      headers,
      data: { ...taskData(), ...invalidConfiguration },
    });
    expect(response.status(), await response.text()).toBe(400);
  }
  const response = await request.get(`${API}/api/tasks/${task.id}`, {
    headers,
  });
  expect(response.ok(), await response.text()).toBe(true);
  expect(await response.json()).toMatchObject({
    dragDropItems: items,
    dragDropTargets: targets,
    dragDropSolutions: solutions,
  });
});

test("rejects malformed practice placements", async ({ request }) => {
  const headers = await loginAdmin(request);
  const task = await createTask(request, headers);
  for (const placements of [
    { stranger: "position-1" },
    { a: "unknown-position" },
    { ...primary, "b-two": "position-2" },
    { ...primary, stranger: "position-4" },
  ]) {
    for (const path of [
      `/api/practice/tasks/${task.id}/check`,
      `/api/tasks/${task.id}/check`,
    ]) {
      const response = await request.post(`${API}${path}`, {
        headers,
        data: { payload: { placements } },
      });
      expect(response.status(), await response.text()).toBe(400);
      expect(await response.json()).toMatchObject({
        message: "La respuesta de arrastrar y soltar no es válida.",
      });
    }
  }
});

test("recovers partial placements, preserves valid saves after invalid input, and scores submitted alternatives", async ({
  request,
  page,
}) => {
  const headers = await loginAdmin(request);
  const task = await createTask(request, headers);
  const now = Date.now();
  const contest = await createContest(request, headers, {
    tasks: [{ taskId: task.id }],
    registrationStartsAt: new Date(now - 3600000).toISOString(),
    registrationEndsAt: new Date(now + 3600000).toISOString(),
    startsAt: new Date(now + 7200000).toISOString(),
    endsAt: new Date(now + 14400000).toISOString(),
  });
  const cases = [
    {
      firstName: "Alternativa",
      placements: swapped,
      correctCount: 1,
      answeredCount: 1,
      totalScore: 8,
    },
    {
      firstName: "Parcial",
      placements: partial,
      correctCount: 0,
      answeredCount: 1,
      totalScore: 0,
    },
    {
      firstName: "Incorrecta",
      placements: incorrect,
      correctCount: 0,
      answeredCount: 1,
      totalScore: 0,
    },
    {
      firstName: "Vacia",
      placements: {},
      correctCount: 0,
      answeredCount: 0,
      totalScore: 2,
    },
  ];
  const students = [];
  for (const entry of cases) {
    students.push({
      ...entry,
      ...(await joinContestSession(
        request,
        headers,
        contest.id,
        "P3",
        entry.firstName,
      )),
    });
  }
  await setE2EClock(request, new Date(now + 7260000));

  for (const [index, student] of students.entries()) {
    const studentHeaders = playHeaders(student.sessionToken);
    const start = await request.post(`${API}/api/play/start`, {
      headers: studentHeaders,
      data: {},
    });
    expect(start.ok(), await start.text()).toBe(true);
    const save = async (placements: Record<string, string>) =>
      request.post(`${API}/api/play/answer`, {
        headers: studentHeaders,
        data: { taskId: task.id, payload: { placements } },
      });
    const initialSave = await save(partial);
    expect(initialSave.status(), await initialSave.text()).toBe(204);

    for (const invalid of [
      { stranger: "position-1" },
      { a: "unknown-position" },
      { a: "position-8", "b-one": "position-8" },
    ]) {
      const rejected = await save(invalid);
      expect(rejected.status(), await rejected.text()).toBe(400);
    }

    const recovered = await request.get(`${API}/api/play/attempt`, {
      headers: studentHeaders,
    });
    expect(recovered.ok(), await recovered.text()).toBe(true);
    const attempt = await recovered.json();
    expect(attempt.answers[task.id]).toEqual({ placements: partial });
    expectPrivateSolutionsAbsent(attempt.tasks[0]);

    if (index === 0) {
      await page.addInitScript((token) => {
        window.localStorage.setItem("bebras_play_session", token);
      }, student.sessionToken);
      await page.goto("/rendir");
      await expect(page.getByText("Tarea 1", { exact: true })).toBeVisible({
        timeout: 15000,
      });
      await page.reload();
      const stage = page.locator('[aria-label^="Escenario de la tarea."]');
      await expect(
        stage.getByRole("button", { name: "Ficha a", exact: true }),
      ).toBeVisible();
      const pendingSave = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/play/answer") &&
          response.status() === 204,
      );
      for (const id of ["b-one", "b-two"] as const) {
        await page
          .getByRole("button", { name: `Ficha ${id}`, exact: true })
          .click();
        const target = targets.find(
          (candidate) => candidate.id === swapped[id],
        )!;
        const box = await stage.boundingBox();
        expect(box).not.toBeNull();
        await stage.click({
          position: {
            x: (box!.width * target.x) / 100,
            y: (box!.height * target.y) / 100,
          },
        });
      }
      await pendingSave;
      await page
        .getByRole("button", { name: "Entregar", exact: true })
        .first()
        .click();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "Entregar", exact: true })
        .click();
      await expect(page.getByText("¡Terminaste!", { exact: true })).toBeVisible({
        timeout: 15000,
      });
    } else {
      const saved = await save(student.placements);
      expect(saved.status(), await saved.text()).toBe(204);
      const submit = await request.post(`${API}/api/play/submit`, {
        headers: studentHeaders,
        data: {},
      });
      expect(submit.ok(), await submit.text()).toBe(true);
    }
  }

  const resultsResponse = await request.get(
    `${API}/api/contests/${contest.id}/results`,
    { headers },
  );
  expect(resultsResponse.ok(), await resultsResponse.text()).toBe(true);
  const results = await resultsResponse.json();
  for (const { firstName, totalScore, correctCount, answeredCount } of cases) {
    expect(results.rows).toContainEqual(
      expect.objectContaining({
        memberOneFirstName: firstName,
        totalScore,
        correctCount,
        answeredCount,
      }),
    );
  }
});

test("edits destinations independently, repairs incomplete solutions and persists authored alternatives", async ({
  request,
  page,
}) => {
  const headers = await loginAdmin(request);
  const task = await createTask(request, headers);
  await loginAdminPage(page);
  await page.goto(`/tareas/editar?id=${task.id}`);
  await expect(
    page.getByText("3 piezas · 12 destinos", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Agregar destino", exact: true })
    .click();
  await expect(
    page.getByText("3 piezas · 13 destinos", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Quitar destino 13", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Agregar pieza", exact: true })
    .click();
  await expect(
    page.getByText("4 piezas · 12 destinos", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Quitar pieza 4", exact: true })
    .click();
  const marker = page.getByRole("button", {
    name: "Mover destino 1",
    exact: true,
  });
  await marker.focus();
  await marker.press("ArrowRight");
  await expect(page.getByLabel("Horizontal (%)", { exact: true })).toHaveValue(
    "16",
  );
  await page.getByLabel("Horizontal (%)", { exact: true }).fill("15");
  await page
    .getByRole("button", { name: "Quitar destino 1", exact: true })
    .click();
  await expect(page.getByRole("alertdialog")).toContainText("Principal");
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Eliminar", exact: true })
    .click();
  await expect(
    page.getByText(/Soluciones incompletas: Principal/),
  ).toBeVisible();
  await expect(
    page.getByText("3 piezas · 11 destinos", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Agregar destino", exact: true })
    .click();
  await page.getByLabel("Horizontal (%)", { exact: true }).fill("15");
  await page.getByLabel("Vertical (%)", { exact: true }).fill("20");
  await page
    .getByRole("radio", { name: "Definir solución", exact: true })
    .click();
  await expect(
    page.getByLabel("Destino de la pieza 1", { exact: true }),
  ).toHaveValue("");
  await page
    .getByLabel("Destino de la pieza 1", { exact: true })
    .selectOption({ label: "Destino 12" });
  await page
    .getByLabel("Solución válida", { exact: true })
    .selectOption("another-subset");
  await expect(
    page.getByLabel("Destino de la pieza 1", { exact: true }),
  ).toHaveValue("position-8");
  await page
    .getByLabel("Destino de la pieza 1", { exact: true })
    .selectOption("position-7");
  await page
    .getByLabel("Piezas equivalentes 2", { exact: true })
    .fill(" shared-b ");
  await page
    .getByLabel("Piezas equivalentes 3", { exact: true })
    .fill("shared-b");
  const saving = page.waitForResponse(
    (r) =>
      r.url() === `${API}/api/tasks/${task.id}` &&
      r.request().method() === "PUT",
  );
  await page
    .getByRole("button", { name: "Guardar cambios", exact: true })
    .click();
  expect((await saving).ok()).toBe(true);
  await page.goto(`/tareas/editar?id=${task.id}`);
  await expect(
    page.getByText("3 piezas · 12 destinos", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Piezas equivalentes 2", { exact: true }),
  ).toHaveValue("shared-b");
  await page
    .getByRole("radio", { name: "Definir solución", exact: true })
    .click();
  await page
    .getByLabel("Solución válida", { exact: true })
    .selectOption("another-subset");
  await expect(
    page.getByLabel("Destino de la pieza 1", { exact: true }),
  ).toHaveValue("position-7");
  const saved = await request
    .get(`${API}/api/tasks/${task.id}`, { headers })
    .then((r) => r.json());
  expect(saved.dragDropTargets).toHaveLength(12);
  expect(saved.dragDropItems).toHaveLength(3);
  expect(saved.dragDropSolutions[0].placements).toEqual({
    ...alternative,
    a: "position-7",
  });
  expect(saved.dragDropItems[0].correctTargetId).not.toBe("position-7");
  await page
    .getByRole("radio", { name: "Editar posiciones", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("[data-drag-target-editor]").scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/drag-editor-mobile.png" });
});

test("checks equivalent pieces in the actual tester", async ({
  request,
  page,
}) => {
  const headers = await loginAdmin(request);
  await loginAdminPage(page);
  const task = await createTask(request, headers);
  const positions: Record<string, string> = Object.fromEntries(
    task.dragDropItems.map((item: { id: string; correctTargetId: string }) => [
      item.id,
      item.correctTargetId,
    ]),
  );
  const firstEquivalent = task.dragDropItems[1];
  const secondEquivalent = task.dragDropItems[2];
  [positions[firstEquivalent.id], positions[secondEquivalent.id]] = [
    positions[secondEquivalent.id],
    positions[firstEquivalent.id],
  ];
  await page.goto(`/tareas/probador?id=${task.id}`);
  const stage = page.locator('[aria-label^="Escenario de la tarea."]');
  await expect(stage).toBeVisible();
  for (const item of task.dragDropItems) {
    await page.getByRole("button", { name: item.label, exact: true }).click();
    const target = task.dragDropTargets.find(
      (candidate: { id: string }) => candidate.id === positions[item.id],
    );
    const box = await stage.boundingBox();
    await stage.click({
      position: {
        x: (box!.width * target.x) / 100,
        y: (box!.height * target.y) / 100,
      },
    });
  }
  await page.getByRole("button", { name: "Probar", exact: true }).click();
  await expect(
    page.getByText("Respuesta correcta", { exact: true }).first(),
  ).toBeVisible();
  const checked = await request.post(
    `${API}/api/practice/tasks/${task.id}/check`,
    { data: { payload: { placements: positions } } },
  );
  expect(await checked.json()).toMatchObject({ correct: true });
});
