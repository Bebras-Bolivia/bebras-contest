import { gradeCh08 } from "./interactive-graders/ch-08";
import { isCorrectMx02b, MX_02B_CODE } from "./interactive-graders/mx-02b";

/** Se corrige lo que devuelve `task.getAnswer()`, nunca el puntaje de la tarea. */
export type InteractiveElement = {
  type: "html" | "javascript" | "library";
  content: string;
};

export type InteractiveConfig = {
  version: 1;
  engine: { name: string; version: string };
  width: number;
  height: number;
  elements: InteractiveElement[];
};

export type InteractiveKey = {
  version: 1;
  validator: InteractiveValidator;
  acceptedAnswers: string[];
};

export type InteractiveAnswer = {
  version: 1;
  answer: string;
  state?: string;
};

export const INTERACTIVE_VALIDATORS = [
  "accepted-answers",
  MX_02B_CODE,
  "2026-CH-08",
] as const;
export type InteractiveValidator = (typeof INTERACTIVE_VALIDATORS)[number];

const ENGINE_NAME = /^[a-z][a-z0-9-]{0,39}$/;
const ENGINE_VERSION = /^[0-9a-f]{12}$/;
const LIBRARY_URL =
  /^data:(?:text|application)\/javascript;base64,[a-z0-9+/]+={0,2}(?:#[\w.-]*)?$/i;
const MAX_ELEMENTS = 40;
const MAX_ACCEPTED_ANSWERS = 200;
const MAX_ANSWER_LENGTH = 64_000;
const MAX_STATE_LENGTH = 200_000;

export function interactiveEngineKey(engine: {
  name: string;
  version: string;
}) {
  return `interactive/engines/${engine.name}-${engine.version}.js`;
}

export function parseInteractiveEngineKey(key: string) {
  const match =
    /^interactive\/engines\/([a-z][a-z0-9-]{0,39})-([0-9a-f]{12})\.js$/.exec(
      key,
    );
  return match ? { name: match[1], version: match[2] } : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readDimension(value: unknown, label: string) {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 100 ||
    value > 2000
  ) {
    throw new Error(
      `El ${label} de la actividad debe estar entre 100 y 2000 px.`,
    );
  }
  return value;
}

export function parseInteractiveConfig(value: unknown): InteractiveConfig {
  if (!isRecord(value) || value.version !== 1) {
    throw new Error(
      "La configuración de la actividad interactiva no es válida.",
    );
  }
  const engine = value.engine;
  if (
    !isRecord(engine) ||
    typeof engine.name !== "string" ||
    !ENGINE_NAME.test(engine.name) ||
    typeof engine.version !== "string" ||
    !ENGINE_VERSION.test(engine.version)
  ) {
    throw new Error(
      "La actividad interactiva debe indicar su motor y versión.",
    );
  }
  if (!Array.isArray(value.elements) || value.elements.length === 0) {
    throw new Error("La actividad interactiva no tiene código.");
  }
  if (value.elements.length > MAX_ELEMENTS) {
    throw new Error("La actividad interactiva tiene demasiados elementos.");
  }
  const elements = value.elements.map((entry): InteractiveElement => {
    if (
      !isRecord(entry) ||
      (entry.type !== "html" &&
        entry.type !== "javascript" &&
        entry.type !== "library") ||
      typeof entry.content !== "string"
    ) {
      throw new Error("Un elemento de la actividad interactiva no es válido.");
    }
    if (
      entry.type === "javascript" &&
      /^\s*var grader\s*=/.test(entry.content)
    ) {
      throw new Error(
        "El corrector de ViLLE no se guarda en la tarea: la corrige el servidor.",
      );
    }
    if (entry.type === "library" && !LIBRARY_URL.test(entry.content)) {
      throw new Error(
        "Cada librería de la actividad debe ir incluida como JavaScript en la tarea.",
      );
    }
    return { type: entry.type, content: entry.content };
  });
  if (!elements.some((element) => element.type === "javascript")) {
    throw new Error("La actividad interactiva no tiene código.");
  }
  return {
    version: 1,
    engine: { name: engine.name, version: engine.version },
    width: readDimension(value.width, "ancho"),
    height: readDimension(value.height, "alto"),
    elements,
  };
}

export function parseInteractiveKey(value: unknown): InteractiveKey {
  if (!isRecord(value) || value.version !== 1) {
    throw new Error(
      "Las respuestas de la actividad interactiva no son válidas.",
    );
  }
  const validator = INTERACTIVE_VALIDATORS.find(
    (name) => name === value.validator,
  );
  if (!validator) {
    throw new Error("La actividad interactiva usa un corrector desconocido.");
  }
  const accepted = value.acceptedAnswers ?? [];
  if (
    !Array.isArray(accepted) ||
    accepted.length > MAX_ACCEPTED_ANSWERS ||
    accepted.some(
      (answer) =>
        typeof answer !== "string" ||
        !answer.trim() ||
        answer.length > MAX_ANSWER_LENGTH,
    )
  ) {
    throw new Error("Las respuestas aceptadas de la actividad no son válidas.");
  }
  const acceptedAnswers = [...new Set(accepted as string[])];
  if (validator === "accepted-answers" && acceptedAnswers.length === 0) {
    throw new Error("Falta al menos una respuesta aceptada.");
  }
  return { version: 1, validator, acceptedAnswers };
}

export function readInteractiveAnswer(
  payload: unknown,
): InteractiveAnswer | null {
  if (!isRecord(payload) || payload.version !== 1) return null;
  const { answer, state } = payload;
  if (typeof answer !== "string" || !answer.trim()) return null;
  if (state !== undefined && typeof state !== "string") return null;
  return state === undefined
    ? { version: 1, answer }
    : { version: 1, answer, state };
}

export function validateInteractiveAnswer(payload: unknown) {
  if (!isRecord(payload)) return false;
  if (Object.keys(payload).length === 0) return true;
  if (
    Object.keys(payload).some(
      (key) => !["version", "answer", "state"].includes(key),
    )
  )
    return false;
  const answer = readInteractiveAnswer(payload);
  return (
    answer !== null &&
    answer.answer.length <= MAX_ANSWER_LENGTH &&
    (answer.state ?? "").length <= MAX_STATE_LENGTH
  );
}

function canonicalJson(value: string): string | null {
  const sort = (node: unknown): unknown =>
    Array.isArray(node)
      ? node.map(sort)
      : isRecord(node)
        ? Object.fromEntries(
            Object.keys(node)
              .sort()
              .map((key) => [key, sort(node[key])]),
          )
        : node;
  try {
    return JSON.stringify(sort(JSON.parse(value)));
  } catch {
    return null;
  }
}

export function matchesAcceptedAnswer(answer: string, accepted: string[]) {
  if (accepted.includes(answer)) return true;
  const given = canonicalJson(answer);
  return (
    given !== null && accepted.some((option) => canonicalJson(option) === given)
  );
}

export function interactiveAnswerIsCorrect(
  keyValue: unknown,
  payload: unknown,
) {
  const answer = readInteractiveAnswer(payload);
  if (!answer) return false;
  let key: InteractiveKey;
  try {
    key = parseInteractiveKey(keyValue);
  } catch {
    return false;
  }
  switch (key.validator) {
    case "accepted-answers":
      return matchesAcceptedAnswer(answer.answer, key.acceptedAnswers);
    case MX_02B_CODE:
      return isCorrectMx02b(answer.answer);
    case "2026-CH-08":
      return gradeCh08(answer.answer);
  }
}
