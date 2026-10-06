import { test, expect, type Page } from "@playwright/test";
import {
  API,
  createPracticeTask,
  findTaskByTitle,
  loginAdmin,
  loginAdminPage,
  taskBlock,
} from "./support/helpers";

const titleField = (page: Page) =>
  page.getByRole("textbox", { name: "Título de la tarea" });
const problem = (page: Page) =>
  page.locator('form p[role="alert"]');
const result = (page: Page) =>
  page.getByRole("status").filter({ hasText: /Correcto|incorrecta/ });

async function openEditor(page: Page, path: string) {
  await page.goto(path);
  await expect(titleField(page)).toBeVisible({ timeout: 15000 });
}

function waitForSave(page: Page, method: "POST" | "PUT") {
  return page.waitForResponse(
    (response) =>
      response.url().startsWith(`${API}/api/tasks`) &&
      !response.url().includes("/draft/") &&
      response.request().method() === method,
  );
}

test("crea una tarea de respuesta corta, la guarda con su código automático y la reabre igual", async ({
  page,
  request: api,
}) => {
  const title = `Tarea creada ${Date.now()}`;
  await loginAdminPage(page);
  await openEditor(page, "/tareas/nueva");
  await expect(page).toHaveTitle(/Nueva tarea/);

  await titleField(page).fill(title);
  await page.getByRole("radio", { name: "Respuesta corta" }).click();
  await page
    .getByRole("textbox", { name: "Cuenta la situación de la tarea." })
    .fill("Contenido que debe conservarse");
  await page
    .getByRole("textbox", { name: "Escribe la pregunta." })
    .fill("Pregunta que debe conservarse");
  await page
    .getByRole("textbox", { name: "Respuesta correcta" })
    .fill("Castor");
  await page
    .getByRole("textbox", { name: "Explica por qué esa es la respuesta." })
    .fill("Explicación que debe conservarse");
  await page
    .getByRole("radiogroup", { name: "Dificultad en Titi" })
    .getByRole("radio", { name: "Medio" })
    .click();
  await page
    .getByRole("button", { name: "Algoritmos y programación" })
    .click();
  await page.getByRole("combobox", { name: "País de origen" }).click();
  await page.getByRole("option", { name: "Alemania" }).click();
  await page.getByRole("spinbutton", { name: "Año del desafío" }).fill("2024");

  const saved = waitForSave(page, "POST");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  const response = await saved;
  expect(response.ok()).toBe(true);
  const payload = response.request().postDataJSON();
  expect(payload).toMatchObject({
    title,
    answerType: "short_text",
    shortAnswer: "Castor",
    categories: ["Algoritmos y programación"],
    difficulties: { "10–12": "medium" },
    country: "Alemania",
  });
  // Sin campo «Código original»: se arma con año, país y el siguiente número.
  expect(payload.sourceTaskCode).toMatch(/^2024-DE-\d{2}$/);
  await expect(page).toHaveURL(/\/tareas\/?$/);

  const headers = await loginAdmin(api);
  const created = await findTaskByTitle(api, headers, title);
  expect(created.sourceTaskCode).toBe(payload.sourceTaskCode);
  await openEditor(page, `/tareas/editar?id=${created.id}`);
  await expect(page).toHaveTitle(/Editar tarea/);
  await expect(titleField(page)).toHaveValue(title);
  await expect(
    page.getByRole("radio", { name: "Respuesta corta" }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(
    page.getByRole("textbox", { name: "Cuenta la situación de la tarea." }),
  ).toContainText("Contenido que debe conservarse");
  await expect(
    page.getByRole("textbox", { name: "Escribe la pregunta." }),
  ).toContainText("Pregunta que debe conservarse");
  await expect(
    page.getByRole("textbox", { name: "Respuesta correcta" }),
  ).toHaveValue("Castor");
  await expect(
    page
      .getByRole("radiogroup", { name: "Dificultad en Titi" })
      .getByRole("radio", { name: "Medio" }),
  ).toHaveAttribute("aria-checked", "true");

  // Volver a guardar sin cambios conserva el mismo código.
  const again = waitForSave(page, "PUT");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  expect((await again).request().postDataJSON().sourceTaskCode).toBe(
    payload.sourceTaskCode,
  );

  await api.delete(`${API}/api/tasks/${created.id}`, { headers });
});

test("avisa lo que falta sin enviar nada y el aviso cambia mientras se corrige", async ({
  page,
}) => {
  await loginAdminPage(page);
  await openEditor(page, "/tareas/nueva");
  const sent: string[] = [];
  page.on("request", (request) => {
    if (
      request.url().startsWith(`${API}/api/tasks`) &&
      request.method() !== "GET"
    ) {
      sent.push(`${request.method()} ${request.url()}`);
    }
  });

  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(problem(page)).toContainText("Falta el título.");
  await expect(problem(page)).toContainText(/y \d+ más/);

  await titleField(page).fill("Tarea a medias");
  await expect(problem(page)).toContainText("Falta el área de contenido.");
  await page
    .getByRole("button", { name: "Algoritmos y programación" })
    .click();
  await expect(problem(page)).toContainText(
    "Falta la dificultad en alguna categoría.",
  );

  // «Probar» con problemas se queda en el editor en vez de abrir un
  // probador que no puede mostrar la tarea.
  await page.getByRole("button", { name: "Probar", exact: true }).click();
  await expect(page).toHaveURL(/\/tareas\/nueva/);
  await expect(problem(page)).toBeVisible();
  expect(sent).toEqual([]);
});

test("opción múltiple: la letra marca la correcta y se guarda cada criterio", async ({
  page,
  request: api,
}) => {
  const headers = await loginAdmin(api);
  const task = await createPracticeTask(api, headers, "multiple_choice");
  const editUrl = `/tareas/editar?id=${task.id}`;
  const letter = (key: string) =>
    page.getByRole("button", { name: new RegExp(`^Opción ${key}(,|\\.)`) });
  const save = async () => {
    const saved = waitForSave(page, "PUT");
    await page.getByRole("button", { name: "Guardar", exact: true }).click();
    const response = await saved;
    expect(response.ok()).toBe(true);
    await expect(page).toHaveURL(/\/tareas\/?$/);
    await openEditor(page, editUrl);
    return response.request().postDataJSON().correctAnswerId as string;
  };
  const sorted = (value: string) => {
    const [mode, keys] = value.split(":");
    return `${mode}:${keys.split(",").sort().join(",")}`;
  };

  await loginAdminPage(page);
  await openEditor(page, editUrl);
  await expect(letter("B")).toHaveAttribute("aria-pressed", "true");
  await expect(letter("A")).toHaveAttribute("aria-pressed", "false");

  // Con una sola correcta, tocar otra letra la reemplaza.
  await letter("A").click();
  await expect(letter("A")).toHaveAttribute("aria-pressed", "true");
  await expect(letter("B")).toHaveAttribute("aria-pressed", "false");
  expect(await save()).toBe("single:A");

  await page.getByRole("checkbox", { name: "Hay varias correctas" }).check();
  await letter("B").click();
  await page.getByRole("button", { name: "al menos una" }).click();
  expect(sorted(await save())).toBe("any:A,B");

  await expect(
    page.getByRole("checkbox", { name: "Hay varias correctas" }),
  ).toBeChecked();
  await page.getByRole("button", { name: "todas las correctas" }).click();
  expect(sorted(await save())).toBe("all:A,B");

  // La tercera opción se agrega, se escribe y se quita con la X.
  await page.getByRole("button", { name: "Otra opción" }).click();
  await page
    .getByRole("textbox", { name: "Texto de la opción C" })
    .fill("Tercera");
  await page.getByRole("button", { name: "Quitar la opción C" }).click();
  await expect(
    page.getByRole("textbox", { name: "Texto de la opción C" }),
  ).toHaveCount(0);

  const stored = await api
    .get(`${API}/api/tasks/${task.id}`, { headers })
    .then((response) => response.json());
  expect(sorted(stored.correctAnswerId)).toBe("all:A,B");
});

test("el probador corrige «al menos una» y «todas» con Comprobar y Reiniciar", async ({
  page,
  request: api,
}) => {
  const headers = await loginAdmin(api);
  const answers = ["A", "B", "C"].map((id) => ({
    id,
    blocks: [taskBlock(`tester-${id}-${Date.now()}`, `Respuesta ${id}`)],
  }));
  const anyTask = await createPracticeTask(api, headers, "multiple_choice", {
    title: "Probador criterio any",
    answers,
    correctAnswerId: "any:B,C",
  });
  const allTask = await createPracticeTask(api, headers, "multiple_choice", {
    title: "Probador criterio all",
    answers,
    correctAnswerId: "all:B,C",
  });
  const option = (name: string) =>
    page.getByRole("button", { name, exact: true });
  const check = page.getByRole("button", { name: "Comprobar", exact: true });

  await loginAdminPage(page);
  await page.goto(`/tareas/probador?id=${anyTask.id}`);
  await expect(check).toBeDisabled();
  await option("Respuesta B").click();
  await check.click();
  await expect(result(page)).toContainText("¡Correcto!");
  await page.getByRole("button", { name: "Reiniciar" }).click();
  await expect(result(page)).toHaveCount(0);
  await option("Respuesta A").click();
  await check.click();
  await expect(result(page)).toContainText("Respuesta incorrecta");

  await page.goto(`/tareas/probador?id=${allTask.id}`);
  await option("Respuesta B").click();
  await check.click();
  await expect(result(page)).toContainText("Respuesta incorrecta");
  await option("Respuesta C").click();
  await check.click();
  await expect(result(page)).toContainText("¡Correcto!");

  // «Editar» lleva a la tarea guardada.
  await page.getByRole("link", { name: "Editar", exact: true }).click();
  await expect(page).toHaveURL(`/tareas/editar?id=${allTask.id}`);
});

test("Probar lleva el borrador sin guardar y Editar vuelve a él sin tocar la base", async ({
  page,
  request: api,
}) => {
  const headers = await loginAdmin(api);
  const task = await createPracticeTask(api, headers, "short_text");
  const draftTitle = `${task.title} (borrador)`;

  await loginAdminPage(page);
  await openEditor(page, `/tareas/editar?id=${task.id}`);
  await titleField(page).fill(draftTitle);
  await page
    .getByRole("textbox", { name: "Respuesta correcta" })
    .fill("Castor");
  await page.getByRole("button", { name: "Probar", exact: true }).click();

  await expect(page).toHaveURL(/\/tareas\/probador\?borrador=1/);
  await expect(
    page.getByRole("heading", { name: draftTitle, exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Cambios sin guardar")).toBeVisible();
  await page.getByRole("textbox", { name: "Tu respuesta" }).fill("Castor");
  await page.getByRole("button", { name: "Comprobar", exact: true }).click();
  await expect(result(page)).toContainText("¡Correcto!");

  await page.getByRole("link", { name: "Editar", exact: true }).click();
  await expect(page).toHaveURL(/\/tareas\/editar\?id=.+borrador=1/);
  await expect(titleField(page)).toHaveValue(draftTitle);
  await expect(
    page.getByRole("textbox", { name: "Respuesta correcta" }),
  ).toHaveValue("Castor");

  const stored = await api
    .get(`${API}/api/tasks/${task.id}`, { headers })
    .then((response) => response.json());
  expect(stored).toMatchObject({ title: task.title, shortAnswer: "Bebras" });
});

test("el editor de cada tipo de respuesta cabe en la pantalla del celular", async ({
  page,
  request: api,
}) => {
  const headers = await loginAdmin(api);
  const created = await Promise.all(
    (["multiple_choice", "short_text", "drag_drop"] as const).map((type) =>
      createPracticeTask(api, headers, type),
    ),
  );
  const ids = [
    ...created.map((task) => task.id as string),
    "bebras-2024-04-caminando-bosque",
    "bebras-2024-09-tubo-canicas",
    "bebras-2024-19-dias-soleados",
  ];

  await loginAdminPage(page);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 800 });
    for (const id of ids) {
      await openEditor(page, `/tareas/editar?id=${id}`);
      await page.waitForLoadState("networkidle");
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      expect(overflow, `${id} a ${width}px`).toBeLessThanOrEqual(0);
      await expect(
        page.getByRole("button", { name: "Guardar", exact: true }),
      ).toBeInViewport();
    }
  }
});

test("la lista de tareas se busca y se filtra, y los filtros se quitan de una vez", async ({
  page,
}) => {
  await loginAdminPage(page);
  await page.goto("/tareas");
  const rows = page
    .locator("main li")
    .filter({ has: page.locator('a[href^="/tareas/editar"]') });
  await expect(rows.first()).toBeVisible({ timeout: 15000 });

  // Sin tildes ni mayúsculas también la encuentra.
  await page
    .getByRole("searchbox", { name: "Buscar tarea por nombre, código o país" })
    .fill("FIESTA DE PIZZA");
  await expect(page.getByRole("link", { name: "Fiesta de pizza", exact: true })).toBeVisible();
  await expect(rows).toHaveCount(1);
  await expect(page).toHaveURL(/q=/);
  await page.getByRole("button", { name: "Borrar búsqueda" }).click();

  await page
    .getByRole("group", { name: "Filtrar por tipo de respuesta" })
    .getByRole("button", { name: /^Zonas sobre la imagen/ })
    .click();
  await expect(page.getByRole("link", { name: "Caminando por el bosque", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Fiesta de pizza", exact: true })).toHaveCount(0);
  for (const row of await rows.all()) {
    await expect(row).toContainText("Zonas sobre la imagen");
  }
  await page
    .getByRole("group", { name: "Filtrar por tipo de respuesta" })
    .getByRole("button", { name: /^Todas/ })
    .click();

  // Con una categoría aparece el filtro de dificultad.
  await page
    .getByRole("group", { name: "Filtrar por categoría" })
    .getByRole("button", { name: /^Kuntur/ })
    .click();
  const difficulty = page.getByRole("group", { name: "Filtrar por dificultad en Kuntur" });
  await expect(difficulty).toBeVisible();
  await difficulty.getByRole("button", { name: /^Difícil/ }).click();
  await expect(page).toHaveURL(/dificultad=hard/);
  // Cada fila que queda es difícil en Kuntur (se espera a que la lista se actualice).
  const hard = page.getByLabel("Kuntur: Difícil", { exact: true });
  await expect
    .poll(async () => (await rows.count()) - (await hard.count()))
    .toBe(0);
  expect(await rows.count()).toBeGreaterThan(0);

  await page
    .getByRole("searchbox", { name: "Buscar tarea por nombre, código o país" })
    .fill("zzzz sin resultados");
  await expect(page.getByText("No hay tareas con estos filtros.")).toBeVisible();
  await page.getByRole("button", { name: "Quitar filtros" }).click();
  await expect(rows.first()).toBeVisible();
  await expect(page).not.toHaveURL(/q=|edad=|dificultad=/);
});

test("mover una opción cambia su contenido de lugar y la primera sigue siendo la A", async ({
  page,
  request: api,
}) => {
  const headers = await loginAdmin(api);
  const task = await createPracticeTask(api, headers, "multiple_choice");
  const letter = (key: string) =>
    page.getByRole("button", { name: new RegExp(`^Opción ${key}(,|\\.)`) });

  await loginAdminPage(page);
  await openEditor(page, `/tareas/editar?id=${task.id}`);
  await expect(page.getByRole("textbox", { name: "Texto de la opción A" })).toHaveValue("Incorrecta");
  await expect(letter("B")).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Bajar la opción A" }).click();
  // El contenido se movió; las letras quedan en su lugar y la correcta sigue a su texto.
  await expect(page.getByRole("textbox", { name: "Texto de la opción A" })).toHaveValue("Correcta");
  await expect(page.getByRole("textbox", { name: "Texto de la opción B" })).toHaveValue("Incorrecta");
  await expect(letter("A")).toHaveAttribute("aria-pressed", "true");
  await expect(letter("B")).toHaveAttribute("aria-pressed", "false");

  const saved = waitForSave(page, "PUT");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  const payload = (await saved).request().postDataJSON();
  expect(payload.correctAnswerId).toBe("single:A");
  expect(payload.answers[0].blocks[0].content).toBe("Correcta");
});
