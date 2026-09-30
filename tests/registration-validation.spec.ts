import { expect, test } from "@playwright/test";

import {
  API,
  ADMIN,
  createFirebaseUser,
  loginAdmin,
  loginPage,
  loginUser,
  registerBebrasProfile,
  registrationFields,
  signInFirebaseUser,
  uniqueEmail,
  VALID_JPG,
  VALID_PDF,
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

async function openRegistration(page: import("@playwright/test").Page) {
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
}

async function fillAccountFields(
  page: import("@playwright/test").Page,
  email: string,
) {
  await page.getByLabel("Nombres", { exact: true }).fill("Maestra");
  await page.getByLabel("Apellidos", { exact: true }).fill("Accesible");
  await page.getByLabel("Correo", { exact: true }).fill(email);
  await page.getByLabel("Teléfono", { exact: true }).fill("70000010");
  await page.getByLabel("Contraseña", { exact: true }).fill("segura123");
  await page
    .getByLabel("Confirmar contraseña", { exact: true })
    .fill("segura123");
}

async function expectVerificationStep(
  page: import("@playwright/test").Page,
  email?: string,
) {
  await expect(
    page.getByRole("heading", { name: "Revisa tu correo" }),
  ).toBeVisible();
  if (email) {
    await expect(
      page.getByText(email.toLowerCase(), { exact: false }),
    ).toBeVisible();
  }
}

for (const width of [390, 1280]) {
  test(`blocks forbidden registration characters when typing and pasting at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await openRegistration(page);
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);
    for (const [label, valid, key, pasted, id] of [
      ["Nombres", "Ana María", "1", "Ana123", "reg-first-error"],
      ["Apellidos", "O’Connor-Pérez", "9", "Pérez😀", "reg-last-error"],
      ["Teléfono", "+591 7123-4567", "a", "Tel: 71234567", "reg-phone-error"],
      [
        "Contraseña",
        "segura123",
        " ",
        "clave con espacios",
        "reg-password-error",
      ],
      [
        "Confirmar contraseña",
        "segura123",
        " ",
        "segura123 ",
        "reg-confirm-error",
      ],
    ]) {
      const input = page.getByLabel(label, { exact: true });
      await input.fill(valid);
      await input.press("End");
      await input.pressSequentially(key);
      await expect(input).toHaveValue(valid);
      await expect(input).toBeFocused();
      await expect(page.locator(`#${id}`)).toBeVisible();
      await expect(input).toHaveAttribute("aria-describedby", id);
      await page.evaluate(
        (text) => navigator.clipboard.writeText(text),
        pasted,
      );
      await input.press("ControlOrMeta+A");
      await input.press("ControlOrMeta+V");
      await expect(input).toHaveValue(valid);
      if (label !== "Teléfono") {
        await page.evaluate(
          (text) => navigator.clipboard.writeText(`${text}Otro\n`),
          valid,
        );
        await input.press("ControlOrMeta+V");
        await expect(input).toHaveValue(valid);
        await expect(page.locator(`#${id}`)).toBeVisible();
      }
      // Programmatic input/autofill events are checked as well as keyboard/paste.
      await input.fill(pasted);
      await expect(input).toHaveValue(valid);
      // Native HTML pattern works independently of React and remains Unicode-safe.
      const native = await input.evaluate((element, invalid) => {
        const control = element as HTMLInputElement;
        const original = control.value;
        const acceptsValid = !control.validity.patternMismatch;
        control.value = invalid;
        const rejectsInvalid = control.validity.patternMismatch;
        control.value = original;
        return { acceptsValid, rejectsInvalid, required: control.required };
      }, pasted);
      expect(native).toEqual({
        acceptsValid: true,
        rejectsInvalid: true,
        required: true,
      });
      await input.fill("");
      await page.evaluate((text) => navigator.clipboard.writeText(text), valid);
      await input.press("ControlOrMeta+V");
      await expect(input).toHaveValue(valid);
      await expect(page.locator(`#${id}`)).toHaveCount(0);
    }
    const first = page.getByLabel("Nombres", { exact: true });
    await first.fill("李 Mari\u0301a");
    await expect(first).toHaveValue("李 Mari\u0301a");
    const phone = page.getByLabel("Teléfono", { exact: true });
    await expect(phone).toHaveAttribute("type", "tel");
    await expect(phone).toHaveAttribute("inputmode", "tel");
    await page
      .getByLabel("Correo", { exact: true })
      .fill(`guard-${width}-${Date.now()}@example.com`);
    await page.getByRole("button", { name: "Enseño en casa" }).click();
    await chooseLocation(page);
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await page
      .getByRole("button", { name: "Confirmar y crear cuenta" })
      .click();
    await expectVerificationStep(page);
  });
}

