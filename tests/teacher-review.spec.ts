import { test, expect } from "@playwright/test";
import {
  API,
  VALID_PDF,
  createApprovedTeacher,
  loginAdmin,
  loginAdminPage,
  loginPage,
  loginUser,
  registerBebrasProfile,
} from "./support/helpers";

const LOCATION = { department: "LA PAZ", city: "El Alto" };

async function maestroByEmail(
  request: Parameters<typeof loginAdmin>[0],
  headers: Record<string, string>,
  email: string,
) {
  const maestros = (await request
    .get(`${API}/api/users/maestros`, { headers })
    .then((r) => r.json())) as Array<{
    id: number;
    email: string;
    status: string;
    name: string;
    phone: string;
    place: string | null;
    schools: Array<{ id: string; status: string }>;
  }>;
  return maestros.find((maestro) => maestro.email === email)!;
}

test("una cuenta nueva espera en «Por revisar» y se aprueba desde la bandeja", async ({
  page,
  request,
}) => {
  const headers = await loginAdmin(request);
  const { identity, response } = await registerBebrasProfile(request, {
    fields: { letter: VALID_PDF, ...LOCATION, firstName: "Revisión" },
  });
  expect(response.status(), await response.text()).toBe(201);

  const pending = await maestroByEmail(request, headers, identity.email);
  expect(pending.status).toBe("pending");
  expect(pending.place).toBe("El Alto, La Paz");

  // Pendiente, no puede armar grupos.
  const session = await loginUser(request, identity);
  const blocked = await request.get(`${API}/api/groups`, {
    headers: session.headers,
  });
  expect(blocked.status()).toBe(403);

  await loginAdminPage(page);
  await page.goto("/maestros");
  await expect(page.getByRole("tab", { name: /Por revisar/ })).toBeVisible();
  const card = page
    .getByText(identity.email)
    .first()
    .locator("xpath=ancestor::*[.//button[normalize-space()='Aprobar']][1]");
  await card.getByRole("button", { name: "Aprobar" }).click();
  await expect(page.getByText(identity.email)).toHaveCount(0, {
    timeout: 15000,
  });

  const approved = await maestroByEmail(request, headers, identity.email);
  expect(approved.status).toBe("approved");
  const allowed = await request.get(`${API}/api/groups`, {
    headers: session.headers,
  });
  expect(allowed.ok()).toBe(true);
});

test("otro colegio se revisa aparte aunque la cuenta ya esté aprobada", async ({
  request,
}) => {
  const headers = await loginAdmin(request);
  const teacher = await createApprovedTeacher(request, headers);

  const school = await request.post(`${API}/api/auth/me/schools`, {
    headers: teacher.headers,
    multipart: { schoolName: "Unidad Educativa Segunda", letter: VALID_PDF },
  });
  expect(school.status(), await school.text()).toBe(201);
  const { id } = await school.json();

  const listed = await maestroByEmail(request, headers, teacher.identity.email);
  expect(listed.status).toBe("approved");
  expect(listed.schools.find((item) => item.id === id)?.status).toBe("pending");

  const letter = await request.get(`${API}/api/users/schools/${id}/letter`, {
    headers,
  });
  expect(letter.ok()).toBe(true);

  const decided = await request.post(
    `${API}/api/users/schools/${id}/approve`,
    { headers },
  );
  expect((await decided.json()).status).toBe("approved");

  // Una carta aprobada ya no se reemplaza ni se borra desde el perfil.
  const replace = await request.post(
    `${API}/api/auth/me/schools/${id}/letter`,
    { headers: teacher.headers, multipart: { letter: VALID_PDF } },
  );
  expect(replace.status()).toBe(409);
  const remove = await request.delete(`${API}/api/auth/me/schools/${id}`, {
    headers: teacher.headers,
  });
  expect(remove.status()).toBe(409);
});

test("el administrador corrige los datos de un maestro con las mismas reglas del registro", async ({
  request,
}) => {
  const headers = await loginAdmin(request);
  const teacher = await createApprovedTeacher(request, headers);
  const base = {
    firstName: "maría  josé",
    lastName: "quispe mamani",
    phone: "71234567",
    institutionType: "school",
    schoolName: "Colegio Corregido",
    ...LOCATION,
  };

  const badPhone = await request.put(`${API}/api/users/${teacher.id}`, {
    headers,
    data: { ...base, phone: "123" },
  });
  expect(badPhone.status()).toBe(400);
  expect((await badPhone.json()).field).toBe("phone");

  const unknownSchool = await request.put(`${API}/api/users/${teacher.id}`, {
    headers,
    data: { ...base, schoolCodUe: "00000000" },
  });
  expect(unknownSchool.status()).toBe(400);

  const saved = await request.put(`${API}/api/users/${teacher.id}`, {
    headers,
    data: base,
  });
  expect(saved.ok(), await saved.text()).toBe(true);
  const maestro = await saved.json();
  expect(maestro.name).toBe("María José Quispe Mamani");
  expect(maestro.phone).toBe("+59171234567");
  expect(maestro.place).toBe("El Alto, La Paz");

  const notATeacher = await request.put(`${API}/api/users/999999`, {
    headers,
    data: base,
  });
  expect(notATeacher.status()).toBe(404);
});

