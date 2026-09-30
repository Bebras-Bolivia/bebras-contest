import { test, expect, request } from "@playwright/test";
import {
  API,
  createFirebaseUser,
  loginAdmin,
  loginAdminPage,
  loginPage,
  loginUser,
  registerBebrasProfile,
  VALID_PDF,
  VALID_JPG,
  VALID_PNG,
} from "./support/helpers";

/**
 * Sin colegio del catálogo (a mano o en casa), el registro pide dónde está:
 * departamento y ciudad.
 */
async function chooseLocation(page: import("@playwright/test").Page) {
  await page
    .getByRole("group", { name: "Departamento" })
    .getByRole("button", { name: "Cochabamba" })
    .click();
  await page
    .getByRole("group", { name: "Ciudad" })
    .getByRole("button")
    .first()
    .click();
}

test("rejects documents whose content does not match the extension", async () => {
  const api = await request.newContext();
  const identity = await createFirebaseUser(api, {
    email: `archivo-${Date.now()}@example.com`,
  });
  const response = await api.post(`${API}/api/auth/register`, {
    headers: identity.headers,
    multipart: {
      firstName: "Archivo",
      lastName: "Disfrazado",
      schoolName: "Colegio manual",
      institutionType: "school",
      phone: "70000000",
      letter: {
        name: "carta.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("esto no es un documento PDF"),
      },
    },
  });

  expect(response.status()).toBe(400);
  expect(await response.json()).toEqual(
    expect.objectContaining({
      message: expect.stringContaining("contenido del documento"),
      field: "letter",
    }),
  );
  await api.dispose();
});

test("registers school and homeschool teachers with valid documents", async () => {
  const api = await request.newContext();
  const headers = await loginAdmin(api);
  const schoolEmail = `colegio-${Date.now()}@example.com`;
  const homeschoolEmail = `casa-${Date.now()}@example.com`;

  try {
    const { response: school } = await registerBebrasProfile(api, {
      email: schoolEmail,
      fields: {
        letter: VALID_PDF,
      },
    });
    expect(school.status(), await school.text()).toBe(201);

    const { response: homeschool } = await registerBebrasProfile(api, {
      email: homeschoolEmail,
      institutionType: "homeschool",
      fields: {
        idFront: VALID_JPG,
        idBack: VALID_PNG,
      },
    });
    expect(homeschool.status(), await homeschool.text()).toBe(201);

    const teachersResponse = await api.get(`${API}/api/users/maestros`, {
      headers,
    });
    expect(teachersResponse.ok(), await teachersResponse.text()).toBe(true);
    const teachers = await teachersResponse.json();
    expect(teachers).toContainEqual(
      expect.objectContaining({
        email: schoolEmail,
        institutionType: "school",
        hasLetter: true,
        hasIdFront: false,
        hasIdBack: false,
      }),
    );
    expect(teachers).toContainEqual(
      expect.objectContaining({
        email: homeschoolEmail,
        institutionType: "homeschool",
        hasLetter: false,
        hasIdFront: true,
        hasIdBack: true,
      }),
    );
  } finally {
    await api.dispose();
  }
});

test("rejects unsupported and oversized document uploads cleanly", async () => {
  const api = await request.newContext();

  const assertRejected = async (
    fields: Record<string, string | typeof VALID_PDF>,
    expectedMessage: string,
    expectedField?: string,
  ) => {
    const { response } = await registerBebrasProfile(api, { fields });
    expect(response.status()).toBe(400);
    expect(await response.json()).toEqual(
      expect.objectContaining({
        message: expect.stringContaining(expectedMessage),
        ...(expectedField ? { field: expectedField } : {}),
      }),
    );
  };

  try {
    await assertRejected(
      {
        letter: {
          name: "carta.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("documento"),
        },
      },
      "PDF o una imagen",
      "letter",
    );
    await assertRejected(
      {
        letter: {
          name: "carta.pdf",
          mimeType: "application/pdf",
          buffer: Buffer.alloc(5 * 1024 * 1024 + 1, 0x25),
        },
      },
      "5 MB",
      "letter",
    );
    await assertRejected(
      {
        firstName: "",
        letter: VALID_PDF,
      },
      "Ingresa tus nombres.",
      "firstName",
    );
    await assertRejected(
      {
        letter: VALID_PDF,
        idFront: {
          name: "carnet.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("documento"),
        },
      },
      "PDF o una imagen",
      "idFront",
    );
  } finally {
    await api.dispose();
  }
});

