import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import {
  API,
  createContest,
  joinContestSession,
  loginAdmin,
  loginAdminPage,
  playHeaders,
  resetE2EClock,
  setE2EClock,
  taskBlock,
} from "./support/helpers";

type Kind = "state_grid" | "text_cloze";
const kinds: Kind[] = ["state_grid", "text_cloze"];
const options = [
  { id: "white", label: "Blanca", image: null, limit: null },
  { id: "black", label: "Negra", image: null, limit: null },
];
const solution = { first: "white", second: "black" };
const alternate = { first: "black", second: "white" };
const partial = { first: "white" };
const field = (kind: Kind) => (kind === "state_grid" ? "cells" : "blanks");
const payload = (kind: Kind, values: Record<string, string>) => ({
  version: 1,
  [field(kind)]: values,
});
/**
 * La rejilla se resuelve tocando la casilla hasta llegar al estado; el hueco,
 * eligiendo primero la opción en la paleta.
 */
async function assignSlot(
  page: Page,
  grid: boolean,
  slotId: string,
  label: string,
  tap = false,
) {
  const slot = page.locator(`[data-assignment-slot="${slotId}"]`);
  if (grid) {
    for (let step = 0; step < 8; step += 1) {
      const current = (await slot.getAttribute("aria-label")) ?? "";
      if (current.endsWith(`: ${label}`)) return;
      await (tap ? slot.tap() : slot.click());
      await expect(slot).not.toHaveAttribute("aria-label", current);
    }
    throw new Error(`La casilla ${slotId} nunca llegó a ${label}.`);
  }
  const choice = page.getByRole("radio", {
    name: `Elegir ${label}`,
    exact: true,
  });
  await (tap ? choice.tap() : choice.click());
  await (tap ? slot.tap() : slot.click());
}

