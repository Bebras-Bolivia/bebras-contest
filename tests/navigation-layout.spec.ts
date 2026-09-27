import { test, expect, request } from "@playwright/test";
import { canAccessSiteNavForMode as canAccessSiteNav } from "../frontend/src/lib/site-navigation-access";
import { API, loginAdmin, loginAdminPage } from "./support/helpers";

test("blocks the panel for users without a session", async ({ page }) => {
  await page.goto("/desafios");
  await expect(page).toHaveURL(/\/login/, { timeout: 15000 });
});

test("filters navigation sections by user role", () => {
  expect(canAccessSiteNav("public")).toBe(true);
  expect(canAccessSiteNav("admin", "admin", "approved")).toBe(true);
  expect(canAccessSiteNav("staff", "admin", "approved")).toBe(true);
  expect(canAccessSiteNav("staff", "maestro", "approved")).toBe(true);
  expect(canAccessSiteNav("admin", "maestro", "approved")).toBe(false);
  expect(canAccessSiteNav("staff")).toBe(false);
});

test("keeps the contest list and a new contest within a mobile viewport", async ({
  page,
}) => {
  await loginAdminPage(page);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/desafios");
  await page.waitForFunction(
    () => {
      const island = document.querySelector(
        'astro-island[component-url*="contests-home"]',
      );
      return island !== null && !island.hasAttribute("ssr");
    },
    null,
    { timeout: 30000 },
  );

  const mainBeforeMenu = await page.locator("main").boundingBox();
  await page.getByRole("button", { name: "Abrir menú" }).click();
  const mobileNavigation = page.getByRole("navigation", {
    name: "Navegación principal",
  });
  await expect(mobileNavigation).toBeVisible();
  await expect(
    mobileNavigation.getByRole("link", { name: "Práctica" }),
  ).toBeVisible();
  await expect(
    mobileNavigation.getByRole("link", { name: "Tareas" }),
  ).toBeVisible();
  await expect(
    mobileNavigation.getByRole("link", { name: "Desafíos" }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    mobileNavigation.getByRole("link", { name: "Grupos" }),
  ).toBeVisible();
  await expect(
    mobileNavigation.getByRole("link", { name: "Maestros" }),
  ).toBeVisible();
  const mainWithMenu = await page.locator("main").boundingBox();
  expect(mainWithMenu!.y).toBeGreaterThan(mainBeforeMenu!.y);
  await page.getByRole("button", { name: "Cerrar menú" }).click();
  await expect(mobileNavigation).toBeHidden();

  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    ),
  ).toBe(false);

  await page.evaluate(() => {
    (
      window as Window & { __bebrasClientNavigation?: boolean }
    ).__bebrasClientNavigation = true;
  });
  await page.getByRole("button", { name: "Abrir menú" }).click();
  await mobileNavigation.getByRole("link", { name: "Desafíos" }).click();
  await expect(page).toHaveURL(/\/desafios\/?$/);
  expect(
    await page.evaluate(
      () =>
        (window as Window & { __bebrasClientNavigation?: boolean })
          .__bebrasClientNavigation,
    ),
  ).toBe(true);
  await expect(page.locator("html")).toHaveCSS("scrollbar-width", "none");
  await expect(page.getByRole("banner")).toHaveCSS(
    "view-transition-name",
    "app-header",
  );

  // «Nuevo desafío» crea el borrador con las seis categorías y abre su editor.
  await page.getByRole("button", { name: "Nuevo desafío" }).click();
  await expect(page).toHaveURL(/\/desafios\/editar\?id=/, { timeout: 15000 });
  await expect(page.getByRole("tab", { name: /Guacamayo/ })).toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(6);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    ),
  ).toBe(false);
});

test("keeps the contest calendar within a mobile viewport", async ({
  page,
}) => {
  const api = await request.newContext();
  const headers = await loginAdmin(api);
  const draft = await api
    .post(`${API}/api/contests`, {
      headers,
      data: {
        title: "PW Calendario " + Date.now(),
        category: "Capibara",
        durationMinutes: 45,
        tasks: [],
      },
    })
    .then((response) => response.json());

  await loginAdminPage(page);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(`/desafios/editar?id=${draft.id}`);

  await expect(page.getByText("Inscripción", { exact: true })).toBeVisible();
  await expect(page.getByText("Rendición", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Rendición, inicio, día" })
    .click();
  const calendarBounds = await page
    .locator('[data-slot="calendar"]')
    .boundingBox();
  expect(calendarBounds).not.toBeNull();
  expect(calendarBounds!.x).toBeGreaterThanOrEqual(0);
  expect(calendarBounds!.x + calendarBounds!.width).toBeLessThanOrEqual(320);
  await page.keyboard.press("Escape");

  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    ),
  ).toBe(false);

  await api.dispose();
});