test("separates the manual school from teaching at home", async ({ page }) => {
  await page.goto("/registro");
  await page.waitForFunction(
    () => {
      const island = document.querySelector(
        'astro-island[component-url*="register-form"]',
      );
      return island !== null && !island.hasAttribute("ssr");
    },
    null,
    { timeout: 30000 },
  );

  const manualOption = page.getByRole("button", {
    name: "Mi colegio no está en la lista",
  });
  const homeOption = page.getByRole("button", { name: "Enseño en casa" });
  const departments = page.getByRole("group", { name: "Departamento" });
  // Un bloque plegado queda «inert»: fuera del teclado y del lector de pantalla.
  const isOpen = (locator: typeof departments) =>
    expect
      .poll(() => locator.evaluate((element) => !element.closest("[inert]")));

  await expect(manualOption).toBeVisible();
  await expect(homeOption).toBeVisible();
  // Los documentos ya no se piden al registrarse: se suben desde el perfil.
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  // Con un colegio del catálogo no hace falta decir dónde está.
  await isOpen(departments).toBe(false);

  await manualOption.click();
  const manualName = page.getByPlaceholder("Nombre de tu unidad educativa");
  await expect(manualName).toBeVisible();
  await isOpen(departments).toBe(true);
  await expect(departments.getByRole("button")).toHaveCount(9);
  await manualName.fill("Colegio de Prueba");

  // La ciudad aparece al elegir el departamento, con «Otra» para escribirla.
  const cities = page.getByRole("group", { name: "Ciudad" });
  await isOpen(cities).toBe(false);
  await departments.getByRole("button", { name: "Tarija" }).click();
  await isOpen(cities).toBe(true);
  await cities.getByRole("button", { name: "Otra" }).click();
  await expect(page.getByPlaceholder("Escribe tu ciudad")).toBeFocused();

  await page
    .getByRole("button", { name: "Buscar mi colegio en la lista" })
    .click();
  await expect(manualName).toHaveCount(0);
  await isOpen(departments).toBe(false);

  await homeOption.click();
  await expect(page.getByText("Educación en casa")).toBeVisible();
  await isOpen(departments).toBe(true);
  await page.getByRole("button", { name: "Buscar un colegio" }).click();
  await expect(page.getByText("Educación en casa")).toHaveCount(0);
  await isOpen(departments).toBe(false);
});

test("lets a teacher sign in first and upload the documents later", async () => {
  const api = await request.newContext();
  const email = `luego-${Date.now()}@example.com`;

  const { identity, response: registered } = await registerBebrasProfile(api, {
    email,
    fields: {
      firstName: "Sube",
      lastName: "Después",
      schoolName: "Colegio de Prueba",
      phone: "70000001",
    },
  });
  expect(registered.status(), await registered.text()).toBe(201);
  const created = await registered.json();
  expect(created.pendingDocuments).toBe(true);

  expect(created.user.status).toBe("pending");
  const meWithIdentityToken = await api.get(`${API}/api/auth/me`, {
    headers: identity.headers,
  });
  expect(meWithIdentityToken.ok(), await meWithIdentityToken.text()).toBe(true);

  const session = await loginUser(api, { email, password: "segura123" });
  expect(session.user.status).toBe("pending");
  const headers = session.headers;

  const profile = await api
    .get(`${API}/api/auth/me`, { headers })
    .then((r) => r.json());
  expect(profile.documents.complete).toBe(false);
  expect(profile.documents.missing).toEqual(["letter"]);

  const groups = await api.get(`${API}/api/groups`, { headers });
  expect(groups.status()).toBe(403);

  const wrongDocument = await api.post(`${API}/api/auth/me/documents`, {
    headers,
    multipart: { idFront: VALID_PNG },
  });
  expect(wrongDocument.status()).toBe(400);

  const upload = await api.post(`${API}/api/auth/me/documents`, {
    headers,
    multipart: { letter: VALID_PDF },
  });
  expect(upload.ok(), await upload.text()).toBe(true);
  expect((await upload.json()).documents.complete).toBe(true);

  const updated = await api
    .get(`${API}/api/auth/me`, { headers })
    .then((r) => r.json());
  expect(updated.documents.letter).toBe(true);
  expect(updated.documents.missing).toEqual([]);
  expect(updated.status).toBe("pending");

  const homeEmail = `casa-${Date.now()}@example.com`;
  const { response: homeRegistered } = await registerBebrasProfile(api, {
    email: homeEmail,
    institutionType: "homeschool",
    fields: {
      firstName: "Media",
      lastName: "Carnet",
      schoolName: "Educación en casa",
      phone: "70000002",
      idFront: VALID_JPG,
    },
  });
  expect(homeRegistered.status(), await homeRegistered.text()).toBe(201);

  const homeLogin = await loginUser(api, {
    email: homeEmail,
    password: "segura123",
  });
  const homeProfile = await api
    .get(`${API}/api/auth/me`, {
      headers: homeLogin.headers,
    })
    .then((r) => r.json());
  expect(homeProfile.documents.idFront).toBe(true);
  expect(homeProfile.documents.missing).toEqual(["idBack"]);

  await api.dispose();
});

