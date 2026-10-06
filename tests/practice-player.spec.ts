import { test, expect, request } from "@playwright/test";
import {
  API,
  loginAdmin,
  taskBlock,
  DRAG_DROP_TARGETS,
  DRAG_DROP_ITEMS,
  DRAG_DROP_CORRECT_PLACEMENTS,
  createPracticeTask,
} from "./support/helpers";

test("solves a v2 drag-drop practice task with pointer and touch input", async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  const api = await request.newContext();
  const headers = await loginAdmin(api);
  const task = await createPracticeTask(api, headers, "drag_drop");
  await api.dispose();

  await page.goto(`/practica/tarea?id=${task.id}&nombre=Titi`);
  // Primera página de la corrida: el servidor de desarrollo aún compila.
  await expect(page.getByRole("heading", { name: task.title })).toBeVisible({
    timeout: 20000,
  });

  const stage = page.locator('[aria-label^="Escenario de la tarea."]');
  // La bandeja conserva el hueco de cada objeto, así que el nombre tiene que
  // coincidir exacto para no chocar con el botón «Devolver ... a su lugar».
  const itemButton = (label: string) =>
    page.getByRole("button", { name: label, exact: true });
  const targetPoint = async (target: (typeof DRAG_DROP_TARGETS)[number]) => {
    const box = await stage.boundingBox();
    expect(box).not.toBeNull();
    return {
      x: box!.x + (target.x / 100) * box!.width,
      y: box!.y + (target.y / 100) * box!.height,
    };
  };
  const expectAtTarget = async (
    label: string,
    target: (typeof DRAG_DROP_TARGETS)[number],
    activeStage = stage,
    activeItemButton = itemButton(label),
  ) => {
    const [buttonBox, point] = await Promise.all([
      activeItemButton.boundingBox(),
      (async () => {
        const box = await activeStage.boundingBox();
        expect(box).not.toBeNull();
        return {
          x: box!.x + (target.x / 100) * box!.width,
          y: box!.y + (target.y / 100) * box!.height,
        };
      })(),
    ]);
    expect(buttonBox).not.toBeNull();
    expect(
      Math.abs(buttonBox!.x + buttonBox!.width / 2 - point.x),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(buttonBox!.y + buttonBox!.height / 2 - point.y),
    ).toBeLessThanOrEqual(1);
  };
  const expectScaledWidth = async (
    label: string,
    widthPercent: number,
    activeStage = stage,
    activeItemButton = itemButton(label),
  ) => {
    // Al colocarse, la pieza se asienta con una animación que empieza con
    // una escala de 1,06: se mide cuando termina.
    await expect
      .poll(async () => {
        const [buttonBox, stageBox] = await Promise.all([
          activeItemButton.boundingBox(),
          activeStage.boundingBox(),
        ]);
        return Math.abs(
          buttonBox!.width - (stageBox!.width * widthPercent) / 100,
        );
      })
      .toBeLessThanOrEqual(1);
  };

  await expect(stage).toHaveText("");
  await expect(stage.getByRole("button")).toHaveCount(0);
  const initialHtml = await stage.evaluate((element) => element.outerHTML);
  expect(initialHtml).not.toContain("snapRadius");
  for (const target of DRAG_DROP_TARGETS) {
    await expect(page.getByText(target.id, { exact: true })).toHaveCount(0);
  }

  // La bandeja se ordena a gusto: arrastrar una pieza sobre el lugar de otra
  // intercambia sus posiciones, y se puede dejar todo como estaba.
  const dragOnto = async (from: string, to: string) => {
    const [origin, destination] = await Promise.all([
      itemButton(from).boundingBox(),
      itemButton(to).boundingBox(),
    ]);
    expect(origin).not.toBeNull();
    expect(destination).not.toBeNull();
    await page.mouse.move(
      origin!.x + origin!.width / 2,
      origin!.y + origin!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      destination!.x + destination!.width / 2,
      destination!.y + destination!.height / 2,
      { steps: 8 },
    );
    await page.mouse.up();
  };
  const trayLeft = async (label: string) =>
    (await itemButton(label).boundingBox())!.x;
  const alphaLeft = await trayLeft(DRAG_DROP_ITEMS[0].label);
  const betaLeft = await trayLeft(DRAG_DROP_ITEMS[1].label);
  // Las piezas se deslizan a su lugar nuevo: se mide cuando terminan.
  await dragOnto(DRAG_DROP_ITEMS[0].label, DRAG_DROP_ITEMS[1].label);
  // Las piezas tienen anchos distintos: tras el intercambio cambia el orden,
  // y la que queda primera ocupa el lugar de la primera.
  await expect.poll(() => trayLeft(DRAG_DROP_ITEMS[1].label)).toBe(alphaLeft);
  await expect
    .poll(async () =>
      (await trayLeft(DRAG_DROP_ITEMS[0].label)) >
      (await trayLeft(DRAG_DROP_ITEMS[1].label)),
    )
    .toBe(true);
  await dragOnto(DRAG_DROP_ITEMS[1].label, DRAG_DROP_ITEMS[0].label);
  await expect.poll(() => trayLeft(DRAG_DROP_ITEMS[0].label)).toBe(alphaLeft);
  await expect.poll(() => trayLeft(DRAG_DROP_ITEMS[1].label)).toBe(betaLeft);
  await expect(stage.getByRole("button")).toHaveCount(0);

  const alpha = itemButton(DRAG_DROP_ITEMS[0].label);
  await alpha.click();
  await expect(alpha).toHaveAttribute("aria-pressed", "true");
  const beta = itemButton(DRAG_DROP_ITEMS[1].label);
  await beta.click();
  await expect(alpha).toHaveAttribute("aria-pressed", "false");
  await expect(beta).toHaveAttribute("aria-pressed", "true");
  await beta.click();
  await expect(beta).toHaveAttribute("aria-pressed", "false");
  await alpha.click();
  await stage.click({ position: { x: 400, y: 20 } });
  await expect(stage.getByRole("button")).toHaveCount(0);
  await expect(alpha).toHaveAttribute("aria-pressed", "true");

  const targetTwoPoint = await targetPoint(DRAG_DROP_TARGETS[0]);
  const stageBox = await stage.boundingBox();
  expect(stageBox).not.toBeNull();
  expect(stageBox!.width).toBeLessThanOrEqual(769);
  // Un toque lejos de todo lugar no coloca la pieza. (Cerca de un lugar sí:
  // se acepta a menos de 0,6 veces el ancho de la pieza.)
  await page.mouse.click(
    stageBox!.x + stageBox!.width * 0.5,
    stageBox!.y + stageBox!.height * 0.95,
  );
  await expect(stage.getByRole("button")).toHaveCount(0);
  await expect(alpha).toHaveAttribute("aria-pressed", "true");

  await page.mouse.click(targetTwoPoint.x, targetTwoPoint.y);
  await expectAtTarget(DRAG_DROP_ITEMS[0].label, DRAG_DROP_TARGETS[0]);
  await expectScaledWidth(
    DRAG_DROP_ITEMS[0].label,
    DRAG_DROP_ITEMS[0].widthPercent,
  );

  const betaBox = await beta.boundingBox();
  expect(betaBox).not.toBeNull();
  await page.mouse.move(
    betaBox!.x + betaBox!.width / 2,
    betaBox!.y + betaBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(targetTwoPoint.x, targetTwoPoint.y, { steps: 8 });
  await page.mouse.up();
  await expectAtTarget(DRAG_DROP_ITEMS[1].label, DRAG_DROP_TARGETS[0]);
  await expectScaledWidth(
    DRAG_DROP_ITEMS[1].label,
    DRAG_DROP_ITEMS[1].widthPercent,
  );
  await expect(stage.getByRole("button")).toHaveCount(1);
  await expect(alpha).toHaveAccessibleName(DRAG_DROP_ITEMS[0].label);

  await alpha.click();
  await beta.click();
  await expectAtTarget(DRAG_DROP_ITEMS[0].label, DRAG_DROP_TARGETS[0]);
  await expect(stage.getByRole("button")).toHaveCount(1);

  await beta.click();
  await alpha.click();
  await expectAtTarget(DRAG_DROP_ITEMS[1].label, DRAG_DROP_TARGETS[0]);
  await expect(stage.getByRole("button")).toHaveCount(1);

  await alpha.click();
  const targetOnePoint = await targetPoint(DRAG_DROP_TARGETS[1]);
  await page.mouse.click(targetOnePoint.x, targetOnePoint.y);
  await expectAtTarget(DRAG_DROP_ITEMS[0].label, DRAG_DROP_TARGETS[1]);

  await alpha.click();
  await beta.click();
  await expectAtTarget(DRAG_DROP_ITEMS[0].label, DRAG_DROP_TARGETS[0]);
  await expectAtTarget(DRAG_DROP_ITEMS[1].label, DRAG_DROP_TARGETS[1]);

  // Arrastrar una pieza fuera de la imagen la devuelve a la bandeja; el hueco
  // vacío queda en su sitio para volver a colocarla.
  const placedAlpha = await alpha.boundingBox();
  const stageBounds = await stage.boundingBox();
  expect(placedAlpha).not.toBeNull();
  expect(stageBounds).not.toBeNull();
  await page.mouse.move(
    placedAlpha!.x + placedAlpha!.width / 2,
    placedAlpha!.y + placedAlpha!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    stageBounds!.x + stageBounds!.width / 2,
    stageBounds!.y + stageBounds!.height + 60,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect(stage.getByRole("button")).toHaveCount(1);
  // Queda un solo hueco, el de la pieza que sigue en la imagen.
  await expect(
    page.getByRole("button", { name: /Lugar \d+ de la bandeja, vacío/ }),
  ).toHaveCount(1);

  await alpha.click();
  await page.mouse.click(targetTwoPoint.x, targetTwoPoint.y);
  await expectAtTarget(DRAG_DROP_ITEMS[0].label, DRAG_DROP_TARGETS[0]);
  await expect(stage.getByRole("button")).toHaveCount(2);

  const checkRequest = page.waitForRequest(
    (candidate) =>
      candidate.url() === `${API}/api/practice/tasks/${task.id}/check` &&
      candidate.method() === "POST",
  );
  await page.getByRole("button", { name: "Comprobar" }).click();
  expect((await checkRequest).postDataJSON()).toEqual({
    payload: { placements: DRAG_DROP_CORRECT_PLACEMENTS },
  });
  await expect(page.getByText("¡Correcto!", { exact: true })).toBeVisible();
  await expect(alpha).toBeDisabled();
  await expect(beta).toBeDisabled();

  const touchContext = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });
  try {
    const touchPage = await touchContext.newPage();
    await touchPage.goto(`/practica/tarea?id=${task.id}&nombre=Titi`);
    await expect(
      touchPage.getByRole("heading", { name: task.title }),
    ).toBeVisible();
    const touchStage = touchPage.locator(
      '[aria-label^="Escenario de la tarea."]',
    );
    const touchBeta = touchPage.getByRole("button", {
      name: DRAG_DROP_ITEMS[1].label,
      exact: true,
    });
    await touchBeta.tap();
    await expect(touchBeta).toHaveAttribute("aria-pressed", "true");
    const touchStageBox = await touchStage.boundingBox();
    expect(touchStageBox).not.toBeNull();
    const touchTarget = DRAG_DROP_TARGETS[1];
    await touchPage.touchscreen.tap(
      touchStageBox!.x + (touchTarget.x / 100) * touchStageBox!.width,
      touchStageBox!.y + (touchTarget.y / 100) * touchStageBox!.height,
    );
    const placedBeta = await touchBeta.boundingBox();
    expect(placedBeta).not.toBeNull();
    expect(
      Math.abs(
        placedBeta!.x +
          placedBeta!.width / 2 -
          (touchStageBox!.x + (touchTarget.x / 100) * touchStageBox!.width),
      ),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(
        placedBeta!.y +
          placedBeta!.height / 2 -
          (touchStageBox!.y + (touchTarget.y / 100) * touchStageBox!.height),
      ),
    ).toBeLessThanOrEqual(1);
    await expectScaledWidth(
      DRAG_DROP_ITEMS[1].label,
      DRAG_DROP_ITEMS[1].widthPercent,
      touchStage,
      touchBeta,
    );

    const touchAlpha = touchPage.getByRole("button", {
      name: DRAG_DROP_ITEMS[0].label,
      exact: true,
    });
    const touchAlphaBox = await touchAlpha.boundingBox();
    expect(touchAlphaBox).not.toBeNull();
    const touchTargetTwo = DRAG_DROP_TARGETS[0];
    const touchTargetTwoPoint = {
      x: touchStageBox!.x + (touchTargetTwo.x / 100) * touchStageBox!.width,
      y: touchStageBox!.y + (touchTargetTwo.y / 100) * touchStageBox!.height,
    };
    const start = {
      x: touchAlphaBox!.x + touchAlphaBox!.width / 2,
      y: touchAlphaBox!.y + touchAlphaBox!.height / 2,
    };
    const cdp = await touchContext.newCDPSession(touchPage);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ ...start, id: 1 }],
    });
    for (let step = 1; step <= 8; step += 1) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          {
            id: 1,
            x: start.x + ((touchTargetTwoPoint.x - start.x) * step) / 8,
            y: start.y + ((touchTargetTwoPoint.y - start.y) * step) / 8,
          },
        ],
      });
    }
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expectAtTarget(
      DRAG_DROP_ITEMS[0].label,
      DRAG_DROP_TARGETS[0],
      touchStage,
      touchAlpha,
    );
  } finally {
    await touchContext.close();
  }
});