test("Firebase rejects weak passwords before a Bebras profile can be registered", async ({
  request,
}) => {
  const apiKey = process.env.E2E_FIREBASE_API_KEY!;
  for (const password of ["", "12345"]) {
    const response = await request.post(
      `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`,
      {
        data: {
          email: uniqueEmail("password-invalid"),
          password,
          returnSecureToken: true,
        },
      },
    );
    expect(response.status(), await response.text()).toBe(400);
    expect((await response.json()).error.message).toMatch(
      /MISSING_PASSWORD|WEAK_PASSWORD/,
    );
  }

  const profile = await request.post(`${API}/api/auth/register`, {
    multipart: { ...registrationFields("school"), letter: VALID_PDF },
  });
  expect(profile.status()).toBe(401);
});

test("registers profiles for Firebase passwords and preserves Unicode for login", async ({
  request,
}) => {
  let index = 0;
  for (const password of [
    "123456",
    "a".repeat(72),
    "é".repeat(36),
    "😀".repeat(18),
    "clave-sin-espacios",
    "e\u0301abcd",
  ]) {
    const email = `password-valid-${Date.now()}-${index++}@example.com`;
    const identity = await createFirebaseUser(request, { email, password });
    const { response } = await registerBebrasProfile(request, {
      identity,
    });
    expect(response.status()).toBe(201);
    await expect(
      loginUser(request, { email, password }),
    ).resolves.toBeDefined();
    const altered =
      password.normalize("NFC") !== password
        ? password.normalize("NFC")
        : `X${password.slice(1)}`;
    await expect(
      signInFirebaseUser(request, { email, password: altered }),
    ).rejects.toThrow(`Firebase no autenticó a ${email}`);
  }
});

