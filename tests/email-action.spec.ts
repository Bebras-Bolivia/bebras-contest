import { expect, request, test } from "@playwright/test";

import {
  createFirebaseUser,
  registerBebrasProfile,
  uniqueEmail,
} from "./support/helpers";

const FIREBASE_EMULATOR = "http://127.0.0.1:9099";
const FIREBASE_PROJECT_ID = "bebras-bo-staging";

test("verifies an emulator email action and automatically opens the session", async ({
  page,
}) => {
  const api = await request.newContext();
  const email = uniqueEmail("accion-correo");
  const password = "segura123";

  try {
    const identity = await createFirebaseUser(api, {
      email,
      password,
      emailVerified: false,
    });
    const { response: profile } = await registerBebrasProfile(api, {
      identity,
      fields: {
        firstName: "Acción",
        lastName: "Correo",
        schoolName: "Colegio de Prueba",
        phone: "70000006",
      },
    });
    expect(profile.status(), await profile.text()).toBe(201);

    await page.goto("/login");
    await page.waitForFunction(
      () => {
        const island = document.querySelector(
          'astro-island[component-url*="login-form"]',
        );
        return island !== null && !island.hasAttribute("ssr");
      },
      null,
      { timeout: 30000 },
    );
    await page.getByRole("textbox", { name: "Correo", exact: true }).fill(email);
    await page.getByLabel("Contraseña", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page.getByText("Verifica tu correo", { exact: true })).toBeVisible();

    // Reproduce una sesión Bebras vieja: el retorno explícito debe reemplazarla.
    await page.evaluate(() => {
      localStorage.setItem("bebras_token", "stale-token");
      localStorage.setItem(
        "bebras_user",
        JSON.stringify({
          id: 999999,
          email: "anterior@example.com",
          name: "Sesión anterior",
          role: "maestro",
        }),
      );
    });

    const apiKey = process.env.E2E_FIREBASE_API_KEY;
    expect(apiKey).toBeTruthy();
    const sent = await api.post(
      `${FIREBASE_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${apiKey}`,
      {
        data: {
          requestType: "VERIFY_EMAIL",
          idToken: identity.token,
        },
      },
    );
    expect(sent.ok(), await sent.text()).toBe(true);

    const listed = await api.get(
      `${FIREBASE_EMULATOR}/emulator/v1/projects/${FIREBASE_PROJECT_ID}/oobCodes`,
    );
    expect(listed.ok(), await listed.text()).toBe(true);
    const body = (await listed.json()) as {
      oobCodes?: Array<{
        email?: string;
        oobCode?: string;
        requestType?: string;
      }>;
    };
    const action = body.oobCodes
      ?.toReversed()
      .find(
        (item) =>
          item.email === email && item.requestType === "VERIFY_EMAIL",
      );
    expect(action?.oobCode).toBeTruthy();

    const continuation = "http://localhost:4421/login?verified=1";
    await page.goto(
      `/auth/action?mode=verifyEmail&oobCode=${encodeURIComponent(action!.oobCode!)}&continueUrl=${encodeURIComponent(continuation)}&lang=es`,
    );

    await expect(page).toHaveURL(/\/perfil\/?$/, { timeout: 15000 });
    await expect(page.getByText(email).first()).toBeVisible({ timeout: 15000 });
    expect(
      await page.evaluate(() => localStorage.getItem("bebras_user")),
    ).toContain(email);
  } finally {
    await api.dispose();
  }
});
