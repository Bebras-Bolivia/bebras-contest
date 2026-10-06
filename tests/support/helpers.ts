import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const API = "http://localhost:3100";
const FIREBASE_EMULATOR = "http://127.0.0.1:9099";
const FIREBASE_PROJECT_ID = "bebras-bo-staging";

export const ADMIN = {
  email: process.env.E2E_ADMIN_EMAIL ?? "marko@bebras.bo",
  password: process.env.E2E_ADMIN_PASSWORD ?? "bebras-e2e-only",
};

type FirebaseCredentials = { email: string; password: string };
type Upload = { name: string; mimeType: string; buffer: Buffer };
export type FirebaseTestUser = FirebaseCredentials & {
  uid: string;
  token: string;
  headers: { authorization: string };
};

let uniqueUserIndex = 0;

export async function setE2EClock(
  api: APIRequestContext,
  value: Date | string,
) {
  const now = typeof value === "string" ? value : value.toISOString();
  const response = await api.put(`${API}/api/e2e/clock`, { data: { now } });
  expect(response.ok(), await response.text()).toBe(true);
}

export async function resetE2EClock(api: APIRequestContext) {
  const response = await api.delete(`${API}/api/e2e/clock`);
  expect(response.ok(), await response.text()).toBe(true);
}

export function uniqueEmail(prefix = "maestro") {
  uniqueUserIndex += 1;
  return `${prefix}-${Date.now()}-${uniqueUserIndex}@example.com`;
}

function firebaseApiBase() {
  const emulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  return emulatorHost
    ? `${emulatorHost}/identitytoolkit.googleapis.com`
    : "https://identitytoolkit.googleapis.com";
}

/** Obtiene un ID token sin exigir que el perfil Bebras ya exista. */
export async function signInFirebaseUser(
  api: APIRequestContext,
  credentials: FirebaseCredentials,
) {
  const apiKey = process.env.E2E_FIREBASE_API_KEY;
  if (!apiKey) {
    throw new Error("Falta E2E_FIREBASE_API_KEY para autenticar Firebase E2E.");
  }

  const response = await api.post(
    `${firebaseApiBase()}/v1/accounts:signInWithPassword?key=${apiKey}`,
    { data: { ...credentials, returnSecureToken: true } },
  );
  const body = (await response.json()) as {
    idToken?: string;
    localId?: string;
    error?: { message?: string };
  };
  if (!response.ok() || !body.idToken || !body.localId) {
    throw new Error(
      `Firebase no autenticó a ${credentials.email} (${response.status()}: ${body.error?.message ?? "sin ID token"}).`,
    );
  }

  return {
    ...credentials,
    uid: body.localId,
    token: body.idToken,
    headers: { authorization: `Bearer ${body.idToken}` },
  } satisfies FirebaseTestUser;
}

/** Crea una identidad verificada y estable para pruebas que luego iniciarán sesión. */
export async function createFirebaseUser(
  api: APIRequestContext,
  options: Partial<FirebaseCredentials> & { emailVerified?: boolean } = {},
) {
  const email = options.email ?? uniqueEmail();
  const password = options.password ?? "segura123";
  uniqueUserIndex += 1;
  const uid = `e2e-${Date.now()}-${uniqueUserIndex}`;
  const response = await api.post(
    `${FIREBASE_EMULATOR}/identitytoolkit.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/accounts`,
    {
      headers: { authorization: "Bearer owner" },
      data: {
        localId: uid,
        email,
        emailVerified: options.emailVerified ?? true,
        password,
      },
    },
  );
  if (!response.ok()) {
    throw new Error(
      `No se pudo crear ${email} en Firebase Auth Emulator (${response.status()}: ${await response.text()}).`,
    );
  }

  return signInFirebaseUser(api, { email, password });
}