test("sorts teachers by status and confirms rejecting or suspending", async ({
  page,
}) => {
  const api = await request.newContext();
  const stamp = Date.now();
  const approvedEmail = `aprobado-${stamp}@example.com`;
  const rejectedEmail = `rechazado-${stamp}@example.com`;

  for (const [email, firstName] of [
    [approvedEmail, "Aprobable"],
    [rejectedEmail, "Rechazable"],
  ]) {
    const { response: created } = await registerBebrasProfile(api, {
      email,
      fields: {
        firstName,
        lastName: "Maestro",
        schoolName: "Colegio de Prueba",
        phone: "70000003",
        letter: VALID_PDF,
      },
    });
    expect(created.status(), await created.text()).toBe(201);
  }

  await api.dispose();

  await loginAdminPage(page);
  await page.goto("/maestros");

  const rowFor = (email: string) =>
    page.locator("article").filter({ hasText: email });
  const showAll = async (filter: RegExp, email: string) => {
    await page.getByRole("tab", { name: /Todos los maestros/ }).click();
    await page.getByRole("button", { name: filter }).click();
    await page.getByRole("textbox", { name: "Buscar maestros" }).fill(email);
  };

  // «Por revisar»: cada cuenta nueva con sus documentos, para aprobarla.
  await expect(rowFor(approvedEmail)).toBeVisible({ timeout: 15000 });
  await rowFor(approvedEmail).getByRole("button", { name: "Aprobar" }).click();
  await expect(rowFor(approvedEmail)).toHaveCount(0);

  await showAll(/^Aprobados/, approvedEmail);
  await expect(rowFor(approvedEmail)).toBeVisible();
  await rowFor(approvedEmail)
    .getByRole("button", { name: "Suspender" })
    .click();
  const suspendDialog = page.getByRole("alertdialog");
  await expect(suspendDialog).toContainText("¿Suspender a este maestro?");
  await suspendDialog.getByRole("button", { name: "Suspender" }).click();
  await page.getByRole("button", { name: /^Suspendidos/ }).click();
  await expect(rowFor(approvedEmail)).toBeVisible();

  // Rechazar pide confirmación; cancelar no cambia nada.
  await page.getByRole("tab", { name: /Por revisar/ }).click();
  await rowFor(rejectedEmail)
    .getByRole("button", { name: "Rechazar", exact: true })
    .click();
  const rejectDialog = page.getByRole("alertdialog");
  await expect(rejectDialog).toContainText("¿Rechazar");
  await rejectDialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(rowFor(rejectedEmail)).toBeVisible();

  await rowFor(rejectedEmail)
    .getByRole("button", { name: "Rechazar", exact: true })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Rechazar" })
    .click();
  await expect(rowFor(rejectedEmail)).toHaveCount(0);
  await showAll(/^Rechazados/, rejectedEmail);
  await expect(rowFor(rejectedEmail)).toBeVisible();

  const suspendedApi = await request.newContext();
  const suspendedLogin = await loginUser(suspendedApi, {
    email: approvedEmail,
    password: "segura123",
  });
  const groups = await suspendedApi.get(`${API}/api/groups`, {
    headers: suspendedLogin.headers,
  });
  expect(groups.status()).toBe(403);
  await suspendedApi.dispose();
});