function fixture(kind: Kind) {
  return {
    title: `Configuración ${kind} ${Date.now()}`,
    categories: ["Algoritmos y programación"],
    difficulties: { "8–10": "easy" },
    isPractice: true,
    bodyBlocks: [taskBlock("body", "Construye la configuración final.")],
    challengeBlocks:
      kind === "state_grid"
        ? [taskBlock("challenge", "Completa las dos casillas.")]
        : [
            {
              ...taskBlock("challenge", "Primero y después."),
              richText: {
                type: "doc",
                content: [
                  {
                    type: "paragraph",
                    attrs: { indent: 2 },
                    content: [
                      { type: "text", text: "Primero " },
                      { type: "taskBlank", attrs: { blankId: "first" } },
                      { type: "text", text: " y después " },
                      { type: "taskBlank", attrs: { blankId: "second" } },
                    ],
                  },
                ],
              },
            },
          ],
    explanationBlocks: [
      taskBlock("explanation", "Cada posición tiene un estado distinto."),
    ],
    answerType: kind,
    answerConfig:
      kind === "state_grid"
        ? {
            version: 1,
            rows: 1,
            columns: 2,
            cells: [
              { id: "first", label: "Casilla 1" },
              { id: "second", label: "Casilla 2" },
            ],
            states: options,
          }
        : {
            version: 1,
            options,
            blanks: ["first", "second"].map((id) => ({
              id,
              allowedOptionIds: ["white", "black"],
            })),
          },
    answerKey: { version: 1, acceptedAssignments: [solution, alternate] },
  };
}
async function createTask(
  request: APIRequestContext,
  headers: Record<string, string>,
  kind: Kind,
) {
  const response = await request.post(`${API}/api/tasks`, {
    headers,
    data: fixture(kind),
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
function expectPrivateAbsent(value: Record<string, unknown>) {
  expect(value).not.toHaveProperty("answerKey");
  expect(value).not.toHaveProperty("correctAnswerId");
  expect(value.answerConfig).not.toHaveProperty("acceptedAssignments");
}
test.use({ hasTouch: true });
test.afterEach(async ({ request }) => resetE2EClock(request));

for (const kind of kinds) {
  test(`${kind}: saves configurations, validates alternatives and protects private keys`, async ({
    request,
  }) => {
    const headers = await loginAdmin(request);
    const authored = await createTask(request, headers, kind);
    const reopened = await request
      .get(`${API}/api/tasks/${authored.id}`, { headers })
      .then((r) => r.json());
    expect(reopened.answerConfig).toEqual(authored.answerConfig);
    expect(reopened.answerKey).toEqual(authored.answerKey);
    const publicTask = await request
      .get(`${API}/api/practice/tasks/${authored.id}`)
      .then((r) => r.json());
    expectPrivateAbsent(publicTask);
    expect(publicTask.answerConfig).toEqual(authored.answerConfig);
    for (const [assignments, correct] of [
      [solution, true],
      [alternate, true],
      [partial, false],
      [{}, false],
      [{ first: "white", second: "white" }, false],
    ] as const) {
      for (const path of [
        `/api/tasks/${authored.id}/check`,
        `/api/practice/tasks/${authored.id}/check`,
      ]) {
        const check = await request.post(`${API}${path}`, {
          headers,
          data: { payload: payload(kind, assignments) },
        });
        expect(check.ok(), await check.text()).toBe(true);
        expect(await check.json()).toMatchObject({ correct });
      }
    }
    for (const patch of [
      { answerConfig: { ...authored.answerConfig, version: 2 } },
      { answerKey: { version: 1, acceptedAssignments: [partial] } },
      {
        answerKey: {
          version: 1,
          acceptedAssignments: [solution, { second: "black", first: "white" }],
        },
      },
      {
        answerKey: {
          version: 1,
          acceptedAssignments: [{ ...solution, extra: "white" }],
        },
      },
      {
        answerConfig: {
          ...authored.answerConfig,
          [kind === "state_grid" ? "states" : "options"]: options.map(
            (option) => ({ ...option, limit: 0 }),
          ),
        },
      },
      ...(kind === "text_cloze"
        ? [
            { challengeBlocks: [taskBlock("missing", "Texto sin huecos")] },
            {
              challengeBlocks: [
                ...authored.challengeBlocks,
                ...authored.challengeBlocks,
              ],
            },
          ]
        : []),
    ]) {
      const update = await request.put(`${API}/api/tasks/${authored.id}`, {
        headers,
        data: { ...authored, ...patch },
      });
      expect(update.status(), await update.text()).toBe(400);
    }
    expect(
      (
        await request
          .get(`${API}/api/tasks/${authored.id}`, { headers })
          .then((r) => r.json())
      ).answerKey,
    ).toEqual(authored.answerKey);
    const unauthenticated = await request.post(
      `${API}/api/tasks/${authored.id}/check`,
      { data: { payload: payload(kind, solution) } },
    );
    expect(unauthenticated.status()).toBe(401);
    const privateUpdate = await request.put(`${API}/api/tasks/${authored.id}`, {
      headers,
      data: { ...authored, isPractice: false },
    });
    expect(privateUpdate.ok(), await privateUpdate.text()).toBe(true);
    expect(
      (await request.get(`${API}/api/practice/tasks/${authored.id}`)).status(),
    ).toBe(404);
    expect(
      (
        await request.post(`${API}/api/tasks/${authored.id}/check`, {
          headers,
          data: { payload: payload(kind, solution) },
        })
      ).ok(),
    ).toBe(true);
  });

  test(`${kind}: supports pointer, touch, keyboard, clearing and practice locking`, async ({
    page,
  }) => {
    const headers = await loginAdmin(page.request);
    await loginAdminPage(page);
    const authored = await createTask(page.request, headers, kind);
    for (const width of [1100, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`/practica/tarea?id=${authored.id}`);
      const first = page.locator('[data-assignment-slot="first"]');
      const second = page.locator('[data-assignment-slot="second"]');
      await expect(first).toHaveAccessibleName(/vacío$/);
      if (kind === "state_grid") {
        await assignSlot(page, true, "first", "Blanca", width === 390);
      } else if (width === 390) {
        await page
          .getByRole("radio", { name: "Elegir Blanca", exact: true })
          .tap();
        await first.tap();
      } else {
        const choice = page.getByRole("radio", {
          name: "Elegir Blanca",
          exact: true,
        });
        const start = await choice.boundingBox();
        const end = await first.boundingBox();
        expect(start).not.toBeNull();
        expect(end).not.toBeNull();
        await page.mouse.move(
          start!.x + start!.width / 2,
          start!.y + start!.height / 2,
        );
        await page.mouse.down();
        await page.mouse.move(
          end!.x + end!.width / 2,
          end!.y + end!.height / 2,
          { steps: 6 },
        );
        await page.mouse.up();
      }
      await expect(first).toHaveAccessibleName(/Blanca$/);
      await first.focus();
      await page.keyboard.press("Delete");
      await expect(first).toHaveAccessibleName(/vacío$/);
      await page.keyboard.press("ArrowRight");
      await expect(first).toHaveAccessibleName(/Blanca$/);
      await second.focus();
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowRight");
      await expect(second).toHaveAccessibleName(/Negra$/);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page
        .getByRole("button", { name: "Comprobar", exact: true })
        .click();
      await expect(page.getByText("¡Correcto!", { exact: true })).toBeVisible();
      await expect(first).toBeDisabled();
      await expect(second).toBeDisabled();
      await page.screenshot({
        path: `test-results/${kind}-${width}.png`,
        fullPage: true,
      });
      await page
        .getByRole("button", { name: "Intentar de nuevo", exact: true })
        .click();
      await expect(first).toHaveAccessibleName(/vacío$/);
      await expect(second).toHaveAccessibleName(/vacío$/);
    }
  });

  test(`${kind}: edits options and reopens saved content and solutions`, async ({
    page,
  }) => {
    const headers = await loginAdmin(page.request);
    await loginAdminPage(page);
    const authored = await createTask(page.request, headers, kind);
    await page.goto(`/tareas/editar?id=${authored.id}`);
    const option = page.getByRole("textbox", {
      name: kind === "state_grid" ? "Estado 1" : "Opción 1",
      exact: true,
    });
    await option.fill("Blanca editada");
    const saved = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/tasks/${authored.id}`) &&
        r.request().method() === "PUT",
    );
    await page
      .getByRole("button", { name: "Guardar cambios", exact: true })
      .click();
    // Guardar navega a la lista; leer el cuerpo después ya no es posible.
    expect((await saved).status()).toBe(200);
    await page.goto(`/tareas/editar?id=${authored.id}`);
    await expect(option).toHaveValue("Blanca editada");
    const stored = await page.request
      .get(`${API}/api/tasks/${authored.id}`, { headers })
      .then((r) => r.json());
    expect(stored.answerKey).toEqual(authored.answerKey);
    if (kind === "text_cloze") {
      expect(stored.challengeBlocks[0].richText.content[0].attrs.indent).toBe(
        2,
      );
      expect(
        stored.challengeBlocks[0].richText.content[0].content
          .filter((node: { type: string }) => node.type === "taskBlank")
          .map((node: { attrs: { blankId: string } }) => node.attrs.blankId),
      ).toEqual(["first", "second"]);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await option.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/${kind}-editor-mobile.png` });
  });
}

test("both assignment types recover partial answers, clear and reload, then score a real contest", async ({
  request,
  page,
}) => {
  const headers = await loginAdmin(request);
  const tasks = [];
  for (const kind of kinds)
    tasks.push(await createTask(request, headers, kind));
  const now = Date.now();
  const contest = await createContest(request, headers, {
    tasks: tasks.map((task) => ({ taskId: task.id })),
    registrationStartsAt: new Date(now - 3600000).toISOString(),
    registrationEndsAt: new Date(now + 3600000).toISOString(),
    startsAt: new Date(now + 7200000).toISOString(),
    endsAt: new Date(now + 14400000).toISOString(),
  });
  const cases = [
    {
      name: "Construida",
      assignments: alternate,
      correctCount: 2,
      answeredCount: 2,
    },
    {
      name: "Incompleta",
      assignments: partial,
      correctCount: 0,
      answeredCount: 2,
    },
    { name: "Borrada", assignments: {}, correctCount: 0, answeredCount: 0 },
  ];
  const students = [];
  for (const entry of cases)
    students.push({
      ...entry,
      ...(await joinContestSession(
        request,
        headers,
        contest.id,
        "P3",
        entry.name,
      )),
    });
  await setE2EClock(request, new Date(now + 7260000));
  for (const [studentIndex, student] of students.entries()) {
    const auth = playHeaders(student.sessionToken);
    expect(
      (
        await request.post(`${API}/api/play/start`, { headers: auth, data: {} })
      ).ok(),
    ).toBe(true);
    const save = (taskId: string, value: unknown) =>
      request.post(`${API}/api/play/answer`, {
        headers: auth,
        data: { taskId, payload: value },
      });
    for (const [index, authored] of tasks.entries()) {
      const kind = kinds[index];
      expect((await save(authored.id, payload(kind, partial))).status()).toBe(
        204,
      );
      for (const invalid of [
        payload(kind, { first: "unknown" }),
        payload(kind, { unknown: "white" }),
        { version: 2, [field(kind)]: partial },
      ])
        expect((await save(authored.id, invalid)).status()).toBe(400);
    }
    let attempt = await request
      .get(`${API}/api/play/attempt`, { headers: auth })
      .then((r) => r.json());
    for (const [index, authored] of tasks.entries()) {
      expect(attempt.answers[authored.id]).toEqual(
        payload(kinds[index], partial),
      );
      expectPrivateAbsent(attempt.tasks[index]);
    }
    if (studentIndex === 0) {
      await page.addInitScript(
        (token) => localStorage.setItem("bebras_play_session", token),
        student.sessionToken,
      );
      await page.goto("/rendir");
      const first = page.locator('[data-assignment-slot="first"]');
      await expect(first).toHaveAccessibleName(/Blanca$/);
      await page.reload();
      await expect(first).toHaveAccessibleName(/Blanca$/);
      const cleared = page.waitForResponse(
        (r) => r.url().endsWith("/api/play/answer") && r.status() === 204,
      );
      await first.focus();
      await page.keyboard.press("Delete");
      await cleared;
      await page.reload();
      await expect(first).toHaveAccessibleName(/vacío$/);
    }
    for (const [index, authored] of tasks.entries()) {
      expect(
        (await save(authored.id, payload(kinds[index], {}))).status(),
      ).toBe(204);
      expect(
        (
          await save(authored.id, payload(kinds[index], student.assignments))
        ).status(),
      ).toBe(204);
    }
    attempt = await request
      .get(`${API}/api/play/attempt`, { headers: auth })
      .then((r) => r.json());
    for (const [index, authored] of tasks.entries())
      expect(attempt.answers[authored.id]).toEqual(
        payload(kinds[index], student.assignments),
      );
    expect(
      (
        await request.post(`${API}/api/play/submit`, {
          headers: auth,
          data: {},
        })
      ).ok(),
    ).toBe(true);
  }
  const results = await request
    .get(`${API}/api/contests/${contest.id}/results`, { headers })
    .then((r) => r.json());
  for (const student of cases)
    expect(results.rows).toContainEqual(
      expect.objectContaining({
        memberOneFirstName: student.name,
        correctCount: student.correctCount,
        answeredCount: student.answeredCount,
      }),
    );
});

// Las cinco tareas del cuadernillo que motivaron estos dos tipos. La solución
// se lee de la API de administración; nunca se escribe en el archivo.
const seeded = [
  {
    id: "bebras-2024-09-tubo-canicas",
    kind: "state_grid",
    slots: 3,
    bank: 2,
  },
  {
    id: "bebras-2024-31-secuencia-pelotas",
    kind: "state_grid",
    slots: 8,
    bank: 2,
  },
  {
    id: "bebras-2024-19-dias-soleados",
    kind: "text_cloze",
    slots: 1,
    bank: 4,
  },
  {
    id: "bebras-2024-37-dias-soleados-2",
    kind: "text_cloze",
    slots: 2,
    bank: 6,
  },
  { id: "bebras-2024-40-explorando", kind: "text_cloze", slots: 2, bank: 5 },
] as const;

function slotsOf(config: {
  cells?: Array<{ id: string }>;
  blanks?: Array<{ id: string }>;
}) {
  return config.cells ?? config.blanks ?? [];
}
function bankOf(config: { states?: unknown[]; options?: unknown[] }) {
  return (config.states ?? config.options ?? []) as Array<{
    id: string;
    label: string;
  }>;
}

test("the five booklet tasks keep their solutions private and grade every case", async ({
  request,
}) => {
  const headers = await loginAdmin(request);
  for (const entry of seeded) {
    const author = await request
      .get(`${API}/api/tasks/${entry.id}`, { headers })
      .then((r) => r.json());
    expect(author.answerType).toBe(entry.kind);
    expect(slotsOf(author.answerConfig)).toHaveLength(entry.slots);
    expect(bankOf(author.answerConfig)).toHaveLength(entry.bank);
    const publicTask = await request
      .get(`${API}/api/practice/tasks/${entry.id}`)
      .then((r) => r.json());
    expectPrivateAbsent(publicTask);
    expect(publicTask.answerConfig).toEqual(author.answerConfig);

    const accepted = author.answerKey.acceptedAssignments[0];
    const last = slotsOf(author.answerConfig).at(-1)!.id;
    const allowed =
      author.answerConfig.blanks?.find(
        (blank: { id: string }) => blank.id === last,
      )?.allowedOptionIds ??
      bankOf(author.answerConfig).map((option) => option.id);
    const swapped = allowed.find((id: string) => id !== accepted[last]);
    const partialAnswer = { ...accepted };
    delete partialAnswer[last];
    for (const [assignments, correct] of [
      [accepted, true],
      [{ ...accepted, [last]: swapped }, false],
      [partialAnswer, false],
      [{}, false],
    ] as const) {
      const check = await request.post(`${API}/api/tasks/${entry.id}/check`, {
        headers,
        data: { payload: payload(entry.kind, assignments) },
      });
      expect(check.ok(), await check.text()).toBe(true);
      expect(await check.json()).toMatchObject({ correct });
    }
    for (const invalid of [
      { [last]: "no-existe" },
      { "no-existe": accepted[last] },
    ]) {
      const check = await request.post(`${API}/api/tasks/${entry.id}/check`, {
        headers,
        data: { payload: payload(entry.kind, invalid) },
      });
      expect(check.status()).toBe(400);
    }
  }
});

for (const width of [1100, 390]) {
  test(`the five booklet tasks are solvable at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(120000);
    const headers = await loginAdmin(page.request);
    await loginAdminPage(page);
    await page.setViewportSize({ width, height: 900 });
    for (const entry of seeded) {
      const author = await page.request
        .get(`${API}/api/tasks/${entry.id}`, { headers })
        .then((r) => r.json());
      const accepted = author.answerKey.acceptedAssignments[0];
      const bank = bankOf(author.answerConfig);
      await page.goto(`/practica/tarea?id=${entry.id}`);
      await page.locator("[data-assignment-slot]").first().waitFor();
      for (const [slotId, optionId] of Object.entries(accepted)) {
        const option = bank.find((entry) => entry.id === optionId)!;
        await assignSlot(
          page,
          author.answerType === "state_grid",
          slotId,
          option.label,
        );
      }
      await page
        .getByRole("button", { name: "Comprobar", exact: true })
        .click();
      await expect(page.getByText("¡Correcto!", { exact: true })).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(
        await page.evaluate(
          () =>
            [...document.images].filter(
              (image) => !image.complete || image.naturalWidth === 0,
            ).length,
        ),
      ).toBe(0);
      // Sin `fullPage`: estas tareas traen imágenes grandes en data URL y una
      // captura de la página entera agota la memoria del navegador.
      await page.screenshot({ path: `test-results/${entry.id}-${width}.png` });
    }
  });
}

// Cada categoría Bebras tiene su rango de edad y un desafío solo admite tareas
// con dificultad para ese rango, así que las cinco no caben en uno solo.
const contests = [
  {
    category: "Titi",
    grade: "P5",
    ids: ["bebras-2024-09-tubo-canicas", "bebras-2024-19-dias-soleados"],
  },
  {
    category: "Kuntur",
    grade: "S5",
    ids: [
      "bebras-2024-31-secuencia-pelotas",
      "bebras-2024-37-dias-soleados-2",
      "bebras-2024-40-explorando",
    ],
  },
];

test("the five booklet tasks are answered, submitted and scored in a real contest", async ({
  request,
}) => {
  const headers = await loginAdmin(request);
  const now = Date.now();
  // Inscribir exige que la ventana siga abierta y rendir exige haberla pasado,
  // así que primero se arman los dos desafíos y recién después salta el reloj.
  const rounds = [];
  for (const group of contests) {
    const entries = group.ids.map(
      (id) => seeded.find((entry) => entry.id === id)!,
    );
    const authored = [];
    for (const entry of entries)
      authored.push(
        await request
          .get(`${API}/api/tasks/${entry.id}`, { headers })
          .then((r) => r.json()),
      );
    const contest = await createContest(request, headers, {
      category: group.category,
      tasks: entries.map((entry) => ({ taskId: entry.id })),
      registrationStartsAt: new Date(now - 3600000).toISOString(),
      registrationEndsAt: new Date(now + 3600000).toISOString(),
      startsAt: new Date(now + 7200000).toISOString(),
      endsAt: new Date(now + 14400000).toISOString(),
    });
    // El servidor normaliza los nombres, así que aquí van tal como los devuelve.
    const students = [];
    for (const entry of [
      { name: "Resuelta", whole: true },
      { name: "Amedias", whole: false },
    ])
      students.push({
        ...entry,
        ...(await joinContestSession(
          request,
          headers,
          contest.id,
          group.grade,
          entry.name,
        )),
      });
    rounds.push({ contest, entries, authored, students });
  }

  await setE2EClock(request, new Date(now + 7260000));

  for (const round of rounds) {
    for (const student of round.students) {
      const auth = playHeaders(student.sessionToken);
      expect(
        (
          await request.post(`${API}/api/play/start`, {
            headers: auth,
            data: {},
          })
        ).ok(),
      ).toBe(true);
      const started = await request
        .get(`${API}/api/play/attempt`, { headers: auth })
        .then((r) => r.json());
      for (const task of started.tasks) expectPrivateAbsent(task);

      for (const [index, entry] of round.entries.entries()) {
        const accepted = round.authored[index].answerKey.acceptedAssignments[0];
        const slots = Object.keys(accepted);
        // A medias: se deja la última posición sin llenar.
        const values = student.whole
          ? accepted
          : Object.fromEntries(
              slots.slice(0, -1).map((slot) => [slot, accepted[slot]]),
            );
        expect(
          (
            await request.post(`${API}/api/play/answer`, {
              headers: auth,
              data: { taskId: entry.id, payload: payload(entry.kind, values) },
            })
          ).status(),
        ).toBe(204);
      }
      const saved = await request
        .get(`${API}/api/play/attempt`, { headers: auth })
        .then((r) => r.json());
      for (const entry of round.entries)
        expect(
          Object.keys(saved.answers[entry.id]?.[field(entry.kind)] ?? {}),
        ).toHaveLength(student.whole ? entry.slots : entry.slots - 1);
      expect(
        (
          await request.post(`${API}/api/play/submit`, {
            headers: auth,
            data: {},
          })
        ).ok(),
      ).toBe(true);
    }

    const results = await request
      .get(`${API}/api/contests/${round.contest.id}/results`, { headers })
      .then((r) => r.json());
    // Una tarea de un solo hueco no tiene respuesta a medias: dejarla
    // incompleta es dejarla vacía, y el desafío la cuenta como no respondida.
    const partialAnswered = round.entries.filter(
      (entry) => entry.slots > 1,
    ).length;
    for (const student of round.students)
      expect(results.rows).toContainEqual(
        expect.objectContaining({
          memberOneFirstName: student.name,
          correctCount: student.whole ? round.entries.length : 0,
          answeredCount: student.whole ? round.entries.length : partialAnswered,
        }),
      );
  }
});
