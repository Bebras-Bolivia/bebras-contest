import { test, expect } from "@playwright/test";
import {
  API,
  createApprovedTeacher,
  createContest,
  createPracticeTask,
  loginAdmin,
  loginPage,
  resetE2EClock,
  setE2EClock,
} from "./support/helpers";

test.beforeEach(async ({ request }) => resetE2EClock(request));

test("la portada muestra los desafíos publicados y nunca los borradores", async ({
  page,
  request,
}) => {
  const headers = await loginAdmin(request);
  const published = await createContest(request, headers, {
    title: `Desafío público ${Date.now()}`,
  });
  const draft = await request
    .post(`${API}/api/contests`, {
      headers,
      data: { title: `Borrador oculto ${Date.now()}`, categories: ["Titi"] },
    })
    .then((r) => r.json());

  const listed = (await request
    .get(`${API}/api/public-contests`)
    .then((r) => r.json())) as Array<{ id: string; participants: number; state: string }>;
  expect(listed.some((contest) => contest.id === published.id)).toBe(true);
  expect(listed.some((contest) => contest.id === draft.id)).toBe(false);

  await page.goto("/");
  await expect(page.getByText(published.title).first()).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByText(draft.title)).toHaveCount(0);
});

test("el ranking público solo muestra el nombre y la inicial del apellido", async ({
  request,
}) => {
  const ranking = (await request
    .get(`${API}/api/public-ranking`)
    .then((r) => r.json())) as Array<{
    categories: Array<{ rows: Array<Record<string, unknown>> }>;
  }>;

  for (const contest of ranking) {
    for (const category of contest.categories) {
      for (const row of category.rows) {
        expect(Object.keys(row).sort()).toEqual(
          ["department", "name", "place", "rank", "school", "score"].sort(),
        );
        for (const person of String(row.name).split(" y ")) {
          expect(person).toMatch(/^\S.* \p{Lu}\.$/u);
        }
      }
    }
  }
});

test("la práctica pública lista categorías y abre una tarea para comprobar", async ({
  page,
  request,
}) => {
  const headers = await loginAdmin(request);
  const task = await createPracticeTask(request, headers, "multiple_choice");

  const categories = (await request
    .get(`${API}/api/practice/categories`)
    .then((r) => r.json())) as Array<{ name: string; count: number }>;
  expect(categories.find((category) => category.name === "Titi")?.count).toBeGreaterThan(0);

  await page.goto("/practica");
  await expect(page.getByText("Titi").first()).toBeVisible({ timeout: 15000 });

  await page.goto(`/practica/tarea?nombre=Titi&id=${task.id}`);
  const check = page.getByRole("button", { name: "Comprobar" });
  await expect(check).toBeVisible({ timeout: 15000 });
  await expect(check).toBeDisabled();
});

test("la carta modelo se ve en pantalla y se descarga en PDF", async ({
  page,
  request,
}) => {
  await page.goto("/carta-modelo");
  await expect(page.locator("main")).toContainText("Bebras");

  const pdf = await request.post(`${API}/api/letter/pdf`, {
    data: { colegio: "U.E. Prueba", maestro: "ana pérez", ciudad: "Sucre" },
  });
  expect(pdf.ok()).toBe(true);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
});

test("entrar con un código que no existe avisa sin revelar nada", async ({
  page,
}) => {
  await page.goto("/entrar");
  await page.waitForFunction(() => {
    const island = document.querySelector('astro-island[component-url*="join-form"]');
    return island !== null && !island.hasAttribute("ssr");
  });
  await page.locator("#access-code").fill("ZZZZZZ");
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByText(/no encontrado/i).first()).toBeVisible();
});

test("el servidor responde que está sano y conectado a la base", async ({ request }) => {
  const health = await request.get(`${API}/health`).then((r) => r.json());
  expect(health).toEqual({ status: "ok", database: "connected" });
});

test("la lista de una categoría de práctica va de fácil a difícil", async ({
  page,
  request,
}) => {
  const list = (await request
    .get(`${API}/api/practice/tasks?category=Titi`)
    .then((r) => r.json())) as { tasks: Array<{ title: string; difficulty: string | null }> };
  const rank = { easy: 0, medium: 1, hard: 2 } as Record<string, number>;
  const order = list.tasks.map((task) => rank[task.difficulty ?? ""] ?? 3);
  expect(order).toEqual([...order].sort((a, b) => a - b));

  await page.goto("/practica/categoria?nombre=Titi");
  await expect(page.getByText(list.tasks[0].title).first()).toBeVisible({
    timeout: 15000,
  });
  const missing = await request.get(`${API}/api/practice/tasks?category=Nadie`);
  expect(missing.status()).toBe(404);
});

test("cada desafío de la portada ofrece lo que corresponde a su etapa y a quien mira", async ({
  page,
  request,
}) => {
  const headers = await loginAdmin(request);
  const startsAt = new Date(Date.now() + 2 * 3600000);
  const contest = await createContest(request, headers, {
    title: `Portada por etapa ${Date.now()}`,
    registrationStartsAt: "",
    registrationEndsAt: "",
    startsAt: startsAt.toISOString(),
    endsAt: new Date(startsAt.getTime() + 3600000).toISOString(),
  });
  const card = page.locator("article").filter({ hasText: contest.title });

  // Con la inscripción abierta, el estudiante se inscribe y el maestro tiene su acceso.
  await page.goto("/");
  await expect(card).toBeVisible({ timeout: 15000 });
  await expect(card.getByRole("link", { name: "Inscribirme" })).toHaveAttribute("href", "/entrar");
  await expect(card.getByRole("link", { name: "Soy maestro: inscribir a mis estudiantes" })).toBeVisible();

  // Durante la prueba, se entra al desafío.
  await setE2EClock(request, new Date(startsAt.getTime() + 60000));
  await page.goto("/");
  await expect(card.getByRole("link", { name: "Entrar al desafío" })).toBeVisible({ timeout: 15000 });
  await resetE2EClock(request);

  // Un maestro con sesión va a sus grupos.
  const teacher = await createApprovedTeacher(request, headers);
  await loginPage(page, teacher.identity, /\/perfil\/?$/);
  await page.goto("/");
  await expect(card.getByRole("link", { name: /Inscribir un grupo|Ver mis grupos/ })).toHaveAttribute(
    "href",
    /\/grupos/,
    { timeout: 15000 },
  );
});