test("places drag-drop objects with the keyboard without exposing targets", async ({
  page,
}) => {
  const api = await request.newContext();
  const headers = await loginAdmin(api);
  const task = await createPracticeTask(api, headers, "drag_drop");
  await api.dispose();

  await page.goto(`/practica/tarea?id=${task.id}&nombre=Titi`);
  const stage = page.locator('[aria-label^="Escenario de la tarea."]');
  const alpha = page.getByRole("button", {
    name: DRAG_DROP_ITEMS[0].label,
    exact: true,
  });
  const beta = page.getByRole("button", {
    name: DRAG_DROP_ITEMS[1].label,
    exact: true,
  });
  const expectAtTarget = async (
    button: typeof alpha,
    target: (typeof DRAG_DROP_TARGETS)[number],
  ) => {
    const [buttonBox, stageBox] = await Promise.all([
      button.boundingBox(),
      stage.boundingBox(),
    ]);
    expect(buttonBox).not.toBeNull();
    expect(stageBox).not.toBeNull();
    expect(
      Math.abs(
        buttonBox!.x +
          buttonBox!.width / 2 -
          (stageBox!.x + (target.x / 100) * stageBox!.width),
      ),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(
        buttonBox!.y +
          buttonBox!.height / 2 -
          (stageBox!.y + (target.y / 100) * stageBox!.height),
      ),
    ).toBeLessThanOrEqual(1);
  };

  await expect(alpha).toHaveAccessibleName(DRAG_DROP_ITEMS[0].label);
  await expect(
    page.getByRole("img", { name: DRAG_DROP_ITEMS[0].image.name }),
  ).toHaveCount(0);
  const dispatchIgnoredPointerDrag = async (
    pointerId: number,
    isPrimary: boolean,
    button: number,
  ) => {
    await alpha.dispatchEvent("pointerdown", {
      button,
      clientX: 20,
      clientY: 20,
      isPrimary,
      pointerId,
      pointerType: "pen",
    });
    await alpha.dispatchEvent("pointermove", {
      button,
      clientX: 200,
      clientY: 200,
      isPrimary,
      pointerId,
      pointerType: "pen",
    });
    await alpha.dispatchEvent("pointerup", {
      button,
      clientX: 200,
      clientY: 200,
      isPrimary,
      pointerId,
      pointerType: "pen",
    });
  };
  await dispatchIgnoredPointerDrag(9, false, 0);
  await dispatchIgnoredPointerDrag(10, true, 2);
  await expect(alpha).toHaveAttribute("aria-pressed", "false");
  await expect(stage.getByRole("button")).toHaveCount(0);

  await alpha.focus();
  await page.keyboard.press("Enter");
  await expect(stage).toBeFocused();
  await expect(alpha).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Enter");
  await expect(alpha).toHaveAttribute("aria-pressed", "true");

  for (let step = 0; step < 5; step += 1) {
    await page.keyboard.press("Shift+ArrowRight");
  }
  for (let step = 0; step < 3; step += 1) {
    await page.keyboard.press("Shift+ArrowDown");
  }
  await page.keyboard.press("Enter");
  await expectAtTarget(alpha, DRAG_DROP_TARGETS[0]);
  await expect(alpha).toBeFocused();

  await beta.focus();
  await page.keyboard.press("Enter");
  await expect(stage).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(beta).toHaveAttribute("aria-pressed", "false");
  await expect(beta).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(stage).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowLeft");
  for (let step = 0; step < 5; step += 1) {
    await page.keyboard.press("Shift+ArrowLeft");
  }
  for (let step = 0; step < 3; step += 1) {
    await page.keyboard.press("Shift+ArrowUp");
  }
  await expect(stage.locator("[data-keyboard-cursor]")).toHaveAttribute(
    "style",
    /left: 25%; top: 35%/,
  );
  await page.keyboard.press("Enter");
  await expectAtTarget(beta, DRAG_DROP_TARGETS[1]);

  const stageHtml = await stage.evaluate((element) => element.outerHTML);
  expect(stageHtml).not.toContain("snapRadius");
  for (const target of DRAG_DROP_TARGETS) {
    await expect(page.getByText(target.id, { exact: true })).toHaveCount(0);
  }
});