export async function registerBebrasProfile(
  api: APIRequestContext,
  options: {
    identity?: FirebaseTestUser;
    email?: string;
    password?: string;
    emailVerified?: boolean;
    institutionType?: "school" | "homeschool";
    fields?: Record<string, string | Upload>;
  } = {},
) {
  const identity =
    options.identity ??
    (await createFirebaseUser(api, {
      email: options.email,
      password: options.password,
      emailVerified: options.emailVerified,
    }));
  const institutionType = options.institutionType ?? "school";
  const response = await api.post(`${API}/api/auth/register`, {
    headers: identity.headers,
    multipart: {
      ...registrationFields(institutionType),
      ...options.fields,
    },
  });

  return { identity, response };
}

/**
 * La autenticacion es Firebase, asi que el token de las suites tambien tiene que
 * salir de Firebase. `E2E_FIREBASE_API_KEY` decide contra que proyecto: usar el
 * emulador de Auth o un proyecto aparte, nunca `bebras-bo`, para no mezclar
 * usuarios de prueba con los reales.
 */
export async function loginUser(
  api: APIRequestContext,
  credentials: { email: string; password: string },
) {
  if (!credentials.email || !credentials.password) {
    throw new Error(
      "Faltan las credenciales E2E para autenticar la cuenta Firebase.",
    );
  }
  const firebaseSession = await signInFirebaseUser(api, credentials);
  const authorization = firebaseSession.headers.authorization;
  const bebrasResponse = await api.post(`${API}/api/auth/session`, {
    headers: { authorization },
  });
  if (!bebrasResponse.ok()) {
    throw new Error(
      `No se pudo abrir la sesión Bebras E2E (${bebrasResponse.status()}).`,
    );
  }

  const bebrasSession = (await bebrasResponse.json()) as {
    user: { email: string; status: string };
  };
  return { headers: { authorization }, user: bebrasSession.user };
}

export async function loginAdmin(api: APIRequestContext) {
  return (await loginUser(api, ADMIN)).headers;
}