for (const width of [390, 1280]) {
  test(`live password errors and accessible independent revelation at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await openRegistration(page);
    const password = page.getByLabel("Contraseña", { exact: true });
    const confirmation = page.getByLabel("Confirmar contraseña", {
      exact: true,
    });
    const reveal = page.getByRole("button", {
      name: "Mostrar contraseña",
      exact: true,
    });
    const revealConfirmation = page.getByRole("button", {
      name: "Mostrar confirmación de contraseña",
      exact: true,
    });
    const error = page.locator("#reg-password-error");
    const confirmationError = page.locator("#reg-confirm-error");
    await expect(
      page.locator('[data-slot="field"]').filter({ has: password }),
    ).toHaveText("Contraseña");
    await expect(
      page.locator('[data-slot="field"]').filter({ has: confirmation }),
    ).toHaveText("Confirmar contraseña");
    await expect(password).toHaveAttribute("autocomplete", "new-password");
    await expect(confirmation).toHaveAttribute("autocomplete", "new-password");
    for (const [value, message] of [
      ["12345", "La contraseña debe tener al menos 6 caracteres."],
      ["é".repeat(37), "La contraseña es muy larga."],
      ["😀".repeat(19), "La contraseña es muy larga."],
      ["", "Ingresa una contraseña."],
    ]) {
      await password.fill(value);
      await expect(error).toHaveText(message);
      await expect(error).toHaveAttribute("role", "alert");
      await expect(password).toBeFocused();
      await expect(password).toHaveAttribute("aria-invalid", "true");
      await expect(password).toHaveAttribute(
        "aria-describedby",
        "reg-password-error",
      );
      await expect(password).toHaveValue(value);
      await expect(confirmationError).toBeHidden();
    }
    await password.fill("123456");
    await expect(error).toHaveCount(0);
    await expect(password).toHaveAttribute("aria-invalid", "false");
    await confirmation.fill("12345x");
    await expect(confirmationError).toHaveText("Las contraseñas no coinciden.");
    await confirmation.fill("123456");
    await expect(confirmationError).toBeHidden();
    await password.fill("1234567");
    await expect(confirmationError).toHaveText("Las contraseñas no coinciden.");
    await confirmation.fill("");
    await expect(confirmationError).toHaveText("Confirma tu contraseña.");
    await confirmation.fill("1234567");
    await expect(confirmationError).toBeHidden();

    await password.focus();
    await page.keyboard.press("Tab");
    await expect(reveal).toBeFocused();
    expect(
      await reveal.evaluate((button) => button.matches(":focus-visible")),
    ).toBe(true);
    await expect(reveal).toHaveAttribute("aria-controls", "reg-password");
    await expect(reveal).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("Enter");
    await expect(reveal).toBeFocused();
    await expect(reveal).toHaveAttribute("aria-pressed", "true");
    await expect(password).toHaveAttribute("type", "text");
    await expect(confirmation).toHaveAttribute("type", "password");
    await page.keyboard.press("Tab");
    await expect(confirmation).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(revealConfirmation).toBeFocused();
    await expect(revealConfirmation).toHaveAttribute(
      "aria-controls",
      "reg-confirm",
    );
    await page.keyboard.press("Space");
    await expect(revealConfirmation).toHaveAttribute("aria-pressed", "true");
    await expect(confirmation).toHaveAttribute("type", "text");
    await reveal.click();
    await expect(password).toHaveAttribute("type", "password");
    await expect(confirmation).toHaveAttribute("type", "text");
    await expect(password).toHaveValue("1234567");
    await expect(confirmation).toHaveValue("1234567");
    await revealConfirmation.click();
    for (const button of [reveal, revealConfirmation]) {
      const box = await button.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(24);
      expect(box!.height).toBeGreaterThanOrEqual(24);
    }

    await fillAccountFields(
      page,
      `password-ui-${width}-${Date.now()}@example.com`,
    );
    await page.getByRole("button", { name: "Enseño en casa" }).click();
    await chooseLocation(page);
    await password.fill("a".repeat(73));
    await expect(password).toHaveValue("a".repeat(72));
    await expect(password).toHaveAttribute("maxlength", "72");
    await page.screenshot({
      path: test.info().outputPath("password-validation.png"),
      fullPage: true,
    });
    const secret = "é".repeat(36);
    await password.fill(secret);
    await confirmation.fill(secret);
    await reveal.click();
    await revealConfirmation.click();
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await page.getByRole("button", { name: "Editar", exact: true }).click();
    await expect(password).toHaveAttribute("type", "password");
    await expect(confirmation).toHaveAttribute("type", "password");
    await expect(password).toHaveValue(secret);
    await password.fill("clave-sin-espacios");
    await expect(error).toHaveCount(0);
    await expect(confirmationError).toHaveText("Las contraseñas no coinciden.");
    await confirmation.fill("clave-sin-espacios");
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await page
      .getByRole("button", { name: "Confirmar y crear cuenta" })
      .click();
    await expectVerificationStep(page);
  });
}

test("rejects invalid registration names without writing Bebras profiles", async ({
  request,
}) => {
  const headers = await loginAdmin(request);
  const emails: string[] = [];
  for (const [field, value] of [
    ["firstName", "123"],
    ["lastName", "---"],
    ["firstName", "a".repeat(101)],
    ["lastName", "ñ".repeat(101)],
    ["firstName", "Ana\tMaría"],
    ["lastName", "Pérez\n"],
    ["firstName", "Ana😀"],
    ["lastName", ""],
    ["schoolName", "x".repeat(201)],
    ["schoolName", "---"],
    ["schoolName", "Colegio\tUno"],
    ["schoolName", ""],
  ]) {
    const email = `text-${Date.now()}-${emails.length}@example.com`;
    emails.push(email);
    const { response } = await registerBebrasProfile(request, {
      email,
      fields: { [field]: value, letter: VALID_PDF },
    });
    expect(response.status(), `${field}: ${await response.text()}`).toBe(400);
    expect(await response.json()).toMatchObject({
      field,
      message: expect.any(String),
    });
  }
  const response = await request.get(`${API}/api/users/maestros`, { headers });
  expect(response.ok()).toBe(true);
  const teachers = (await response.json()) as Array<{ email: string }>;
  expect(teachers.some((teacher) => emails.includes(teacher.email))).toBe(
    false,
  );
});

test("persists normalized Unicode names and manual schools at registration limits", async ({
  request,
}) => {
  for (const fields of [
    {
      firstName: "  ana\u00a0  mari\u0301a ",
      lastName: " o’connor-pérez ",
      schoolName: "  U.E.  “6 de Agosto” N.º 2  ",
    },
    {
      firstName: "𠮷".repeat(100),
      lastName: "ñ".repeat(100),
      schoolName: "C".repeat(200),
    },
  ]) {
    const { identity, response } = await registerBebrasProfile(request, {
      email: uniqueEmail("valid-text"),
      fields,
    });
    expect(response.status(), await response.text()).toBe(201);
    const profile = await request.get(`${API}/api/auth/me`, {
      headers: identity.headers,
    });
    expect(profile.ok()).toBe(true);
    const user = await profile.json();
    if (fields.firstName.includes("ana")) {
      expect(user).toMatchObject({
        firstName: "Ana María",
        lastName: "O’Connor-Pérez",
        schoolName: "U.E. “6 de Agosto” N.º 2",
      });
    } else {
      expect(user).toMatchObject({
        firstName: fields.firstName,
        lastName: `Ñ${"ñ".repeat(99)}`,
        schoolName: fields.schoolName,
      });
    }
  }
});

for (const width of [390, 1280]) {
  test(`registration text errors and recovery at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await openRegistration(page);
    await fillAccountFields(page, `text-ui-${width}-${Date.now()}@example.com`);
    await page
      .getByRole("button", { name: "Mi colegio no está en la lista" })
      .click();
    await chooseLocation(page);
    const first = page.getByLabel("Nombres", { exact: true });
    const last = page.getByLabel("Apellidos", { exact: true });
    const school = page.getByPlaceholder("Nombre de tu unidad educativa");
    await expect(first).toHaveAttribute("maxlength", "100");
    await expect(school).toHaveAttribute("maxlength", "200");
    await school.fill("Colegio 2");
    for (const [input, value, id] of [
      [last, "---", "reg-last-error"],
      [school, "-", "reg-school-error"],
    ] as const) {
      await input.fill(value);
      await page
        .getByRole("button", { name: "Continuar", exact: true })
        .click();
      await expect(input).toBeFocused();
      await expect(input).toHaveAttribute("aria-invalid", "true");
      await expect(input).toHaveAttribute("aria-describedby", id);
      await expect(page.locator(`#${id}`)).toBeVisible();
      await expect(input).toHaveValue(value);
      await input.fill(input === school ? "Colegio 2" : "María");
      await expect(page.locator(`#${id}`)).toHaveCount(0);
    }
    await first.fill("  ana   mari\u0301a ");
    await last.fill(" o’connor-pérez ");
    await school.fill("  U.E.  “6 de Agosto” N.º 2  ");
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await expect(
      page.locator("dd").filter({ hasText: "Ana María" }),
    ).toBeVisible();
    await expect(
      page.locator("dd").filter({ hasText: "U.E. “6 de Agosto” N.º 2" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Editar", exact: true }).click();
    await expect(first).toHaveValue("Ana María");
    await expect(last).toHaveValue("O’Connor-Pérez");
    await expect(school).toHaveValue("U.E. “6 de Agosto” N.º 2");
    // Verify server errors route back to each new field after confirmation.
    for (const [field, input] of [
      ["firstName", first],
      ["lastName", last],
      ["schoolName", school],
    ] as const) {
      await page.route(
        "**/api/auth/register",
        (route) =>
          route.fulfill({
            status: 400,
            json: { field, message: "Revisa este dato." },
          }),
        { times: 1 },
      );
      await page
        .getByRole("button", { name: "Continuar", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Confirmar y crear cuenta" })
        .click();
      await expect(input).toBeFocused();
      await expect(input).toHaveAttribute("aria-invalid", "true");
      await input.fill(await input.inputValue());
    }
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await page
      .getByRole("button", { name: "Confirmar y crear cuenta" })
      .click();
    await expectVerificationStep(page);
  });
}

test("Firebase rejects invalid email identities before Bebras registration", async ({
  request,
}) => {
  const stamp = Date.now();
  const invalidEmails = [
    `sin-arroba-${stamp}`,
    "",
    "   ",
    `maestro-${stamp}@`,
    "@example.com",
    `maestro-${stamp}@@example.com`,
  ];
  const apiKey = process.env.E2E_FIREBASE_API_KEY!;
  for (const email of invalidEmails) {
    const response = await request.post(
      `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`,
      { data: { email, password: "segura123", returnSecureToken: true } },
    );
    expect(response.status(), `${email}: ${await response.text()}`).toBe(400);
    expect((await response.json()).error.message).toMatch(
      /INVALID_EMAIL|MISSING_EMAIL/,
    );
  }
});

test("normalizes email aliases and subdomains for registration, duplicates and login", async ({
  request,
}) => {
  const email = `Maestra.${Date.now()}+Colegio@Docentes.Example.COM`;
  const normalized = email.toLowerCase();
  const { identity, response: registered } = await registerBebrasProfile(
    request,
    { email },
  );
  expect(registered.status(), await registered.text()).toBe(201);
  const created = await registered.json();
  expect(created.user.email).toBe(normalized);
  const profile = await request.get(`${API}/api/auth/me`, {
    headers: identity.headers,
  });
  expect(profile.ok()).toBe(true);
  expect((await profile.json()).email).toBe(normalized);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const duplicate = await request.post(`${API}/api/auth/register`, {
      headers: identity.headers,
      multipart: registrationFields("school"),
    });
    expect(duplicate.status()).toBe(409);
    expect(await duplicate.json()).toMatchObject({
      field: "email",
      message: "Ya existe una cuenta con ese correo.",
    });
  }
  const login = await loginUser(request, {
    email: email.trim().toLowerCase(),
    password: "segura123",
  });
  expect(login.user.email).toBe(normalized);
});

for (const width of [390, 1280]) {
  test(`email validation and normalized confirmation at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await openRegistration(page);
    await fillAccountFields(page, "maestra@example.com");
    await page.getByRole("button", { name: "Enseño en casa" }).click();
    await chooseLocation(page);
    const email = page.getByLabel("Correo", { exact: true });
    for (const invalid of [
      "maestra@colegio",
      ".maestra@example.com",
      "mae stra@example.com",
    ]) {
      await email.fill(invalid);
      await page
        .getByRole("button", { name: "Continuar", exact: true })
        .click();
      await expect(email).toBeFocused();
      await expect(email).toHaveAttribute("aria-invalid", "true");
      await expect(email).toHaveAttribute(
        "aria-describedby",
        "reg-email-error",
      );
      await expect(page.locator("#reg-email-error")).toHaveText(
        "Ingresa un correo válido.",
      );
      await expect(email).toHaveValue(invalid);
    }

    // A duplicate after normalization returns from confirmation to the email field.
    await email.fill(` ${ADMIN.email.toUpperCase()} `);
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await expect(
      page.locator("dd").filter({ hasText: ADMIN.email.toLowerCase() }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Confirmar y crear cuenta" })
      .click();
    await expect(email).toBeFocused();
    await expect(page.locator("#reg-email-error")).toHaveText(
      "Ya existe una cuenta con ese correo.",
    );

    const address = `Maestra.${width}.${Date.now()}+Grupo@Docentes.Example.COM`;
    await email.fill(` ${address} `);
    await expect(page.locator("#reg-email-error")).toHaveCount(0);
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await expect(
      page.locator("dd").filter({ hasText: address.toLowerCase() }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Editar", exact: true }).click();
    await expect(email).toHaveValue(address.toLowerCase());
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await page
      .getByRole("button", { name: "Confirmar y crear cuenta" })
      .click();
    await expectVerificationStep(page, address);
  });
}

test("validates phone numbers on the API and stores their international form", async ({
  request,
}) => {
  const email = `phone-api-${Date.now()}@example.com`;
  const identity = await createFirebaseUser(request, { email });
  for (const phone of [
    "",
    "abcdef",
    "7abc1234",
    "1",
    "12345678",
    "+99971234567",
    "59171234567",
  ]) {
    const { response } = await registerBebrasProfile(request, {
      identity,
      fields: { phone },
    });
    expect(response.status(), await response.text()).toBe(400);
    expect(await response.json()).toMatchObject({
      field: "phone",
      message: expect.any(String),
    });
  }

  // Reusing the rejected email also proves no account was created by invalid requests.
  for (const [index, [phone, normalized]] of [
    ["(7123) 45-67", "+59171234567"],
    ["22123456", "+59122123456"],
    ["+54 (11) 2345-6789", "+541123456789"],
  ].entries()) {
    const currentIdentity =
      index === 0
        ? identity
        : await createFirebaseUser(request, {
            email: `phone-${index}-${email}`,
          });
    const { response } = await registerBebrasProfile(request, {
      identity: currentIdentity,
      fields: { phone },
    });
    expect(response.status(), await response.text()).toBe(201);
    const profile = await request.get(`${API}/api/auth/me`, {
      headers: currentIdentity.headers,
    });
    expect(profile.ok()).toBe(true);
    expect((await profile.json()).phone).toBe(normalized);
  }
});

for (const width of [390, 1280]) {
  test(`phone validation, normalization and recovery at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await openRegistration(page);
    const email = `phone-ui-${width}-${Date.now()}@example.com`;
    await fillAccountFields(page, email);
    await page.getByRole("button", { name: "Enseño en casa" }).click();
    await chooseLocation(page);
    const phone = page.getByLabel("Teléfono", { exact: true });
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.evaluate(() => navigator.clipboard.writeText("7abc1234"));
    await phone.focus();
    await phone.press("ControlOrMeta+A");
    await phone.press("ControlOrMeta+V");
    await expect(phone).toBeFocused();
    await expect(phone).toHaveValue("70000010");
    await expect(phone).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#reg-phone-error")).toContainText("letras");
    await expect(phone).toHaveAttribute("aria-describedby", "reg-phone-error");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);

    await phone.fill("+54 (11) 2345-6789");
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await expect(
      page.locator("dd").filter({ hasText: "+541123456789" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Editar", exact: true }).click();
    await expect(phone).toHaveValue("+541123456789");
    await page.getByRole("button", { name: "Continuar", exact: true }).click();

    await page.route("**/api/auth/register", (route) =>
      route.fulfill({
        status: 400,
        json: { field: "phone", message: "Revisa el número de contacto." },
      }),
    );
    await page
      .getByRole("button", { name: "Confirmar y crear cuenta" })
      .click();
    await expect(phone).toBeFocused();
    await expect(page.locator("#reg-phone-error")).toHaveText(
      "Revisa el número de contacto.",
    );
    await expect(phone).toHaveValue("+541123456789");
    await page.unroute("**/api/auth/register");
    await phone.fill("7123-4567");
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await page
      .getByRole("button", { name: "Confirmar y crear cuenta" })
      .click();
    await expectVerificationStep(page, email);
    const headers = await loginAdmin(page.request);
    const teachers = await page.request.get(`${API}/api/users/maestros`, {
      headers,
    });
    expect(teachers.ok()).toBe(true);
    const profile = (await teachers.json()).find(
      (teacher: { email: string }) => teacher.email === email,
    );
    expect(profile.phone).toBe("+59171234567");
  });
}

test("shows field errors and associates an existing email with its input", async ({
  page,
}) => {
  await openRegistration(page);

  const firstName = page.getByLabel("Nombres", { exact: true });
  const email = page.getByLabel("Correo", { exact: true });
  const school = page.getByLabel("¿Dónde enseñas?", { exact: true });
  await page.getByRole("button", { name: "Continuar", exact: true }).click();

  await expect(firstName).toBeFocused();
  await expect(firstName).toHaveAttribute("aria-invalid", "true");
  await expect(firstName).toHaveAttribute(
    "aria-describedby",
    "reg-first-error",
  );
  await expect(email).toHaveAttribute("aria-invalid", "true");
  await expect(school).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#reg-letter-error")).toHaveCount(0);

  await firstName.fill("Maestra");
  await page.getByLabel("Apellidos", { exact: true }).fill("Accesible");
  await email.fill("correo-invalido");
  await page.getByLabel("Teléfono", { exact: true }).fill("70000010");
  await page.getByLabel("Contraseña", { exact: true }).fill("123");
  await page
    .getByLabel("Confirmar contraseña", { exact: true })
    .fill("distinta");
  await page.getByRole("button", { name: "Continuar", exact: true }).click();

  await expect(email).toBeFocused();
  await expect(page.locator("#reg-email-error")).toHaveText(
    "Ingresa un correo válido.",
  );
  await expect(page.locator("#reg-password-error")).toHaveText(
    "La contraseña debe tener al menos 6 caracteres.",
  );
  await expect(page.locator("#reg-confirm-error")).toHaveText(
    "Las contraseñas no coinciden.",
  );

  await email.fill(ADMIN.email);
  await page.getByLabel("Contraseña", { exact: true }).fill(ADMIN.password);
  await page
    .getByLabel("Confirmar contraseña", { exact: true })
    .fill(ADMIN.password);
  await page
    .getByRole("button", { name: "Mi colegio no está en la lista" })
    .click();
  await chooseLocation(page);
  const manualSchool = page.getByLabel("¿Dónde enseñas?", { exact: true });
  await expect(manualSchool).toHaveAttribute("aria-invalid", "true");
  await expect(manualSchool).toHaveAttribute(
    "aria-describedby",
    "reg-school-error",
  );
  await manualSchool.fill("Colegio Accesible");
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.getByRole("button", { name: "Confirmar y crear cuenta" }).click();

  const existingMessage = "Ya existe una cuenta con ese correo.";
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: existingMessage }),
  ).toBeVisible();
  await expect(email).toBeFocused();
  await expect(email).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#reg-email-error")).toHaveText(existingMessage);

  await email.fill(`registro-${Date.now()}@example.com`);
  await expect(page.locator("#reg-email-error")).toHaveCount(0);
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.getByRole("button", { name: "Confirmar y crear cuenta" }).click();

  await expectVerificationStep(page);
});

test("validates each homeschool document from the profile and keeps the preview on rejection", async ({
  page,
  request,
}) => {
  // Los documentos ya no se piden al registrarse: se suben desde el perfil.
  const email = `casa-ui-${Date.now()}@example.com`;
  const { response } = await registerBebrasProfile(request, {
    email,
    institutionType: "homeschool",
    fields: { schoolName: "Educación en casa" },
  });
  expect(response.status(), await response.text()).toBe(201);

  await loginPage(page, { email, password: "segura123" }, /\/perfil\/?$/);
  const front = page.locator("#banner-idFront");
  const back = page.locator("#banner-idBack");
  await expect(
    page.getByRole("button", { name: "Subir anverso del carnet" }),
  ).toBeVisible({ timeout: 15000 });
  const toast = (text: string) =>
    page.locator("[data-sonner-toast]").filter({ hasText: text });
  const review = page.getByRole("dialog", {
    name: "Revisa el documento antes de continuar",
  });

  // Tipo y tamaño se revisan antes de mostrar nada.
  await front.setInputFiles({
    name: "carnet.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("documento"),
  });
  await expect(toast("Elige un archivo PDF, JPG o PNG.")).toBeVisible();
  await expect(review).toHaveCount(0);
  await front.setInputFiles({
    name: "carnet.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.alloc(5 * 1024 * 1024 + 1, 0xff),
  });
  await expect(
    toast("El documento no debe estar vacío ni pesar más de 5 MB."),
  ).toBeVisible();
  await expect(review).toHaveCount(0);

  // Uno bueno: se revisa y se envía.
  await front.setInputFiles(VALID_JPG);
  await expect(review).toContainText(VALID_JPG.name);
  await review.getByRole("button", { name: "Sí, enviar documento" }).click();
  await expect(review).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Subir anverso del carnet" }),
  ).toHaveCount(0);

  // Un PNG que no es PNG: el servidor lo rechaza y la vista previa queda para
  // cambiar el archivo.
  await back.setInputFiles({
    name: "reverso.png",
    mimeType: "image/png",
    buffer: Buffer.from("contenido inválido"),
  });
  await review.getByRole("button", { name: "Sí, enviar documento" }).click();
  await expect(toast("El contenido del documento no coincide")).toBeVisible();
  await expect(review).toBeVisible();
  await back.setInputFiles(VALID_PNG);
  await expect(review).toContainText(VALID_PNG.name);
  await review.getByRole("button", { name: "Sí, enviar documento" }).click();
  await expect(review).toHaveCount(0);

  const session = await loginUser(request, { email, password: "segura123" });
  const me = await request
    .get(`${API}/api/auth/me`, { headers: session.headers })
    .then((r) => r.json());
  expect(me.documents).toMatchObject({
    idFront: true,
    idBack: true,
    complete: true,
  });
});
