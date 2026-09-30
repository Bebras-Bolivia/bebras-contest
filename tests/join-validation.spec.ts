import { expect, request, test } from "@playwright/test";

import { API, createContest, loginAdmin } from "./support/helpers";

async function createGroup(allowPairs = false) {
  const api = await request.newContext();
  const headers = await loginAdmin(api);
  const contest = await createContest(api, headers, { allowPairs });
  const response = await api.post(`${API}/api/groups`, {
    headers,
    data: { contestId: contest.id, name: "Validation Group" },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const group = (await response.json()) as { accessCode: string };
  await api.dispose();
  return { accessCode: group.accessCode, grade: contest.picked.grade };
}

async function openJoinForm(page: import("@playwright/test").Page) {
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
}

test("associates code errors with the code field", async ({ page }) => {
  const group = await createGroup();
  await openJoinForm(page);

  const code = page.getByLabel("Tu código");
  await page.getByRole("button", { name: "Continuar" }).click();

  await expect(code).toBeFocused();
  await expect(code).toHaveAttribute("aria-invalid", "true");
  await expect(code).toHaveAttribute("aria-describedby", "access-code-error");
  await expect(page.locator("#access-code-error")).toHaveText(
    "Escribe el código que te dio tu maestro.",
  );

  // Ocho caracteres: se intenta como código personal y no existe.
  await code.fill("ZZZZZZZZ");
  await expect(code).toHaveAttribute("aria-invalid", "false");
  await expect(page.locator("#access-code-error")).toHaveCount(0);
  await page.getByRole("button", { name: "Continuar" }).click();

  await expect(code).toBeFocused();
  await expect(code).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#access-code-error")).toHaveText(
    "Código no encontrado.",
  );

  // El código del grupo lleva a inscribirse, nunca a rendir.
  await code.fill(group.accessCode);
  await expect(page.locator("#access-code-error")).toHaveCount(0);
  await page.getByRole("button", { name: "Continuar" }).click();

  await expect(page.getByRole("heading", { name: "Inscríbete" })).toBeVisible();
  await expect(
    page.getByRole("radiogroup", { name: "¿En qué curso estás?" }),
  ).toBeVisible();
});

test("validates pair registration and preserves general step errors", async ({
  page,
}) => {
  const group = await createGroup(true);
  await openJoinForm(page);

  await page.getByLabel("Tu código").fill(group.accessCode);
  await page.getByRole("button", { name: "Continuar" }).click();

  const grades = page.getByRole("radiogroup", { name: "¿En qué curso estás?" });
  const firstGrade = grades.getByRole("radio").first();
  const firstName = page.getByLabel("Nombres", { exact: true });
  const lastName = page.getByLabel("Apellidos", { exact: true });
  await page.getByRole("button", { name: "Continuar" }).click();

  // Vacío: el foco va al curso y cada campo queda marcado con su error.
  await expect(firstGrade).toBeFocused();
  await expect(grades).toHaveAttribute("aria-describedby", "grade-error");
  await expect(page.locator("#grade-error")).toHaveText("Elige tu curso.");
  await expect(firstName).toHaveAttribute("aria-invalid", "true");
  await expect(lastName).toHaveAttribute("aria-invalid", "true");

  await firstGrade.click();
  await expect(firstGrade).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("#grade-error")).toHaveCount(0);
  await firstName.fill("Ana");
  await lastName.fill("Quispe");
  await page.getByRole("radio", { name: "En pareja" }).click();
  await page.getByRole("button", { name: "Continuar" }).click();

  const secondFirst = page.getByLabel("Nombres de tu compañero");
  const secondLast = page.getByLabel("Apellidos de tu compañero");
  await expect(secondFirst).toBeFocused();
  await expect(secondFirst).toHaveAttribute("aria-invalid", "true");
  await expect(secondLast).toHaveAttribute("aria-invalid", "true");

  await secondFirst.fill("Ana");
  await secondLast.fill("Quispe");
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(secondFirst).toBeFocused();
  await expect(page.locator("#two-first-error")).toHaveText(
    "Debe ser una persona diferente.",
  );

  await secondFirst.fill("Bea");
  await expect(page.locator("#two-first-error")).toHaveCount(0);
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(
    page.getByRole("heading", { name: "¿Está todo bien?" }),
  ).toBeVisible();
  await expect(page.getByText("Ana Quispe")).toBeVisible();
  await expect(page.getByText("Bea Quispe")).toBeVisible();

  // Un error del servidor vuelve al formulario con el mensaje enfocado.
  await page.route("**/api/play/join", async (route) => {
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ message: "No se pudo completar el registro." }),
    });
  });
  await page.getByRole("button", { name: "Sí, inscribirme" }).click();

  const formError = page
    .getByRole("alert")
    .filter({ hasText: "No se pudo completar el registro." });
  await expect(formError).toBeVisible();
  await expect(formError).toBeFocused();
  await expect(page.getByRole("heading", { name: "Inscríbete" })).toBeVisible();

  await page.unroute("**/api/play/join");
  await page.getByLabel("Tus nombres").fill("Ana María");
  await expect(formError).toHaveCount(0);
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByRole("button", { name: "Sí, inscribirme" }).click();

  await expect(page.getByText("¡Listo, ya estás inscrito!")).toBeVisible();
  // Un segundo intento con el mismo nombre no revela el código de nadie.
  const repeated = await page.request.post(`${API}/api/play/join`, {
    data: {
      accessCode: group.accessCode,
      participationMode: "individual",
      grade: group.grade,
      memberOneFirstName: "Ana María",
      memberOneLastName: "Quispe",
    },
  });
  expect(repeated.status()).toBe(409);
});