export async function loginPage(
  page: Page,
  credentials: { email: string; password: string },
  destination: RegExp,
) {
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
  await page
    .getByRole("textbox", { name: "Correo", exact: true })
    .fill(credentials.email);
  await page
    .getByLabel("Contraseña", { exact: true })
    .fill(credentials.password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL(destination, { timeout: 15000 });
}

export async function loginAdminPage(page: Page) {
  await loginPage(page, ADMIN, /\/desafios\/?$/);
}

export const SEEDED_TASK = {
  taskId: "seed-bebras-easy",
  category: "Capibara",
  grade: "P3",
};

export const SCORING_TASKS = [
  {
    taskId: "seed-bebras-easy",
    difficulty: "easy",
    minScore: -2,
    noAnswerScore: 0,
    maxScore: 6,
  },
  {
    taskId: "seed-bebras-medium",
    difficulty: "medium",
    minScore: -3,
    noAnswerScore: 0,
    maxScore: 9,
  },
  {
    taskId: "seed-bebras-hard",
    difficulty: "hard",
    minScore: -4,
    noAnswerScore: 0,
    maxScore: 12,
  },
] as const;

export async function createContest(
  api: APIRequestContext,
  headers: Record<string, string>,
  overrides: Record<string, unknown> = {},
) {
  const picked = SEEDED_TASK;
  const now = Date.now();
  const startsAt =
    typeof overrides.startsAt === "string"
      ? new Date(overrides.startsAt)
      : new Date(now + 2 * 3600000);
  const registrationEndsAt = new Date(
    Math.min(now + 3600000, startsAt.getTime() - 60000),
  );

  await resetE2EClock(api);

  const created = await api.post(`${API}/api/contests`, {
    headers,
    data: {
      title: "PW Eval " + Date.now(),
      category: picked.category,
      durationMinutes: 60,
      registrationStartsAt: new Date(
        registrationEndsAt.getTime() - 2 * 3600000,
      ).toISOString(),
      registrationEndsAt: registrationEndsAt.toISOString(),
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + 3 * 3600000).toISOString(),
      allowPairs: false,
      showFeedback: true,
      showSolutions: true,
      showTotalScore: true,
      tasks: [{ taskId: picked.taskId }],
      ...overrides,
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const contest = await created.json();

  const published = await api.post(
    `${API}/api/contests/${contest.id}/publish`,
    { headers },
  );
  expect(published.ok(), await published.text()).toBe(true);

  return { ...contest, picked };
}

export async function openContest(
  api: APIRequestContext,
  contest: { startsAt: string; endsAt: string },
) {
  const startsAt = new Date(contest.startsAt).getTime();
  const endsAt = new Date(contest.endsAt).getTime();
  const executionTime = Math.min(
    Math.max(Date.now(), startsAt + 1000),
    endsAt - 1000,
  );
  await setE2EClock(api, new Date(executionTime));
}

async function enterContestRegistration(
  api: APIRequestContext,
  headers: Record<string, string>,
  contestId: string,
) {
  const response = await api.get(`${API}/api/contests/${contestId}`, {
    headers,
  });
  expect(response.ok(), await response.text()).toBe(true);
  const contest = (await response.json()) as {
    registrationStartsAt: string;
    registrationEndsAt: string;
    startsAt: string;
    endsAt: string;
  };
  const registrationStartsAt = new Date(contest.registrationStartsAt).getTime();
  const registrationEndsAt = new Date(contest.registrationEndsAt).getTime();
  await setE2EClock(
    api,
    new Date((registrationStartsAt + registrationEndsAt) / 2),
  );
  return contest;
}

export async function joinContest(
  api: APIRequestContext,
  headers: Record<string, string>,
  contestId: string,
  grade: string,
  firstName = "Playwright",
) {
  const contest = await enterContestRegistration(api, headers, contestId);
  const group = await api
    .post(`${API}/api/groups`, {
      headers,
      data: { contestId, name: "PW Group" },
    })
    .then((r) => r.json());

  const response = await api.post(`${API}/api/play/join`, {
    data: {
      accessCode: group.accessCode,
      participationMode: "individual",
      grade,
      memberOneFirstName: firstName,
      memberOneLastName: "Tester",
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const join = await response.json();
  await openContest(api, contest);

  return join.personalCode as string;
}

export function playHeaders(sessionToken: string) {
  return { "x-play-session": sessionToken };
}

export async function joinContestSession(
  api: APIRequestContext,
  headers: Record<string, string>,
  contestId: string,
  grade: string,
  firstName = "Playwright",
  lastName = "Tester",
) {
  const contest = await enterContestRegistration(api, headers, contestId);
  const group = await api
    .post(`${API}/api/groups`, {
      headers,
      data: { contestId, name: "PW Group" },
    })
    .then((r) => r.json());

  const join = await api.post(`${API}/api/play/join`, {
    data: {
      accessCode: group.accessCode,
      participationMode: "individual",
      grade,
      memberOneFirstName: firstName,
      memberOneLastName: lastName,
    },
  });
  expect(join.ok(), await join.text()).toBe(true);

  const personalCode = (await join.json()).personalCode as string;
  await openContest(api, contest);

  // Rendir exige el codigo personal; el del grupo solo sirve para inscribirse.
  const session = await api.post(`${API}/api/play/session`, {
    data: { personalCode },
  });
  expect(session.ok(), await session.text()).toBe(true);

  return {
    accessCode: group.accessCode as string,
    personalCode,
    sessionToken: (await session.json()).sessionToken as string,
    firstName,
    lastName,
  };
}

export async function createScoringTask(
  api: APIRequestContext,
  headers: Record<string, string>,
  difficulty: (typeof SCORING_TASKS)[number]["difficulty"],
  index: number,
) {
  const block = (id: string, content: string) => ({
    id,
    type: "text",
    content,
    image: null,
    widthPercent: 100,
  });
  const response = await api.post(`${API}/api/tasks`, {
    headers,
    data: {
      title: `PW ${difficulty} ${index} ${Date.now()}`,
      categories: ["Algoritmos y programación"],
      difficulties: { "8–10": difficulty },
      bodyBlocks: [block(`body-${difficulty}-${index}`, "Contenido")],
      challengeBlocks: [
        block(`challenge-${difficulty}-${index}`, "Selecciona B"),
      ],
      answerType: "multiple_choice",
      multipleChoiceOrderMode: "fixed",
      answers: [
        {
          id: "A",
          blocks: [block(`answer-a-${difficulty}-${index}`, "Incorrecta")],
        },
        {
          id: "B",
          blocks: [block(`answer-b-${difficulty}-${index}`, "Correcta")],
        },
      ],
      correctAnswerId: "single:B",
      explanationBlocks: [
        block(
          `explicacion-${difficulty}-${index}`,
          "B es la respuesta correcta.",
        ),
      ],
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const task = await response.json();
  const scoring = SCORING_TASKS.find(
    (candidate) => candidate.difficulty === difficulty,
  )!;

  return { ...scoring, taskId: task.id as string };
}

export async function submitScoringAttempt(
  api: APIRequestContext,
  headers: Record<string, string>,
  contestId: string,
  tasks: ReadonlyArray<{ taskId: string }>,
  firstName: string,
  selectedForTask: (index: number) => "A" | "B" | null,
) {
  const personalCode = await joinContest(
    api,
    headers,
    contestId,
    SEEDED_TASK.grade,
    firstName,
  );
  const start = await api.post(`${API}/api/play/start`, {
    data: { personalCode },
  });
  expect(start.ok(), await start.text()).toBe(true);

  for (const [index, task] of tasks.entries()) {
    const selected = selectedForTask(index);
    if (!selected) {
      continue;
    }

    const answer = await api.post(`${API}/api/play/answer`, {
      data: {
        personalCode,
        taskId: task.taskId,
        payload: { selected: [selected] },
      },
    });
    expect(answer.status(), await answer.text()).toBe(204);
  }

  const submit = await api.post(`${API}/api/play/submit`, {
    data: { personalCode },
  });
  expect(submit.ok(), await submit.text()).toBe(true);
}

/**
 * Un maestro registrado con su carta y aprobado por el administrador: el
 * único que puede crear grupos y prácticas.
 */
export async function createApprovedTeacher(
  api: APIRequestContext,
  adminHeaders: Record<string, string>,
  fields: Record<string, string> = {},
) {
  const { identity, response } = await registerBebrasProfile(api, {
    fields: {
      letter: VALID_PDF,
      department: "COCHABAMBA",
      city: "Quillacollo",
      ...fields,
    } as Record<string, string | Upload>,
  });
  expect(response.status(), await response.text()).toBe(201);
  const maestros = (await api
    .get(`${API}/api/users/maestros`, { headers: adminHeaders })
    .then((r) => r.json())) as Array<{ id: number; email: string }>;
  const created = maestros.find((maestro) => maestro.email === identity.email);
  expect(created, `No aparece ${identity.email} en la lista`).toBeTruthy();
  const approved = await api.post(`${API}/api/users/${created!.id}/approve`, {
    headers: adminHeaders,
  });
  expect(approved.ok(), await approved.text()).toBe(true);
  const session = await loginUser(api, identity);
  return { id: created!.id, identity, headers: session.headers };
}

export function registrationFields(institutionType: "school" | "homeschool") {
  return {
    firstName: "Registro",
    lastName: "Documentado",
    schoolName:
      institutionType === "school" ? "Colegio manual" : "Educación en casa",
    institutionType,
    phone: "70000000",
    // Sin colegio del catálogo, el registro pide dónde está.
    department: "COCHABAMBA",
    city: "Quillacollo",
  };
}

export const VALID_PDF = {
  name: "carta.pdf",
  mimeType: "application/pdf",
  buffer: Buffer.from("%PDF-1.4\n"),
};
export const VALID_JPG = {
  name: "anverso.jpg",
  mimeType: "image/jpeg",
  buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
};
export const VALID_PNG = {
  name: "reverso.png",
  mimeType: "image/png",
  buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
};

export function taskBlock(id: string, content: string) {
  return { id, type: "text", content, image: null, widthPercent: 100 };
}

export const DRAG_DROP_BACKGROUND = {
  id: "drag-background",
  name: "escenario.svg",
  url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 500'%3E%3Crect width='800' height='500' fill='%23e2e8f0'/%3E%3C/svg%3E",
};
export const DRAG_DROP_INPUT_TARGETS = [
  {
    id: "drop-zone-two",
    x: 75.123456789,
    y: 65.234567891,
    snapRadius: 10,
  },
  {
    id: "drop-zone-one",
    x: 24.876543211,
    y: 34.765432109,
    snapRadius: 10,
  },
];
export const DRAG_DROP_TARGETS = DRAG_DROP_INPUT_TARGETS.map((target) => ({
  ...target,
  x: Math.round(target.x * 1000) / 1000,
  y: Math.round(target.y * 1000) / 1000,
}));
export const DRAG_DROP_ITEMS = [
  {
    id: "drag-item-a",
    label: "Objeto alfa",
    image: {
      id: "drag-image-a",
      name: "objeto-alfa.svg",
      url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='60' viewBox='0 0 80 60'%3E%3Crect width='80' height='60' fill='%23ef4444'/%3E%3C/svg%3E",
    },
    widthPercent: 12,
    correctTargetId: "drop-zone-two",
  },
  {
    id: "drag-item-b",
    label: "Objeto beta",
    image: {
      id: "drag-image-b",
      name: "objeto-beta.svg",
      url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='60' viewBox='0 0 80 60'%3E%3Ccircle cx='40' cy='30' r='28' fill='%233b82f6'/%3E%3C/svg%3E",
    },
    widthPercent: 16,
    correctTargetId: "drop-zone-one",
  },
];

export const DRAG_DROP_CORRECT_PLACEMENTS = Object.fromEntries(
  DRAG_DROP_ITEMS.map((item) => [item.id, item.correctTargetId]),
);

export async function createPracticeTask(
  api: APIRequestContext,
  headers: Record<string, string>,
  answerType: "multiple_choice" | "short_text" | "drag_drop",
  overrides: Record<string, unknown> = {},
) {
  const suffix = `${answerType}-${Date.now()}`;
  const response = await api.post(`${API}/api/tasks`, {
    headers,
    data: {
      title: `Práctica ${answerType}`,
      categories: ["Algoritmos y programación"],
      difficulties: { "10–12": "medium" },
      bodyBlocks: [taskBlock(`body-${suffix}`, "Contenido")],
      challengeBlocks: [taskBlock(`challenge-${suffix}`, "Resuelve")],
      answerType,
      multipleChoiceOrderMode: "fixed",
      answers:
        answerType === "multiple_choice"
          ? [
              { id: "A", blocks: [taskBlock(`a-${suffix}`, "Incorrecta")] },
              { id: "B", blocks: [taskBlock(`b-${suffix}`, "Correcta")] },
            ]
          : [],
      correctAnswerId: answerType === "multiple_choice" ? "single:B" : "",
      shortAnswer: answerType === "short_text" ? "Bebras" : "",
      dragDropBackground:
        answerType === "drag_drop" ? DRAG_DROP_BACKGROUND : null,
      dragDropItems: answerType === "drag_drop" ? DRAG_DROP_ITEMS : [],
      dragDropTargets:
        answerType === "drag_drop" ? DRAG_DROP_INPUT_TARGETS : [],
      explanationBlocks: [
        taskBlock(`explicacion-${suffix}`, `Explicación ${answerType}`),
      ],
      isPractice: true,
      ...overrides,
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const task = await response.json();
  if (answerType === "drag_drop") {
    expect(task.dragDropTargets).toEqual(DRAG_DROP_TARGETS);
  }
  return task;
}

/**
 * Guardar desde el editor navega a la lista y el cuerpo de la respuesta ya no
 * se puede leer: la tarea recién creada se busca por su título.
 */
export async function findTaskByTitle(
  api: APIRequestContext,
  headers: Record<string, string>,
  title: string,
) {
  const tasks = (await api
    .get(`${API}/api/tasks`, { headers })
    .then((response) => response.json())) as Array<{
    id: string;
    title: string;
  }>;
  const found = tasks.find((task) => task.title === title);
  expect(found, `No se encontró la tarea «${title}»`).toBeTruthy();
  return api
    .get(`${API}/api/tasks/${found!.id}`, { headers })
    .then((response) => response.json());
}