test("uses any and all selection modes in the practice player", async ({
  page,
}) => {
  const api = await request.newContext();
  const headers = await loginAdmin(api);
  const answers = ["A", "B", "C"].map((id) => ({
    id,
    blocks: [taskBlock(`player-${id}-${Date.now()}`, `Respuesta ${id}`)],
  }));
  const anyTask = await createPracticeTask(api, headers, "multiple_choice", {
    title: "Jugador criterio any",
    answers,
    correctAnswerId: "any:B,C",
  });
  const allTask = await createPracticeTask(api, headers, "multiple_choice", {
    title: "Jugador criterio all",
    answers,
    correctAnswerId: "all:B,C",
  });
  await api.dispose();

  await page.goto(`/practica/tarea?id=${anyTask.id}&nombre=Titi`);
  await page.getByRole("button", { name: "Respuesta B", exact: true }).click();
  await page.getByRole("button", { name: "Respuesta C", exact: true }).click();
  const anyCheck = page.waitForRequest(
    (candidate) =>
      candidate.url() === `${API}/api/practice/tasks/${anyTask.id}/check` &&
      candidate.method() === "POST",
  );
  await page.getByRole("button", { name: "Comprobar" }).click();
  expect((await anyCheck).postDataJSON().payload.selected).toEqual(["C"]);
  await expect(page.getByText("¡Correcto!", { exact: true })).toBeVisible();

  await page.goto(`/practica/tarea?id=${allTask.id}&nombre=Titi`);
  await expect(
    page.getByText("Debes marcar todas las opciones correctas.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Respuesta B", exact: true }).click();
  await page.getByRole("button", { name: "Respuesta C", exact: true }).click();
  const allCheck = page.waitForRequest(
    (candidate) =>
      candidate.url() === `${API}/api/practice/tasks/${allTask.id}/check` &&
      candidate.method() === "POST",
  );
  await page.getByRole("button", { name: "Comprobar" }).click();
  expect((await allCheck).postDataJSON().payload.selected).toEqual(["B", "C"]);
  await expect(page.getByText("¡Correcto!", { exact: true })).toBeVisible();
});

