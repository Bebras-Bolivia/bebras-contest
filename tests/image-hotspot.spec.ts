import { expect, test, type Locator, type Page } from "@playwright/test";
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

const ids = [
  "bebras-2024-04-caminando-bosque",
  "bebras-2024-11-dibujando-barquitos",
];
test.use({ hasTouch: true });
test.afterEach(async ({ request }) => resetE2EClock(request));

test("checks unsaved hotspot drafts and locks the public practice after checking", async ({
  request,
  page,
}) => {
  const headers = await loginAdmin(request);
  const task = await request
    .get(`${API}/api/tasks/${ids[1]}`, { headers })
    .then((r) => r.json());
  const draft = {
    ...task,
    answerKey: { version: 1, acceptedRegionIds: ["punto-3"] },
  };
  const preview = await request.post(`${API}/api/tasks/draft/preview`, {
    headers,
    data: draft,
  });
  expect(preview.status()).toBe(200);
  expect(await preview.json()).not.toHaveProperty("answerKey");
  const check = await request.post(`${API}/api/tasks/draft/check`, {
    headers,
    data: { task: draft, payload: { version: 1, regionId: "punto-3" } },
  });
  expect(await check.json()).toMatchObject({ correct: true });
  expect(
    (
      await request
        .get(`${API}/api/tasks/${ids[1]}`, { headers })
        .then((r) => r.json())
    ).answerKey,
  ).toEqual(task.answerKey);
  await page.goto(`/practica/tarea?id=${ids[1]}`);
  const svg = page.getByRole("group", {
    name: "Imagen con zonas seleccionables",
    exact: true,
  });
  const top = svg.getByRole("button", {
    name: "Zona 1",
    exact: true,
  });
  await top.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Comprobar", exact: true }).click();
  await expect(page.getByText("¡Correcto!", { exact: true })).toBeVisible();
  await expect(top).toHaveAttribute("aria-disabled", "true");
  await clickPoint(page, svg, 50, 61);
  await expect(top).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "Borrar", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Intentar de nuevo", exact: true })
    .click();
  await expect(svg.locator('[aria-pressed="true"]')).toHaveCount(0);
  await expect(top).toHaveAttribute("aria-disabled", "false");
});
/** Puntos que caen dentro de un polígono, en % de la imagen. */
function insidePoints(polygon: Array<{ x: number; y: number }>, count: number) {
  const inside = (x: number, y: number) => {
    let hit = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i];
      const b = polygon[j];
      if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
        hit = !hit;
      }
    }
    return hit;
  };
  const found: Array<[number, number]> = [];
  for (let y = 1; y < 100 && found.length < 400; y += 0.5) {
    for (let x = 1; x < 100; x += 0.5) {
      // Lejos del borde, para que el toque no caiga en la zona de al lado.
      if ([[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => inside(x + dx, y + dy))) {
        found.push([x, y]);
      }
    }
  }
  expect(found.length).toBeGreaterThanOrEqual(count);
  return Array.from({ length: count }, (_, i) =>
    found[Math.floor(((i + 0.5) * found.length) / count)],
  );
}
async function screenPoint(svg: Locator, x: number, y: number) {
  return svg.evaluate(
    (element, p) => {
      const svg = element as SVGSVGElement;
      const point = new DOMPoint(
        (p.x * svg.viewBox.baseVal.width) / 100,
        (p.y * svg.viewBox.baseVal.height) / 100,
      ).matrixTransform(svg.getScreenCTM()!);
      return { x: point.x, y: point.y };
    },
    { x, y },
  );
}
async function clickPoint(
  page: Page,
  svg: Locator,
  x: number,
  y: number,
  touch = false,
) {
  await svg.scrollIntoViewIfNeeded();
  const p = await screenPoint(svg, x, y);
  if (touch) await page.touchscreen.tap(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
}

test("hotspot seeds reopen with private answer keys and reject invalid updates", async ({
  request,
}) => {
  const headers = await loginAdmin(request);
  for (const [index, id] of ids.entries()) {
    const author = await request
      .get(`${API}/api/tasks/${id}`, { headers })
      .then((r) => r.json());
    expect(author.answerType).toBe("image_hotspot");
    expect(author.answerConfig.regions).toHaveLength(index ? 9 : 4);
    expect(author.answerKey.acceptedRegionIds).toHaveLength(index ? 2 : 1);
    const publicTask = await request
      .get(`${API}/api/practice/tasks/${id}`)
      .then((r) => r.json());
    expect(publicTask).not.toHaveProperty("answerKey");
    expect(publicTask).not.toHaveProperty("correctAnswerId");
    expect(publicTask.answerConfig).toEqual(author.answerConfig);
    for (const region of author.answerConfig.regions) {
      const response = await request.post(`${API}/api/tasks/${id}/check`, {
        headers,
        data: { payload: { version: 1, regionId: region.id } },
      });
      expect(await response.json()).toMatchObject({
        correct: author.answerKey.acceptedRegionIds.includes(region.id),
      });
    }
    for (const patch of [
      { answerKey: { version: 1, acceptedRegionIds: ["unknown"] } },
      { answerConfig: { ...author.answerConfig, version: 2 } },
      {
        answerConfig: {
          ...author.answerConfig,
          regions: [
            ...author.answerConfig.regions,
            { ...author.answerConfig.regions[0], id: "overlap" },
          ],
        },
      },
    ])
      expect(
        (
          await request.put(`${API}/api/tasks/${id}`, {
            headers,
            data: { ...author, ...patch },
          })
        ).status(),
      ).toBe(400);
    expect(
      (
        await request
          .get(`${API}/api/tasks/${id}`, { headers })
          .then((r) => r.json())
      ).answerConfig,
    ).toEqual(author.answerConfig);
  }
});

test("selects actual paths and boat points by pointer, keyboard and touch at different widths", async ({
  page,
}) => {
  const headers = await loginAdmin(page.request);
  await loginAdminPage(page);
  for (const width of [1100, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/tareas/probador?id=${ids[0]}`);
    const svg = page.getByRole("group", {
      name: "Imagen con zonas seleccionables",
      exact: true,
    });
    await expect(svg).toBeVisible();
    const path = await page.request
      .get(`${API}/api/tasks/${ids[0]}`, { headers })
      .then((r) => r.json());
    const pathB = path.answerConfig.regions.find(
      (r: { id: string }) => r.id === "camino-b",
    );
    for (const [x, y] of insidePoints(pathB.shapes[0].points, 3)) {
      await clickPoint(page, svg, x, y, width === 390);
      await expect(
        svg.getByRole("button", { name: "Zona 2", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
    }
    await clickPoint(page, svg, 99, 3, width === 390);
    await expect(
      svg.getByRole("button", { name: "Zona 2", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Comprobar", exact: true }).click();
    await expect(
      page.getByText("¡Correcto!", { exact: true }),
    ).toBeVisible();
    await svg.getByRole("button", { name: "Zona 1", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(
      svg.getByRole("button", { name: "Zona 1", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Comprobar", exact: true }).click();
    await expect(
      page.getByText("Respuesta incorrecta", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Borrar", exact: true }).click();
    await expect(svg.locator('[aria-pressed="true"]')).toHaveCount(0);
    await svg.screenshot({ path: `test-results/hotspot-04-${width}.png` });
    await page.goto(`/tareas/probador?id=${ids[1]}`);
    const boat = await page.request
      .get(`${API}/api/tasks/${ids[1]}`, { headers })
      .then((r) => r.json());
    await expect(svg).toBeVisible();
    for (const id of ["punto-1", "punto-6", "punto-3"]) {
      const region = boat.answerConfig.regions.find(
        (r: { id: string }) => r.id === id,
      );
      await clickPoint(
        page,
        svg,
        region.shapes[0].x,
        region.shapes[0].y,
        width === 390,
      );
      await expect(
        svg.getByRole("button", { name: region.label, exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await page.getByRole("button", { name: "Comprobar", exact: true }).click();
      await expect(
        page.getByText(
          id === "punto-3" ? "Respuesta incorrecta" : "¡Correcto!",
          { exact: true },
        ),
      ).toBeVisible();
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/hotspot-11-${width}.png`,
      fullPage: true,
    });
  }
});

