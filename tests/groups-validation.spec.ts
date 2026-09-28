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
    title: "Desafío con calendario heredado",
  });

  await loginAdminPage(page);
  await page.goto("/grupos");
  await page.waitForFunction(
    () => {
      const island = document.querySelector(
        'astro-island[component-url*="groups-home"]',
      );
      return island !== null && !island.hasAttribute("ssr");
    },
    null,
    { timeout: 30000 },
  );

  const challenge = page.getByRole("combobox", { name: "Desafío" });
  const name = page.getByLabel("Nombre del grupo");
  const create = page.getByRole("button", { name: "Crear grupo" });
  await expect(
    page.getByText("Fecha y hora de la sesión (opcional)", { exact: true }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Nuevo grupo" }).click();
  await challenge.click();
  await page.getByRole("option", { name: contest.title }).click();
  await name.fill("Grupo con calendario heredado");
  const createRequest = page.waitForRequest(
    (request) =>
      request.url() === `${API}/api/groups` &&
      request.method() === "POST" &&
      request.postDataJSON().name === "Grupo con calendario heredado",
  );
  await create.click();
  expect((await createRequest).postDataJSON()).toEqual({
    contestId: contest.id,
    name: "Grupo con calendario heredado",
  });
  await expect(
    page.getByText("Grupo con calendario heredado", { exact: true }),
  ).toBeVisible();

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
    message: "Ana Perez ya está registrado en este desafío.",
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
  let holdNextEnrollment = true;
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
  await page.goto("/grupos");
  const groupCard = page
    .getByRole("heading", {
      name: "Grupo inscripción accesible",
      exact: true,
    })
    .locator("xpath=ancestor::li[1]");
  await groupCard.getByRole("button", { name: /1 equipo/ }).click();
  await groupCard
    .getByRole("button", { name: "Inscribir participante" })
    .click();

  const dialog = page.getByRole("dialog", { name: "Inscribir participante" });
  const grade = dialog.getByRole("combobox", { name: "Curso" });
  const firstName = dialog.getByLabel("Nombres", { exact: true });
  const lastName = dialog.getByLabel("Apellidos", { exact: true });
  const submit = dialog.getByRole("button", { name: "Inscribir" });
  await submit.click();
  await expect(grade).toBeFocused();
  await expect(grade).toHaveAttribute("aria-invalid", "true");
  await expect(firstName).toHaveAttribute("aria-invalid", "true");
  await expect(lastName).toHaveAttribute("aria-invalid", "true");
  await expect(grade).toHaveAttribute(
    "aria-describedby",
    "enroll-grade-description enroll-grade-error",
  );

  await grade.click();
  await page.getByRole("option", { name: "3.º de primaria" }).click();
  await expect(grade).toHaveAttribute("aria-invalid", "false");
  await firstName.fill("Ana");
  await lastName.fill("Pérez");
  await expect(firstName).toHaveAttribute("aria-invalid", "false");
  await dialog.getByRole("button", { name: "Pareja" }).click();
  await submit.click();

  const secondFirstName = dialog.getByLabel("Nombres del 2.º integrante");
  const secondLastName = dialog.getByLabel("Apellidos del 2.º integrante");
  await expect(secondFirstName).toBeFocused();
  await expect(secondFirstName).toHaveAttribute("aria-invalid", "true");
  await expect(secondLastName).toHaveAttribute("aria-invalid", "true");
  await secondFirstName.fill("ana");
  await secondLastName.fill("perez");
  await submit.click();

  const identicalMessage =
    "Los dos integrantes no pueden ser la misma persona.";
  await expect(dialog.getByRole("alert")).toHaveText(identicalMessage);
  await expect(secondFirstName).toBeFocused();
  await secondFirstName.fill("Luis");
  await secondLastName.fill("Gómez");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await submit.click();

  await expect(
    dialog.getByRole("button", { name: "Inscribiendo..." }),
  ).toBeVisible();
  await expect(grade).toBeDisabled();
  await expect(firstName).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Cancelar" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Close" })).toHaveCount(0);
  releaseEnrollment?.();

  const duplicateMessage = "Ana Pérez ya está registrado en este desafío.";
  await expect(dialog.getByRole("alert")).toHaveText(duplicateMessage);
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: duplicateMessage }),
  ).toBeVisible();
  await expect(firstName).toBeFocused();
  await page.unroute(endpoint);
  await firstName.fill("Marta");
  await lastName.fill("Rojas");
  const recoveryResponse = page.waitForResponse(
    (response) =>
      response.url() === endpoint &&
      response.request().method() === "POST" &&
      response.status() === 201,
  );
  await lastName.press("Enter");
  await recoveryResponse;

  await expect(dialog).toHaveCount(0);
  await expect(
    groupCard.getByText("Marta Rojas · Luis Gómez", { exact: true }),
  ).toBeVisible();
  await page.waitForLoadState("networkidle");

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
    message: "Ana Perez ya está registrado en este desafío.",
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
    title: "Desafío edición accesible",
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
  let holdNextUpdate = true;
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
  await page.goto("/grupos");
  const groupCard = page
    .getByRole("heading", { name: "Grupo edición accesible", exact: true })
    .locator("xpath=ancestor::li[1]");
  await groupCard.getByRole("button", { name: /2 equipo/ }).click();
  const targetRow = groupCard
    .getByRole("listitem")
    .filter({ hasText: "Laura Núñez · Mario Soto" });
  await targetRow.getByRole("button", { name: "Editar participante" }).click();

  const dialog = page.getByRole("dialog", { name: "Editar participante" });
  const firstName = dialog.getByLabel("Nombres", { exact: true });
  const lastName = dialog.getByLabel("Apellidos", { exact: true });
  const secondFirstName = dialog.getByLabel("Nombres del 2.º integrante");
  const secondLastName = dialog.getByLabel("Apellidos del 2.º integrante");
  const submit = dialog.getByRole("button", { name: "Guardar" });
  await firstName.fill("");
  await lastName.fill("");
  await secondFirstName.fill("");
  await secondLastName.fill("");
  await submit.click();

  await expect(firstName).toBeFocused();
  await expect(firstName).toHaveAttribute("aria-invalid", "true");
  await expect(lastName).toHaveAttribute("aria-invalid", "true");
  await expect(secondFirstName).toHaveAttribute("aria-invalid", "true");
  await expect(secondLastName).toHaveAttribute("aria-invalid", "true");
  await expect(firstName).toHaveAttribute(
    "aria-describedby",
    "edit-one-first-error",
  );

  await firstName.fill("Ana");
  await lastName.fill("Pérez");
  await secondFirstName.fill("ana");
  await secondLastName.fill("perez");
  await submit.click();

  const identicalMessage =
    "Los dos integrantes no pueden ser la misma persona.";
  await expect(dialog.getByRole("alert")).toHaveText(identicalMessage);
  await expect(secondFirstName).toBeFocused();
  await secondFirstName.fill("Mario");
  await secondLastName.fill("Soto");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await submit.click();

  await expect(
    dialog.getByRole("button", { name: "Guardando..." }),
  ).toBeVisible();
  await expect(firstName).toBeDisabled();
  await expect(secondFirstName).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Cancelar" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Close" })).toHaveCount(0);
  releaseUpdate?.();

  const duplicateMessage = "Ana Pérez ya está registrado en este desafío.";
  await expect(dialog.getByRole("alert")).toHaveText(duplicateMessage);
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: duplicateMessage }),
  ).toBeVisible();
  await expect(firstName).toBeFocused();
  await page.unroute(updateEndpoint);
  await firstName.fill("Marta");
  await lastName.fill("Rojas");
  await secondLastName.press("Enter");

  await expect(dialog).toHaveCount(0);
  await expect(
    groupCard.getByText("Marta Rojas · Mario Soto", { exact: true }),
  ).toBeVisible();

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
  expect(rejection.details.map((issue: { row: number }) => issue.row)).toEqual([
    4, 5, 7, 8, 9, 10, 11, 12, 13, 13,
  ]);
  expect(rejection.details[2].reason).toContain("no reconocida");
  expect(rejection.details[3].reason).toContain("no puede incluir datos");
  expect(rejection.details[4].reason).toContain("Faltan los datos");
  expect(rejection.details[5].reason).toContain("Ya está inscrito");
  expect(rejection.details[6].reason).toContain("Ya está inscrito");
  expect(rejection.details[7]).toMatchObject({
    name: "ana perez",
    reason: "Ya está inscrito en este desafío.",
  });
  expect(
    rejection.details.slice(8).map((issue: { reason: string }) => issue.reason),
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
  const siblingResponse = await api.post(`${API}/api/groups`, {
    headers,
    data: { contestId: contest.id, name: "Grupo importación paralelo" },
  });
  expect(siblingResponse.ok(), await siblingResponse.text()).toBe(true);
  const uploadEndpoint = `${API}/api/groups/${group.id}/roster`;
  let uploadCount = 0;
  let releaseUpload: (() => void) | undefined;
  const uploadGate = new Promise<void>((resolve) => {
    releaseUpload = resolve;
  });
  let failNextRefresh = true;
  let refreshCount = 0;
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
    if (uploadCount === 3) {
      const response = await route.fetch();
      await uploadGate;
      await route.fulfill({ response });
      return;
    }
    await route.continue();
  });
  await page.route(`${API}/api/groups/${group.id}`, async (route) => {
    refreshCount += 1;
    if (failNextRefresh) {
      failNextRefresh = false;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ message: "No disponible." }),
      });
      return;
    }
    await route.continue();
  });

  await loginAdminPage(page);
  await page.goto("/grupos");
  const groupCard = page
    .getByRole("heading", {
      name: "Grupo importación accesible",
      exact: true,
    })
    .locator("xpath=ancestor::li[1]");
  const siblingCard = page
    .getByRole("heading", { name: "Grupo importación paralelo", exact: true })
    .locator("xpath=ancestor::li[1]");
  await groupCard.getByRole("button", { name: /0 equipo/ }).click();
  const input = groupCard.getByLabel("Importar planilla");
  await expect(input).toHaveAttribute(
    "accept",
    ".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv",
  );

  await input.setInputFiles({
    name: "participantes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("contenido", "utf8"),
  });
  const typeMessage = "La planilla debe ser un archivo XLSX o CSV.";
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(input).toHaveAttribute(
    "aria-describedby",
    `roster-${group.id}-description roster-${group.id}-error`,
  );
  await expect(
    groupCard.getByText("Archivo: participantes.txt."),
  ).toBeVisible();
  await expect(groupCard.locator(`#roster-${group.id}-error`)).toHaveText(
    typeMessage,
  );
  await expect(input).toHaveValue("");
  expect(uploadCount).toBe(0);

  await input.setInputFiles({
    name: "demasiado-grande.csv",
    mimeType: "text/csv",
    buffer: Buffer.alloc(2 * 1024 * 1024 + 1, "a"),
  });
  await expect(groupCard.locator(`#roster-${group.id}-error`)).toHaveText(
    "La planilla no debe superar los 2 MB.",
  );
  await expect(
    groupCard.getByText("Archivo: demasiado-grande.csv."),
  ).toBeVisible();
  expect(uploadCount).toBe(0);

  await input.setInputFiles({
    name: "dañada.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from("no es un xlsx", "utf8"),
  });
  const corruptMessage =
    "No pudimos leer la planilla. Usa la plantilla del desafío.";
  await expect(input).toBeFocused();
  await expect(groupCard.locator(`#roster-${group.id}-error`)).toHaveText(
    corruptMessage,
  );
  await expect(groupCard.getByText("Archivo: dañada.xlsx.")).toBeVisible();
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: corruptMessage }),
  ).toBeVisible();
  expect(uploadCount).toBe(1);

  await input.setInputFiles({
    name: "respuesta-proxy.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from("contenido", "utf8"),
  });
  const fallbackMessage = "No se pudo importar la planilla.";
  await expect(input).toBeFocused();
  await expect(groupCard.locator(`#roster-${group.id}-error`)).toHaveText(
    fallbackMessage,
  );
  await expect(
    groupCard.getByText("Archivo: respuesta-proxy.xlsx."),
  ).toBeVisible();
  await expect(input).toHaveValue("");
  expect(uploadCount).toBe(2);

  const csv = [
    "Nombres,Apellidos,Curso,Modalidad",
    `Marta,Rojas,${contest.picked.grade},individual`,
    `Sin,,${contest.picked.grade},individual`,
  ].join("\n");
  const invalidFileName = `participantes-${"muy".repeat(30)}.csv`;
  await input.setInputFiles({
    name: invalidFileName,
    mimeType: "text/csv",
    buffer: Buffer.from(csv, "utf8"),
  });
  await expect(input).toBeDisabled();
  await expect(input).toHaveAttribute("aria-invalid", "false");
  await expect(groupCard).toContainText("Importando...");
  await groupCard.getByRole("button", { name: /0 equipo/ }).click();
  await expect(
    groupCard.getByRole("button", { name: /0 equipo/ }),
  ).toHaveAttribute("aria-expanded", "false");
  await siblingCard.getByRole("button", { name: /0 equipo/ }).click();
  const siblingInput = siblingCard.getByLabel("Importar planilla");
  await expect(siblingInput).toBeDisabled();
  await expect(siblingCard).toContainText(
    "Solo se procesa una planilla a la vez en este panel.",
  );
  releaseUpload?.();

  const validation = groupCard.getByRole("alert");
  await expect(validation).toBeFocused();
  await expect(
    groupCard.getByRole("button", { name: /0 equipo/ }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(validation).toContainText(
    "No se importó ningún participante. Corrige las filas indicadas.",
  );
  await expect(validation).toContainText(
    "Fila 3: Sin. Faltan nombres o apellidos.",
  );
  await expect(
    page.locator("[data-sonner-toast]").filter({
      hasText:
        "No se importó ningún participante. Corrige las filas indicadas.",
    }),
  ).toBeVisible();
  await expect(groupCard.getByRole("status")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(uploadCount).toBe(3);
  expect(refreshCount).toBe(0);

  await input.setInputFiles({
    name: "participantes-total.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      [
        "Nombres,Apellidos,Curso,Modalidad",
        `Lucía,Flores,${contest.picked.grade},individual`,
      ].join("\n"),
      "utf8",
    ),
  });
  await expect(groupCard.getByRole("status")).toContainText(
    "Importación completada",
  );
  const refreshMessage =
    "La importación terminó, pero no se pudo actualizar la lista. Recarga la página para ver los cambios.";
  await expect(groupCard.getByRole("alert")).toContainText(refreshMessage);
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: refreshMessage }),
  ).toBeVisible();
  expect(uploadCount).toBe(4);
  expect(refreshCount).toBe(1);

  await input.setInputFiles({
    name: "participantes-segundo.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      [
        "Nombres,Apellidos,Curso,Modalidad",
        `Carlos,Soto,${contest.picked.grade},individual`,
      ].join("\n"),
      "utf8",
    ),
  });
  await expect(groupCard.getByRole("status")).toContainText(
    "Importación completada",
  );
  await expect(
    groupCard.getByText("Lucía Flores", { exact: true }),
  ).toBeVisible();
  await expect(
    groupCard.getByText("Carlos Soto", { exact: true }),
  ).toBeVisible();
  await expect(groupCard.getByRole("alert")).toHaveCount(0);
  await expect(
    page
      .locator("[data-sonner-toast]")
      .filter({
        hasText: "Se importaron 1 participante(s).",
      })
      .last(),
  ).toBeVisible();
  await expect(input).toHaveAttribute(
    "aria-describedby",
    `roster-${group.id}-description`,
  );
  await expect(input).toHaveValue("");
  expect(uploadCount).toBe(5);
  expect(refreshCount).toBe(2);

  await api.dispose();
});

