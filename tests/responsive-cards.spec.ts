import { test, expect, request } from "@playwright/test";
import {
  API,
  VALID_PDF,
  createContest,
  createPracticeTask,
  loginAdmin,
  loginAdminPage,
  registerBebrasProfile,
} from "./support/helpers";

test("keeps every list row and its actions inside the screen", async ({
  page,
  request: api,
}) => {
  const headers = await loginAdmin(api);
  const contest = await createContest(api, headers, {
    title: `Responsive actions ${Date.now()}`,
    tasks: [
      { taskId: "seed-bebras-easy" },
      { taskId: "seed-bebras-medium" },
      { taskId: "seed-bebras-hard" },
    ],
  });
  const group = await api
    .post(`${API}/api/groups`, {
      headers,
      data: { contestId: contest.id, name: `Grupo responsive ${Date.now()}` },
    })
    .then((response) => response.json());
  await api.post(`${API}/api/groups/${group.id}/teams`, {
    headers,
    data: {
      participationMode: "individual",
      grade: "P3",
      memberOneFirstName: "Participante",
      memberOneLastName: "Con apellido bastante extenso",
    },
  });
  const { response: pending } = await registerBebrasProfile(api, {
    email: `maestro.responsive.con.correo.extenso.${Date.now()}@example.com`,
    fields: { letter: VALID_PDF },
  });
  expect(pending.status(), await pending.text()).toBe(201);

  await loginAdminPage(page);
  const pages: Array<[string, () => Promise<void>]> = [
    ["/desafios", () => expect(page.getByText(contest.title).first()).toBeVisible()],
    ["/tareas", () => expect(page.getByRole("heading", { name: "Tareas" })).toBeVisible()],
    ["/grupos", () => expect(page.getByText(group.name).first()).toBeVisible()],
    [`/grupos/ver?id=${group.id}&vista=estudiantes`, () =>
      expect(page.getByText("Participante Con Apellido Bastante Extenso").first()).toBeVisible()],
    ["/maestros", () => expect(page.getByRole("tab", { name: /Por revisar/ })).toBeVisible()],
  ];

  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    for (const [path, ready] of pages) {
      await page.goto(path);
      await ready();
      // Nada se sale de la pantalla: ni la página ni ningún botón o enlace de
      // las filas.
      const outside = await page.evaluate(() => {
        const limit = document.documentElement.clientWidth + 0.5;
        const overflowing =
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth;
        const controls = [
          ...document.querySelectorAll("main li a, main li button, main article a, main article button"),
        ]
          .filter((element) => (element as HTMLElement).offsetParent !== null)
          .filter((element) => element.getBoundingClientRect().right > limit)
          .map((element) => (element.textContent ?? "").trim() || element.getAttribute("aria-label"));
        return { overflowing, controls };
      });
      expect(outside, `${path} a ${width}px`).toEqual({
        overflowing: false,
        controls: [],
      });
    }
  }
});

test("opens a task from its title with the mouse, the keyboard and touch", async ({
  browser,
  page,
  request: api,
}) => {
  const headers = await loginAdmin(api);
  const tasks = (await api
    .get(`${API}/api/tasks`, { headers })
    .then((response) => response.json())) as Array<{ id: string; title: string }>;
  // Una tarea con título único: los datos de prueba repiten algunos títulos.
  const listedTask = tasks.find(
    (task) => tasks.filter((other) => other.title === task.title).length === 1,
  )!;

  await loginAdminPage(page);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/tareas");
  const title = page.getByRole("link", { name: listedTask.title, exact: true });
  const row = title.locator("xpath=ancestor::li[1]");
  await expect(title).toHaveAttribute("href", `/tareas/editar?id=${listedTask.id}`);

  await row.getByRole("link", { name: "Probar", exact: true }).click();
  await expect(page).toHaveURL(`/tareas/probador?id=${listedTask.id}`);
  await page.goBack();
  await title.click();
  await expect(page).toHaveURL(`/tareas/editar?id=${listedTask.id}`);
  await page.goBack();
  await title.focus();
  await title.press("Enter");
  await expect(page).toHaveURL(`/tareas/editar?id=${listedTask.id}`);

  const touchContext = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });
  try {
    const touchPage = await touchContext.newPage();
    await loginAdminPage(touchPage);
    await touchPage.goto("/tareas");
    await touchPage
      .getByRole("link", { name: listedTask.title, exact: true })
      .tap();
    await expect(touchPage).toHaveURL(`/tareas/editar?id=${listedTask.id}`);
  } finally {
    await touchContext.close();
  }
});