test("names written answer fields for assistive technology", async ({
  page,
}) => {
  const api = await request.newContext();
  const headers = await loginAdmin(api);
  const shortTextTask = await createPracticeTask(api, headers, "short_text", {
    title: "Campo accesible de texto",
  });
  await api.dispose();

  await page.goto(`/practica/tarea?id=${shortTextTask.id}&nombre=Titi`);
  await expect(
    page.getByRole("textbox", { name: "Tu respuesta", exact: true }),
  ).toBeVisible();
});

test("la práctica recuerda lo que se resolvió y deja seguir con la siguiente pregunta", async ({
  page,
  request,
}) => {
  const headers = await loginAdmin(request);
  const title = `Práctica recordada ${Date.now()}`;
  const task = await createPracticeTask(request, headers, "multiple_choice", { title });

  await page.goto(`/practica/tarea?nombre=Titi&id=${task.id}&from=%2Fpractica`);
  await page.getByRole("button", { name: "Correcta", exact: true }).click();
  await page.getByRole("button", { name: "Comprobar", exact: true }).click();
  await expect(page.getByText("¡Correcto!", { exact: true })).toBeVisible();
  // Después de comprobar se puede reintentar o seguir.
  await expect(page.getByRole("button", { name: "Intentar de nuevo" })).toBeVisible();
  const next = page.getByRole("link", { name: /^(Siguiente pregunta|Ver todas las preguntas)$/ });
  await expect(next).toBeVisible();

  await page.goto("/practica/categoria?nombre=Titi&from=%2Fpractica");
  const row = page.getByRole("link").filter({ hasText: title });
  await expect(row).toContainText("¡Resuelto!", { timeout: 15000 });
  // El avance se guarda en el navegador: sigue ahí al volver.
  await page.reload();
  await expect(row).toContainText("¡Resuelto!", { timeout: 15000 });
});