test("asks for another school that the admin approves on its own", async ({
  page,
}) => {
  const api = await request.newContext();
  const email = `dos-colegios-${Date.now()}@example.com`;

  const { identity, response: registered } = await registerBebrasProfile(api, {
    email,
    fields: {
      firstName: "Dos",
      lastName: "Colegios",
      schoolName: "Colegio Principal",
      phone: "70000004",
      letter: VALID_PDF,
    },
  });
  expect(registered.status(), await registered.text()).toBe(201);
  const headers = identity.headers;

  const asked = await api.post(`${API}/api/auth/me/schools`, {
    headers,
    multipart: { schoolName: "Colegio Segundo", letter: VALID_PDF },
  });
  expect(asked.status(), await asked.text()).toBe(201);
  const school = await asked.json();
  expect(school.status).toBe("pending");
  expect(school.hasLetter).toBe(true);

  const repeated = await api.post(`${API}/api/auth/me/schools`, {
    headers,
    multipart: { schoolName: "colegio segundo", letter: VALID_PDF },
  });
  expect(repeated.status()).toBe(409);

  const main = await api.post(`${API}/api/auth/me/schools`, {
    headers,
    multipart: { schoolName: "Colegio Principal" },
  });
  expect(main.status()).toBe(409);

  const profile = await api
    .get(`${API}/api/auth/me`, { headers })
    .then((r) => r.json());
  expect(profile.phone).toBe("+59170000004");
  expect(profile.schoolName).toBe("Colegio Principal");
  expect(profile.schools).toHaveLength(1);
  expect(profile.schools[0].schoolName).toBe("Colegio Segundo");

  const adminHeaders = await loginAdmin(api);
  const listed = await api
    .get(`${API}/api/users/maestros`, { headers: adminHeaders })
    .then((r) => r.json());
  const listedTeacher = listed.find(
    (item: { email: string }) => item.email === email,
  );
  expect(listedTeacher.schools).toHaveLength(1);
  expect(listedTeacher.status).toBe("pending");

  const approvedSchool = await api.post(
    `${API}/api/users/schools/${school.id}/approve`,
    { headers: adminHeaders },
  );
  expect(approvedSchool.ok(), await approvedSchool.text()).toBe(true);
  expect((await approvedSchool.json()).status).toBe("approved");

  const removal = await api.delete(`${API}/api/auth/me/schools/${school.id}`, {
    headers,
  });
  expect(removal.status()).toBe(409);

  await api.dispose();

  await loginPage(page, { email, password: "segura123" }, /\/perfil\/?$/);

  await expect(page.getByText(email).first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("7000 0004").first()).toBeVisible();
  await expect(page.getByText("Colegio Principal").first()).toBeVisible();
  await expect(page.getByText("Colegio Segundo").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Administrar otro colegio" }),
  ).toBeVisible();
});

test("builds the authorization letter as a PDF", async () => {
  const api = await request.newContext();
  const response = await api.post(`${API}/api/letter/pdf`, {
    data: {
      ciudad: "Cochabamba",
      dia: "31",
      mes: "agosto",
      anio: "2026",
      colegio: "AMERICA",
      maestro: "Jorge Eduardo Rojas",
      ci: "8765432 CB",
      director: "Rosa Chávez Antezana",
      colegioFirma: "AMERICA",
    },
  });

  expect(response.ok(), await response.text()).toBe(true);
  expect(response.headers()["content-type"]).toContain("application/pdf");
  expect(response.headers()["content-disposition"]).toContain("attachment");

  const body = await response.body();
  expect(body.subarray(0, 4).toString()).toBe("%PDF");
  expect(body.byteLength).toBeGreaterThan(1000);

  await api.dispose();
});

test("enables group navigation after the teacher is approved", async ({
  page,
}) => {
  const api = await request.newContext();
  const email = `panel-${Date.now()}@example.com`;
  const { response: registered } = await registerBebrasProfile(api, {
    email,
    fields: {
      firstName: "Sin",
      lastName: "Aprobar",
      schoolName: "Colegio de Prueba",
      phone: "70000005",
      letter: VALID_PDF,
    },
  });
  expect(registered.status(), await registered.text()).toBe(201);

  await loginPage(page, { email, password: "segura123" }, /\/perfil\/?$/);
  await expect(
    page.getByRole("heading", { name: "Mis colegios", exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("link", { name: "Grupos" })).toBeHidden();
  // Sin aprobar, «Mis grupos» está bloqueada: no es un enlace.
  await expect(page.getByText("Mis grupos").first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Mis grupos/ })).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Práctica", exact: true }),
  ).toBeVisible();

  const adminHeaders = await loginAdmin(api);
  const listed = await api
    .get(`${API}/api/users/maestros`, { headers: adminHeaders })
    .then((r) => r.json());
  const stored = listed.find((item: { email: string }) => item.email === email);
  await api.post(`${API}/api/users/${stored.id}/approve`, {
    headers: adminHeaders,
  });
  await api.dispose();

  await page.reload();
  const groupsLink = page.getByRole("link", { name: /Mis grupos/ });
  await expect(groupsLink).toBeVisible({ timeout: 15000 });
  await groupsLink.click();
  await expect(page).toHaveURL(/\/grupos$/);
  await expect(page.getByRole("link", { name: "Grupos" })).toBeVisible({
    timeout: 15000,
  });
});
