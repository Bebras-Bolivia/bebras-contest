import { test, expect, type Locator, type Page } from "@playwright/test";
import {
  API,
  findTaskByTitle,
  loginAdmin,
  loginAdminPage,
} from "./support/helpers";

const svg = (name: string, body: string, width = 800, height = 500) => ({
  name,
  mimeType: "image/svg+xml",
  buffer: Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`,
  ),
});
const BACKGROUND = svg(
  "fondo.svg",
  '<rect width="800" height="500" fill="#cbd5e1"/>',
);
const RED = svg("roja.svg", '<circle cx="40" cy="40" r="36" fill="#dc2626"/>', 80, 80);
const BLUE = svg("azul.svg", '<rect x="6" y="6" width="68" height="68" fill="#2563eb"/>', 80, 80);

async function drag(page: Page, from: Locator, to: { x: number; y: number }) {
  const box = await from.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
}

async function fillRestOfTask(page: Page, title: string) {
  await page.getByRole("textbox", { name: "Título de la tarea" }).fill(title);
  await page
    .getByRole("textbox", { name: "Cuenta la situación de la tarea." })
    .fill("Hay dos fichas.");
  await page
    .getByRole("textbox", { name: "Escribe la pregunta." })
    .fill("Pon cada ficha en su lugar.");
  await page
    .getByRole("textbox", { name: "Explica por qué esa es la respuesta." })
    .fill("Cada ficha va donde corresponde.");
  await page
    .getByRole("radiogroup", { name: "Dificultad en Capibara" })
    .getByRole("radio", { name: "Fácil" })
    .click();
  await page
    .getByRole("button", { name: "Algoritmos y programación" })
    .click();
}

test("arma una tarea de arrastre soltando cada pieza en su lugar y la reabre igual", async ({
  page,
  request: api,
}) => {
  await page.setViewportSize({ width: 1280, height: 1800 });
  await loginAdminPage(page);
  await page.goto("/tareas/nueva");
  await page.getByRole("radio", { name: "Arrastrar y soltar" }).click();

  await page.getByLabel("Imagen de fondo").setInputFiles(BACKGROUND);
  const stage = page.locator('[aria-label^="Escenario de la tarea."]');
  await expect(stage).toBeVisible();
  await expect
    .poll(() =>
      stage
        .locator("img")
        .first()
        .evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBeGreaterThan(0);

  await page.getByLabel("Imagen de la nueva pieza").setInputFiles(RED);
  await page.getByLabel("Imagen de la nueva pieza").setInputFiles(BLUE);
  const first = page.getByRole("button", { name: "Pieza 1", exact: true });
  const second = page.getByRole("button", { name: "Pieza 2", exact: true });
  await expect(first).toBeVisible();
  await expect(second).toBeVisible();

  // Donde se suelta cada pieza queda su lugar: no hay coordenadas que escribir.
  await stage.scrollIntoViewIfNeeded();
  let box = (await stage.boundingBox())!;
  await drag(page, first, { x: box.x + box.width * 0.25, y: box.y + box.height * 0.4 });
  await expect(stage.getByRole("button", { name: "Pieza 1" })).toBeVisible();
  box = (await stage.boundingBox())!;
  await drag(page, second, { x: box.x + box.width * 0.75, y: box.y + box.height * 0.6 });
  await expect(stage.getByRole("button", { name: "Pieza 2" })).toBeVisible();

  // Un lugar extra: se puede soltar ahí sin que sea la respuesta.
  await page.getByRole("button", { name: "Lugares extra" }).click();
  box = (await stage.boundingBox())!;
  await stage.click({ position: { x: box.width * 0.5, y: box.height * 0.15 } });
  await page.getByRole("button", { name: "Listo" }).click();

  // Otra respuesta correcta aparece como pestaña y se quita con la X.
  await page.getByRole("button", { name: "Otra respuesta correcta" }).click();
  await expect(page.getByRole("tab", { name: "Otra respuesta 1" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("button", { name: "Quitar Otra respuesta 1" }).click();
  await expect(page.getByRole("tab", { name: "Otra respuesta 1" })).toHaveCount(0);

  const title = `Arrastre desde el editor ${Date.now()}`;
  await fillRestOfTask(page, title);
  const saved = page.waitForResponse(
    (response) =>
      response.url() === `${API}/api/tasks` &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  const response = await saved;
  expect(response.ok()).toBe(true);
  await expect(page).toHaveURL(/\/tareas\/?$/);
  const headers = await loginAdmin(api);
  const task = await findTaskByTitle(api, headers, title);

  expect(task.answerType).toBe("drag_drop");
  expect(task.dragDropItems).toHaveLength(2);
  expect(task.dragDropTargets).toHaveLength(3);
  const [red, blue] = task.dragDropItems;
  expect(red.correctTargetId).toBeTruthy();
  expect(blue.correctTargetId).toBeTruthy();
  expect(red.correctTargetId).not.toBe(blue.correctTargetId);
  const target = (id: string) =>
    task.dragDropTargets.find((candidate: { id: string }) => candidate.id === id);
  expect(target(red.correctTargetId).x).toBeLessThan(50);
  expect(target(blue.correctTargetId).x).toBeGreaterThan(50);
  expect(task.dragDropSolutions ?? []).toHaveLength(0);

  // Reabierta, cada pieza está en su lugar sobre la imagen.
  await page.goto(`/tareas/editar?id=${task.id}`);
  await expect(stage.getByRole("button", { name: "Pieza 1" })).toBeVisible({
    timeout: 15000,
  });
  await expect(stage.getByRole("button", { name: "Pieza 2" })).toBeVisible();

  // Y el probador la da por correcta solo con cada pieza en su lugar.
  await page.goto(`/tareas/probador?id=${task.id}`);
  await expect(stage).toBeVisible();
  const play = (name: string) =>
    page.getByRole("button", { name, exact: true }).first();
  await stage.scrollIntoViewIfNeeded();
  box = (await stage.boundingBox())!;
  const at = (id: string) => ({
    x: box.x + (box.width * target(id).x) / 100,
    y: box.y + (box.height * target(id).y) / 100,
  });
  await drag(page, play("Pieza 1"), at(blue.correctTargetId));
  await drag(page, play("Pieza 2"), at(red.correctTargetId));
  await page.getByRole("button", { name: "Comprobar", exact: true }).click();
  await expect(page.getByText("Respuesta incorrecta")).toBeVisible();
  await page.getByRole("button", { name: "Reiniciar" }).click();
  await expect(page.getByText("Respuesta incorrecta")).toHaveCount(0);
  await page.waitForFunction(
    () => !document.documentElement.hasAttribute("data-answer-reset"),
  );
  await expect(stage.getByRole("button")).toHaveCount(0);
  await drag(page, play("Pieza 1"), at(red.correctTargetId));
  await drag(page, play("Pieza 2"), at(blue.correctTargetId));
  await page.getByRole("button", { name: "Comprobar", exact: true }).click();
  await expect(page.getByText("¡Correcto!")).toBeVisible();

  await api.delete(`${API}/api/tasks/${task.id}`, { headers });
});

test("quitar una pieza la saca de la bandeja y del escenario", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1800 });
  await loginAdminPage(page);
  await page.goto("/tareas/nueva");
  await page.getByRole("radio", { name: "Arrastrar y soltar" }).click();
  await page.getByLabel("Imagen de fondo").setInputFiles(BACKGROUND);
  await page.getByLabel("Imagen de la nueva pieza").setInputFiles(RED);
  await page.getByLabel("Imagen de la nueva pieza").setInputFiles(BLUE);

  await page.getByRole("button", { name: "Editar Pieza 2" }).click();
  await page.getByRole("button", { name: "Quitar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Editar Pieza 2" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Pieza 2", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Pieza 1", exact: true })).toBeVisible();

  // Sin piezas, guardar avisa qué falta.
  await page.getByRole("button", { name: "Editar Pieza 1" }).click();
  await page.getByRole("button", { name: "Quitar", exact: true }).click();
  await fillRestOfTask(page, "Arrastre sin piezas");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page.locator('form p[role="alert"]')).toContainText(
    "Falta al menos una pieza.",
  );
});
