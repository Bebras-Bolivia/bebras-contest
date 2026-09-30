import { test, expect, type APIRequestContext } from "@playwright/test";
import {
  API,
  createApprovedTeacher,
  createContest,
  loginAdmin,
  registerBebrasProfile,
} from "./support/helpers";

// D1 admite 100 parámetros por consulta y, según el plan, 50 o 1000 consultas
// por petición. Con más de 100 maestros, grupos o desafíos, una relación que
// Prisma no puede partir en tandas rompe la pantalla entera. Cada listado se
// mide con la cabecera X-D1-Queries que el backend agrega en local.
const FREE_PLAN_QUERIES = 50;
const MORE_THAN_A_PAGE = 105;

test.describe.configure({ timeout: 300_000 });

async function countOf(
  request: APIRequestContext,
  headers: Record<string, string>,
  path: string,
) {
  const response = await request.get(`${API}${path}`, { headers });
  expect(response.ok(), `${path}: ${await response.text()}`).toBe(true);
  const body = await response.json();
  return Array.isArray(body) ? body.length : 0;
}

async function mapLimit<T>(count: number, limit: number, run: (index: number) => Promise<T>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < count) {
        const index = next;
        next += 1;
        await run(index);
      }
    }),
  );
}

test("los listados siguen andando con más de cien maestros, grupos y desafíos", async ({
  request,
}) => {
  const headers = await loginAdmin(request);

  const contests = await countOf(request, headers, "/api/contests");
  await mapLimit(Math.max(0, MORE_THAN_A_PAGE - contests), 8, async (index) => {
    const created = await request.post(`${API}/api/contests`, {
      headers,
      data: { title: `Escala ${Date.now()} ${index}`, categories: ["Titi"] },
    });
    expect(created.ok(), await created.text()).toBe(true);
  });

  const teachers = await countOf(request, headers, "/api/users/maestros");
  await mapLimit(Math.max(0, MORE_THAN_A_PAGE - teachers), 8, async () => {
    const { response } = await registerBebrasProfile(request);
    expect(response.status(), await response.text()).toBe(201);
  });

  const groups = await countOf(request, headers, "/api/groups");
  if (groups < MORE_THAN_A_PAGE) {
    const contest = await createContest(request, headers);
    const teacher = await createApprovedTeacher(request, headers);
    await mapLimit(MORE_THAN_A_PAGE - groups, 8, async (index) => {
      const created = await request.post(`${API}/api/groups`, {
        headers: teacher.headers,
        data: { contestId: contest.id, name: `Escala ${index}` },
      });
      expect(created.ok(), await created.text()).toBe(true);
    });
  }

  for (const path of [
    "/api/contests",
    "/api/users/maestros",
    "/api/groups",
    "/api/practices",
    "/api/published-contests",
    "/api/public-contests",
    "/api/public-ranking",
    "/api/admin/certificates",
  ]) {
    const response = await request.get(`${API}${path}`, { headers });
    expect(response.ok(), `${path}: ${await response.text()}`).toBe(true);
    const queries = Number(response.headers()["x-d1-queries"]);
    expect(queries, `${path} hizo ${queries} consultas`).toBeLessThanOrEqual(
      FREE_PLAN_QUERIES,
    );
  }

  expect(await countOf(request, headers, "/api/contests")).toBeGreaterThanOrEqual(
    MORE_THAN_A_PAGE,
  );
  expect(
    await countOf(request, headers, "/api/users/maestros"),
  ).toBeGreaterThanOrEqual(MORE_THAN_A_PAGE);
  expect(await countOf(request, headers, "/api/groups")).toBeGreaterThanOrEqual(
    MORE_THAN_A_PAGE,
  );
});
