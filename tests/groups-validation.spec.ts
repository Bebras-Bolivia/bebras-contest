import { expect, request, test } from "@playwright/test";
import ExcelJS from "exceljs";

import {
  API,
  createContest,
  loginAdmin,
  loginAdminPage,
} from "./support/helpers";

test("returns structured fields for group creation errors", async () => {
  const api = await request.newContext();
  const headers = await loginAdmin(api);
  const contest = await createContest(api, headers);

  const missingName = await api.post(`${API}/api/groups`, {
    headers,
    data: { contestId: contest.id, name: "" },
  });
  expect(missingName.status()).toBe(400);
  expect(await missingName.json()).toEqual({
    message: "El nombre del grupo es obligatorio.",
    code: "GROUP_NAME_REQUIRED",
    field: "name",
  });

  const missingContest = await api.post(`${API}/api/groups`, {
    headers,
    data: { contestId: "missing-contest", name: "Grupo válido" },
  });
  expect(missingContest.status()).toBe(400);
  expect(await missingContest.json()).toEqual({
    message: "El desafío no existe.",
    code: "GROUP_CONTEST_NOT_FOUND",
    field: "contestId",
  });

  await api.dispose();
});

test("creates groups that inherit the contest schedule", async ({ page }) => {
  const api = await request.newContext();
  const headers = await loginAdmin(api);
  const contest = await createContest(api, headers, {
    title: `Desafío con calendario heredado ${Date.now()}`,
  });

  await loginAdminPage(page);
  await page.goto("/grupos");
  await page.getByRole("button", { name: "Nuevo grupo" }).click();
  const dialog = page.getByRole("dialog", { name: "Nuevo grupo" });
  await dialog.getByRole("radio", { name: new RegExp(contest.title) }).click();
  await dialog.getByLabel("Nombre del grupo").fill("Grupo con calendario heredado");
  const createRequest = page.waitForRequest(
    (request) =>
      request.url() === `${API}/api/groups` && request.method() === "POST",
  );
  await dialog.getByRole("button", { name: "Crear grupo" }).click();
  expect((await createRequest).postDataJSON()).toEqual({
    contestId: contest.id,
    category: contest.categories[0],
    name: "Grupo con calendario heredado",
  });

  // Crear lleva directo a la pantalla del grupo, lista para inscribir.
  await expect(page).toHaveURL(/\/grupos\/ver\?id=.+&vista=estudiantes/);
  await expect(
    page.getByRole("heading", { name: "Grupo con calendario heredado" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Inscribir" })).toBeVisible();

  const groups = await api
    .get(`${API}/api/groups`, { headers })
    .then((response) => response.json());
  const stored = groups.find(
    (group: { name: string }) => group.name === "Grupo con calendario heredado",
  );
  expect(stored).not.toHaveProperty("scheduledAt");

  const publicGroup = await api
    .get(`${API}/api/play/group/${stored.accessCode}`)
    .then((response) => response.json());
  expect(publicGroup).toMatchObject({
    registrationStartsAt: contest.registrationStartsAt,
    registrationEndsAt: contest.registrationEndsAt,
    category: contest.categories[0],
    state: "inscripcion",
  });

  await api.dispose();
});


test("returns structured fields for manual enrollment errors", async () => {
  const api = await request.newContext();
  const headers = await loginAdmin(api);
  const contest = await createContest(api, headers, { allowPairs: true });
  const groupResponse = await api.post(`${API}/api/groups`, {
    headers,
    data: { contestId: contest.id, name: "Grupo contrato inscripción" },
  });
  expect(groupResponse.ok(), await groupResponse.text()).toBe(true);
  const group = (await groupResponse.json()) as { id: string };
  const endpoint = `${API}/api/groups/${group.id}/teams`;

  const missingFirstMember = await api.post(endpoint, {
    headers,
    data: { participationMode: "individual", grade: "P3" },
  });
  expect(missingFirstMember.status()).toBe(400);
  expect(await missingFirstMember.json()).toEqual({
    message: "Los nombres y apellidos son obligatorios.",
    code: "TEAM_MEMBER_ONE_REQUIRED",
    fields: ["memberOneFirstName", "memberOneLastName"],
  });

  const missingSecondMember = await api.post(endpoint, {
    headers,
    data: {
      participationMode: "pareja",
      grade: "P3",
      memberOneFirstName: "Ana",
      memberOneLastName: "Pérez",
    },
  });
  expect(missingSecondMember.status()).toBe(400);
  expect(await missingSecondMember.json()).toEqual({
    message: "Faltan los nombres y apellidos del segundo integrante.",
    code: "TEAM_MEMBER_TWO_REQUIRED",
    fields: ["memberTwoFirstName", "memberTwoLastName"],
  });

  const invalidGrade = await api.post(endpoint, {
    headers,
    data: {
      participationMode: "individual",
      grade: "S6",
      memberOneFirstName: "Ana",
      memberOneLastName: "Pérez",
    },
  });
  expect(invalidGrade.status()).toBe(400);
  expect(await invalidGrade.json()).toMatchObject({
    code: "TEAM_GRADE_INVALID",
    field: "grade",
  });

  const identicalMembers = await api.post(endpoint, {
    headers,
    data: {
      participationMode: "pareja",
      grade: "P3",
      memberOneFirstName: "Ána",
      memberOneLastName: "Pérez",
      memberTwoFirstName: "ana",
      memberTwoLastName: "perez",
    },
  });
  expect(identicalMembers.status()).toBe(400);
  expect(await identicalMembers.json()).toEqual({
    message: "Los dos integrantes no pueden ser la misma persona.",
    code: "TEAM_MEMBERS_IDENTICAL",
    fields: ["memberTwoFirstName", "memberTwoLastName"],
  });

  const created = await api.post(endpoint, {
    headers,
    data: {
      participationMode: "individual",
      grade: "P3",
      memberOneFirstName: "Ana",
      memberOneLastName: "Pérez",
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const duplicate = await api.post(endpoint, {
    headers,
    data: {
      participationMode: "individual",
      grade: "P3",
      memberOneFirstName: "ana",
      memberOneLastName: "perez",
    },
  });
  expect(duplicate.status()).toBe(409);
  expect(await duplicate.json()).toEqual({
    message: "Ana Perez ya está en este grupo.",
    code: "TEAM_MEMBER_DUPLICATE",
    fields: ["memberOneFirstName", "memberOneLastName"],
  });

  await api.dispose();
});

test("validates manual enrollment and recovers from a duplicate", async ({
  page,
}) => {
  const api = await request.newContext();
  const headers = await loginAdmin(api);
  const contest = await createContest(api, headers, {
    title: "Desafío inscripción manual",
    allowPairs: true,
  });
  const groupResponse = await api.post(`${API}/api/groups`, {
    headers,
    data: { contestId: contest.id, name: "Grupo inscripción accesible" },
  });
  expect(groupResponse.ok(), await groupResponse.text()).toBe(true);
  const group = (await groupResponse.json()) as { id: string };
  const endpoint = `${API}/api/groups/${group.id}/teams`;
  const existing = await api.post(endpoint, {
    headers,
    data: {
      participationMode: "individual",
      grade: "P3",
      memberOneFirstName: "Ana",
      memberOneLastName: "Pérez",
    },
  });
  expect(existing.ok(), await existing.text()).toBe(true);
  let releaseEnrollment: (() => void) | undefined;
  const enrollmentGate = new Promise<void>((resolve) => {
    releaseEnrollment = resolve;
  });
  let holdNextEnrollment = false;
  await page.route(endpoint, async (route) => {
    if (route.request().method() === "POST" && holdNextEnrollment) {
      holdNextEnrollment = false;
      const response = await route.fetch();
      await enrollmentGate;
      await route.fulfill({ response });
      return;
    }
    await route.continue();
  });

  await loginAdminPage(page);
  await page.goto(`/grupos/ver?id=${group.id}&vista=estudiantes`);
  const form = page
    .locator("form")
    .filter({ has: page.getByRole("button", { name: "Inscribir" }) });
  const firstName = form.getByRole("textbox", { name: "Nombres", exact: true });
  const lastName = form.getByRole("textbox", { name: "Apellidos", exact: true });
  const grades = form.getByRole("radiogroup", { name: "Curso" });
  const submit = form.getByRole("button", { name: "Inscribir" });
  const alert = form.getByRole("alert");

  // Vacío: marca los campos y lleva el foco al primero.
  await submit.click();
  await expect(alert).toHaveText("Faltan los nombres.");
  await expect(firstName).toHaveAttribute("aria-invalid", "true");
  await expect(lastName).toHaveAttribute("aria-invalid", "true");
  await expect(grades).toHaveAttribute("aria-invalid", "true");
  await expect(firstName).toBeFocused();

  await firstName.fill("Ana");
  await lastName.fill("Pérez");
  await expect(firstName).toHaveAttribute("aria-invalid", "false");
  await submit.click();
  await expect(alert).toHaveText("Elige el curso.");
  await expect(grades.getByRole("radio").first()).toBeFocused();
  await grades.getByRole("radio", { name: "3.º de primaria" }).click();
  await expect(grades).toHaveAttribute("aria-invalid", "false");

  // En pareja aparecen los datos del segundo, cada campo con su nombre.
  await form.getByRole("radio", { name: "En pareja" }).click();
  const pairFirst = form.getByRole("textbox", { name: "Nombres del primero" });
  const pairLast = form.getByRole("textbox", { name: "Apellidos del primero" });
  const secondFirst = form.getByRole("textbox", { name: "Nombres del segundo" });
  const secondLast = form.getByRole("textbox", { name: "Apellidos del segundo" });
  await expect(pairFirst).toHaveValue("Ana");
  await submit.click();
  await expect(secondFirst).toHaveAttribute("aria-invalid", "true");
  await expect(secondLast).toHaveAttribute("aria-invalid", "true");
  await expect(secondFirst).toBeFocused();

  // El servidor rechaza a la misma persona dos veces y lo dice en su campo.
  await secondFirst.fill("ana");
  await secondLast.fill("perez");
  await submit.click();
  await expect(alert).toHaveText(
    "Los dos integrantes no pueden ser la misma persona.",
  );
  await expect(secondFirst).toBeFocused();
  await secondFirst.fill("Luis");
  await secondLast.fill("Gómez");
  await expect(alert).toHaveCount(0);

  // Mientras guarda, el formulario queda bloqueado.
  holdNextEnrollment = true;
  await submit.click();
  await expect(submit).toBeDisabled();
  await expect(pairFirst).toBeDisabled();
  await expect(grades.getByRole("radio").first()).toBeDisabled();
  releaseEnrollment?.();

  // Ana Pérez ya está en el grupo: el error va al campo y se corrige ahí.
  await expect(alert).toHaveText("Ana Pérez ya está en este grupo.");
  await expect(pairFirst).toBeFocused();
  await pairFirst.fill("Marta");
  await pairLast.fill("Rojas");
  const recovery = page.waitForResponse(
    (response) =>
      response.url() === endpoint &&
      response.request().method() === "POST" &&
      response.status() === 201,
  );
  await pairLast.press("Enter");
  await recovery;

  await expect(
    page.locator("[data-sonner-toast]").filter({
      hasText: "Marta Rojas y Luis Gómez quedó inscrito.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("listitem").filter({ hasText: "Marta Rojas y Luis Gómez" }),
  ).toBeVisible();
  // Queda listo para el siguiente: mismo curso y modalidad, nombres vacíos.
  await expect(pairFirst).toHaveValue("");
  await expect(pairFirst).toBeFocused();
  await expect(
    grades.getByRole("radio", { name: "3.º de primaria" }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(form.getByRole("radio", { name: "En pareja" })).toHaveAttribute(
    "aria-checked",
    "true",
  );

  await api.dispose();
});


test("returns structured fields for participant editing errors", async () => {
  const api = await request.newContext();
  const headers = await loginAdmin(api);
  const contest = await createContest(api, headers, { allowPairs: true });
  const groupResponse = await api.post(`${API}/api/groups`, {
    headers,
    data: { contestId: contest.id, name: "Grupo contrato edición" },
  });
  expect(groupResponse.ok(), await groupResponse.text()).toBe(true);
  const group = (await groupResponse.json()) as { id: string };
  const enrollmentEndpoint = `${API}/api/groups/${group.id}/teams`;
  const targetResponse = await api.post(enrollmentEndpoint, {
    headers,
    data: {
      participationMode: "pareja",
      grade: "P3",
      memberOneFirstName: "Laura",
      memberOneLastName: "Núñez",
      memberTwoFirstName: "Mario",
      memberTwoLastName: "Soto",
    },
  });
  expect(targetResponse.ok(), await targetResponse.text()).toBe(true);
  const target = (await targetResponse.json()) as { id: string };
  const existingResponse = await api.post(enrollmentEndpoint, {
    headers,
    data: {
      participationMode: "individual",
      grade: "P3",
      memberOneFirstName: "Ana",
      memberOneLastName: "Pérez",
    },
  });
  expect(existingResponse.ok(), await existingResponse.text()).toBe(true);
  const endpoint = `${API}/api/teams/${target.id}`;

  const missingFirstMember = await api.put(endpoint, {
    headers,
    data: { grade: "P3" },
  });
  expect(missingFirstMember.status()).toBe(400);
  expect(await missingFirstMember.json()).toEqual({
    message: "Los nombres y apellidos son obligatorios.",
    code: "TEAM_MEMBER_ONE_REQUIRED",
    fields: ["memberOneFirstName", "memberOneLastName"],
  });

  const missingSecondMember = await api.put(endpoint, {
    headers,
    data: {
      grade: "P3",
      memberOneFirstName: "Laura",
      memberOneLastName: "Núñez",
    },
  });
  expect(missingSecondMember.status()).toBe(400);
  expect(await missingSecondMember.json()).toEqual({
    message: "Faltan los nombres y apellidos del segundo integrante.",
    code: "TEAM_MEMBER_TWO_REQUIRED",
    fields: ["memberTwoFirstName", "memberTwoLastName"],
  });

  const invalidGrade = await api.put(endpoint, {
    headers,
    data: {
      grade: "S6",
      memberOneFirstName: "Laura",
      memberOneLastName: "Núñez",
      memberTwoFirstName: "Mario",
      memberTwoLastName: "Soto",
    },
  });
  expect(invalidGrade.status()).toBe(400);
  expect(await invalidGrade.json()).toMatchObject({
    code: "TEAM_GRADE_INVALID",
    field: "grade",
  });

  const identicalMembers = await api.put(endpoint, {
    headers,
    data: {
      grade: "P3",
      memberOneFirstName: "Ána",
      memberOneLastName: "Pérez",
      memberTwoFirstName: "ana",
      memberTwoLastName: "perez",
    },
  });
  expect(identicalMembers.status()).toBe(400);
  expect(await identicalMembers.json()).toEqual({
    message: "Los dos integrantes no pueden ser la misma persona.",
    code: "TEAM_MEMBERS_IDENTICAL",
    fields: ["memberTwoFirstName", "memberTwoLastName"],
  });

  const duplicate = await api.put(endpoint, {
    headers,
    data: {
      grade: "P3",
      memberOneFirstName: "ana",
      memberOneLastName: "perez",
      memberTwoFirstName: "Mario",
      memberTwoLastName: "Soto",
    },
  });
  expect(duplicate.status()).toBe(409);
  expect(await duplicate.json()).toEqual({
    message: "Ana Perez ya está en este grupo.",
    code: "TEAM_MEMBER_DUPLICATE",
    fields: ["memberOneFirstName", "memberOneLastName"],
  });

  await api.dispose();
});

test("validates participant editing and recovers from a duplicate", async ({
  page,
}) => {
  const api = await request.newContext();
  const headers = await loginAdmin(api);
  const contest = await createContest(api, headers, {
    title: "Desafío edición manual",
    allowPairs: true,
  });
  const groupResponse = await api.post(`${API}/api/groups`, {
    headers,
    data: { contestId: contest.id, name: "Grupo edición accesible" },
  });
  expect(groupResponse.ok(), await groupResponse.text()).toBe(true);
  const group = (await groupResponse.json()) as { id: string };
  const enrollmentEndpoint = `${API}/api/groups/${group.id}/teams`;
  const existingResponse = await api.post(enrollmentEndpoint, {
    headers,
    data: {
      participationMode: "individual",
      grade: "P3",
      memberOneFirstName: "Ana",
      memberOneLastName: "Pérez",
    },
  });
  expect(existingResponse.ok(), await existingResponse.text()).toBe(true);
  const targetResponse = await api.post(enrollmentEndpoint, {
    headers,
    data: {
      participationMode: "pareja",
      grade: "P3",
      memberOneFirstName: "Laura",
      memberOneLastName: "Núñez",
      memberTwoFirstName: "Mario",
      memberTwoLastName: "Soto",
    },
  });
  expect(targetResponse.ok(), await targetResponse.text()).toBe(true);
  const target = (await targetResponse.json()) as { id: string };
  const updateEndpoint = `${API}/api/teams/${target.id}`;
  let releaseUpdate: (() => void) | undefined;
  const updateGate = new Promise<void>((resolve) => {
    releaseUpdate = resolve;
  });
  let holdNextUpdate = false;
  await page.route(updateEndpoint, async (route) => {
    if (route.request().method() === "PUT" && holdNextUpdate) {
      holdNextUpdate = false;
      const response = await route.fetch();
      await updateGate;
      await route.fulfill({ response });
      return;
    }
    await route.continue();
  });

  await loginAdminPage(page);
  await page.goto(`/grupos/ver?id=${group.id}&vista=estudiantes`);
  await page
    .getByRole("button", { name: "Editar a Laura Núñez y Mario Soto" })
    .click();

  const form = page
    .locator("form")
    .filter({ has: page.getByRole("button", { name: "Guardar" }) });
  const firstName = form.getByRole("textbox", { name: "Nombres del primero" });
  const lastName = form.getByRole("textbox", { name: "Apellidos del primero" });
  const secondFirst = form.getByRole("textbox", { name: "Nombres del segundo" });
  const secondLast = form.getByRole("textbox", { name: "Apellidos del segundo" });
  const submit = form.getByRole("button", { name: "Guardar" });
  const alert = form.getByRole("alert");
  await expect(firstName).toHaveValue("Laura");
  await expect(secondLast).toHaveValue("Soto");

  for (const field of [firstName, lastName, secondFirst, secondLast]) {
    await field.fill("");
  }
  await submit.click();
  await expect(alert).toHaveText("Faltan los nombres.");
  for (const field of [firstName, lastName, secondFirst, secondLast]) {
    await expect(field).toHaveAttribute("aria-invalid", "true");
  }
  await expect(firstName).toBeFocused();

  await firstName.fill("Ana");
  await lastName.fill("Pérez");
  await secondFirst.fill("ana");
  await secondLast.fill("perez");
  await submit.click();
  await expect(alert).toHaveText(
    "Los dos integrantes no pueden ser la misma persona.",
  );
  await expect(secondFirst).toBeFocused();
  await secondFirst.fill("Mario");
  await secondLast.fill("Soto");
  await expect(alert).toHaveCount(0);

  holdNextUpdate = true;
  await submit.click();
  await expect(submit).toBeDisabled();
  await expect(firstName).toBeDisabled();
  await expect(form.getByRole("button", { name: "Cancelar" })).toBeDisabled();
  releaseUpdate?.();

  await expect(alert).toHaveText("Ana Pérez ya está en este grupo.");
  await expect(firstName).toBeFocused();
  await firstName.fill("Marta");
  await lastName.fill("Rojas");
  await secondLast.press("Enter");

  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: "Datos guardados." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Editar a Marta Rojas y Mario Soto" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Guardar" })).toHaveCount(0);

  await api.dispose();
});


test("validates the roster upload transport contract", async () => {
  const api = await request.newContext();
  const headers = await loginAdmin(api);
  const contest = await createContest(api, headers);
  const groupResponse = await api.post(`${API}/api/groups`, {
    headers,
    data: { contestId: contest.id, name: "Grupo contrato planilla" },
  });
  expect(groupResponse.ok(), await groupResponse.text()).toBe(true);
  const group = (await groupResponse.json()) as { id: string };
  const endpoint = `${API}/api/groups/${group.id}/roster`;

  const missing = await api.post(endpoint, { headers });
  expect(missing.status()).toBe(400);
  expect(await missing.json()).toEqual({ message: "Adjunta la planilla." });

  const unsupported = await api.post(endpoint, {
    headers,
    multipart: {
      file: {
        name: "participantes.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("contenido", "utf8"),
      },
    },
  });
  expect(unsupported.status()).toBe(400);
  expect(await unsupported.json()).toEqual({
    message: "La planilla debe ser un archivo XLSX o CSV.",
  });

  const oversized = await api.post(endpoint, {
    headers,
    multipart: {
      file: {
        name: "participantes.csv",
        mimeType: "text/csv",
        buffer: Buffer.alloc(2 * 1024 * 1024 + 1, "a"),
      },
    },
  });
  expect(oversized.status()).toBe(400);
  expect(await oversized.json()).toEqual({
    message: "La planilla no debe superar los 2 MB.",
  });

  const corrupt = await api.post(endpoint, {
    headers,
    multipart: {
      file: {
        name: "participantes.xlsx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: Buffer.from("no es un xlsx", "utf8"),
      },
    },
  });
  expect(corrupt.status()).toBe(400);
  expect(await corrupt.json()).toEqual({
    message: "No pudimos leer la planilla. Usa la plantilla del desafío.",
  });

  const allSkipped = await api.post(endpoint, {
    headers,
    multipart: {
      file: {
        name: "participantes.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(
          [
            "Nombres,Apellidos,Curso,Modalidad",
            `Sin,,${contest.picked.grade},individual`,
          ].join("\n"),
          "utf8",
        ),
      },
    },
  });
  expect(allSkipped.status()).toBe(422);
  expect(await allSkipped.json()).toEqual({
    message: "No se importó ningún participante. Corrige las filas indicadas.",
    code: "ROSTER_VALIDATION_FAILED",
    details: [
      {
        row: 2,
        name: "Sin",
        reason: "Faltan nombres o apellidos.",
      },
    ],
  });

  await api.dispose();
});

test("validates complete rosters before writing any participant", async () => {
  const api = await request.newContext();
  const headers = await loginAdmin(api);
  const contest = await createContest(api, headers, { allowPairs: true });
  const sourceGroup = await api
    .post(`${API}/api/groups`, {
      headers,
      data: { contestId: contest.id, name: "Grupo con participante previo" },
    })
    .then((response) => response.json());
  const targetGroup = await api
    .post(`${API}/api/groups`, {
      headers,
      data: { contestId: contest.id, name: "Grupo importación atómica" },
    })
    .then((response) => response.json());
  const existing = await api.post(`${API}/api/groups/${sourceGroup.id}/teams`, {
    headers,
    data: {
      participationMode: "individual",
      grade: contest.picked.grade,
      memberOneFirstName: "Ana",
      memberOneLastName: "Pérez",
    },
  });
  expect(existing.status(), await existing.text()).toBe(201);

  const invalidCsv = [
    "Nombres,Apellidos,Curso,Modalidad,Nombres del compañero,Apellidos del compañero,Nota",
    `Alice,Rojas,${contest.picked.grade}, INDIVIDUAL ,,`,
    ",,,,,",
    `Sin,,${contest.picked.grade},individual,,`,
    "Mal,Curso,S6,individual,,",
    `Sin,Modalidad,${contest.picked.grade},,,`,
    `Modo,Desconocido,${contest.picked.grade},equipo,,`,
    `Individual,ConCompañero,${contest.picked.grade},individual,Luis,Soto`,
    `Pareja,Incompleta,${contest.picked.grade},pareja,Luis,`,
    `Alice,Rojas,${contest.picked.grade},individual,,`,
    `ana,perez,${contest.picked.grade},individual,,`,
    `Compañero,Duplicado,${contest.picked.grade},pareja,ana,perez`,
    ",,,,,,Tiene una nota",
  ].join("\n");
  const rejected = await api.post(
    `${API}/api/groups/${targetGroup.id}/roster`,
    {
      headers,
      multipart: {
        file: {
          name: "participantes-invalidos.csv",
          mimeType: "text/csv",
          buffer: Buffer.from(invalidCsv, "utf8"),
        },
      },
    },
  );
  expect(rejected.status(), await rejected.text()).toBe(422);
  const rejection = await rejected.json();
  expect(rejection.code).toBe("ROSTER_VALIDATION_FAILED");
  // La fila 11 («ana perez») no se rechaza: la Ana Pérez que ya existe está en
  // otro grupo, y los nombres repetidos se controlan por grupo.
  expect(rejection.details.map((issue: { row: number }) => issue.row)).toEqual([
    4, 5, 7, 8, 9, 10, 12, 13, 13,
  ]);
  expect(rejection.details[2].reason).toContain("no reconocida");
  expect(rejection.details[3].reason).toContain("no puede incluir datos");
  expect(rejection.details[4].reason).toContain("Faltan los datos");
  expect(rejection.details[5].reason).toContain("repetido en la planilla");
  expect(rejection.details[6]).toMatchObject({
    name: "ana perez",
    reason: "Ya está en este grupo o repetido en la planilla.",
  });
  expect(
    rejection.details.slice(7).map((issue: { reason: string }) => issue.reason),
  ).toEqual(expect.arrayContaining(["Faltan nombres o apellidos."]));

  const groupsAfterRejection = await api
    .get(`${API}/api/groups`, { headers })
    .then((response) => response.json());
  expect(
    groupsAfterRejection.find(
      (group: { id: string }) => group.id === targetGroup.id,
    ).teams,
  ).toHaveLength(0);

  const validCsv = [
    "Modalidad,Curso,Apellidos,Nombres,Apellidos del compañero,Nombres del compañero",
    ` individual ,${contest.picked.grade},Flores,Lucía,,`,
    ` PAREJA ,${contest.picked.grade},Mamani,Luis,Rojas,Marta`,
  ].join("\n");
  const accepted = await api.post(
    `${API}/api/groups/${targetGroup.id}/roster`,
    {
      headers,
      multipart: {
        file: {
          name: "participantes-validos.csv",
          mimeType: "text/csv",
          buffer: Buffer.from(validCsv, "utf8"),
        },
      },
    },
  );
  expect(accepted.status(), await accepted.text()).toBe(201);
  const result = await accepted.json();
  expect(result.created).toHaveLength(2);
  expect(result.created.map((team: { name: string }) => team.name)).toEqual([
    "Lucía Flores",
    "Luis Mamani",
  ]);
  expect(result.skipped).toEqual([]);

  await api.dispose();
});

test("discovers one importable XLSX sheet and keeps template examples inert", async () => {
  const api = await request.newContext();
  const headers = await loginAdmin(api);
  const contest = await createContest(api, headers, { allowPairs: true });
  const createGroup = async (name: string) =>
    api
      .post(`${API}/api/groups`, {
        headers,
        data: { contestId: contest.id, name },
      })
      .then((response) => response.json());
  const customGroup = await createGroup("Grupo Excel propio");

  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("Notas").addRow(["Documento auxiliar"]);
  const participants = workbook.addWorksheet("Mi listado", { properties: {} });
  participants.addRow([
    "Curso",
    "Modalidad",
    "Apellidos",
    "Nombres",
    "Apellidos del compañero",
    "Nombres del compañero",
  ]);
  participants.addRow([
    contest.picked.grade,
    "individual",
    "Rojas",
    "Marta",
    "",
    "",
  ]);
  const customBuffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const customImport = await api.post(
    `${API}/api/groups/${customGroup.id}/roster`,
    {
      headers,
      multipart: {
        file: {
          name: "listado-propio.xlsx",
          mimeType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          buffer: customBuffer,
        },
      },
    },
  );
  expect(customImport.status(), await customImport.text()).toBe(201);
  expect((await customImport.json()).created[0].name).toBe("Marta Rojas");

  const noSheetGroup = await createGroup("Grupo sin hoja");
  const noSheetWorkbook = new ExcelJS.Workbook();
  noSheetWorkbook.addWorksheet("Notas").addRow(["Nombres", "Apellidos"]);
  const noSheet = await api.post(
    `${API}/api/groups/${noSheetGroup.id}/roster`,
    {
      headers,
      multipart: {
        file: {
          name: "sin-hoja.xlsx",
          mimeType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          buffer: Buffer.from(await noSheetWorkbook.xlsx.writeBuffer()),
        },
      },
    },
  );
  expect(noSheet.status()).toBe(400);
  expect((await noSheet.json()).code).toBe("ROSTER_SHEET_NOT_FOUND");

  const multipleSheetsGroup = await createGroup("Grupo con dos hojas");
  const multipleSheetsWorkbook = new ExcelJS.Workbook();
  for (const name of ["Primera", "Segunda"]) {
    multipleSheetsWorkbook
      .addWorksheet(name)
      .addRow(["Nombres", "Apellidos", "Curso", "Modalidad"]);
  }
  const multipleSheets = await api.post(
    `${API}/api/groups/${multipleSheetsGroup.id}/roster`,
    {
      headers,
      multipart: {
        file: {
          name: "dos-hojas.xlsx",
          mimeType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          buffer: Buffer.from(await multipleSheetsWorkbook.xlsx.writeBuffer()),
        },
      },
    },
  );
  expect(multipleSheets.status()).toBe(400);
  expect((await multipleSheets.json()).code).toBe("ROSTER_MULTIPLE_SHEETS");

  const duplicateHeadersGroup = await createGroup(
    "Grupo con encabezados repetidos",
  );
  const duplicateHeadersWorkbook = new ExcelJS.Workbook();
  duplicateHeadersWorkbook
    .addWorksheet("Participantes")
    .addRow(["Nombres", "Nombres", "Apellidos", "Curso", "Modalidad"]);
  const duplicateHeaders = await api.post(
    `${API}/api/groups/${duplicateHeadersGroup.id}/roster`,
    {
      headers,
      multipart: {
        file: {
          name: "encabezados-repetidos.xlsx",
          mimeType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          buffer: Buffer.from(
            await duplicateHeadersWorkbook.xlsx.writeBuffer(),
          ),
        },
      },
    },
  );
  expect(duplicateHeaders.status()).toBe(400);
  expect((await duplicateHeaders.json()).code).toBe("ROSTER_DUPLICATE_HEADERS");

  const templateGroup = await createGroup("Grupo plantilla segura");
  const templateResponse = await api.get(
    `${API}/api/groups/${templateGroup.id}/roster-template`,
    { headers },
  );
  expect(templateResponse.ok(), await templateResponse.text()).toBe(true);
  const templateBuffer = await templateResponse.body();
  const templateWorkbook = new ExcelJS.Workbook();
  await templateWorkbook.xlsx.load(templateBuffer);
  expect(
    templateWorkbook.worksheets
      .filter((sheet) => sheet.state === "visible")
      .map((sheet) => sheet.name),
  ).toEqual(["Estudiantes"]);
  expect(templateWorkbook.getWorksheet("Datos")?.state).toBe("veryHidden");
  const studentsSheet = templateWorkbook.getWorksheet("Estudiantes");
  expect(studentsSheet?.getCell("A1").value).toBe("Lista de estudiantes");
  expect(studentsSheet?.getRow(5).values).toContain("Modalidad");
  expect(studentsSheet?.getRow(6).values).toEqual([]);

  const templateImport = await api.post(
    `${API}/api/groups/${templateGroup.id}/roster`,
    {
      headers,
      multipart: {
        file: {
          name: "plantilla.xlsx",
          mimeType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          buffer: templateBuffer,
        },
      },
    },
  );
  expect(templateImport.status()).toBe(400);
  expect((await templateImport.json()).code).toBe("ROSTER_EMPTY");

  await api.dispose();
});

test("allows only one roster import at a time per contest", async () => {
  const api = await request.newContext();
  const headers = await loginAdmin(api);
  const contest = await createContest(api, headers);
  const groups = await Promise.all(
    ["Grupo concurrente A", "Grupo concurrente B"].map((name) =>
      api
        .post(`${API}/api/groups`, {
          headers,
          data: { contestId: contest.id, name },
        })
        .then((response) => response.json()),
    ),
  );
  const roster = (prefix: string) =>
    [
      "Nombres,Apellidos,Curso,Modalidad",
      ...Array.from(
        { length: 50 },
        (_, index) =>
          `${prefix}${index},Apellido${prefix},${contest.picked.grade},individual`,
      ),
    ].join("\n");
  const importRoster = (
    group: { id: string },
    index: number,
    extraHeaders: Record<string, string> = {},
  ) =>
    api.post(`${API}/api/groups/${group.id}/roster`, {
      headers: { ...headers, ...extraHeaders },
      multipart: {
        file: {
          name: `participantes-${index}.csv`,
          mimeType: "text/csv",
          buffer: Buffer.from(roster(index === 0 ? "Uno" : "Dos"), "utf8"),
        },
      },
    });
  const firstImport = await importRoster(groups[0], 0, {
    "x-e2e-keep-roster-lease": "1",
  });
  const responses = [
    firstImport,
    await importRoster(groups[1], 1, {
      "x-e2e-release-roster-lease": "1",
    }),
  ];
  expect(responses.map((response) => response.status()).sort()).toEqual([
    201, 409,
  ]);
  const conflict = responses.find((response) => response.status() === 409);
  expect(await conflict?.json()).toMatchObject({
    code: "ROSTER_IMPORT_IN_PROGRESS",
  });

  await api.dispose();
});

test("announces roster validation, atomic results and refresh failures", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const api = await request.newContext();
  const headers = await loginAdmin(api);
  const contest = await createContest(api, headers, {
    title: "Desafío importación accesible",
  });
  const groupResponse = await api.post(`${API}/api/groups`, {
    headers,
    data: { contestId: contest.id, name: "Grupo importación accesible" },
  });
  expect(groupResponse.ok(), await groupResponse.text()).toBe(true);
  const group = (await groupResponse.json()) as { id: string };
  const uploadEndpoint = `${API}/api/groups/${group.id}/roster`;
  let uploadCount = 0;
  let releaseUpload: (() => void) | undefined;
  const uploadGate = new Promise<void>((resolve) => {
    releaseUpload = resolve;
  });
  await page.route(uploadEndpoint, async (route) => {
    uploadCount += 1;
    if (uploadCount === 2) {
      await route.fulfill({
        status: 502,
        contentType: "text/html",
        body: "<p>Bad gateway</p>",
      });
      return;
    }
    if (uploadCount === 4) {
      const response = await route.fetch();
      await uploadGate;
      await route.fulfill({ response });
      return;
    }
    await route.continue();
  });

  await loginAdminPage(page);
  await page.goto(`/grupos/ver?id=${group.id}&vista=estudiantes`);
  const input = page.locator('input[type="file"]');
  const upload = page.getByRole("button", { name: "súbela llena" });
  await expect(input).toHaveAttribute("accept", ".xlsx,.csv");
  const error = page.getByRole("alert").filter({ hasText: /planilla|Fila/ });

  // Tipo y tamaño se revisan antes de subir nada.
  await input.setInputFiles({
    name: "participantes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("contenido", "utf8"),
  });
  await expect(error).toHaveText("La planilla debe ser un archivo XLSX o CSV.");
  await input.setInputFiles({
    name: "demasiado-grande.csv",
    mimeType: "text/csv",
    buffer: Buffer.alloc(2 * 1024 * 1024 + 1, "a"),
  });
  await expect(error).toHaveText("La planilla no debe superar los 2 MB.");
  expect(uploadCount).toBe(0);

  // Un archivo dañado y una respuesta que no es del servidor.
  await input.setInputFiles({
    name: "dañada.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from("no es un xlsx", "utf8"),
  });
  await expect(error).toHaveText(
    "No pudimos leer la planilla. Usa la plantilla del desafío.",
  );
  await input.setInputFiles({
    name: "respuesta-proxy.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from("contenido", "utf8"),
  });
  await expect(error).toHaveText("No se pudo importar la planilla.");
  expect(uploadCount).toBe(2);

  // Filas con problemas: no se importa nadie y se dice cuál falla.
  const invalid = [
    "Nombres,Apellidos,Curso,Modalidad",
    `Marta,Rojas,${contest.picked.grade},individual`,
    `Sin,,${contest.picked.grade},individual`,
  ].join("\n");
  await input.setInputFiles({
    name: "con-errores.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(invalid, "utf8"),
  });
  await expect(error).toContainText(
    "No se importó ningún participante. Corrige las filas indicadas.",
  );
  await expect(error).toContainText("Fila 3: Faltan nombres o apellidos.");
  expect(
    (
      await api
        .get(`${API}/api/groups/${group.id}`, { headers })
        .then((response) => response.json())
    ).teams,
  ).toHaveLength(0);

  // Una planilla correcta se importa entera; mientras sube, el botón espera.
  const valid = [
    "Nombres,Apellidos,Curso,Modalidad",
    `Marta,Rojas,${contest.picked.grade},individual`,
    `Luis,Flores,${contest.picked.grade},`,
  ].join("\n");
  await input.setInputFiles({
    name: "correcta.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(valid, "utf8"),
  });
  await expect(upload).toBeDisabled();
  releaseUpload?.();
  await expect(page.getByRole("status")).toHaveText(
    "Se inscribieron 2 estudiantes.",
  );
  await expect(error).toHaveCount(0);
  await expect(upload).toBeEnabled();
  for (const name of ["Marta Rojas", "Luis Flores"]) {
    await expect(
      page.getByRole("button", { name: `Editar a ${name}` }),
    ).toBeVisible();
  }
  expect(uploadCount).toBe(4);

  await api.dispose();
});


test("associates group creation errors and recovers after a remote rejection", async ({
  page,
}) => {
  const api = await request.newContext();
  const headers = await loginAdmin(api);
  const firstContest = await createContest(api, headers, {
    title: `Desafío validación uno ${Date.now()}`,
  });
  const secondContest = await createContest(api, headers, {
    title: `Desafío validación dos ${Date.now()}`,
  });
  let rejectNextCreation = true;
  await page.route(`${API}/api/groups`, async (route) => {
    if (route.request().method() === "POST" && rejectNextCreation) {
      rejectNextCreation = false;
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          message: "El desafío ya cerró; no es posible crear grupos.",
          code: "GROUP_CONTEST_CLOSED",
          field: "contestId",
        }),
      });
      return;
    }
    await route.continue();
  });

  await loginAdminPage(page);
  await page.goto("/grupos");
  await page.getByRole("button", { name: "Nuevo grupo" }).click();
  const dialog = page.getByRole("dialog", { name: "Nuevo grupo" });
  const name = dialog.getByLabel("Nombre del grupo");
  const create = dialog.getByRole("button", { name: "Crear grupo" });
  const alert = dialog.getByRole("alert");

  await create.click();
  await expect(alert).toHaveText("Elige el desafío.");
  await dialog.getByRole("radio", { name: new RegExp(firstContest.title) }).click();
  await expect(alert).toHaveCount(0);
  await create.click();
  await expect(alert).toHaveText("Ponle un nombre al grupo.");
  await name.fill("Grupo con validación accesible");
  await expect(alert).toHaveCount(0);

  await create.click();
  await expect(alert).toHaveText(
    "El desafío ya cerró; no es posible crear grupos.",
  );
  await expect(create).toBeEnabled();

  await dialog.getByRole("radio", { name: new RegExp(secondContest.title) }).click();
  await expect(alert).toHaveCount(0);
  await create.click();
  await expect(page).toHaveURL(/\/grupos\/ver\?id=.+/);
  await expect(
    page.getByRole("heading", { name: "Grupo con validación accesible" }),
  ).toBeVisible();

  await api.dispose();
});