test("edits points and polygon vertices on one canvas and saves/reopens both config and key", async ({
  page,
}) => {
  const headers = await loginAdmin(page.request);
  await loginAdminPage(page);
  const response = await page.request.post(`${API}/api/tasks`, {
    headers,
    data: {
      title: "Zonas editables",
      categories: ["Algoritmos y programación"],
      difficulties: { "8–10": "easy" },
      bodyBlocks: [taskBlock("body", "Observa la imagen")],
      challengeBlocks: [taskBlock("challenge", "Señala una zona")],
      explanationBlocks: [taskBlock("explanation", "Dos puntos válidos")],
      answerType: "image_hotspot",
      answerConfig: {
        version: 1,
        image: {
          id: "board",
          name: "board.svg",
          url: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><rect width="600" height="300" fill="white"/></svg>')}`,
        },
        imageWidth: 600,
        imageHeight: 300,
        regions: [
          {
            id: "one",
            label: "Punto inicial",
            shapes: [{ type: "circle", x: 20, y: 30, radius: 6 }],
          },
        ],
      },
      answerKey: { version: 1, acceptedRegionIds: ["one"] },
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const task = await response.json();
  await page.goto(`/tareas/editar?id=${task.id}`);
  const editor = page.getByLabel("Editor de zonas activas", { exact: true });
  const svg = editor.getByRole("group", {
    name: "Dibujar zonas sobre la imagen",
    exact: true,
  });
  await expect(svg).toBeVisible();
  await editor
    .getByRole("button", { name: "Marcar punto", exact: true })
    .click();
  await clickPoint(page, svg, 60, 30);
  const correct = editor.getByRole("button", {
    name: "Es correcta",
    exact: true,
  });
  await expect(correct).toHaveAttribute("aria-pressed", "false");
  await correct.click();
  await expect(correct).toHaveAttribute("aria-pressed", "true");
  const initialX =
    (Number(
      await editor
        .getByRole("button", { name: "Mover centro", exact: true })
        .getAttribute("cx"),
    ) /
      600) *
    100;
  await editor
    .getByRole("button", { name: "Mover centro", exact: true })
    .focus();
  await page.keyboard.press("ArrowRight");
  await editor
    .getByRole("button", { name: "Ajustar radio", exact: true })
    .focus();
  await page.keyboard.press("ArrowUp");
  await editor
    .getByRole("button", { name: "Dibujar zona", exact: true })
    .click();
  for (const [x, y] of [
    [10, 65],
    [80, 65],
    [80, 80],
    [10, 80],
  ])
    await clickPoint(page, svg, x, y);
  await editor
    .getByRole("button", { name: "Cerrar zona", exact: true })
    .click();
  const zones = editor.getByRole("group", { name: "Zonas", exact: true });
  await expect(zones.getByRole("button")).toHaveCount(3);
  // Deshacer quita la zona recién dibujada y Ctrl+Shift+Z la devuelve.
  await editor.getByRole("button", { name: "Deshacer", exact: true }).click();
  await expect(zones.getByRole("button")).toHaveCount(2);
  await page.keyboard.press("Control+Shift+Z");
  await expect(zones.getByRole("button")).toHaveCount(3);
  await zones.getByRole("button", { name: "Zona 3", exact: true }).click();
  const vertex = editor.getByRole("button", { name: "Vértice 1", exact: true });
  await vertex.focus();
  await page.keyboard.press("ArrowRight");
  const handle = await vertex.boundingBox();
  await page.mouse.move(
    handle!.x + handle!.width / 2,
    handle!.y + handle!.height / 2,
  );
  await page.mouse.down();
  const destination = await screenPoint(svg, 12, 65);
  await page.mouse.move(destination.x, destination.y);
  await page.mouse.up();
  await expect(editor.getByRole("alert")).toHaveCount(0);
  const saved = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/api/tasks/${task.id}`) &&
      r.request().method() === "PUT",
  );
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  expect((await saved).ok()).toBe(true);
  await expect(page).toHaveURL(/\/tareas\/?$/);
  await page.goto(`/tareas/editar?id=${task.id}`);
  await expect(svg).toBeVisible();
  const stored = await page.request
    .get(`${API}/api/tasks/${task.id}`, { headers })
    .then((r) => r.json());
  expect(stored.answerConfig.regions).toHaveLength(3);
  expect(stored.answerKey.acceptedRegionIds).toHaveLength(2);
  expect(stored.answerConfig.regions[1].shapes[0].x).toBeCloseTo(
    initialX + 0.5,
    6,
  );
  expect(stored.answerConfig.regions[1].shapes[0].radius).toBeCloseTo(3.2, 6);
  expect(stored.answerConfig.regions[2].shapes[0].points[0].x).toBeCloseTo(
    12,
    0,
  );
  await zones.getByRole("button", { name: "Zona 2", exact: true }).click();
  await expect(correct).toHaveAttribute("aria-pressed", "true");
  await zones.getByRole("button", { name: "Zona 3", exact: true }).click();
  await expect(correct).toHaveAttribute("aria-pressed", "false");
  await page.setViewportSize({ width: 390, height: 844 });
  await editor.scrollIntoViewIfNeeded();
  expect((await editor.boundingBox())!.height).toBeLessThan(844);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await editor.screenshot({ path: "test-results/hotspot-editor-mobile.png" });
});

test("persists and clears hotspot answers, rejects invalid saves and matches contest scoring", async ({
  request,
  page,
}) => {
  const headers = await loginAdmin(request);
  const now = Date.now();
  const contest = await createContest(request, headers, {
    tasks: ids.map((taskId) => ({ taskId })),
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
    "Zonas",
  );
  await setE2EClock(request, new Date(now + 7260000));
  const auth = playHeaders(student.sessionToken);
  expect(
    (
      await request.post(`${API}/api/play/start`, { headers: auth, data: {} })
    ).ok(),
  ).toBe(true);
  const save = (taskId: string, payload: unknown) =>
    request.post(`${API}/api/play/answer`, {
      headers: auth,
      data: { taskId, payload },
    });
  expect(
    (await save(ids[0], { version: 1, regionId: "camino-b" })).status(),
  ).toBe(204);
  for (const payload of [
    { version: 2, regionId: "camino-b" },
    { version: 1, regionId: "missing" },
    { version: 1, regionId: ["camino-a", "camino-b"] },
  ])
    expect((await save(ids[0], payload)).status()).toBe(400);
  let attempt = await request
    .get(`${API}/api/play/attempt`, { headers: auth })
    .then((r) => r.json());
  expect(attempt.answers[ids[0]]).toEqual({ version: 1, regionId: "camino-b" });
  expect(attempt.tasks[0]).not.toHaveProperty("answerKey");
  await page.addInitScript(
    (token) => localStorage.setItem("bebras_play_session", token),
    student.sessionToken,
  );
  await page.goto("/rendir");
  const svg = page.getByRole("group", {
    name: "Imagen con zonas seleccionables",
    exact: true,
  });
  await expect(
    svg.getByRole("button", { name: "Zona 2", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const cleared = page.waitForResponse(
    (r) => r.url().endsWith("/api/play/answer") && r.status() === 204,
  );
  await page.getByRole("button", { name: "Borrar", exact: true }).click();
  await cleared;
  await page.reload();
  await expect(svg).toBeVisible();
  await expect(svg.locator('[aria-pressed="true"]')).toHaveCount(0);
  const saved = page.waitForResponse(
    (r) => r.url().endsWith("/api/play/answer") && r.status() === 204,
  );
  await svg.getByRole("button", { name: "Zona 2", exact: true }).focus();
  await page.keyboard.press("Space");
  await saved;
  expect(
    (await save(ids[1], { version: 1, regionId: "punto-6" })).status(),
  ).toBe(204);
  attempt = await request
    .get(`${API}/api/play/attempt`, { headers: auth })
    .then((r) => r.json());
  expect(attempt.answers[ids[1]]).toEqual({ version: 1, regionId: "punto-6" });
  expect(
    (
      await request.post(`${API}/api/play/submit`, { headers: auth, data: {} })
    ).ok(),
  ).toBe(true);
  const results = await request
    .get(`${API}/api/contests/${contest.id}/results`, { headers })
    .then((r) => r.json());
  expect(results.rows).toContainEqual(
    expect.objectContaining({
      memberOneFirstName: "Zonas",
      correctCount: 2,
      answeredCount: 2,
    }),
  );
});