test("confirms task deletion and keeps the task list compact", async ({
  page,
}) => {
  const api = await request.newContext();
  const headers = await loginAdmin(api);
  const removableTask = await createPracticeTask(api, headers, "short_text", {
    title: `Tarea eliminable ${Date.now()}`,
    isPractice: false,
  });
  const protectedTask = await createPracticeTask(api, headers, "short_text", {
    title: `Tarea protegida ${Date.now()}`,
    difficulties: { "8–10": "easy" },
    isPractice: false,
  });
  await createContest(api, headers, {
    title: `Desafío que protege tarea ${Date.now()}`,
    tasks: [{ taskId: protectedTask.id }],
  });

  await loginAdminPage(page);
  await page.goto("/tareas");

  // Entre el encabezado y la lista están los filtros, que quedan pegados.
  const listHeader = page
    .getByRole("group", { name: "Filtrar por tipo de respuesta" })
    .locator("xpath=..");
  const removableRow = page
    .getByRole("link", { name: removableTask.title, exact: true })
    .locator("xpath=ancestor::li[1]");
  const protectedRow = page
    .getByRole("link", { name: protectedTask.title, exact: true })
    .locator("xpath=ancestor::li[1]");
  const taskList = removableRow.locator("xpath=parent::ul");
  const firstTaskRow = taskList.locator(":scope > li").first();
  await expect(removableRow).toBeVisible();
  await expect(protectedRow).toBeVisible();
  await expect(
    page.getByText("Estas son las tareas registradas actualmente.", {
      exact: true,
    }),
  ).toHaveCount(0);
  const [headerBox, firstTaskBox] = await Promise.all([
    listHeader.boundingBox(),
    firstTaskRow.boundingBox(),
  ]);
  expect(headerBox).not.toBeNull();
  expect(firstTaskBox).not.toBeNull();
  expect(
    firstTaskBox!.y - (headerBox!.y + headerBox!.height),
  ).toBeLessThanOrEqual(40);

  await removableRow
    .getByRole("button", { name: "Eliminar", exact: true })
    .click();
  let dialog = page.getByRole("alertdialog");
  await expect(dialog.getByText("¿Eliminar esta tarea?")).toBeVisible();
  await expect(dialog).toContainText(removableTask.title);
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(dialog).toBeHidden();
  await expect(removableRow).toBeVisible();

  let releaseDelete: (() => void) | undefined;
  const deleteGate = new Promise<void>((resolve) => {
    releaseDelete = resolve;
  });
  await page.route(`${API}/api/tasks/${removableTask.id}`, async (route) => {
    await deleteGate;
    await route.continue();
  });
  await removableRow
    .getByRole("button", { name: "Eliminar", exact: true })
    .click();
  dialog = page.getByRole("alertdialog");
  await dialog.getByRole("button", { name: "Eliminar", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Eliminando..." }),
  ).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Cancelar" })).toBeDisabled();
  await expect(dialog).toBeVisible();
  releaseDelete?.();
  await expect(removableRow).toHaveCount(0);
  await expect(dialog).toBeHidden();
  await expect(
    page.getByText("La tarea se eliminó correctamente.", { exact: true }),
  ).toBeVisible();

  await protectedRow
    .getByRole("button", { name: "Eliminar", exact: true })
    .click();
  dialog = page.getByRole("alertdialog");
  await dialog.getByRole("button", { name: "Eliminar", exact: true }).click();
  await expect(
    page.getByText(/Esta tarea está asociada a 1 desafío/),
  ).toBeVisible();
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Eliminar", exact: true }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(protectedRow).toBeVisible();
  await api.dispose();
});

