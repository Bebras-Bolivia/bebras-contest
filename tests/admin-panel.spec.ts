import { test, expect } from "@playwright/test";
import {
  ADMIN,
  API,
  createApprovedTeacher,
  createFirebaseUser,
  loginAdmin,
  loginAdminPage,
  uniqueEmail,
} from "./support/helpers";

test("sin sesión o como maestro no se entra a nada del administrador", async ({
  request,
}) => {
  const adminHeaders = await loginAdmin(request);
  const teacher = await createApprovedTeacher(request, adminHeaders);
  const adminOnly = [
    "/api/tasks",
    "/api/contests",
    "/api/users/maestros",
    "/api/admin/admins",
    "/api/admin/certificates",
  ];

  for (const path of adminOnly) {
    const anonymous = await request.get(`${API}${path}`);
    expect(anonymous.status(), path).toBe(401);
    const asTeacher = await request.get(`${API}${path}`, {
      headers: teacher.headers,
    });
    expect(asTeacher.status(), path).toBe(403);
  }

  const promote = await request.post(`${API}/api/admin/admins`, {
    headers: teacher.headers,
    data: { email: teacher.identity.email },
  });
  expect(promote.status()).toBe(403);
});

test("nombra administradores por correo y se enlazan en su primer ingreso", async ({
  request,
}) => {
  const headers = await loginAdmin(request);
  const email = uniqueEmail("admin");

  const invalid = await request.post(`${API}/api/admin/admins`, {
    headers,
    data: { email: "sin-arroba" },
  });
  expect(invalid.status()).toBe(400);

  const created = await request.post(`${API}/api/admin/admins`, {
    headers,
    data: { email },
  });
  expect(created.status(), await created.text()).toBe(201);
  expect((await created.json()).isSelf).toBe(false);

  const again = await request.post(`${API}/api/admin/admins`, {
    headers,
    data: { email },
  });
  expect(again.status()).toBe(409);

  const admins = (await request
    .get(`${API}/api/admin/admins`, { headers })
    .then((r) => r.json())) as Array<{ email: string; isSelf: boolean }>;
  expect(admins.find((admin) => admin.email === ADMIN.email)?.isSelf).toBe(true);
  expect(admins.some((admin) => admin.email === email)).toBe(true);

  // Entra por primera vez con ese correo: la cuenta se enlaza y ya es admin.
  const identity = await createFirebaseUser(request, { email });
  const session = await request.post(`${API}/api/auth/session`, {
    headers: identity.headers,
  });
  expect(session.ok(), await session.text()).toBe(true);
  expect((await session.json()).user.role).toBe("admin");
  const tasks = await request.get(`${API}/api/tasks`, {
    headers: identity.headers,
  });
  expect(tasks.ok()).toBe(true);
});

test("guarda el enlace del sitio informativo normalizado y lo publica", async ({
  request,
}) => {
  const headers = await loginAdmin(request);
  const before = (await request
    .get(`${API}/api/site-settings`)
    .then((r) => r.json())) as { infoSiteUrl: string | null };

  const invalid = await request.put(`${API}/api/admin/site-settings`, {
    headers,
    data: { infoSiteUrl: "esto no es un enlace" },
  });
  expect(invalid.status()).toBe(400);

  const saved = await request.put(`${API}/api/admin/site-settings`, {
    headers,
    data: { infoSiteUrl: "sitio-prueba.example.org" },
  });
  expect(await saved.json()).toEqual({
    infoSiteUrl: "https://sitio-prueba.example.org/",
  });
  expect(
    await request.get(`${API}/api/site-settings`).then((r) => r.json()),
  ).toEqual({ infoSiteUrl: "https://sitio-prueba.example.org/" });

  const cleared = await request.put(`${API}/api/admin/site-settings`, {
    headers,
    data: { infoSiteUrl: "" },
  });
  expect(await cleared.json()).toEqual({ infoSiteUrl: null });

  await request.put(`${API}/api/admin/site-settings`, {
    headers,
    data: { infoSiteUrl: before.infoSiteUrl ?? "" },
  });
});

test("la exportación de certificados exige la clave vigente", async ({
  request,
}) => {
  const headers = await loginAdmin(request);

  const first = (await request
    .post(`${API}/api/admin/certificates/key`, { headers })
    .then((r) => r.json())) as { key: string };
  const second = (await request
    .post(`${API}/api/admin/certificates/key`, { headers })
    .then((r) => r.json())) as { key: string };
  expect(second.key).not.toBe(first.key);
  expect(second.key).toMatch(/^[0-9a-f]{48}$/);

  const without = await request.get(`${API}/api/certificates/export`);
  expect(without.status()).toBe(401);
  const stale = await request.get(
    `${API}/api/certificates/export?key=${first.key}`,
  );
  expect(stale.status()).toBe(401);

  const byQuery = await request.get(
    `${API}/api/certificates/export?key=${second.key}`,
  );
  expect(byQuery.ok()).toBe(true);
  expect(byQuery.headers()["cache-control"]).toBe("no-store");
  const exported = await byQuery.json();
  expect(exported.version).toBe(1);
  expect(Array.isArray(exported.certificates)).toBe(true);

  const byHeader = await request.get(`${API}/api/certificates/export`, {
    headers: { authorization: `Bearer ${second.key}` },
  });
  expect(byHeader.ok()).toBe(true);
});

test("el panel del administrador muestra a los administradores y sus ajustes", async ({
  page,
}) => {
  await loginAdminPage(page);
  await page.goto("/admin");
  await expect(page.getByText(ADMIN.email).first()).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Correo del nuevo administrador" }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Enlace al sitio informativo" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Certificados" }),
  ).toBeVisible();
});