test("cada maestro ve sus propios documentos y nadie más que el administrador", async ({
  request,
}) => {
  const headers = await loginAdmin(request);
  const owner = await createApprovedTeacher(request, headers);
  const other = await createApprovedTeacher(request, headers);

  const mine = await request.get(`${API}/api/auth/me/documents/letter`, {
    headers: owner.headers,
  });
  expect(mine.ok()).toBe(true);
  expect(mine.headers()["content-type"]).toBe("application/pdf");
  expect(mine.headers()["cache-control"]).toContain("no-store");

  const missing = await request.get(`${API}/api/auth/me/documents/idFront`, {
    headers: owner.headers,
  });
  expect(missing.status()).toBe(404);

  const foreign = await request.get(
    `${API}/api/users/${owner.id}/documents/letter`,
    { headers: other.headers },
  );
  expect(foreign.status()).toBe(403);

  const byAdmin = await request.get(
    `${API}/api/users/${owner.id}/documents/letter`,
    { headers },
  );
  expect(byAdmin.ok()).toBe(true);
});

test("una cuenta suspendida no arma grupos y una rechazada no entra", async ({
  request,
}) => {
  const headers = await loginAdmin(request);
  const suspended = await createApprovedTeacher(request, headers);
  await request.post(`${API}/api/users/${suspended.id}/suspend`, { headers });
  const groups = await request.get(`${API}/api/groups`, {
    headers: suspended.headers,
  });
  expect(groups.status()).toBe(403);

  const rejected = await createApprovedTeacher(request, headers);
  await request.post(`${API}/api/users/${rejected.id}/reject`, { headers });
  const session = await request.post(`${API}/api/auth/session`, {
    headers: rejected.headers,
  });
  expect(session.status()).toBe(403);
  expect((await session.json()).code).toBe("ACCOUNT_REJECTED");
});

test("el buscador de colegios usa el catálogo y filtra por departamento", async ({
  request,
}) => {
  const short = await request.get(`${API}/api/schools?q=s`).then((r) => r.json());
  expect(short).toEqual([]);

  const found = (await request
    .get(`${API}/api/schools?q=SAN&dep=${encodeURIComponent("LA PAZ")}`)
    .then((r) => r.json())) as Array<{ codUe: string; name: string; dep: string }>;
  expect(found.length).toBeGreaterThan(0);
  expect(found.length).toBeLessThanOrEqual(20);
  expect(found.every((school) => school.dep === "LA PAZ")).toBe(true);
  expect(found.every((school) => school.name.includes("SAN"))).toBe(true);
});

test("el perfil del maestro muestra su estado, sus datos y sus documentos", async ({
  page,
  request,
}) => {
  const headers = await loginAdmin(request);
  const teacher = await createApprovedTeacher(request, headers, {
    firstName: "Perfil",
    lastName: "Visible",
    ...LOCATION,
  });

  const me = await request
    .get(`${API}/api/auth/me`, { headers: teacher.headers })
    .then((r) => r.json());
  expect(me).toMatchObject({
    status: "approved",
    name: "Perfil Visible",
    place: "El Alto, La Paz",
    departmentSlug: "la-paz",
  });
  expect(me.documents).toMatchObject({ letter: true, complete: true });

  await loginPage(page, teacher.identity, /\/perfil\/?$/);
  await expect(page.getByText("Perfil Visible").first()).toBeVisible();
  await expect(page.getByText(/Verificada/).first()).toBeVisible();
  await expect(page.getByText("El Alto, La Paz").first()).toBeVisible();
  await expect(page.getByText("Mis grupos").first()).toBeVisible();
});

test("aprobar, rechazar y suspender solo cambian cuentas de maestro", async ({
  request,
}) => {
  const headers = await loginAdmin(request);
  const admin = await request
    .get(`${API}/api/auth/me`, { headers })
    .then((r) => r.json());

  for (const decision of ["approve", "reject", "suspend"]) {
    const onAdmin = await request.post(`${API}/api/users/${admin.id}/${decision}`, {
      headers,
    });
    expect(onAdmin.status(), decision).toBe(404);
    const missing = await request.post(`${API}/api/users/999999/${decision}`, {
      headers,
    });
    expect(missing.status(), decision).toBe(404);
  }
  const stillAdmin = await request
    .get(`${API}/api/auth/me`, { headers })
    .then((r) => r.json());
  expect(stillAdmin.role).toBe("admin");

  const teacher = await createApprovedTeacher(request, headers);
  const suspended = await request.post(`${API}/api/users/${teacher.id}/suspend`, {
    headers,
  });
  expect(await suspended.json()).toEqual({ id: teacher.id, status: "suspended" });
  const approved = await request.post(`${API}/api/users/${teacher.id}/approve`, {
    headers,
  });
  expect(await approved.json()).toEqual({ id: teacher.id, status: "approved" });
});

test("el registro y otro colegio solo aceptan códigos del catálogo", async ({
  request,
}) => {
  const unknown = await registerBebrasProfile(request, {
    fields: { schoolCodUe: "00000000", schoolName: "Colegio inventado" },
  });
  expect(unknown.response.status()).toBe(400);
  expect((await unknown.response.json()).message).toContain("catálogo");

  const [school] = (await request
    .get(`${API}/api/schools?q=SAN&dep=${encodeURIComponent("LA PAZ")}`)
    .then((r) => r.json())) as Array<{ codUe: string; name: string }>;
  const listed = await registerBebrasProfile(request, {
    fields: { schoolCodUe: school.codUe, schoolName: "Nombre que manda el navegador" },
  });
  expect(listed.response.status(), await listed.response.text()).toBe(201);
  // Se guarda el nombre del catálogo, no el que llega en la petición.
  const me = await request
    .get(`${API}/api/auth/me`, { headers: listed.identity.headers })
    .then((r) => r.json());
  expect(me.schoolName).toBe(school.name);

  const extra = await request.post(`${API}/api/auth/me/schools`, {
    headers: listed.identity.headers,
    multipart: { schoolCodUe: "00000000", schoolName: "Otro inventado" },
  });
  expect(extra.status()).toBe(400);
});