test("associates group creation errors and recovers after a remote rejection", async ({
  page,
}) => {
  const api = await request.newContext();
  const headers = await loginAdmin(api);
  const firstContest = await createContest(api, headers, {
    title: "Desafío validación uno",
  });
  const secondContest = await createContest(api, headers, {
    title: "Desafío validación dos",
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
  await page.waitForFunction(
    () => {
      const island = document.querySelector(
        'astro-island[component-url*="groups-home"]',
      );
      return island !== null && !island.hasAttribute("ssr");
    },
    null,
    { timeout: 30000 },
  );

  await page.getByRole("button", { name: "Nuevo grupo" }).click();
  const form = page
    .getByRole("dialog", { name: "Crear grupo" })
    .locator("form");
  const contest = form.getByRole("combobox", { name: "Desafío" });
  const name = form.getByLabel("Nombre del grupo");
  const create = form.getByRole("button", { name: "Crear grupo" });
  await create.click();

  await expect(contest).toBeFocused();
  await expect(contest).toHaveAttribute("aria-invalid", "true");
  await expect(contest).toHaveAttribute(
    "aria-describedby",
    "group-contest-error",
  );
  await expect(form.locator("#group-contest-error")).toHaveText(
    "Elige un desafío publicado.",
  );
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(name).toHaveAttribute("aria-describedby", "group-name-error");

  await contest.click();
  await page.getByRole("option", { name: firstContest.title }).click();
  await expect(contest).toHaveAttribute("aria-invalid", "false");
  await expect(form.locator("#group-contest-error")).toHaveCount(0);
  await create.click();
  await expect(name).toBeFocused();

  await name.fill("Grupo con validación accesible");
  await expect(name).toHaveAttribute("aria-invalid", "false");
  await create.click();

  const closedMessage = "El desafío ya cerró; no es posible crear grupos.";
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: closedMessage }),
  ).toBeVisible();
  await expect(contest).toBeFocused();
  await expect(contest).toHaveAttribute("aria-invalid", "true");
  await expect(form.locator("#group-contest-error")).toHaveText(closedMessage);

  await contest.click();
  await page.getByRole("option", { name: secondContest.title }).click();
  await expect(form.locator("#group-contest-error")).toHaveCount(0);
  await create.click();

  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: "Grupo creado." }),
  ).toBeVisible();
  await expect(
    page.getByText("Grupo con validación accesible", { exact: true }),
  ).toBeVisible();

  await api.dispose();
});
