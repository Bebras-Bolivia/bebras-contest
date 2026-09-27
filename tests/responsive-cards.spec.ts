import { test, expect, request } from "@playwright/test";
import {
  API,
  createContest,
  createPracticeTask,
  loginAdmin,
  loginAdminPage,
} from "./support/helpers";

test("keeps contest and task card actions responsive and compact", async ({
  browser,
  page,
}) => {
  const api = await request.newContext();
  const headers = await loginAdmin(api);
  const listedContest = await createContest(api, headers, {
    title: `Responsive actions ${Date.now()}`,
    tasks: [
      { taskId: "seed-bebras-easy" },
      { taskId: "seed-bebras-medium" },
      { taskId: "seed-bebras-hard" },
    ],
  });
  const tasksResponse = await api.get(`${API}/api/tasks`, { headers });
  expect(tasksResponse.ok()).toBe(true);
  const listedTask = (
    (await tasksResponse.json()) as Array<{ id: string; title: string }>
  )[0];
  expect(listedTask).toBeDefined();

  await loginAdminPage(page);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/desafios");

  const contestLink = page.getByRole("link", {
    name: listedContest.title,
    exact: true,
  });
  const contestRow = contestLink.locator("xpath=ancestor::li[1]");
  const menu = contestRow.getByRole("button", {
    name: `Más acciones de ${listedContest.title}`,
  });

  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    const [rowBox, linkBox, menuBox] = await Promise.all([
      contestRow.boundingBox(),
      contestLink.boundingBox(),
      menu.boundingBox(),
    ]);
    expect(rowBox!.x + rowBox!.width).toBeLessThanOrEqual(width);
    // El menú queda a la derecha del nombre, en la misma fila.
    expect(menuBox!.x).toBeGreaterThan(linkBox!.x);
    expect(menuBox!.y).toBeLessThan(linkBox!.y + linkBox!.height + 24);
  }

  await menu.click();
  await expect(page.getByRole("menuitem", { name: "Eliminar" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/tareas");
  const taskTitleLink = page.getByRole("link", {
    name: listedTask.title,
    exact: true,
  });
  const taskRow = taskTitleLink.locator("xpath=ancestor::li[1]");
  const taskActions = [
    taskRow.getByRole("button", { name: /^(En práctica|Práctica)$/ }),
    taskRow.getByRole("link", { name: "Editar" }),
    taskRow.getByRole("link", { name: "Probar" }),
    taskRow.getByRole("button", { name: "Eliminar" }),
  ];
  const mobileTaskActions = await Promise.all(
    taskActions.map((action) => action.boundingBox()),
  );
  // En celular van en una sola fila y Eliminar queda solo con su ícono.
  expect(mobileTaskActions[3]!.width).toBeLessThan(mobileTaskActions[2]!.width);
  for (const action of mobileTaskActions) {
    expect(action!.y).toBe(mobileTaskActions[0]!.y);
    expect(action!.x + action!.width).toBeLessThanOrEqual(320);
  }

  await page.setViewportSize({ width: 1280, height: 800 });
  const desktopTaskActions = await Promise.all(
    taskActions.map((action) => action.boundingBox()),
  );
  expect(desktopTaskActions[0]!.width).toBeLessThan(160);
  expect(desktopTaskActions[0]!.width).toBe(desktopTaskActions[1]!.width);
  expect(desktopTaskActions[1]!.width).toBe(desktopTaskActions[2]!.width);
  expect(desktopTaskActions[2]!.width).toBe(desktopTaskActions[3]!.width);
  expect(desktopTaskActions[1]!.y).toBe(desktopTaskActions[0]!.y);
  expect(desktopTaskActions[1]!.x).toBeGreaterThan(desktopTaskActions[0]!.x);
  expect(desktopTaskActions[2]!.y).toBeGreaterThan(desktopTaskActions[0]!.y);
  expect(desktopTaskActions[3]!.y).toBe(desktopTaskActions[2]!.y);
  expect((await taskRow.boundingBox())!.height).toBeLessThan(260);

  await expect(taskTitleLink).toHaveAttribute(
    "href",
    `/tareas/editar?id=${listedTask.id}`,
  );

  await taskRow.getByRole("link", { name: "Probar", exact: true }).click();
  await expect(page).toHaveURL(`/tareas/probador?id=${listedTask.id}`);
  await page.goBack();
  await expect(taskRow).toBeVisible();

  const taskTitleLinkBox = await taskTitleLink.boundingBox();
  expect(taskTitleLinkBox).not.toBeNull();
  await taskTitleLink.click({
    position: {
      x: taskTitleLinkBox!.width / 2,
      y: taskTitleLinkBox!.height / 2,
    },
  });
  await expect(page).toHaveURL(`/tareas/editar?id=${listedTask.id}`);

  await page.goBack();
  await expect(taskRow).toBeVisible();
  await taskTitleLink.focus();
  await expect(taskTitleLink).toBeFocused();
  await taskTitleLink.press("Enter");
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
    const touchTitleLink = touchPage.getByRole("link", {
      name: listedTask.title,
      exact: true,
    });
    const touchTitleLinkBox = await touchTitleLink.boundingBox();
    expect(touchTitleLinkBox).not.toBeNull();
    await touchTitleLink.tap({
      position: {
        x: touchTitleLinkBox!.width / 2,
        y: touchTitleLinkBox!.height / 2,
      },
    });
    await expect(touchPage).toHaveURL(`/tareas/editar?id=${listedTask.id}`);
  } finally {
    await touchContext.close();
  }

  await api.dispose();
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

test("keeps group and teacher cards responsive and compact", async ({
  page,
}) => {
  const now = new Date().toISOString();

  await page.route(`${API}/api/published-contests`, (route) =>
    route.fulfill({
      json: [
        {
          id: "responsive-contest",
          title: "Desafío responsive",
          categories: ["Capibara"],
          startsAt: now,
          endsAt: new Date(Date.now() + 3600000).toISOString(),
        },
      ],
    }),
  );
  await page.route(`${API}/api/groups`, (route) =>
    route.fulfill({
      json: [
        {
          id: "responsive-group",
          name: "Grupo responsive",
          accessCode: "ABC123",
          contestId: "responsive-contest",
          contestTitle: "Desafío responsive",
          contestCategories: ["Capibara"],
          contestAllowPairs: true,
          firstUsedAt: null,
          expiresAt: null,
          createdAt: now,
          teamCount: 1,
          teams: [
            {
              id: "responsive-team",
              participationMode: "individual",
              grade: "P3",
              memberOneFirstName: "Participante",
              memberOneLastName: "Con apellido extenso",
              memberTwoFirstName: null,
              memberTwoLastName: null,
              personalCode: "TEAM01",
              status: "registered",
              createdAt: now,
            },
          ],
        },
      ],
    }),
  );
  await page.route(`${API}/api/users/maestros`, (route) =>
    route.fulfill({
      json: [
        {
          id: 999,
          name: "Maestro responsive",
          email: "maestro.responsive.con.correo.extenso@example.com",
          status: "pending",
          schoolName: "Colegio de prueba responsive",
          institutionType: "school",
          phone: "70000000",
          isHomeschool: false,
          hasLetter: true,
          hasIdFront: true,
          hasIdBack: true,
          createdAt: now,
          schools: [],
        },
      ],
    }),
  );
  await loginAdminPage(page);

  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/grupos");
  const groupRow = page
    .getByRole("heading", { name: "Grupo responsive", level: 3 })
    .locator("xpath=ancestor::li[1]");
  const groupActions = [
    groupRow.getByRole("button", { name: "Copiar enlace" }),
    groupRow.getByRole("button", { name: "Eliminar", exact: true }),
  ];
  const mobileGroupActions = await Promise.all(
    groupActions.map((action) => action.boundingBox()),
  );
  expect(mobileGroupActions[0]!.width).toBe(mobileGroupActions[1]!.width);
  expect(mobileGroupActions[1]!.y).toBeGreaterThan(mobileGroupActions[0]!.y);
  await groupRow.getByRole("button", { name: /1 equipo/ }).click();
  await expect(
    groupRow.getByRole("button", { name: "Editar participante" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    ),
  ).toBe(false);

  await page.setViewportSize({ width: 1280, height: 800 });
  const desktopGroupActions = await Promise.all(
    groupActions.map((action) => action.boundingBox()),
  );
  expect(desktopGroupActions[0]!.width).toBeLessThan(160);
  expect(desktopGroupActions[0]!.width).toBe(desktopGroupActions[1]!.width);
  expect(desktopGroupActions[0]!.y).toBe(desktopGroupActions[1]!.y);

  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/maestros");
  const teacherRow = page
    .getByText("Maestro responsive", { exact: true })
    .locator("xpath=ancestor::article[1]");
  const teacherActions = [
    teacherRow.getByRole("button", { name: "Carta", exact: true }),
    teacherRow.getByRole("button", { name: "Carnet anverso" }),
    teacherRow.getByRole("button", { name: "Carnet reverso" }),
    teacherRow.getByRole("button", { name: "Aprobar" }),
    teacherRow.getByRole("button", { name: "Rechazar a Maestro responsive" }),
  ];
  const mobileTeacherActions = await Promise.all(
    teacherActions.map((action) => action.boundingBox()),
  );
  for (const action of mobileTeacherActions) {
    expect(action).not.toBeNull();
    expect(action!.x).toBeGreaterThanOrEqual(0);
    expect(action!.x + action!.width).toBeLessThanOrEqual(320);
  }
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    ),
  ).toBe(false);

  await page.setViewportSize({ width: 1280, height: 800 });
  const desktopTeacherActions = await Promise.all(
    teacherActions.map((action) => action.boundingBox()),
  );
  expect(desktopTeacherActions[0]!.width).toBeLessThan(130);
  expect(desktopTeacherActions[0]!.y).toBe(desktopTeacherActions[1]!.y);
  expect(desktopTeacherActions[1]!.x).toBeGreaterThan(
    desktopTeacherActions[0]!.x,
  );
  expect((await teacherRow.boundingBox())!.height).toBeLessThan(260);
});
