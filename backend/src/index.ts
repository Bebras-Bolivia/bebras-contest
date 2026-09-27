import { env } from "cloudflare:workers";
import { httpServerHandler } from "cloudflare:node";
import express from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { createAuthorizationLetter } from "./lib/documents-pdf";
import { Readable } from "node:stream";
import { extname } from "node:path";
import { prisma, withRequestPrisma } from "./lib/prisma";
import type { Prisma } from "./generated/prisma/client";
import { formatPersonName } from "./lib/person-name";
import { validatePhone } from "./lib/phone";
import { validateEmail } from "./lib/email";
import { validateRegistrationText } from "./lib/registration-text";
import {
  countFilledBlocks,
  normalizeDragDropConfig,
  parseTaskAnswerConfig,
} from "./lib/task-answers/config";
import { answerHasResponse } from "./lib/task-answers/presence";
import { answerIsCorrect } from "./lib/task-answers/grading";
import { validateTaskAnswer } from "./lib/task-answers/validation";
import { renderSafeTask } from "./lib/task-answers/public-task";
import type { PlayTask } from "./lib/task-answers/types";
import { authenticateFirebase, requireAdmin, requireAuth } from "./lib/auth";

const app = express();
const DOC_ALLOWED_EXT = new Set([".pdf", ".jpg", ".jpeg", ".png"]);
const DOC_MAX_BYTES = 5 * 1024 * 1024;
const ROSTER_ALLOWED_EXT = new Set([".xlsx", ".csv"]);
const ROSTER_MAX_BYTES = 2 * 1024 * 1024;
const ROSTER_LEASE_MS = 10 * 60 * 1000;
let e2eCurrentDate: Date | null = null;

function isE2E() {
  return (env as Cloudflare.Env & { BEBRAS_E2E?: string }).BEBRAS_E2E === "1";
}

function documentUploadField(value: unknown) {
  return value === "letter" || value === "idFront" || value === "idBack"
    ? value
    : undefined;
}

function currentDate() {
  if (isE2E() && e2eCurrentDate) {
    return new Date(e2eCurrentDate);
  }
  return new Date();
}

function uploadedFiles(req: express.Request) {
  const files = req.files as
    | Record<string, Express.Multer.File[]>
    | Express.Multer.File[]
    | undefined;

  return Array.isArray(files) ? files : Object.values(files ?? {}).flat();
}

async function hasValidDocumentSignature(file: Express.Multer.File) {
  const bytes = file.buffer.subarray(0, 8);
  const extension = extname(file.originalname).toLowerCase();

  if (extension === ".pdf") {
    return bytes.subarray(0, 5).equals(Buffer.from("%PDF-"));
  }
  if (extension === ".jpg" || extension === ".jpeg") {
    return (
      bytes.length >= 3 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff
    );
  }
  if (extension === ".png") {
    return bytes.equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  }

  return false;
}

const uploadDocs = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: DOC_MAX_BYTES, files: 3 },
  fileFilter: (_req, file, cb) => {
    if (!DOC_ALLOWED_EXT.has(extname(file.originalname).toLowerCase())) {
      cb(
        Object.assign(new Error("INVALID_DOC_TYPE"), { field: file.fieldname }),
      );
      return;
    }
    cb(null, true);
  },
});

const uploadRoster = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: ROSTER_MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ROSTER_ALLOWED_EXT.has(extname(file.originalname).toLowerCase())) {
      cb(new Error("INVALID_ROSTER_TYPE"));
      return;
    }
    cb(null, true);
  },
}).single("file");

function rosterUploadMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  uploadRoster(req, res, (err: unknown) => {
    if (err) {
      if (err instanceof Error && err.message === "INVALID_ROSTER_TYPE") {
        res
          .status(400)
          .json({ message: "La planilla debe ser un archivo XLSX o CSV." });
        return;
      }

      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        res
          .status(400)
          .json({ message: "La planilla no debe superar los 2 MB." });
        return;
      }

      res.status(400).json({ message: "No se pudo leer la planilla." });
      return;
    }

    next();
  });
}

const ROSTER_COLUMNS = [
  "Nombres",
  "Apellidos",
  "Curso",
  "Modalidad",
  "Nombres del compañero",
  "Apellidos del compañero",
];

function normalizeHeader(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function gradeFromCell(value: unknown, categories: string[]) {
  const raw = String(value ?? "").trim();

  if (!raw) {
    throw new Error("Falta el curso.");
  }

  const normalized = normalizeHeader(raw);
  const known =
    SCHOOL_GRADES.find((grade) => grade.value.toLowerCase() === normalized) ??
    SCHOOL_GRADES.find((grade) => normalizeHeader(grade.label) === normalized);

  if (!known) {
    throw new Error(`Curso "${raw}" no reconocido.`);
  }

  return parseGrade(known.value, categories);
}

function registerUploadMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  const handler = uploadDocs.fields([
    { name: "letter", maxCount: 1 },
    { name: "idFront", maxCount: 1 },
    { name: "idBack", maxCount: 1 },
  ]);

  handler(req, res, (err: unknown) => {
    if (err) {
      void cleanupFiles(...uploadedFiles(req)).then(() => {
        const field = documentUploadField(
          err instanceof multer.MulterError
            ? err.field
            : err instanceof Error && "field" in err
              ? err.field
              : undefined,
        );
        if (
          err instanceof multer.MulterError &&
          err.code === "LIMIT_FILE_SIZE"
        ) {
          res.status(400).json({
            message: "El archivo no debe superar los 5 MB.",
            field,
          });
          return;
        }
        if (err instanceof Error && err.message === "INVALID_DOC_TYPE") {
          res.status(400).json({
            message:
              "El documento debe ser un archivo PDF o una imagen (JPG, JPEG o PNG).",
            field,
          });
          return;
        }
        res.status(400).json({
          message: "No se pudo subir el documento.",
          field,
        });
      });
      return;
    }

    const files = uploadedFiles(req);
    void Promise.allSettled(files.map(hasValidDocumentSignature)).then(
      async (checks) => {
        const invalidIndex = checks.findIndex(
          (check) => check.status === "rejected" || !check.value,
        );
        if (invalidIndex === -1) {
          try {
            for (const file of files) {
              file.filename = `${randomUUID()}${extname(file.originalname).toLowerCase()}`;
              // Record the key before put: a failed response may still have stored it.
              file.path = file.filename;
              await env.UPLOADS.put(file.filename, file.buffer, {
                httpMetadata: { contentType: documentContentType(file.filename) },
              });
            }
          } catch (error) {
            await cleanupFiles(...files);
            next(error);
            return;
          }
          next();
          return;
        }

        await cleanupFiles(...files);
        const check = checks[invalidIndex];
        res.status(400).json({
          message:
            check.status === "rejected"
              ? "No se pudo validar el documento."
              : "El contenido del documento no coincide con un PDF, JPG, JPEG o PNG válido.",
          field: documentUploadField(files[invalidIndex]?.fieldname),
        });
      },
    ).catch(next);
  });
}

async function cleanupFiles(...files: Array<Express.Multer.File | undefined>) {
  for (const file of files) {
    if (file?.path) {
      try {
        await env.UPLOADS.delete(file.path);
        file.path = "";
      } catch (error) {
        console.error("No se pudo compensar el documento R2", file.path, error);
      }
    }
  }
}

function documentContentType(name: string) {
  const extension = extname(name).toLowerCase();
  return extension === ".pdf" ? "application/pdf"
    : extension === ".png" ? "image/png"
    : extension === ".jpg" || extension === ".jpeg" ? "image/jpeg"
    : "application/octet-stream";
}

async function cleanupDocumentKeys(...keys: Array<string | null>) {
  for (const key of keys) {
    if (!key) continue;
    try {
      await env.UPLOADS.delete(key);
    } catch (error) {
      console.error("No se pudo borrar el documento R2 anterior", key, error);
    }
  }
}

async function sendPrivateDocument(res: express.Response, key: string) {
  const object = await env.UPLOADS.get(key);
  if (!object) {
    res.status(404).json({ message: "Archivo no encontrado." });
    return;
  }
  res.setHeader("Content-Type", documentContentType(key));
  res.setHeader("Content-Length", object.size);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", `inline; filename="${key.replace(/[^a-zA-Z0-9._-]/g, "_")}"`);
  // Documents are capped at 5 MiB. Buffering avoids the Node HTTP bridge's
  // premature-close behavior when pipeline() writes a Web/R2 stream to res.
  res.send(Buffer.from(await object.arrayBuffer()));
}

function serializeTeacherSchool(school: {
  id: string;
  schoolCodUe: string | null;
  schoolName: string;
  letterFilename: string | null;
  status: string;
  createdAt: Date;
}) {
  return {
    id: school.id,
    schoolCodUe: school.schoolCodUe,
    schoolName: school.schoolName,
    status: school.status,
    hasLetter: Boolean(school.letterFilename),
    createdAt: school.createdAt.toISOString(),
  };
}

function describeUserDocuments(user: {
  institutionType: string | null;
  letterFilename: string | null;
  idFrontFilename: string | null;
  idBackFilename: string | null;
}) {
  const isSchool = user.institutionType !== "homeschool";
  const missing = isSchool
    ? user.letterFilename
      ? []
      : ["letter"]
    : [
        ...(user.idFrontFilename ? [] : ["idFront"]),
        ...(user.idBackFilename ? [] : ["idBack"]),
      ];

  return {
    institutionType: isSchool ? "school" : "homeschool",
    letter: Boolean(user.letterFilename),
    idFront: Boolean(user.idFrontFilename),
    idBack: Boolean(user.idBackFilename),
    missing,
    complete: missing.length === 0,
  };
}

function pickUploaded(
  req: express.Request,
  field: string,
): Express.Multer.File | undefined {
  const files = req.files as Record<string, Express.Multer.File[]> | undefined;
  return files?.[field]?.[0];
}

const ansi = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  gray: "\x1b[90m",
};

function colorize(text: string, color: string) {
  return `${color}${text}${ansi.reset}`;
}

function formatStatus(statusCode: number) {
  const padded = String(statusCode).padStart(3, " ");

  if (statusCode >= 500) {
    return colorize(padded, ansi.red);
  }

  if (statusCode >= 400) {
    return colorize(padded, ansi.yellow);
  }

  if (statusCode >= 300) {
    return colorize(padded, ansi.cyan);
  }

  if (statusCode >= 200) {
    return colorize(padded, ansi.green);
  }

  return colorize(padded, ansi.gray);
}

function formatMethod(method: string) {
  switch (method) {
    case "GET":
      return colorize(method.padEnd(7, " "), ansi.blue);
    case "POST":
      return colorize(method.padEnd(7, " "), ansi.green);
    case "PUT":
      return colorize(method.padEnd(7, " "), ansi.yellow);
    case "DELETE":
      return colorize(method.padEnd(7, " "), ansi.red);
    case "OPTIONS":
      return colorize(method.padEnd(7, " "), ansi.magenta);
    default:
      return colorize(method.padEnd(7, " "), ansi.gray);
  }
}

function serializeJson(value: unknown) {
  return JSON.stringify(value);
}

function deserializeCategories(value: unknown) {
  const rawValue = String(value ?? "[]");

  try {
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return rawValue ? [rawValue] : [];
  }
}

function parseJsonValue<T>(value: unknown, fallback: T) {
  try {
    return JSON.parse(String(value ?? JSON.stringify(fallback))) as T;
  } catch {
    return fallback;
  }
}

function normalizeTaskDifficulties(value: unknown) {
  const difficulties = parseJsonValue<Record<string, unknown>>(value, {});
  const normalized = { ...difficulties };

  if (!("5–8" in normalized) && "6–8" in normalized) {
    normalized["5–8"] = normalized["6–8"];
  }
  if (!("17–18" in normalized) && "16–19" in normalized) {
    normalized["17–18"] = normalized["16–19"];
  }
  delete normalized["6–8"];
  delete normalized["16–19"];

  return normalized;
}

function deserializeTask<
  T extends {
    category: unknown;
    difficulties: unknown;
    bodyBlocks: unknown;
    challengeBlocks: unknown;
    explanationBlocks?: unknown;
    answerType?: unknown;
    answerConfig?: unknown;
    answerKey?: unknown;
    answers: unknown;
    shortAnswer?: unknown;
    dragDropBackground?: unknown;
    dragDropItems?: unknown;
    multipleChoiceOrderMode?: unknown;
  },
>(task: T) {
  const dragDropConfig = normalizeDragDropConfig(
    parseJsonValue<unknown>(task.dragDropItems, []),
  );

  return {
    ...task,
    categories: deserializeCategories(task.category),
    difficulties: normalizeTaskDifficulties(task.difficulties),
    bodyBlocks: parseJsonValue<unknown[]>(task.bodyBlocks, []),
    challengeBlocks: parseJsonValue<unknown[]>(task.challengeBlocks, []),
    explanationBlocks: parseJsonValue<unknown[]>(task.explanationBlocks, []),
    answerType: String(task.answerType ?? "multiple_choice"),
    answerConfig: parseJsonValue<Record<string, unknown>>(
      task.answerConfig,
      {},
    ),
    answerKey: parseJsonValue<Record<string, unknown>>(task.answerKey, {}),
    answers: parseJsonValue<PlayTask["answers"]>(task.answers, []),
    shortAnswer: String(task.shortAnswer ?? ""),
    dragDropBackground: parseJsonValue<unknown>(task.dragDropBackground, null),
    dragDropItems: dragDropConfig.items,
    dragDropTargets: dragDropConfig.targets,
    dragDropSolutions: dragDropConfig.solutions,
    dragDropVersion: dragDropConfig.version,
    multipleChoiceOrderMode:
      task.multipleChoiceOrderMode === "random" ? "random" : "fixed",
  };
}

function deserializeTaskSummary(task: {
  id: string;
  title: string;
  country: string | null;
  year: number | null;
  sourceTaskCode: string | null;
  category: string;
  difficulties: string;
}) {
  return {
    id: task.id,
    title: task.title,
    country: task.country,
    year: task.year,
    sourceTaskCode: task.sourceTaskCode,
    categories: deserializeCategories(task.category),
    difficulties: normalizeTaskDifficulties(task.difficulties),
  };
}

/** Lee un numero opcional; devuelve null si no hay uno usable. */
function toFiniteNumber(value: unknown) {
  // Number(null) y Number("") valen 0, no NaN: sin este filtro un rango vacío
  // se leería como el intervalo 0 a 0 y daría por buena la respuesta "0".
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// Países que participan en el Desafío Bebras. La misma lista vive en el
// frontend (`src/lib/countries.ts`), que además guarda cada bandera.
const TASK_COUNTRIES = [
  "Alemania",
  "Arabia Saudita",
  "Argentina",
  "Armenia",
  "Australia",
  "Austria",
  "Azerbaiyán",
  "Bolivia",
  "Brasil",
  "Bulgaria",
  "Bélgica",
  "Canadá",
  "Chequia",
  "China",
  "Chipre",
  "Colombia",
  "Corea del Sur",
  "Croacia",
  "EE.UU.",
  "Eslovaquia",
  "Eslovenia",
  "España",
  "Finlandia",
  "Francia",
  "Hungría",
  "India",
  "Indonesia",
  "Irlanda",
  "Irán",
  "Islandia",
  "Italia",
  "Jamaica",
  "Letonia",
  "Lituania",
  "Macedonia del Norte",
  "Malasia",
  "Malta",
  "Montenegro",
  "México",
  "Pakistán",
  "Paraguay",
  "Países Bajos",
  "Polonia",
  "Reino Unido",
  "Serbia",
  "Sudáfrica",
  "Suiza",
  "Taiwán",
  "Turquía",
  "Uruguay",
  "Uzbekistán",
  "Vietnam",
];

const TASK_CATEGORIES = [
  "Algoritmos y programación",
  "Estructuras de datos y representaciones",
  "Procesos computacionales y hardware",
  "Comunicación y redes",
  "Interacción, sistemas y sociedad",
];

/**
 * Categorías oficiales de Bebras con su rango de edad. Fuente única del
 * backend: los rangos de las tareas, los nombres válidos de un desafío y las
 * categorías de práctica salen todos de aquí.
 */
const BEBRAS_CATEGORIES = [
  { name: "Guacamayo", ageRange: "5–8" },
  { name: "Capibara", ageRange: "8–10" },
  { name: "Titi", ageRange: "10–12" },
  { name: "Jucumari", ageRange: "12–14" },
  { name: "Yaguareté", ageRange: "14–16" },
  { name: "Kuntur", ageRange: "17–18" },
] as const;

const TASK_AGE_RANGES: string[] = BEBRAS_CATEGORIES.map(
  (category) => category.ageRange,
);

function readText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseTaskPayload(body: Record<string, unknown>) {
  const title = readText(body.title);

  if (!title) {
    throw new Error("El título es obligatorio.");
  }

  const country = readText(body.country);

  if (country && !TASK_COUNTRIES.includes(country)) {
    throw new Error(`El país "${country}" no es válido.`);
  }

  const year = toFiniteNumber(body.year);

  if (
    year !== null &&
    (!Number.isInteger(year) || year < 1900 || year > 2100)
  ) {
    throw new Error("El año de la tarea no es válido.");
  }

  const sourceTaskCode = readText(body.sourceTaskCode);

  if (
    sourceTaskCode &&
    (sourceTaskCode.length > 64 ||
      !/^\d{4}-[A-Z]{2}(?:-[A-Za-z0-9]+)+$/.test(sourceTaskCode))
  ) {
    throw new Error(
      "El código original debe tener un formato como 2024-DE-04a y no superar 64 caracteres.",
    );
  }

  const categories = Array.isArray(body.categories)
    ? body.categories.filter((item): item is string => typeof item === "string")
    : typeof body.category === "string" && body.category
      ? [body.category]
      : [];

  if (categories.length === 0) {
    throw new Error("Debes seleccionar al menos una categoría.");
  }

  const unknownCategory = categories.find(
    (category) => !TASK_CATEGORIES.includes(category),
  );

  if (unknownCategory) {
    throw new Error(`La categoría "${unknownCategory}" no es válida.`);
  }

  const difficulties =
    body.difficulties && typeof body.difficulties === "object"
      ? (body.difficulties as Record<string, unknown>)
      : {};

  const activeRanges = Object.entries(difficulties).filter(
    ([, value]) => readText(value).length > 0,
  );

  if (activeRanges.length === 0) {
    throw new Error(
      "Debes activar al menos un rango de edad con su dificultad.",
    );
  }

  const unknownRange = activeRanges.find(
    ([range]) => !TASK_AGE_RANGES.includes(range),
  );

  if (unknownRange) {
    throw new Error(`El rango de edad "${unknownRange[0]}" no es válido.`);
  }

  const invalidDifficulty = activeRanges.find(
    ([, value]) => !isDifficultyKey(readText(value)),
  );

  if (invalidDifficulty) {
    throw new Error(
      `La dificultad "${readText(invalidDifficulty[1])}" no es válida para el rango ${invalidDifficulty[0]}.`,
    );
  }

  if (countFilledBlocks(body.bodyBlocks) === 0) {
    throw new Error("Debes agregar contenido en el cuerpo.");
  }

  if (countFilledBlocks(body.challengeBlocks) === 0) {
    throw new Error("Debes agregar contenido en la pregunta o desafío.");
  }

  if (countFilledBlocks(body.explanationBlocks) === 0) {
    throw new Error("La explicación de la respuesta es obligatoria.");
  }
  const answerFields = parseTaskAnswerConfig(body);

  return {
    title,
    country: country || null,
    year,
    sourceTaskCode: sourceTaskCode || null,
    category: serializeJson(categories),
    difficulties: serializeJson(difficulties),
    bodyBlocks: serializeJson(body.bodyBlocks ?? []),
    challengeBlocks: serializeJson(body.challengeBlocks ?? []),
    ...answerFields,
    explanationBlocks: serializeJson(body.explanationBlocks ?? []),
  };
}

const GROUP_CODE_LIFETIME_MINUTES = 30;

function parseOptionalDateInput(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error("La fecha de la sesión no es válida.");
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("La fecha de la sesión no es válida.");
  }

  return date;
}

function parseDateInput(value: unknown, fieldName: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`El campo ${fieldName} es obligatorio.`);
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`El campo ${fieldName} no tiene una fecha válida.`);
  }

  return date;
}

function parseTaskIds(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (item): item is string =>
      typeof item === "string" && item.trim().length > 0,
  );
}

const BEBRAS_SCORING = {
  easy: { correct: 6, wrong: -2 },
  medium: { correct: 9, wrong: -3 },
  hard: { correct: 12, wrong: -4 },
} as const;

type DifficultyKey = keyof typeof BEBRAS_SCORING;

const CATEGORY_AGE_RANGE: Record<string, string> = Object.fromEntries(
  BEBRAS_CATEGORIES.map((category) => [category.name, category.ageRange]),
);

function isDifficultyKey(value: unknown): value is DifficultyKey {
  return value === "easy" || value === "medium" || value === "hard";
}

type ContestScoring = Record<DifficultyKey, { correct: number; wrong: number }>;

const DIFFICULTY_KEYS: DifficultyKey[] = ["easy", "medium", "hard"];

/** Puntajes estándar de Bebras, el punto de partida de todo desafío. */
function defaultContestScoring(): ContestScoring {
  return {
    easy: {
      correct: BEBRAS_SCORING.easy.correct,
      wrong: BEBRAS_SCORING.easy.wrong,
    },
    medium: {
      correct: BEBRAS_SCORING.medium.correct,
      wrong: BEBRAS_SCORING.medium.wrong,
    },
    hard: {
      correct: BEBRAS_SCORING.hard.correct,
      wrong: BEBRAS_SCORING.hard.wrong,
    },
  };
}

/**
 * Lee los puntajes editados a mano. Cada dificultad que falte o venga mal
 * cae en el estándar, así que el resultado siempre está completo.
 */
function parseContestScoring(value: unknown): ContestScoring {
  const scoring = defaultContestScoring();

  if (!value || typeof value !== "object") {
    return scoring;
  }

  const raw = value as Record<string, unknown>;

  for (const key of DIFFICULTY_KEYS) {
    const entry = raw[key];

    if (!entry || typeof entry !== "object") {
      continue;
    }

    const { correct, wrong } = entry as Record<string, unknown>;
    const correctScore = Number(correct);
    const wrongScore = Number(wrong);

    if (!Number.isInteger(correctScore) || correctScore <= 0) {
      throw new Error(
        "El puntaje de una respuesta correcta debe ser un entero mayor que cero.",
      );
    }

    if (!Number.isInteger(wrongScore) || wrongScore > 0) {
      throw new Error(
        "El puntaje de una respuesta incorrecta debe ser un entero menor o igual que cero.",
      );
    }

    scoring[key] = { correct: correctScore, wrong: wrongScore };
  }

  return scoring;
}

function scoresForDifficulty(
  difficulty: DifficultyKey,
  scoring: ContestScoring,
) {
  return {
    difficulty,
    minScore: scoring[difficulty].wrong,
    noAnswerScore: 0,
    maxScore: scoring[difficulty].correct,
  };
}

type ContestTaskInput = { taskId: string; category: string };

function parseContestTasks(
  body: Record<string, unknown>,
  categories: string[],
): ContestTaskInput[] {
  const rawTasks = Array.isArray(body.tasks) ? body.tasks : [];
  const fallbackCategory = categories.length === 1 ? categories[0] : "";
  const seen = new Set<string>();

  return rawTasks.flatMap((item) => {
    if (item === null || typeof item !== "object") {
      return [];
    }

    const record = item as Record<string, unknown>;
    const taskId = typeof record.taskId === "string" ? record.taskId.trim() : "";
    const category =
      typeof record.category === "string" && record.category.trim()
        ? record.category.trim()
        : fallbackCategory;
    const key = `${category}|${taskId}`;

    if (!taskId || seen.has(key)) {
      return [];
    }

    seen.add(key);
    return [{ taskId, category }];
  });
}

async function buildContestTaskWrites(
  tasks: ContestTaskInput[],
  categories: string[],
  scoring: ContestScoring,
) {
  const drafts = await prisma.taskDraft.findMany({
    where: { id: { in: [...new Set(tasks.map((task) => task.taskId))] } },
    select: { id: true, title: true, difficulties: true },
  });

  const byId = new Map(drafts.map((draft) => [draft.id, draft]));
  const positions = new Map<string, number>();

  return tasks.map(({ taskId, category }) => {
    const ageRange = CATEGORY_AGE_RANGE[category];

    if (!ageRange || !categories.includes(category)) {
      throw new Error(
        `La categoría "${category || "sin nombre"}" no es parte de este desafío.`,
      );
    }

    const draft = byId.get(taskId);

    if (!draft) {
      throw new Error("Una o más tareas seleccionadas no existen.");
    }

    const difficulties = parseJsonValue<Record<string, unknown>>(
      draft.difficulties,
      {},
    );
    const difficulty = difficulties[ageRange];

    if (!isDifficultyKey(difficulty)) {
      throw new Error(
        `La tarea "${draft.title}" no tiene dificultad para ${category}.`,
      );
    }

    const position = (positions.get(category) ?? 0) + 1;
    positions.set(category, position);

    return {
      taskDraftId: taskId,
      category,
      position,
      ...scoresForDifficulty(difficulty, scoring),
    };
  });
}

function initialScoreOf(tasks: Array<{ minScore: number }>) {
  return tasks.reduce((total, task) => total - task.minScore, 0);
}

/** Lo que el estudiante lee antes de empezar: cuánto vale cada pregunta. */
function contestRules(
  tasks: Array<{ difficulty: string; minScore: number; maxScore: number }>,
) {
  return {
    initialScore: initialScoreOf(tasks),
    scoring: DIFFICULTY_KEYS.flatMap((difficulty) => {
      const ofDifficulty = tasks.filter((task) => task.difficulty === difficulty);
      return ofDifficulty.length > 0
        ? [
            {
              difficulty,
              count: ofDifficulty.length,
              correct: ofDifficulty[0].maxScore,
              wrong: ofDifficulty[0].minScore,
            },
          ]
        : [];
    }),
  };
}

const CONTEST_CATEGORY_NAMES: string[] = BEBRAS_CATEGORIES.map(
  (category) => category.name,
);

/** Categorías válidas, sin repetir y en el orden oficial. */
function normalizeCategories(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [];
  return CONTEST_CATEGORY_NAMES.filter((name) => list.includes(name));
}

function contestCategories(contest: { categories: string }) {
  return normalizeCategories(parseJsonValue<unknown>(contest.categories, []));
}

/** Categorías en las que se puede inscribir un grupo: la suya o, si no tiene, las del desafío. */
function groupCategories(group: {
  category: string | null;
  contest: { categories: string };
}) {
  const categories = contestCategories(group.contest);
  return group.category && categories.includes(group.category)
    ? [group.category]
    : categories;
}

const SCHOOL_GRADES = [
  { value: "P1", label: "1.º de primaria", category: "Guacamayo" },
  { value: "P2", label: "2.º de primaria", category: "Guacamayo" },
  { value: "P3", label: "3.º de primaria", category: "Capibara" },
  { value: "P4", label: "4.º de primaria", category: "Capibara" },
  { value: "P5", label: "5.º de primaria", category: "Titi" },
  { value: "P6", label: "6.º de primaria", category: "Titi" },
  { value: "S1", label: "1.º de secundaria", category: "Jucumari" },
  { value: "S2", label: "2.º de secundaria", category: "Jucumari" },
  { value: "S3", label: "3.º de secundaria", category: "Yaguareté" },
  { value: "S4", label: "4.º de secundaria", category: "Yaguareté" },
  { value: "S5", label: "5.º de secundaria", category: "Kuntur" },
  { value: "S6", label: "6.º de secundaria", category: "Kuntur" },
] as const;

/** Cursos que admite un desafío; sin categorías, los doce. */
function gradesForCategories(categories: string[]) {
  const grades = SCHOOL_GRADES.filter((grade) =>
    categories.includes(grade.category),
  );
  return grades.length > 0 ? grades : SCHOOL_GRADES.slice();
}

function parseGrade(value: unknown, categories: string[]) {
  const grade = typeof value === "string" ? value.trim() : "";

  if (!grade) {
    throw new Error("Debes indicar el curso del participante.");
  }

  const known = SCHOOL_GRADES.find((item) => item.value === grade);

  if (!known) {
    throw new Error("El curso indicado no es válido.");
  }

  if (categories.length > 0 && !categories.includes(known.category)) {
    throw new Error(
      `${known.label} es de la categoría ${known.category}, que no participa en este desafío (${categories.join(", ")}).`,
    );
  }

  return grade;
}

/**
 * Categoría en la que rinde un equipo: la de su curso. Los equipos sin curso
 * (las prácticas) rinden la única categoría del desafío.
 */
function teamCategory(grade: string | null, categories: string[]) {
  const fromGrade = SCHOOL_GRADES.find((item) => item.value === grade)?.category;

  if (fromGrade && categories.includes(fromGrade)) {
    return fromGrade;
  }

  return categories.length === 1 ? categories[0] : null;
}

function tasksOfCategory<T extends { category: string }>(
  tasks: T[],
  category: string | null,
) {
  return category ? tasks.filter((task) => task.category === category) : [];
}

type ContestState =
  | "borrador"
  | "programada"
  | "inscripcion"
  | "preparacion"
  | "abierta"
  | "suspendida"
  | "cerrada"
  | "consolidada"
  | "publicada";

const ENDED_CONTEST_STATES: ContestState[] = [
  "cerrada",
  "consolidada",
  "publicada",
];

const SUSPENDED_CONTEST_MESSAGE =
  "El desafío está suspendido. Tu tiempo quedó en pausa; espera a que lo reanuden.";

function contestHasEnded(state: ContestState) {
  return ENDED_CONTEST_STATES.includes(state);
}

function groupAccessHasExpired(group: {
  expiresAt: Date | null;
  contest: { endsAt: Date | null };
}) {
  const effectiveExpiry = group.contest.endsAt ?? group.expiresAt;
  return Boolean(effectiveExpiry && effectiveExpiry < currentDate());
}

function contestRegistrationIsOpen(contest: {
  registrationStartsAt?: Date | null;
  registrationEndsAt?: Date | null;
  publishedAt: Date | null;
  startsAt: Date | null;
  endsAt: Date | null;
}) {
  if (!contest.publishedAt) {
    return false;
  }

  if (!contest.registrationStartsAt || !contest.registrationEndsAt) {
    return !contestHasEnded(computeContestState(contest).state);
  }

  const now = currentDate();
  return (
    now >= contest.registrationStartsAt && now < contest.registrationEndsAt
  );
}

function registrationWindowMessage(contest: {
  registrationStartsAt?: Date | null;
  registrationEndsAt?: Date | null;
}) {
  if (
    contest.registrationStartsAt &&
    currentDate() < contest.registrationStartsAt
  ) {
    return "La fase de inscripción todavía no comenzó.";
  }

  return "La fase de inscripción ya terminó.";
}

function computeContestState(
  contest: {
    publishedAt: Date | null;
    suspendedAt?: Date | null;
    consolidatedAt?: Date | null;
    resultsPublishedAt?: Date | null;
    registrationStartsAt?: Date | null;
    registrationEndsAt?: Date | null;
    startsAt: Date | null;
    endsAt: Date | null;
    isPractice?: boolean;
  },
): { state: ContestState; isOpen: boolean } {
  const now = currentDate();

  if (!contest.publishedAt) {
    return { state: "borrador", isOpen: false };
  }

  if (!contest.startsAt || !contest.endsAt || now < contest.startsAt) {
    // Una práctica no tiene inscripción: solo espera su horario.
    if (contest.isPractice) {
      return {
        state: contest.startsAt ? "programada" : "preparacion",
        isOpen: false,
      };
    }

    // Las fechas son opcionales al publicar: sin ventana de inscripción, la
    // inscripción queda abierta hasta que empiece la rendición.
    if (!contest.registrationStartsAt || !contest.registrationEndsAt) {
      return { state: "inscripcion", isOpen: false };
    }

    if (now < contest.registrationStartsAt) {
      return { state: "programada", isOpen: false };
    }

    if (now < contest.registrationEndsAt) {
      return { state: "inscripcion", isOpen: false };
    }

    return { state: "preparacion", isOpen: false };
  }

  if (now > contest.endsAt) {
    if (contest.resultsPublishedAt) {
      return { state: "publicada", isOpen: false };
    }

    if (contest.consolidatedAt) {
      return { state: "consolidada", isOpen: false };
    }

    return { state: "cerrada", isOpen: false };
  }

  if (contest.suspendedAt) {
    return { state: "suspendida", isOpen: false };
  }

  return { state: "abierta", isOpen: true };
}

function deserializeContest(contest: {
  id: string;
  title: string;
  categories: string;
  durationMinutes: number;
  registrationStartsAt: Date | null;
  registrationEndsAt: Date | null;
  startsAt: Date | null;
  endsAt: Date | null;
  scoring?: string | null;
  questionDisplayMode: string;
  allowPairs: boolean;
  shuffleOptions: boolean;
  showFeedback: boolean;
  showSolutions: boolean;
  showTotalScore: boolean;
  showScoreOnSubmit: boolean;
  showFeedbackOnSubmit: boolean;
  showSolutionsOnSubmit: boolean;
  publishedAt: Date | null;
  suspendedAt: Date | null;
  consolidatedAt: Date | null;
  resultsPublishedAt: Date | null;
  resultsAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  tasks?: Array<{
    id: string;
    category: string;
    position: number;
    difficulty: string;
    minScore: number;
    noAnswerScore: number;
    maxScore: number;
    taskDraft: {
      id: string;
      title: string;
      country: string | null;
      year: number | null;
      sourceTaskCode: string | null;
      category: string;
      difficulties: string;
    };
  }>;
}) {
  const { state, isOpen } = computeContestState(contest);
  const categories = contestCategories(contest);
  const tasks = (contest.tasks ?? []).filter((task) =>
    categories.includes(task.category),
  );

  return {
    id: contest.id,
    title: contest.title,
    categories,
    durationMinutes: contest.durationMinutes,
    registrationStartsAt: contest.registrationStartsAt?.toISOString() ?? null,
    registrationEndsAt: contest.registrationEndsAt?.toISOString() ?? null,
    startsAt: contest.startsAt?.toISOString() ?? null,
    endsAt: contest.endsAt?.toISOString() ?? null,
    initialScores: Object.fromEntries(
      categories.map((category) => [
        category,
        initialScoreOf(tasksOfCategory(tasks, category)),
      ]),
    ),
    scoring: parseContestScoring(
      parseJsonValue<Record<string, unknown>>(contest.scoring ?? "{}", {}),
    ),
    questionDisplayMode: contest.questionDisplayMode,
    allowPairs: contest.allowPairs,
    shuffleOptions: contest.shuffleOptions,
    showFeedback: contest.showFeedback,
    showSolutions: contest.showSolutions,
    showTotalScore: contest.showTotalScore,
    showScoreOnSubmit: contest.showScoreOnSubmit,
    showFeedbackOnSubmit: contest.showFeedbackOnSubmit,
    showSolutionsOnSubmit: contest.showSolutionsOnSubmit,
    publishedAt: contest.publishedAt?.toISOString() ?? null,
    suspendedAt: contest.suspendedAt?.toISOString() ?? null,
    consolidatedAt: contest.consolidatedAt?.toISOString() ?? null,
    resultsPublishedAt: contest.resultsPublishedAt?.toISOString() ?? null,
    resultsAt: contest.resultsAt?.toISOString() ?? null,
    state,
    isOpen,
    createdAt: contest.createdAt.toISOString(),
    updatedAt: contest.updatedAt.toISOString(),
    taskCount: tasks.length,
    tasks: tasks.map((task) => ({
        id: task.id,
        category: task.category,
        position: task.position,
        taskId: task.taskDraft.id,
        difficulty: task.difficulty,
        minScore: task.minScore,
        noAnswerScore: task.noAnswerScore,
        maxScore: task.maxScore,
        task: deserializeTaskSummary(task.taskDraft),
      })),
  };
}

/** Duración estándar de Bebras, que se ajusta junto al calendario. */
const DEFAULT_DURATION_MINUTES = 45;

function parseContestPayload(body: Record<string, unknown>) {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  // «category» es la forma anterior, de una sola categoría.
  const requested = Array.isArray(body.categories)
    ? body.categories
    : typeof body.category === "string"
      ? [body.category.trim()]
      : [];
  const categories = normalizeCategories(requested);
  const durationMinutes = body.durationMinutes
    ? Number(body.durationMinutes)
    : DEFAULT_DURATION_MINUTES;

  if (!title) {
    throw new Error("El nombre del desafío es obligatorio.");
  }

  if (categories.length === 0 || categories.length !== new Set(requested).size) {
    throw new Error(
      requested.length === 0
        ? "Elige al menos una categoría."
        : "Hay una categoría que no es válida.",
    );
  }

  // Las preguntas de una categoría que se quitó se van con ella.
  const tasks = parseContestTasks(body, categories).filter((task) =>
    categories.includes(task.category),
  );

  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    throw new Error("La duración debe ser un número mayor que cero.");
  }

  const questionDisplayMode =
    body.questionDisplayMode === "all" ? "all" : "one_by_one";

  const basePayload = {
    title,
    categories,
    durationMinutes,
    scoring: parseContestScoring(body.scoring),
    questionDisplayMode,
    allowPairs: body.allowPairs === true,
    shuffleOptions: body.shuffleOptions === true,
    showFeedback: body.showFeedback === true,
    showSolutions: body.showSolutions === true,
    showTotalScore:
      body.showTotalScore === true || body.showScoreOnSubmit === true,
    showScoreOnSubmit: body.showScoreOnSubmit === true,
    showFeedbackOnSubmit: body.showFeedbackOnSubmit === true,
    showSolutionsOnSubmit: body.showSolutionsOnSubmit === true,
    tasks,
  };

  // Las fechas son opcionales, también al publicar; solo tienen que cuadrar.
  const startsAt = body.startsAt
    ? parseDateInput(body.startsAt, "startsAt")
    : null;
  const endsAt = body.endsAt ? parseDateInput(body.endsAt, "endsAt") : null;
  const registrationStartsAt = body.registrationStartsAt
    ? parseDateInput(body.registrationStartsAt, "registrationStartsAt")
    : null;
  const registrationEndsAt = body.registrationEndsAt
    ? parseDateInput(body.registrationEndsAt, "registrationEndsAt")
    : null;
  const resultsAt = body.resultsAt
    ? parseDateInput(body.resultsAt, "resultsAt")
    : null;

  if (resultsAt && endsAt && resultsAt < endsAt) {
    throw new Error(
      "Los resultados no pueden publicarse antes de que cierre la rendición.",
    );
  }

  if (Boolean(startsAt) !== Boolean(endsAt)) {
    throw new Error(
      "La ventana de rendición necesita su inicio y su fin, o ninguno de los dos.",
    );
  }

  if (Boolean(registrationStartsAt) !== Boolean(registrationEndsAt)) {
    throw new Error(
      "Debes definir tanto el inicio como el fin de la inscripción.",
    );
  }

  if (
    registrationStartsAt &&
    registrationEndsAt &&
    registrationEndsAt <= registrationStartsAt
  ) {
    throw new Error("El cierre de inscripción debe ser posterior a su inicio.");
  }

  if (registrationEndsAt && startsAt && registrationEndsAt >= startsAt) {
    throw new Error(
      "La inscripción debe cerrar antes de que comience la rendición para dejar una fase de preparación.",
    );
  }

  if (startsAt && endsAt && endsAt <= startsAt) {
    throw new Error("La fecha de fin debe ser posterior a la fecha de inicio.");
  }

  return {
    ...basePayload,
    registrationStartsAt,
    registrationEndsAt,
    startsAt,
    endsAt,
    resultsAt,
  };
}

app.use((_req, _res, next) => withRequestPrisma(next));

app.use((req, res, next) => {
  const startedAt = Date.now();

  res.on("finish", () => {
    const durationMs = Date.now() - startedAt;
    console.log(
      `${colorize("[api]", ansi.gray)} ${formatStatus(res.statusCode)} ${formatMethod(
        req.method,
      )} ${colorize(req.originalUrl, ansi.bold)} ${colorize(`${durationMs}ms`, ansi.dim)}`,
    );
  });

  res.header(
    "Access-Control-Allow-Origin",
    req.headers.origin ?? "*",
  );
  res.header("Vary", "Origin");
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Play-Session",
  );
  res.header(
    "Access-Control-Allow-Methods",
    "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  );

  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }

  next();
});

// Fetch/HTTP2 bodies can reach the Node bridge without either HTTP/1 framing
// header. Express and Multer use these headers to decide whether to read them.
app.use((req, _res, next) => {
  if (req.headers["content-type"] &&
      req.headers["content-length"] === undefined &&
      req.headers["transfer-encoding"] === undefined) {
    req.headers["transfer-encoding"] = "chunked";
  }
  next();
});

app.use(express.json({ limit: "10mb" }));

app.put("/api/e2e/clock", (req, res) => {
  if (!isE2E()) {
    res.sendStatus(404);
    return;
  }

  const value = req.body?.now;
  if (
    typeof value !== "string" ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    res.status(400).json({ message: "now debe ser una fecha ISO válida." });
    return;
  }

  e2eCurrentDate = new Date(value);
  res.json({ now: e2eCurrentDate.toISOString() });
});

app.delete("/api/e2e/clock", (_req, res) => {
  if (!isE2E()) {
    res.sendStatus(404);
    return;
  }

  e2eCurrentDate = null;
  res.sendStatus(204);
});

app.patch("/api/e2e/tasks/:id/legacy-drag-drop", async (req, res) => {
  if (!isE2E()) {
    res.sendStatus(404);
    return;
  }

  const task = await prisma.taskDraft.findUnique({
    where: { id: req.params.id },
    select: { answerType: true, dragDropItems: true },
  });
  if (!task) {
    res.sendStatus(404);
    return;
  }
  if (task.answerType !== "drag_drop") {
    res.status(400).json({ message: "La tarea no es de arrastrar y soltar." });
    return;
  }

  const config = normalizeDragDropConfig(
    parseJsonValue<unknown>(task.dragDropItems, []),
  );
  await prisma.taskDraft.update({
    where: { id: req.params.id },
    data: { dragDropItems: serializeJson({ ...config, version: 1 }) },
  });
  res.sendStatus(204);
});

app.use(
  ["/api/groups", "/api/teams", "/api/practices", "/api/practice",
    "/api/play", "/api/public-contests", "/api/published-contests"],
  (req, res, next) => {
    if (String(env.REGISTRATION_ONLY) === "true") {
      requireAdmin(req, res, next);
      return;
    }
    next();
  },
);

app.get("/", (_req, res) => {
  res.json({
    message: "Backend corriendo con Express, TypeScript y Prisma",
  });
});

app.get("/health", async (_req, res) => {
  await prisma.$queryRaw`SELECT 1`;

  res.json({
    status: "ok",
    database: "connected",
  });
});

/**
 * Punto unico de entrada: el frontend ya autentico contra Firebase y manda el
 * ID Token. Aqui solo se resuelve el perfil Bebras que le corresponde.
 *
 * Si el UID todavia no esta asociado pero existe una cuenta con ese mismo
 * correo (admins migrados, o un maestro que antes entraba con contrasena y
 * ahora usa Google), se enlaza en vez de crear un usuario duplicado.
 */
app.post("/api/auth/session", async (req, res) => {
  const authenticated = await authenticateFirebase(req);

  if ("failure" in authenticated) {
    res.status(authenticated.failure.status).json(authenticated.failure.body);
    return;
  }

  const { identity } = authenticated;
  let user = await prisma.user.findUnique({
    where: { firebaseUid: identity.uid },
  });

  if (!user) {
    const byEmail = await prisma.user.findUnique({
      where: { email: identity.email },
    });

    if (byEmail?.firebaseUid && byEmail.firebaseUid !== identity.uid) {
      res.status(409).json({
        message:
          "Ese correo ya está enlazado a otra cuenta de Firebase. Contacta al administrador.",
        code: "UID_CONFLICT",
      });
      return;
    }

    if (byEmail) {
      user = await prisma.user.update({
        where: { id: byEmail.id },
        data: { firebaseUid: identity.uid },
      });
    }
  }

  if (!user) {
    res.status(404).json({
      message: "Completa tu registro para entrar.",
      code: "PROFILE_REQUIRED",
      email: identity.email,
    });
    return;
  }

  if (user.status === "rejected") {
    res.status(403).json({
      message: "Tu cuenta fue rechazada. Contacta al administrador.",
      code: "ACCOUNT_REJECTED",
    });
    return;
  }

  res.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name === null ? null : formatPersonName(user.name),
      role: user.role,
      status: user.status,
    },
  });
});

app.get("/api/auth/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    include: { schools: { orderBy: { createdAt: "asc" } } },
  });

  if (!user) {
    res.status(404).json({ message: "Usuario no encontrado." });
    return;
  }

  res.json({
    id: user.id,
    email: user.email,
    name: user.name === null ? null : formatPersonName(user.name),
    firstName:
      user.firstName === null ? null : formatPersonName(user.firstName),
    lastName: user.lastName === null ? null : formatPersonName(user.lastName),
    role: user.role,
    status: user.status,
    institutionType: user.institutionType,
    schoolName: user.schoolName,
    schoolCodUe: user.schoolCodUe,
    phone: user.phone,
    createdAt: user.createdAt.toISOString(),
    documents: describeUserDocuments(user),
    schools: user.schools.map(serializeTeacherSchool),
  });
});

app.get("/api/auth/me/schools", requireAuth, async (req, res) => {
  const schools = await prisma.teacherSchool.findMany({
    where: { userId: req.user!.id },
    orderBy: { createdAt: "asc" },
  });

  res.json(schools.map(serializeTeacherSchool));
});

app.post(
  "/api/auth/me/schools",
  requireAuth,
  registerUploadMiddleware,
  async (req, res) => {
    const letterFile = pickUploaded(req, "letter");
    const idFrontFile = pickUploaded(req, "idFront");
    const idBackFile = pickUploaded(req, "idBack");
    const schoolName =
      typeof req.body?.schoolName === "string"
        ? req.body.schoolName.trim()
        : "";
    const schoolCodUe =
      typeof req.body?.schoolCodUe === "string" && req.body.schoolCodUe.trim()
        ? req.body.schoolCodUe.trim()
        : null;

    if (idFrontFile || idBackFile) {
      await cleanupFiles(letterFile, idFrontFile, idBackFile);
      res.status(400).json({
        message: "Para un colegio adjunta la carta de su director.",
      });
      return;
    }

    if (!schoolName) {
      await cleanupFiles(letterFile);
      res.status(400).json({ message: "Indica el nombre del colegio." });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: { schools: true },
    });

    if (!user) {
      await cleanupFiles(letterFile);
      res.status(404).json({ message: "Usuario no encontrado." });
      return;
    }

    const alreadyMain =
      (user.schoolCodUe && user.schoolCodUe === schoolCodUe) ||
      (user.schoolName ?? "").toLowerCase() === schoolName.toLowerCase();
    const alreadyExtra = user.schools.some(
      (school) =>
        (school.schoolCodUe && school.schoolCodUe === schoolCodUe) ||
        school.schoolName.toLowerCase() === schoolName.toLowerCase(),
    );

    if (alreadyMain || alreadyExtra) {
      await cleanupFiles(letterFile);
      res.status(409).json({ message: "Ese colegio ya está en tu cuenta." });
      return;
    }

    const created = await prisma.teacherSchool.create({
      data: {
        userId: user.id,
        schoolCodUe,
        schoolName,
        letterFilename: letterFile?.filename ?? null,
      },
    });

    res.locals.documentsCommitted = true;
    res.status(201).json(serializeTeacherSchool(created));
  },
);

app.post(
  "/api/auth/me/schools/:id/letter",
  requireAuth,
  registerUploadMiddleware,
  async (req, res) => {
    const letterFile = pickUploaded(req, "letter");
    const idFrontFile = pickUploaded(req, "idFront");
    const idBackFile = pickUploaded(req, "idBack");
    const school = await prisma.teacherSchool.findUnique({
      where: { id: String(req.params.id) },
    });

    if (!school || school.userId !== req.user!.id) {
      await cleanupFiles(letterFile, idFrontFile, idBackFile);
      res.status(404).json({ message: "Colegio no encontrado." });
      return;
    }

    // Sustituir una carta ya revisada dejaria al administrador con una
    // aprobacion que no corresponde al documento guardado. Si el colegio se
    // aprobo sin carta todavia se puede adjuntar la que falta.
    if (school.status === "approved" && school.letterFilename) {
      await cleanupFiles(letterFile, idFrontFile, idBackFile);
      res.status(409).json({
        message:
          "Esa carta ya fue aprobada; pide al administrador que la cambie.",
      });
      return;
    }

    if (idFrontFile || idBackFile) {
      await cleanupFiles(letterFile, idFrontFile, idBackFile);
      res.status(400).json({
        message: "Para un colegio adjunta la carta de su director.",
      });
      return;
    }

    if (!letterFile) {
      res.status(400).json({ message: "No adjuntaste ninguna carta." });
      return;
    }

    const updated = await prisma.teacherSchool.update({
      where: { id: school.id },
      data: { letterFilename: letterFile.filename, status: "pending" },
    });

    res.locals.documentsCommitted = true;
    await cleanupDocumentKeys(school.letterFilename);
    res.json(serializeTeacherSchool(updated));
  },
);

app.delete("/api/auth/me/schools/:id", requireAuth, async (req, res) => {
  const school = await prisma.teacherSchool.findUnique({
    where: { id: String(req.params.id) },
  });

  if (!school || school.userId !== req.user!.id) {
    res.status(404).json({ message: "Colegio no encontrado." });
    return;
  }

  if (school.status === "approved") {
    res.status(409).json({
      message:
        "Ese colegio ya fue aprobado; pide al administrador que lo quite.",
    });
    return;
  }

  await prisma.teacherSchool.delete({ where: { id: school.id } });
  await cleanupDocumentKeys(school.letterFilename);
  res.status(204).end();
});

app.post(
  "/api/auth/me/documents",
  requireAuth,
  registerUploadMiddleware,
  async (req, res) => {
    const letterFile = pickUploaded(req, "letter");
    const idFrontFile = pickUploaded(req, "idFront");
    const idBackFile = pickUploaded(req, "idBack");
    const allFiles = [letterFile, idFrontFile, idBackFile];
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });

    if (!user) {
      await cleanupFiles(...allFiles);
      res.status(404).json({ message: "Usuario no encontrado." });
      return;
    }

    // Con la cuenta aprobada se puede completar lo que falte, pero no cambiar
    // un documento que el administrador ya reviso.
    const replacesApproved =
      user.status === "approved" &&
      ((letterFile && user.letterFilename) ||
        (idFrontFile && user.idFrontFilename) ||
        (idBackFile && user.idBackFilename));

    if (replacesApproved) {
      await cleanupFiles(...allFiles);
      res.status(409).json({
        message:
          "Ese documento ya fue aprobado; pide al administrador que lo cambie.",
      });
      return;
    }

    const isSchool = user.institutionType !== "homeschool";

    if (isSchool && (idFrontFile || idBackFile)) {
      await cleanupFiles(...allFiles);
      res.status(400).json({
        message: "Tu cuenta es de colegio: adjunta la carta del director.",
      });
      return;
    }

    if (!isSchool && letterFile) {
      await cleanupFiles(...allFiles);
      res.status(400).json({
        message: "Enseñas en casa: adjunta tu carnet de identidad.",
      });
      return;
    }

    if (!letterFile && !idFrontFile && !idBackFile) {
      res.status(400).json({ message: "No adjuntaste ningún documento." });
      return;
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        letterFilename: letterFile?.filename ?? user.letterFilename,
        idFrontFilename: idFrontFile?.filename ?? user.idFrontFilename,
        idBackFilename: idBackFile?.filename ?? user.idBackFilename,
      },
    });

    res.locals.documentsCommitted = true;
    await cleanupDocumentKeys(
      letterFile ? user.letterFilename : null,
      idFrontFile ? user.idFrontFilename : null,
      idBackFile ? user.idBackFilename : null,
    );
    res.json({
      status: updated.status,
      documents: describeUserDocuments(updated),
    });
  },
);

app.post("/api/auth/register", registerUploadMiddleware, async (req, res) => {
  const letterFile = pickUploaded(req, "letter");
  const idFrontFile = pickUploaded(req, "idFront");
  const idBackFile = pickUploaded(req, "idBack");
  const allFiles = [letterFile, idFrontFile, idBackFile];

  // El registro llega con el ID Token recien emitido por Firebase: la identidad
  // (uid y correo) sale del token, nunca del formulario. El correo aun no esta
  // verificado en este punto del flujo, por eso `allowUnverified`.
  const authenticated = await authenticateFirebase(req, {
    allowUnverified: true,
  });

  if ("failure" in authenticated) {
    await cleanupFiles(...allFiles);
    res.status(authenticated.failure.status).json(authenticated.failure.body);
    return;
  }

  const { identity } = authenticated;

  const validatedFirstName = validateRegistrationText(
    typeof req.body?.firstName === "string" ? req.body.firstName : "",
    "firstName",
  );
  const validatedLastName = validateRegistrationText(
    typeof req.body?.lastName === "string" ? req.body.lastName : "",
    "lastName",
  );
  const firstName = validatedFirstName.value;
  const lastName = validatedLastName.value;
  const email = identity.email;
  const schoolCodUe =
    typeof req.body?.schoolCodUe === "string" && req.body.schoolCodUe.trim()
      ? req.body.schoolCodUe.trim()
      : null;
  const rawSchoolName =
    typeof req.body?.schoolName === "string" ? req.body.schoolName : "";
  const institutionType =
    req.body?.institutionType === "homeschool" ? "homeschool" : "school";
  const phone =
    typeof req.body?.phone === "string" ? req.body.phone.trim() : "";

  const isSchool = institutionType === "school";
  const validatedSchool =
    isSchool && !schoolCodUe
      ? validateRegistrationText(rawSchoolName, "schoolName")
      : { value: rawSchoolName.trim(), error: undefined };
  const schoolName = validatedSchool.value;

  for (const [field, error] of [
    ["firstName", validatedFirstName.error],
    ["lastName", validatedLastName.error],
    ["schoolName", validatedSchool.error],
  ]) {
    if (error) {
      await cleanupFiles(...allFiles);
      res.status(400).json({ message: error, field });
      return;
    }
  }

  if (institutionType === "homeschool" && schoolCodUe) {
    await cleanupFiles(...allFiles);
    res.status(400).json({
      message: "La educación en casa no puede tener un código de colegio.",
    });
    return;
  }

  const emailError = validateEmail(email).error;
  if (emailError) {
    await cleanupFiles(...allFiles);
    res.status(400).json({ message: emailError, field: "email" });
    return;
  }

  if (!firstName || !lastName) {
    await cleanupFiles(...allFiles);
    res.status(400).json({
      message: "Nombres y apellidos son obligatorios.",
      field: "firstName",
    });
    return;
  }

  if (!schoolName) {
    await cleanupFiles(...allFiles);
    res.status(400).json({
      message: "Indica tu colegio o el nombre de tu educación en casa.",
    });
    return;
  }

  const validatedPhone = validatePhone(phone);
  if (validatedPhone.error) {
    await cleanupFiles(...allFiles);
    res.status(400).json({
      message: validatedPhone.error,
      field: "phone",
    });
    return;
  }

  const existing = await prisma.user.findFirst({
    where: { OR: [{ firebaseUid: identity.uid }, { email }] },
  });

  if (existing) {
    await cleanupFiles(...allFiles);
    res.status(409).json({
      message: "Ya existe una cuenta con ese correo.",
      field: "email",
      code: "PROFILE_EXISTS",
    });
    return;
  }

  let created;

  try {
    created = await prisma.user.create({
      data: {
        firstName,
        lastName,
        name: `${firstName} ${lastName}`,
        email,
        firebaseUid: identity.uid,
        role: "maestro",
        status: "pending",
        schoolCodUe,
        schoolName,
        institutionType,
        phone: validatedPhone.number,
        letterFilename: isSchool ? (letterFile?.filename ?? null) : null,
        idFrontFilename: isSchool ? null : (idFrontFile?.filename ?? null),
        idBackFilename: isSchool ? null : (idBackFile?.filename ?? null),
      },
    });
  } catch {
    await cleanupFiles(...allFiles);
    res.status(500).json({ message: "No se pudo crear la cuenta." });
    return;
  }

  res.locals.documentsCommitted = true;
  await cleanupFiles(...(isSchool ? [idFrontFile, idBackFile] : [letterFile]));
  const pendingDocuments = isSchool ? !letterFile : !idFrontFile || !idBackFile;

  res.status(201).json({
    message: pendingDocuments
      ? "Cuenta de maestro creada. Sube tus documentos desde tu perfil para que te aprueben."
      : "Cuenta de maestro creada. Queda pendiente de aprobación.",
    pendingDocuments,
    emailVerified: identity.emailVerified,
    user: {
      id: created.id,
      email: created.email,
      name: created.name,
      role: created.role,
      status: created.status,
    },
  });
});

app.post("/api/letter/pdf", async (req, res) => {
  const field = (name: string, fallback = "") => {
    const value = req.body?.[name];
    const text = typeof value === "string" ? value.trim() : "";
    return text || fallback;
  };

  const blank = "____________________";
  const city = field("ciudad", blank);
  const day = field("dia", "____");
  const month = field("mes", "____________");
  const year = field("anio", "______");
  const school = field("colegio", blank);
  const teacher = formatPersonName(field("maestro", blank));
  const id = field("ci", "______________");
  const director = field("director", blank);
  const schoolSign = field("colegioFirma", school);

  const pdf = await createAuthorizationLetter({ city, day, month, year, school, teacher, id, director, schoolSign });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="carta-autorizacion-bebras.pdf"',
  );
  res.send(Buffer.from(pdf));
});

app.get("/api/schools", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const dep = typeof req.query.dep === "string" ? req.query.dep.trim() : "";

  if (q.length < 2) {
    res.json([]);
    return;
  }

  const schools = await prisma.school.findMany({
    where: {
      name: { contains: q },
      ...(dep ? { dep } : {}),
    },
    orderBy: { name: "asc" },
    take: 20,
    select: {
      codUe: true,
      name: true,
      dep: true,
      sec: true,
      dis: true,
    },
  });

  res.json(schools);
});

app.get("/api/public-contests", async (_req, res) => {
  const contests = await prisma.contest.findMany({
    where: { publishedAt: { not: null }, isPractice: false },
    orderBy: { startsAt: "asc" },
    select: {
      id: true,
      title: true,
      categories: true,
      durationMinutes: true,
      registrationStartsAt: true,
      registrationEndsAt: true,
      startsAt: true,
      endsAt: true,
      publishedAt: true,
      suspendedAt: true,
      consolidatedAt: true,
      resultsPublishedAt: true,
    },
  });

  res.json(
    contests.map((contest) => {
      const { state, isOpen } = computeContestState(contest);
      return {
        id: contest.id,
        title: contest.title,
        categories: contestCategories(contest),
        durationMinutes: contest.durationMinutes,
        registrationStartsAt:
          contest.registrationStartsAt?.toISOString() ?? null,
        registrationEndsAt: contest.registrationEndsAt?.toISOString() ?? null,
        startsAt: contest.startsAt?.toISOString() ?? null,
        endsAt: contest.endsAt?.toISOString() ?? null,
        state,
        isOpen,
      };
    }),
  );
});

// ---- Práctica pública (sin login) ----

const PRACTICE_CATEGORIES = BEBRAS_CATEGORIES.map((category) => ({
  name: category.name,
  age: `${category.ageRange.replace("–", "-")} años`,
  ranges: [category.ageRange] as string[],
}));

function taskRanges(task: { difficulties: unknown }) {
  const diff = task.difficulties;
  if (diff && typeof diff === "object") {
    return Object.entries(diff as Record<string, unknown>)
      .filter(([, value]) => typeof value === "string" && value.trim() !== "")
      .map(([range]) => range);
  }
  return [];
}

function taskMatchesCategory(
  task: { difficulties: unknown },
  category: (typeof PRACTICE_CATEGORIES)[number],
) {
  const ranges = taskRanges(task);
  return ranges.some((range) => category.ranges.includes(range));
}

/** Tareas que un maestro puede usar en sus prácticas. */
const TEACHER_TASKS = { OR: [{ isPractice: true }, { forTeachers: true }] };

const TASK_VISIBILITY = {
  practica: { isPractice: true, forTeachers: false },
  maestros: { isPractice: false, forTeachers: true },
  privada: { isPractice: false, forTeachers: false },
} as const;

async function loadPracticeTasks() {
  const tasks = await prisma.taskDraft.findMany({
    where: { isPractice: true },
    orderBy: { updatedAt: "desc" },
  });
  return tasks.map(deserializeTask);
}

app.get("/api/practice/categories", async (_req, res) => {
  const tasks = await loadPracticeTasks();

  const categories = PRACTICE_CATEGORIES.map((category) => ({
    name: category.name,
    age: category.age,
    count: tasks.filter((task) => taskMatchesCategory(task, category)).length,
  })).filter((category) => category.count > 0);

  res.json(categories);
});

app.get("/api/practice/tasks", async (req, res) => {
  const categoryName =
    typeof req.query.category === "string" ? req.query.category : "";
  const category = PRACTICE_CATEGORIES.find((c) => c.name === categoryName);

  if (!category) {
    res.status(404).json({ message: "Categoría no encontrada." });
    return;
  }

  const tasks = await loadPracticeTasks();
  const rows = tasks
    .filter((task) => taskMatchesCategory(task, category))
    .map((task) => ({
      id: task.id,
      title: task.title,
      answerType: task.answerType,
    }));

  res.json({ category: category.name, age: category.age, tasks: rows });
});

app.get("/api/practice/tasks/:id", async (req, res) => {
  const raw = await prisma.taskDraft.findFirst({
    where: { id: req.params.id, isPractice: true },
  });

  if (!raw) {
    res.status(404).json({ message: "Tarea no encontrada." });
    return;
  }

  res.json(renderSafeTask({ position: 0 }, deserializeTask(raw)));
});

app.post("/api/practice/tasks/:id/check", async (req, res) => {
  const raw = await prisma.taskDraft.findFirst({
    where: { id: req.params.id, isPractice: true },
  });

  if (!raw) {
    res.status(404).json({ message: "Tarea no encontrada." });
    return;
  }

  const task = deserializeTask(raw);
  const payload = req.body?.payload;
  const error = validateTaskAnswer(task, payload);
  if (error) {
    res.status(400).json({ message: error });
    return;
  }
  const correct = answerIsCorrect(task, payload);

  res.json({
    correct,
    explanationBlocks: task.explanationBlocks,
  });
});

// Banco de tareas, desafíos y gestión de usuarios: solo admin.
app.use(["/api/tasks", "/api/contests", "/api/users"], requireAdmin);
// Grupos: admin y maestro (con sesión); el alcance se filtra por rol.
async function requireApproved(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  await requireAuth(req, res, () => {
    void prisma.user
      .findUnique({ where: { id: req.user!.id } })
      .then((user) => {
        if (!user || user.status !== "approved") {
          res.status(403).json({
            message:
              "Tu cuenta está pendiente de aprobación. Sube tus documentos desde tu perfil.",
          });
          return;
        }

        next();
      })
      .catch(() => {
        res.status(500).json({ message: "No se pudo validar tu cuenta." });
      });
  });
}

app.use("/api/groups", requireApproved);
app.use("/api/teams", requireApproved);
// Practicas: un maestro arma su propio desafio de practica para sus grupos.
app.use("/api/practices", requireApproved);

const PRACTICE_MAX_TASKS = 40;

function practiceOwnerWhere(req: express.Request) {
  // El admin no crea practicas, pero puede mirarlas para dar soporte.
  return req.user?.role === "maestro"
    ? { isPractice: true, createdById: req.user.id }
    : { isPractice: true };
}

function serializePractice(contest: {
  id: string;
  title: string;
  categories: string;
  durationMinutes: number;
  startsAt: Date | null;
  endsAt: Date | null;
  createdAt: Date;
  tasks: { id: string }[];
  groups: { id: string; accessCode: string; teams: { id: string }[] }[];
}) {
  return {
    id: contest.id,
    // El primero es el que se crea junto con la practica: ese es el codigo que
    // se reparte. Si el maestro agrega mas grupos, viven en Grupos como
    // cualquier otro.
    accessCode: contest.groups[0]?.accessCode ?? null,
    title: contest.title,
    category: contestCategories(contest)[0] ?? "",
    durationMinutes: contest.durationMinutes,
    startsAt: contest.startsAt?.toISOString() ?? null,
    endsAt: contest.endsAt?.toISOString() ?? null,
    createdAt: contest.createdAt.toISOString(),
    taskCount: contest.tasks.length,
    groupCount: contest.groups.length,
    studentCount: contest.groups.reduce(
      (total, group) => total + group.teams.length,
      0,
    ),
    state: computeContestState({
      publishedAt: contest.createdAt,
      startsAt: contest.startsAt,
      endsAt: contest.endsAt,
      isPractice: true,
    }).state,
  };
}

const practiceInclude = {
  tasks: { select: { id: true } },
  groups: {
    select: { id: true, accessCode: true, teams: { select: { id: true } } },
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.ContestInclude;

/** Las tareas que el administrador libero para practica, para elegir de ahi. */
app.get("/api/practices/tasks", async (req, res) => {
  const category =
    typeof req.query.category === "string" ? req.query.category : "";
  const ageRange = CATEGORY_AGE_RANGE[category];

  if (!ageRange) {
    res.status(400).json({ message: "Elige una categoría válida." });
    return;
  }

  const drafts = await prisma.taskDraft.findMany({
    where: TEACHER_TASKS,
    select: { id: true, title: true, difficulties: true },
    orderBy: { title: "asc" },
  });

  // Solo sirven las que tienen dificultad definida para el rango de la
  // categoria: el resto haria fallar el armado del desafio.
  const usable = drafts.flatMap((draft) => {
    const difficulties = parseJsonValue<Record<string, unknown>>(
      draft.difficulties,
      {},
    );
    const difficulty = difficulties[ageRange];
    return isDifficultyKey(difficulty)
      ? [{ id: draft.id, title: draft.title, difficulty }]
      : [];
  });

  res.json({ category, ageRange, tasks: usable });
});

app.get("/api/practices", async (req, res) => {
  const practices = await prisma.contest.findMany({
    where: practiceOwnerWhere(req),
    include: practiceInclude,
    orderBy: { createdAt: "desc" },
  });

  res.json(practices.map(serializePractice));
});

app.post("/api/practices", async (req, res) => {
  if (req.user?.role !== "maestro") {
    res.status(403).json({
      message: "Solo un maestro crea prácticas para sus estudiantes.",
    });
    return;
  }

  const title =
    typeof req.body?.title === "string" ? req.body.title.trim() : "";
  const category =
    typeof req.body?.category === "string" ? req.body.category.trim() : "";
  const durationMinutes = Number(req.body?.durationMinutes);
  const taskIds = Array.isArray(req.body?.tasks)
    ? req.body.tasks.filter(
        (id: unknown): id is string => typeof id === "string",
      )
    : [];
  let startsAt: Date | null;
  let endsAt: Date | null;

  try {
    startsAt = parseOptionalDateInput(req.body?.startsAt);
    endsAt = parseOptionalDateInput(req.body?.endsAt);
  } catch {
    res.status(400).json({ message: "El horario no es válido." });
    return;
  }

  if (!title) {
    res.status(400).json({ message: "Ponle un nombre a la práctica." });
    return;
  }

  if (!CATEGORY_AGE_RANGE[category]) {
    res.status(400).json({ message: "Elige una categoría válida." });
    return;
  }

  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    res.status(400).json({ message: "La duración debe ser mayor que cero." });
    return;
  }

  if (taskIds.length === 0) {
    res.status(400).json({ message: "Elige al menos una pregunta." });
    return;
  }

  if (taskIds.length > PRACTICE_MAX_TASKS) {
    res.status(400).json({
      message: `Una práctica admite hasta ${PRACTICE_MAX_TASKS} preguntas.`,
    });
    return;
  }

  if (new Set(taskIds).size !== taskIds.length) {
    res.status(400).json({ message: "Hay preguntas repetidas." });
    return;
  }

  if (startsAt && endsAt && endsAt <= startsAt) {
    res.status(400).json({
      message: "El horario de cierre debe ser posterior al de inicio.",
    });
    return;
  }

  if (startsAt && endsAt) {
    const windowMinutes = (endsAt.getTime() - startsAt.getTime()) / 60000;
    if (windowMinutes < durationMinutes) {
      res.status(400).json({
        message: `El horario (${Math.round(windowMinutes)} min) es más corto que la duración de la práctica (${durationMinutes} min).`,
      });
      return;
    }
  }

  // Solo del conjunto que el administrador libero: una practica no puede
  // filtrar tareas del banco reservadas para los desafios oficiales.
  const released = await prisma.taskDraft.count({
    where: { id: { in: taskIds }, ...TEACHER_TASKS },
  });

  if (released !== taskIds.length) {
    res.status(400).json({
      message: "Solo puedes usar preguntas liberadas para práctica.",
    });
    return;
  }

  const scoring = defaultContestScoring();
  let taskWrites;

  try {
    taskWrites = await buildContestTaskWrites(
      taskIds.map((taskId: string) => ({ taskId, category })),
      [category],
      scoring,
    );
  } catch (error) {
    res.status(400).json({
      message: error instanceof Error ? error.message : "Tareas inválidas.",
    });
    return;
  }

  // Una practica nace lista: sin borrador, sin ventana de inscripcion y con la
  // retroalimentacion encendida, que es de lo que se trata practicar.
  const practice = await prisma.contest.create({
    data: {
      title,
      categories: JSON.stringify([category]),
      durationMinutes,
      startsAt,
      endsAt,
      scoring: JSON.stringify(scoring),
      questionDisplayMode: "one_by_one",
      allowPairs: false,
      shuffleOptions: false,
      showFeedback: true,
      showSolutions: true,
      showTotalScore: true,
      showScoreOnSubmit: true,
      showFeedbackOnSubmit: true,
      showSolutionsOnSubmit: true,
      isPractice: true,
      createdById: req.user.id,
      publishedAt: currentDate(),
      tasks: { create: taskWrites },
      groups: {
        create: {
          name: title,
          createdById: req.user.id,
          accessCode: await generateUniqueAccessCode(),
          recoveryCode: generateCode(10),
        },
      },
    },
    include: practiceInclude,
  });

  res.status(201).json(serializePractice(practice));
});

app.delete("/api/practices/:id", async (req, res) => {
  const practice = await prisma.contest.findFirst({
    where: { id: String(req.params.id), ...practiceOwnerWhere(req) },
    include: { groups: { select: { id: true } } },
  });

  if (!practice) {
    res.status(404).json({ message: "Práctica no encontrada." });
    return;
  }

  await prisma.contest.delete({ where: { id: practice.id } });
  res.status(204).end();
});

app.get("/api/tasks", async (_req, res) => {
  const tasks = await prisma.taskDraft.findMany({
    orderBy: {
      updatedAt: "desc",
    },
  });

  res.json(tasks.map(deserializeTask));
});

app.get("/api/tasks/:id", async (req, res) => {
  const task = await prisma.taskDraft.findUnique({
    where: {
      id: req.params.id,
    },
  });

  if (!task) {
    res.status(404).json({
      message: "Task not found",
    });
    return;
  }

  res.json(deserializeTask(task));
});

app.post("/api/tasks", async (req, res) => {
  let payload;

  try {
    payload = parseTaskPayload(req.body as Record<string, unknown>);
  } catch (error) {
    res.status(400).json({
      message: error instanceof Error ? error.message : "Tarea inválida.",
    });
    return;
  }

  const task = await prisma.taskDraft.create({
    data: {
      ...payload,
      isPractice: req.body?.isPractice === true,
    },
  });

  res.status(201).json(deserializeTask(task));
});

// Uses the same public projection and grader as play, including private drafts.
// These routes inherit requireAdmin from /api/tasks.

/** Lee una tarea que todavía no está en la base, tal como llega del editor. */
function deserializeDraftBody(body: Record<string, unknown>) {
  return deserializeTask({
    ...parseTaskPayload(body),
    id: readText(body.id) || "draft",
  });
}

// El probador del editor prueba lo que hay en pantalla, no lo último guardado,
// así que el borrador viaja en el cuerpo. Van antes que las rutas con :id para
// que "draft" no se lea como un identificador de tarea.
app.post("/api/tasks/draft/preview", (req, res) => {
  try {
    const task = deserializeDraftBody(
      (req.body ?? {}) as Record<string, unknown>,
    );
    res.json(renderSafeTask({ position: 0 }, task));
  } catch (error) {
    res.status(400).json({
      message: error instanceof Error ? error.message : "Tarea inválida.",
    });
  }
});

app.post("/api/tasks/draft/check", (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  let task;

  try {
    task = deserializeDraftBody((body.task ?? {}) as Record<string, unknown>);
  } catch (error) {
    res.status(400).json({
      message: error instanceof Error ? error.message : "Tarea inválida.",
    });
    return;
  }

  const payload = body.payload;
  const error = validateTaskAnswer(task, payload);
  if (error) {
    res.status(400).json({ message: error });
    return;
  }
  res.json({
    correct: answerIsCorrect(task, payload),
    explanationBlocks: task.explanationBlocks,
  });
});

app.get("/api/tasks/:id/preview", async (req, res) => {
  const raw = await prisma.taskDraft.findUnique({
    where: { id: req.params.id },
  });
  if (!raw) {
    res.status(404).json({ message: "Tarea no encontrada." });
    return;
  }
  res.json(renderSafeTask({ position: 0 }, deserializeTask(raw)));
});

app.post("/api/tasks/:id/check", async (req, res) => {
  const raw = await prisma.taskDraft.findUnique({
    where: { id: req.params.id },
  });
  if (!raw) {
    res.status(404).json({ message: "Tarea no encontrada." });
    return;
  }
  const task = deserializeTask(raw);
  const payload = req.body?.payload;
  const error = validateTaskAnswer(task, payload);
  if (error) {
    res.status(400).json({ message: error });
    return;
  }
  res.json({
    correct: answerIsCorrect(task, payload),
    explanationBlocks: task.explanationBlocks,
  });
});

app.put("/api/tasks/:id", async (req, res) => {
  let payload;

  try {
    payload = parseTaskPayload(req.body as Record<string, unknown>);
  } catch (error) {
    res.status(400).json({
      message: error instanceof Error ? error.message : "Tarea inválida.",
    });
    return;
  }

  const existing = await prisma.taskDraft.findUnique({
    where: { id: req.params.id },
    select: { id: true },
  });

  if (!existing) {
    res.status(404).json({ message: "Task not found" });
    return;
  }

  const task = await prisma.taskDraft.update({
    where: {
      id: req.params.id,
    },
    data: {
      ...payload,
      ...(typeof req.body?.isPractice === "boolean"
        ? { isPractice: req.body.isPractice }
        : {}),
    },
  });

  res.json(deserializeTask(task));
});

app.patch("/api/tasks/:id/visibility", async (req, res) => {
  const visibility = String(req.body?.visibility ?? "");

  if (!Object.hasOwn(TASK_VISIBILITY, visibility)) {
    res.status(400).json({ message: "Visibilidad no válida." });
    return;
  }

  const task = await prisma.taskDraft.update({
    where: { id: req.params.id },
    data: TASK_VISIBILITY[visibility as keyof typeof TASK_VISIBILITY],
    select: { id: true, isPractice: true, forTeachers: true },
  });
  res.json(task);
});

app.patch("/api/tasks/:id/practice", async (req, res) => {
  const task = await prisma.taskDraft.update({
    where: { id: req.params.id },
    data: {
      isPractice: req.body?.isPractice === true,
      forTeachers: false,
    },
    select: { id: true, isPractice: true },
  });
  res.json(task);
});

app.delete("/api/tasks/:id", async (req, res) => {
  const contestCount = await prisma.contestTask.count({
    where: { taskDraftId: req.params.id },
  });

  if (contestCount > 0) {
    res.status(409).json({
      message: `Esta tarea está asociada a ${contestCount} desafío(s) y no se puede eliminar.`,
    });
    return;
  }

  await prisma.taskDraft.delete({
    where: {
      id: req.params.id,
    },
  });

  res.status(204).send();
});

app.get("/api/contests", async (_req, res) => {
  await releaseDueResults();
  const contests = await prisma.contest.findMany({
    where: { isPractice: false },
    include: {
      tasks: {
        orderBy: {
          position: "asc",
        },
        include: {
          taskDraft: true,
        },
      },
    },
    orderBy: {
      updatedAt: "desc",
    },
  });

  res.json(contests.map(deserializeContest));
});

app.get("/api/contests/:id", async (req, res) => {
  await releaseDueResults(String(req.params.id));
  const contest = await prisma.contest.findUnique({
    where: {
      id: req.params.id,
    },
    include: {
      tasks: {
        orderBy: {
          position: "asc",
        },
        include: {
          taskDraft: true,
        },
      },
    },
  });

  if (!contest) {
    res.status(404).json({
      message: "Contest not found",
    });
    return;
  }

  res.json(deserializeContest(contest));
});

app.post("/api/contests", async (req, res) => {
  let payload;

  try {
    payload = parseContestPayload(req.body as Record<string, unknown>);
  } catch (error) {
    res.status(400).json({
      message:
        error instanceof Error ? error.message : "Invalid contest payload",
    });
    return;
  }

  let taskWrites;

  try {
    taskWrites = await buildContestTaskWrites(
      payload.tasks,
      payload.categories,
      payload.scoring,
    );
  } catch (error) {
    res.status(400).json({
      message: error instanceof Error ? error.message : "Tareas inválidas.",
    });
    return;
  }

  const contest = await prisma.contest.create({
    data: {
      title: payload.title,
      categories: JSON.stringify(payload.categories),
      durationMinutes: payload.durationMinutes,
      registrationStartsAt: payload.registrationStartsAt,
      registrationEndsAt: payload.registrationEndsAt,
      startsAt: payload.startsAt,
      endsAt: payload.endsAt,
      resultsAt: payload.resultsAt,
      scoring: JSON.stringify(payload.scoring),
      questionDisplayMode: payload.questionDisplayMode,
      allowPairs: payload.allowPairs,
      shuffleOptions: payload.shuffleOptions,
      showFeedback: payload.showFeedback,
      showSolutions: payload.showSolutions,
      showTotalScore: payload.showTotalScore,
      showScoreOnSubmit: payload.showScoreOnSubmit,
      showFeedbackOnSubmit: payload.showFeedbackOnSubmit,
      showSolutionsOnSubmit: payload.showSolutionsOnSubmit,
      tasks: {
        create: taskWrites,
      },
    },
    include: {
      tasks: {
        orderBy: {
          position: "asc",
        },
        include: {
          taskDraft: true,
        },
      },
    },
  });

  res.status(201).json(deserializeContest(contest));
});

app.put("/api/contests/:id", async (req, res) => {
  let payload;

  try {
    payload = parseContestPayload(req.body as Record<string, unknown>);
  } catch (error) {
    res.status(400).json({
      message:
        error instanceof Error ? error.message : "Invalid contest payload",
    });
    return;
  }

  const existingContest = await prisma.contest.findUnique({
    where: {
      id: req.params.id,
    },
    select: {
      id: true,
      publishedAt: true,
      suspendedAt: true,
      consolidatedAt: true,
      resultsPublishedAt: true,
      registrationStartsAt: true,
      registrationEndsAt: true,
      startsAt: true,
      endsAt: true,
    },
  });

  if (!existingContest) {
    res.status(404).json({
      message: "Contest not found",
    });
    return;
  }

  const { state: currentState } = computeContestState(existingContest);

  const alreadyRunning =
    currentState === "abierta" || currentState === "suspendida";

  if (alreadyRunning || contestHasEnded(currentState)) {
    res.status(409).json({
      message: alreadyRunning
        ? "El desafío ya empezó; no se puede modificar mientras está en curso."
        : "El desafío ya terminó; no se puede modificar.",
    });
    return;
  }

  // Quitar una categoría dejaría sin preguntas a quienes ya se inscribieron.
  const orphanedGrades = SCHOOL_GRADES.filter(
    (grade) => !payload.categories.includes(grade.category),
  ).map((grade) => grade.value);
  const orphaned = await prisma.team.findFirst({
    where: {
      grade: { in: orphanedGrades },
      group: { contestId: req.params.id },
    },
    select: { grade: true },
  });

  if (orphaned) {
    const category = SCHOOL_GRADES.find(
      (grade) => grade.value === orphaned.grade,
    )?.category;
    res.status(409).json({
      message: `No se puede quitar ${category}: ya hay estudiantes inscritos en esa categoría.`,
    });
    return;
  }

  const keepsTasks = !Array.isArray(req.body?.tasks);
  const tasks = keepsTasks
    ? (
        await prisma.contestTask.findMany({
          where: { contestId: req.params.id },
          orderBy: [{ category: "asc" }, { position: "asc" }],
          select: { taskDraftId: true, category: true },
        })
      )
        .map((task) => ({ taskId: task.taskDraftId, category: task.category }))
        .filter((task) => payload.categories.includes(task.category))
    : payload.tasks;

  let taskWrites;

  try {
    taskWrites = await buildContestTaskWrites(
      tasks,
      payload.categories,
      payload.scoring,
    );
  } catch (error) {
    res.status(400).json({
      message: error instanceof Error ? error.message : "Tareas inválidas.",
    });
    return;
  }

  const contestId = String(req.params.id);
  const now = currentDate().toISOString();
  // D1 batches roll back every statement if any task insert fails.
  // UUIDs supply the IDs otherwise generated by Prisma's client-side cuid().
  await env.DB.batch([
    env.DB.prepare('DELETE FROM "ContestTask" WHERE "contestId" = ?').bind(contestId),
    env.DB.prepare(`UPDATE "Contest" SET
      "title" = ?, "categories" = ?, "durationMinutes" = ?,
      "registrationStartsAt" = ?, "registrationEndsAt" = ?, "startsAt" = ?, "endsAt" = ?, "resultsAt" = ?,
      "scoring" = ?, "questionDisplayMode" = ?,
      "allowPairs" = ?, "shuffleOptions" = ?, "showFeedback" = ?, "showSolutions" = ?, "showTotalScore" = ?,
      "showScoreOnSubmit" = ?, "showFeedbackOnSubmit" = ?, "showSolutionsOnSubmit" = ?,
      "updatedAt" = ? WHERE "id" = ?`).bind(
      payload.title, JSON.stringify(payload.categories), payload.durationMinutes,
      payload.registrationStartsAt?.toISOString() ?? null,
      payload.registrationEndsAt?.toISOString() ?? null,
      payload.startsAt?.toISOString() ?? null, payload.endsAt?.toISOString() ?? null,
      payload.resultsAt?.toISOString() ?? null,
      JSON.stringify(payload.scoring), payload.questionDisplayMode,
      Number(payload.allowPairs), Number(payload.shuffleOptions), Number(payload.showFeedback), Number(payload.showSolutions),
      Number(payload.showTotalScore), Number(payload.showScoreOnSubmit),
      Number(payload.showFeedbackOnSubmit), Number(payload.showSolutionsOnSubmit), now, contestId,
    ),
    ...taskWrites.map((task) => env.DB.prepare(`INSERT INTO "ContestTask"
      ("id", "contestId", "category", "taskDraftId", "position", "difficulty", "minScore", "noAnswerScore", "maxScore", "options", "createdAt")
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?)`).bind(
      randomUUID(), contestId, task.category, task.taskDraftId, task.position, task.difficulty,
      task.minScore, task.noAnswerScore, task.maxScore, now,
    )),
  ]);
  const contest = await prisma.contest.findUniqueOrThrow({
    where: { id: contestId },
    include: { tasks: { orderBy: { position: "asc" }, include: { taskDraft: true } } },
  });

  res.json(deserializeContest(contest));
});

const contestPreviewInclude = {
  tasks: {
    orderBy: { position: "asc" as const },
    include: { taskDraft: true },
  },
};

/** La categoría pedida, o la primera del desafío. */
function previewCategory(contest: { categories: string }, requested: unknown) {
  const categories = contestCategories(contest);
  return typeof requested === "string" && categories.includes(requested)
    ? requested
    : (categories[0] ?? null);
}

/**
 * Vista previa de un desafío para el administrador: el mismo contenido que
 * recibe el estudiante, con la misma forma. No crea intento ni equipo, así que
 * probarlo no deja rastro en los datos del concurso.
 */
app.get("/api/contests/:id/preview", async (req, res) => {
  const contest = await prisma.contest.findUnique({
    where: { id: req.params.id },
    include: contestPreviewInclude,
  });

  if (!contest) {
    res.status(404).json({ message: "Contest not found" });
    return;
  }

  const category = previewCategory(contest, req.query.categoria);
  const categoryTasks = tasksOfCategory(contest.tasks, category);
  const tasks = categoryTasks.map((contestTask) =>
    renderSafeTask(
      contestTask,
      deserializeTask(contestTask.taskDraft) as PlayTask,
    ),
  );

  res.json({
    contestTitle: contest.title,
    category,
    categories: contestCategories(contest),
    rules: contestRules(categoryTasks),
    resultsAt: (contest.resultsAt ?? contest.endsAt)?.toISOString() ?? null,
    participationMode: "individual",
    durationMinutes: contest.durationMinutes,
    questionDisplayMode: contest.questionDisplayMode,
    contestStartsAt: contest.startsAt?.toISOString() ?? null,
    contestEndsAt: contest.endsAt?.toISOString() ?? null,
    state: "abierta",
    status: "pending",
    startedAt: null,
    endsAt: null,
    finishedAt: null,
    suspendedAt: null,
    resultsPublished: false,
    showFeedback: contest.showFeedback,
    showSolutions: contest.showSolutions,
    showTotalScore: contest.showTotalScore,
    showScoreOnSubmit: contest.showScoreOnSubmit,
    showFeedbackOnSubmit: contest.showFeedbackOnSubmit,
    showSolutionsOnSubmit: contest.showSolutionsOnSubmit,
    tasks,
    answers: {},
    result: null,
  });
});

/**
 * Corrige las respuestas de una vista previa con las mismas reglas que un
 * intento real, pero sin guardar nada.
 */
app.post("/api/contests/:id/preview/score", async (req, res) => {
  const contest = await prisma.contest.findUnique({
    where: { id: req.params.id },
    include: contestPreviewInclude,
  });

  if (!contest) {
    res.status(404).json({ message: "Contest not found" });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const answers = (
    body.answers && typeof body.answers === "object" ? body.answers : {}
  ) as Record<string, unknown>;

  const categoryTasks = tasksOfCategory(
    contest.tasks,
    previewCategory(contest, body.category),
  );
  let totalScore = initialScoreOf(categoryTasks);
  let correctCount = 0;
  let answeredCount = 0;

  const tasks = categoryTasks.map((contestTask) => {
    const task = deserializeTask(contestTask.taskDraft) as PlayTask;
    const payload = answers[contestTask.taskDraftId] ?? null;
    const answered = answerHasResponse(task.answerType, payload);
    const correct = answered ? answerIsCorrect(task, payload) : false;
    let score = contestTask.noAnswerScore;

    if (answered) {
      score = correct ? contestTask.maxScore : contestTask.minScore;
      answeredCount += 1;
    }

    if (correct) {
      correctCount += 1;
    }

    totalScore += score;

    return {
      taskId: contestTask.taskDraftId,
      position: contestTask.position,
      title: task.title,
      answered,
      correct,
      score,
      explanationBlocks: task.explanationBlocks,
    };
  });

  res.json({
    totalScore,
    correctCount,
    answeredCount,
    taskCount: categoryTasks.length,
    tasks,
  });
});

app.post("/api/contests/:id/publish", async (req, res) => {
  const contest = await prisma.contest.findUnique({
    where: {
      id: req.params.id,
    },
    include: {
      tasks: {
        orderBy: {
          position: "asc",
        },
        include: {
          taskDraft: true,
        },
      },
    },
  });

  if (!contest) {
    res.status(404).json({
      message: "Contest not found",
    });
    return;
  }

  const readinessErrors: string[] = [];

  if (!contest.title.trim()) {
    readinessErrors.push("El desafío necesita nombre.");
  }

  // Las fechas pueden quedar para después; si ya están, tienen que cuadrar.
  if (
    contest.startsAt &&
    contest.endsAt &&
    contest.endsAt <= contest.startsAt
  ) {
    readinessErrors.push("La ventana de ejecución no es válida.");
  }

  if (contest.durationMinutes <= 0) {
    readinessErrors.push("La duración debe ser mayor que cero.");
  }

  const windowMinutes =
    contest.startsAt && contest.endsAt
      ? (contest.endsAt.getTime() - contest.startsAt.getTime()) / 60000
      : Number.POSITIVE_INFINITY;

  if (windowMinutes < contest.durationMinutes) {
    readinessErrors.push(
      `La ventana de ejecución (${Math.round(windowMinutes)} min) es más corta que la duración del desafío (${contest.durationMinutes} min).`,
    );
  }

  const categories = contestCategories(contest);

  if (categories.length === 0) {
    readinessErrors.push("Elige al menos una categoría.");
  }

  const empty = categories.filter(
    (category) => tasksOfCategory(contest.tasks, category).length === 0,
  );

  if (empty.length > 0) {
    readinessErrors.push(
      `${empty.length === 1 ? "La categoría" : "Las categorías"} ${empty.join(", ")} no ${empty.length === 1 ? "tiene" : "tienen"} preguntas.`,
    );
  }

  if (contest.tasks.some((task) => task.maxScore < task.minScore)) {
    readinessErrors.push("Hay tareas con puntajes mal configurados.");
  }

  if (readinessErrors.length > 0) {
    res.status(400).json({
      message: readinessErrors[0],
      errors: readinessErrors,
    });
    return;
  }

  const publishedContest = await prisma.contest.update({
    where: {
      id: contest.id,
    },
    data: {
      publishedAt: contest.publishedAt ?? currentDate(),
    },
    include: {
      tasks: {
        orderBy: {
          position: "asc",
        },
        include: {
          taskDraft: true,
        },
      },
    },
  });

  res.json(deserializeContest(publishedContest));
});

const contestWithTasks = {
  tasks: {
    orderBy: { position: "asc" as const },
    include: { taskDraft: true },
  },
};

app.post("/api/contests/:id/suspend", async (req, res) => {
  const contest = await prisma.contest.findUnique({
    where: { id: req.params.id },
    include: contestWithTasks,
  });

  if (!contest) {
    res.status(404).json({ message: "Contest not found" });
    return;
  }

  if (computeContestState(contest).state !== "abierta") {
    res.status(409).json({
      message: "Solo se puede suspender un desafío que esté en curso.",
    });
    return;
  }

  const suspended = await prisma.contest.update({
    where: { id: contest.id },
    data: { suspendedAt: currentDate() },
    include: contestWithTasks,
  });

  res.json(deserializeContest(suspended));
});

app.post("/api/contests/:id/resume", async (req, res) => {
  const contest = await prisma.contest.findUnique({
    where: { id: req.params.id },
    include: contestWithTasks,
  });

  if (!contest) {
    res.status(404).json({ message: "Contest not found" });
    return;
  }

  if (
    computeContestState(contest).state !== "suspendida" ||
    !contest.suspendedAt
  ) {
    res.status(409).json({
      message: "Solo se puede reanudar un desafío suspendido.",
    });
    return;
  }

  const pausedMs = currentDate().getTime() - contest.suspendedAt.getTime();
  const pausedAttempts = await prisma.attempt.findMany({
    where: {
      status: "in_progress",
      endsAt: { not: null },
      team: { group: { contestId: contest.id } },
    },
    select: { id: true, endsAt: true },
  });

  const resumedAt = currentDate().toISOString();
  await env.DB.batch([
    ...pausedAttempts.map((attempt) =>
      env.DB.prepare(`UPDATE "Attempt" SET "endsAt" = ?, "updatedAt" = ?
        WHERE "id" = ? AND "status" = 'in_progress'
        AND EXISTS (SELECT 1 FROM "Contest" WHERE "id" = ? AND "suspendedAt" IS NOT NULL)`)
        .bind(new Date(attempt.endsAt!.getTime() + pausedMs).toISOString(), resumedAt, attempt.id, contest.id),
    ),
    env.DB.prepare('UPDATE "Contest" SET "suspendedAt" = NULL, "updatedAt" = ? WHERE "id" = ?')
      .bind(resumedAt, contest.id),
  ]);

  const resumed = await prisma.contest.findUniqueOrThrow({
    where: { id: contest.id },
    include: contestWithTasks,
  });

  res.json({
    ...deserializeContest(resumed),
    resumedAttempts: pausedAttempts.length,
  });
});

app.post("/api/contests/:id/consolidate", async (req, res) => {
  const contest = await prisma.contest.findUnique({
    where: { id: req.params.id },
    include: contestWithTasks,
  });

  if (!contest) {
    res.status(404).json({ message: "Contest not found" });
    return;
  }

  const { state } = computeContestState(contest);

  if (!contestHasEnded(state)) {
    res.status(409).json({
      message: "Solo se puede consolidar un desafío cuya ventana ya terminó.",
    });
    return;
  }

  const closedAttempts = await consolidateContest(contest.id);

  const consolidated = await prisma.contest.update({
    where: { id: contest.id },
    data: { consolidatedAt: currentDate() },
    include: contestWithTasks,
  });

  res.json({ ...deserializeContest(consolidated), closedAttempts });
});

app.post("/api/contests/:id/results/publish", async (req, res) => {
  const contest = await prisma.contest.findUnique({
    where: { id: req.params.id },
    select: { id: true, consolidatedAt: true },
  });

  if (!contest) {
    res.status(404).json({ message: "Contest not found" });
    return;
  }

  if (!contest.consolidatedAt) {
    res.status(409).json({
      message: "Primero consolida el desafío para calcular los puntajes.",
    });
    return;
  }

  const published = await prisma.contest.update({
    where: { id: contest.id },
    data: { resultsPublishedAt: currentDate() },
    include: contestWithTasks,
  });

  res.json(deserializeContest(published));
});

app.post("/api/contests/:id/results/unpublish", async (req, res) => {
  const contest = await prisma.contest.findUnique({
    where: { id: req.params.id },
    select: { id: true },
  });

  if (!contest) {
    res.status(404).json({ message: "Contest not found" });
    return;
  }

  const updated = await prisma.contest.update({
    where: { id: contest.id },
    data: { resultsPublishedAt: null },
    include: contestWithTasks,
  });

  res.json(deserializeContest(updated));
});

app.delete("/api/contests/:id", async (req, res) => {
  const contest = await prisma.contest.findUnique({
    where: { id: req.params.id },
    select: { publishedAt: true },
  });

  if (!contest) {
    res.status(404).json({ message: "Desafío no encontrado." });
    return;
  }

  // Publicado, ya lo ven los maestros y puede tener inscritos o resultados.
  if (contest.publishedAt) {
    res.status(409).json({
      message: "Solo se puede eliminar un desafío en borrador.",
    });
    return;
  }

  await prisma.contest.delete({
    where: {
      id: req.params.id,
    },
  });

  res.status(204).send();
});

function generateCode(length: number) {
  // Sin caracteres ambiguos (O/0, I/1/L).
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < length; i += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

async function generateUniqueAccessCode() {
  for (let i = 0; i < 12; i += 1) {
    const code = generateCode(6);
    const existing = await prisma.contestGroup.findUnique({
      where: { accessCode: code },
    });
    if (!existing) {
      return code;
    }
  }
  throw new Error("No se pudo generar un código de acceso único.");
}

async function generateUniquePersonalCode() {
  for (let i = 0; i < 12; i += 1) {
    const code = generateCode(8);
    const existing = await prisma.team.findUnique({
      where: { personalCode: code },
    });
    if (!existing) {
      return code;
    }
  }
  throw new Error("No se pudo generar un código de equipo único.");
}

function cleanName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function formatName(value: string) {
  return cleanName(value)
    .toLowerCase()
    .replace(
      /(^|\s|-)(\p{L})/gu,
      (_match, sep, letter) => sep + letter.toUpperCase(),
    );
}

function nameKey(first: string, last: string) {
  const norm = (value: string) =>
    cleanName(value)
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "");
  return `${norm(first)} ${norm(last)}`;
}

function serializeGroup(group: {
  id: string;
  name: string;
  category: string | null;
  accessCode: string;
  contestId: string;
  firstUsedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  contest?: { title: string; categories: string; allowPairs: boolean } | null;
  teams?: Array<{
    id: string;
    participationMode: string;
    grade: string | null;
    memberOneFirstName: string;
    memberOneLastName: string;
    memberTwoFirstName: string | null;
    memberTwoLastName: string | null;
    personalCode: string;
    status: string;
    createdAt: Date;
  }>;
}) {
  return {
    id: group.id,
    name: group.name,
    accessCode: group.accessCode,
    contestId: group.contestId,
    contestTitle: group.contest?.title ?? "",
    category: group.category,
    contestCategories: group.contest ? contestCategories(group.contest) : [],
    contestAllowPairs: group.contest?.allowPairs ?? false,
    firstUsedAt: group.firstUsedAt?.toISOString() ?? null,
    expiresAt: group.expiresAt?.toISOString() ?? null,
    createdAt: group.createdAt.toISOString(),
    teamCount: group.teams?.length ?? 0,
    teams:
      group.teams?.map((team) => ({
        id: team.id,
        participationMode: team.participationMode,
        grade: team.grade,
        memberOneFirstName: team.memberOneFirstName,
        memberOneLastName: team.memberOneLastName,
        memberTwoFirstName: team.memberTwoFirstName,
        memberTwoLastName: team.memberTwoLastName,
        personalCode: team.personalCode,
        status: team.status,
        createdAt: team.createdAt.toISOString(),
      })) ?? [],
  };
}

const groupContestSelect = {
  contest: { select: { title: true, categories: true, allowPairs: true } },
};

// ---- Gestión de maestros (solo admin) ----

app.get("/api/users/maestros", async (_req, res) => {
  const maestros = await prisma.user.findMany({
    where: { role: "maestro" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      email: true,
      status: true,
      schoolName: true,
      schoolCodUe: true,
      institutionType: true,
      phone: true,
      letterFilename: true,
      idFrontFilename: true,
      idBackFilename: true,
      createdAt: true,
      schools: { orderBy: { createdAt: "asc" as const } },
    },
  });

  res.json(
    maestros.map(
      ({
        letterFilename,
        idFrontFilename,
        idBackFilename,
        schoolCodUe,
        institutionType,
        schools,
        ...maestro
      }) => ({
        ...maestro,
        name: maestro.name === null ? null : formatPersonName(maestro.name),
        schools: schools.map(serializeTeacherSchool),
        institutionType:
          institutionType ?? (schoolCodUe ? "school" : "homeschool"),
        isHomeschool:
          (institutionType ?? (schoolCodUe ? "school" : "homeschool")) ===
          "homeschool",
        hasLetter: Boolean(letterFilename),
        hasIdFront: Boolean(idFrontFilename),
        hasIdBack: Boolean(idBackFilename),
        createdAt: maestro.createdAt.toISOString(),
      }),
    ),
  );
});

app.post("/api/users/:id/approve", async (req, res) => {
  const user = await prisma.user.update({
    where: { id: Number(req.params.id) },
    data: { status: "approved" },
    select: { id: true, status: true },
  });
  res.json(user);
});

app.post("/api/users/:id/reject", async (req, res) => {
  const user = await prisma.user.update({
    where: { id: Number(req.params.id) },
    data: { status: "rejected" },
    select: { id: true, status: true },
  });
  res.json(user);
});

app.post("/api/users/schools/:schoolId/:decision", async (req, res) => {
  const decision = req.params.decision;

  if (decision !== "approve" && decision !== "reject") {
    res.status(400).json({ message: "Decisión inválida." });
    return;
  }

  const school = await prisma.teacherSchool.findUnique({
    where: { id: req.params.schoolId },
  });

  if (!school) {
    res.status(404).json({ message: "Colegio no encontrado." });
    return;
  }

  const updated = await prisma.teacherSchool.update({
    where: { id: school.id },
    data: { status: decision === "approve" ? "approved" : "rejected" },
  });

  res.json(serializeTeacherSchool(updated));
});

app.get("/api/users/schools/:schoolId/letter", async (req, res) => {
  const school = await prisma.teacherSchool.findUnique({
    where: { id: req.params.schoolId },
  });

  if (!school?.letterFilename) {
    res.status(404).json({ message: "Documento no encontrado." });
    return;
  }

  await sendPrivateDocument(res, school.letterFilename);
});

app.post("/api/users/:id/suspend", async (req, res) => {
  const user = await prisma.user.update({
    where: { id: Number(req.params.id) },
    data: { status: "suspended" },
    select: { id: true, status: true },
  });
  res.json(user);
});

app.get("/api/users/:id/documents/:doc", async (req, res) => {
  const docField =
    req.params.doc === "letter"
      ? "letterFilename"
      : req.params.doc === "idFront"
        ? "idFrontFilename"
        : req.params.doc === "idBack"
          ? "idBackFilename"
          : null;

  if (!docField) {
    res.status(400).json({ message: "Documento inválido." });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: Number(req.params.id) },
    select: { [docField]: true },
  });

  const name = user?.[docField as keyof typeof user] as string | undefined;

  if (!name) {
    res
      .status(404)
      .json({ message: "Este maestro no tiene ese documento cargado." });
    return;
  }

  if (name.includes("..") || name.includes("/") || name.includes("\\")) {
    res.status(400).json({ message: "Nombre de archivo inválido." });
    return;
  }

  await sendPrivateDocument(res, name);
});

// ---- Desafíos publicados para armar grupos (admin y maestro) ----

app.get("/api/published-contests", requireAuth, async (req, res) => {
  // Un maestro ve los desafios oficiales y ademas sus propias practicas; nadie
  // mas ve las practicas de nadie.
  const visibility =
    req.user?.role === "maestro"
      ? { OR: [{ isPractice: false }, { createdById: req.user.id }] }
      : { isPractice: false };

  const contests = await prisma.contest.findMany({
    where: {
      publishedAt: { not: null },
      AND: [
        { OR: [{ endsAt: null }, { endsAt: { gte: currentDate() } }] },
        visibility,
      ],
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      categories: true,
      publishedAt: true,
      registrationStartsAt: true,
      registrationEndsAt: true,
      startsAt: true,
      endsAt: true,
    },
  });
  res.json(
    contests.filter(contestRegistrationIsOpen).map((contest) => ({
      ...contest,
      categories: contestCategories(contest),
      registrationStartsAt: contest.registrationStartsAt?.toISOString() ?? null,
      registrationEndsAt: contest.registrationEndsAt?.toISOString() ?? null,
      startsAt: contest.startsAt?.toISOString() ?? null,
      endsAt: contest.endsAt?.toISOString() ?? null,
    })),
  );
});

// ---- Grupos: el admin ve todos; el maestro solo los suyos ----

app.get("/api/groups", async (req, res) => {
  const where =
    req.user?.role === "maestro" ? { createdById: req.user.id } : {};

  const groups = await prisma.contestGroup.findMany({
    where,
    include: { ...groupContestSelect, teams: true },
    orderBy: { createdAt: "desc" },
  });

  res.json(groups.map(serializeGroup));
});

app.get("/api/groups/:id", async (req, res) => {
  const group = await prisma.contestGroup.findUnique({
    where: { id: req.params.id },
    include: {
      ...groupContestSelect,
      teams: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!group) {
    res.status(404).json({ message: "Grupo no encontrado." });
    return;
  }

  if (req.user?.role === "maestro" && group.createdById !== req.user.id) {
    res.status(404).json({ message: "Grupo no encontrado." });
    return;
  }

  res.json(serializeGroup(group));
});

app.post("/api/groups", async (req, res) => {
  const contestId =
    typeof req.body?.contestId === "string" ? req.body.contestId : "";
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";

  if (!name) {
    res.status(400).json({
      message: "El nombre del grupo es obligatorio.",
      code: "GROUP_NAME_REQUIRED",
      field: "name",
    });
    return;
  }

  const contest = await prisma.contest.findUnique({ where: { id: contestId } });

  if (!contest) {
    res.status(400).json({
      message: "El desafío no existe.",
      code: "GROUP_CONTEST_NOT_FOUND",
      field: "contestId",
    });
    return;
  }

  if (!contest.publishedAt) {
    res.status(400).json({
      message: "El desafío debe estar publicado para crear grupos.",
      code: "GROUP_CONTEST_UNPUBLISHED",
      field: "contestId",
    });
    return;
  }

  if (!contestRegistrationIsOpen(contest)) {
    res.status(409).json({ message: registrationWindowMessage(contest) });
    return;
  }

  if (contestHasEnded(computeContestState(contest).state)) {
    res.status(409).json({
      message: "El desafío ya cerró; no es posible crear grupos.",
      code: "GROUP_CONTEST_CLOSED",
      field: "contestId",
    });
    return;
  }

  const categories = contestCategories(contest);
  const requestedCategory =
    typeof req.body?.category === "string" ? req.body.category.trim() : "";
  const category =
    requestedCategory || (categories.length === 1 ? categories[0] : "");

  if (!categories.includes(category)) {
    res.status(400).json({
      message: requestedCategory
        ? "Esa categoría no participa en este desafío."
        : "Elige la categoría del grupo.",
      code: "GROUP_CATEGORY_REQUIRED",
      field: "category",
    });
    return;
  }

  const accessCode = await generateUniqueAccessCode();
  const recoveryCode = generateCode(10);

  const group = await prisma.contestGroup.create({
    data: {
      contestId,
      name,
      category,
      accessCode,
      recoveryCode,
      createdById: req.user?.id ?? null,
    },
    include: { ...groupContestSelect, teams: true },
  });

  res.status(201).json(serializeGroup(group));
});

app.delete("/api/groups/:id", async (req, res) => {
  const group = await prisma.contestGroup.findUnique({
    where: { id: req.params.id },
    select: {
      createdById: true,
      teams: { select: { attempt: { select: { status: true } } } },
    },
  });

  if (
    !group ||
    (req.user?.role === "maestro" && group.createdById !== req.user.id)
  ) {
    res.status(404).json({ message: "Grupo no encontrado." });
    return;
  }

  const played = group.teams.filter(
    (team) => team.attempt && team.attempt.status !== "pending",
  ).length;

  if (played > 0) {
    res.status(409).json({
      message: `Este grupo tiene ${played} participante(s) que ya rindieron; no se puede eliminar sin perder sus resultados.`,
    });
    return;
  }

  await prisma.contestGroup.delete({ where: { id: req.params.id } });
  res.status(204).send();
});

function serializeTeam(team: {
  id: string;
  participationMode: string;
  grade?: string | null;
  memberOneFirstName: string;
  memberOneLastName: string;
  memberTwoFirstName: string | null;
  memberTwoLastName: string | null;
  personalCode?: string;
  status: string;
  createdAt: Date;
}) {
  return {
    id: team.id,
    participationMode: team.participationMode,
    grade: team.grade ?? null,
    memberOneFirstName: team.memberOneFirstName,
    memberOneLastName: team.memberOneLastName,
    memberTwoFirstName: team.memberTwoFirstName,
    memberTwoLastName: team.memberTwoLastName,
    personalCode: team.personalCode,
    status: team.status,
    createdAt: team.createdAt.toISOString(),
  };
}

app.delete("/api/teams/:id", async (req, res) => {
  const team = await prisma.team.findUnique({
    where: { id: req.params.id },
    include: {
      attempt: { select: { status: true } },
      group: { select: { createdById: true } },
    },
  });

  if (
    !team ||
    (req.user?.role === "maestro" && team.group.createdById !== req.user.id)
  ) {
    res.status(404).json({ message: "Participante no encontrado." });
    return;
  }

  if (team.attempt && team.attempt.status !== "pending") {
    res.status(409).json({
      message:
        "Este participante ya rindió el desafío; no se puede eliminar sin perder su resultado.",
    });
    return;
  }

  await prisma.team.delete({ where: { id: team.id } });
  res.status(204).send();
});

app.put("/api/teams/:id", async (req, res) => {
  const team = await prisma.team.findUnique({
    where: { id: req.params.id },
    include: { group: { include: { contest: true } } },
  });

  if (
    !team ||
    (req.user?.role === "maestro" && team.group.createdById !== req.user.id)
  ) {
    res.status(404).json({
      message: "Participante no encontrado.",
      code: "TEAM_NOT_FOUND",
    });
    return;
  }

  const readField = (value: unknown) =>
    typeof value === "string" ? value.trim() : "";
  const oneFirst = readField(req.body?.memberOneFirstName);
  const oneLast = readField(req.body?.memberOneLastName);
  const isPareja = team.participationMode === "pareja";
  const twoFirst = readField(req.body?.memberTwoFirstName);
  const twoLast = readField(req.body?.memberTwoLastName);
  let grade: string;

  try {
    grade = parseGrade(req.body?.grade, groupCategories(team.group));
  } catch (error) {
    res.status(400).json({
      message: error instanceof Error ? error.message : "Curso inválido.",
      code: "TEAM_GRADE_INVALID",
      field: "grade",
    });
    return;
  }

  if (!oneFirst || !oneLast) {
    res.status(400).json({
      message: "Los nombres y apellidos son obligatorios.",
      code: "TEAM_MEMBER_ONE_REQUIRED",
      fields: [
        ...(!oneFirst ? ["memberOneFirstName"] : []),
        ...(!oneLast ? ["memberOneLastName"] : []),
      ],
    });
    return;
  }

  if (isPareja && (!twoFirst || !twoLast)) {
    res.status(400).json({
      message: "Faltan los nombres y apellidos del segundo integrante.",
      code: "TEAM_MEMBER_TWO_REQUIRED",
      fields: [
        ...(!twoFirst ? ["memberTwoFirstName"] : []),
        ...(!twoLast ? ["memberTwoLastName"] : []),
      ],
    });
    return;
  }

  const keyOne = nameKey(oneFirst, oneLast);
  const keyTwo = isPareja ? nameKey(twoFirst, twoLast) : "";

  if (isPareja && keyOne === keyTwo) {
    res.status(400).json({
      message: "Los dos integrantes no pueden ser la misma persona.",
      code: "TEAM_MEMBERS_IDENTICAL",
      fields: ["memberTwoFirstName", "memberTwoLastName"],
    });
    return;
  }

  const others = await prisma.team.findMany({
    where: { group: { contestId: team.group.contestId }, id: { not: team.id } },
    select: {
      memberOneFirstName: true,
      memberOneLastName: true,
      memberTwoFirstName: true,
      memberTwoLastName: true,
    },
  });

  const takenKeys = new Set<string>();
  for (const other of others) {
    takenKeys.add(nameKey(other.memberOneFirstName, other.memberOneLastName));
    if (other.memberTwoFirstName && other.memberTwoLastName) {
      takenKeys.add(nameKey(other.memberTwoFirstName, other.memberTwoLastName));
    }
  }

  if (takenKeys.has(keyOne)) {
    res.status(409).json({
      message: `${formatName(oneFirst)} ${formatName(oneLast)} ya está registrado en este desafío.`,
      code: "TEAM_MEMBER_DUPLICATE",
      fields: ["memberOneFirstName", "memberOneLastName"],
    });
    return;
  }

  if (isPareja && takenKeys.has(keyTwo)) {
    res.status(409).json({
      message: `${formatName(twoFirst)} ${formatName(twoLast)} ya está registrado en este desafío.`,
      code: "TEAM_MEMBER_DUPLICATE",
      fields: ["memberTwoFirstName", "memberTwoLastName"],
    });
    return;
  }

  const updated = await prisma.team.update({
    where: { id: team.id },
    data: {
      grade,
      memberOneFirstName: formatName(oneFirst),
      memberOneLastName: formatName(oneLast),
      memberTwoFirstName: isPareja ? formatName(twoFirst) : null,
      memberTwoLastName: isPareja ? formatName(twoLast) : null,
    },
  });

  res.json(serializeTeam(updated));
});

app.get("/api/groups/:id/roster-template", async (req, res) => {
  const group = await prisma.contestGroup.findUnique({
    where: { id: String(req.params.id) },
    include: { contest: true },
  });

  if (
    !group ||
    (req.user?.role === "maestro" && group.createdById !== req.user.id)
  ) {
    res.status(404).json({ message: "Grupo no encontrado." });
    return;
  }

  const grades = gradesForCategories(groupCategories(group));
  const allowPairs = group.contest.allowPairs;
  // Si el desafio es solo individual, Modalidad tendria un unico valor posible
  // y las columnas del companero solo podrian provocar errores: la planilla se
  // queda con lo que de verdad hay que llenar.
  const headers = allowPairs ? ROSTER_COLUMNS : ROSTER_COLUMNS.slice(0, 3);
  const widths = allowPairs ? [22, 22, 26, 16, 22, 22] : [26, 26, 30];
  const BLANK_ROWS = 40;

  const HEADER_FILL: ExcelJS.Fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF334155" },
  };
  const CELL_BORDER: Partial<ExcelJS.Borders> = {
    top: { style: "thin", color: { argb: "FFD8DEE7" } },
    left: { style: "thin", color: { argb: "FFD8DEE7" } },
    bottom: { style: "thin", color: { argb: "FFD8DEE7" } },
    right: { style: "thin", color: { argb: "FFD8DEE7" } },
  };

  function dressHeader(sheet: ExcelJS.Worksheet, rowNumber: number) {
    const row = sheet.getRow(rowNumber);
    row.height = 22;
    row.font = { bold: true, color: { argb: "FFFFFFFF" } };
    row.alignment = { vertical: "middle" };
    for (let column = 1; column <= headers.length; column += 1) {
      const cell = row.getCell(column);
      cell.fill = HEADER_FILL;
      cell.border = CELL_BORDER;
    }
  }

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Participantes");

  // Las listas viven en una hoja oculta y se referencian por rango: escritas
  // dentro de la formula el formato las limita a 255 caracteres y Excel las
  // descarta sin avisar. El importador acepta el codigo (P3) o la etiqueta
  // (3.º de primaria); se ofrece la etiqueta porque es la que el maestro lee.
  const data = workbook.addWorksheet("Datos", { state: "hidden" });
  data.getCell("A1").value = "Cursos";
  grades.forEach((grade, index) => {
    data.getCell(`A${index + 2}`).value = grade.label;
  });
  if (allowPairs) {
    data.getCell("B1").value = "Modalidades";
    data.getCell("B2").value = "individual";
    data.getCell("B3").value = "pareja";
  }
  const gradeRange = `Datos!$A$2:$A$${grades.length + 1}`;
  const modeRange = "Datos!$B$2:$B$3";

  sheet.columns = headers.map((header, index) => ({
    header,
    key: header,
    width: widths[index],
  }));
  dressHeader(sheet, 1);
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: headers.length },
  };

  // Filas en blanco ya formateadas: la hoja se abre como un formulario listo
  // para llenar.
  const lastRow = BLANK_ROWS + 1;
  for (let rowNumber = 2; rowNumber <= lastRow; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    for (let column = 1; column <= headers.length; column += 1) {
      row.getCell(column).border = CELL_BORDER;
    }
  }

  // Una sola entrada por columna: aplicarlas celda a celda hace que ExcelJS
  // emita rangos sqref solapados, y con eso Excel descarta las listas en
  // silencio (la columna aparece sin desplegable).
  const validations = (
    sheet as unknown as {
      dataValidations: {
        add: (range: string, validation: ExcelJS.DataValidation) => void;
      };
    }
  ).dataValidations;

  validations.add(`C2:C${lastRow}`, {
    type: "list",
    allowBlank: true,
    formulae: [gradeRange],
    showErrorMessage: true,
    errorStyle: "error",
    errorTitle: "Curso no válido",
    error: "Elige uno de los cursos de la lista.",
  });

  if (allowPairs) {
    validations.add(`D2:D${lastRow}`, {
      type: "list",
      allowBlank: true,
      formulae: [modeRange],
      showErrorMessage: true,
      errorStyle: "error",
      errorTitle: "Modalidad no válida",
      error: "Elige individual o pareja.",
    });
  }

  const example = workbook.addWorksheet("Ejemplo");
  example.columns = headers.map((header, index) => ({
    key: header,
    width: widths[index],
  }));
  // Los titulos van en la fila 3 a proposito: el importador busca la hoja cuyos
  // encabezados esten en la fila 1, y esta no debe competir con Participantes.
  example.mergeCells(1, 1, 1, headers.length);
  example.getCell(1, 1).value =
    "Ejemplo de referencia — esta hoja no se importa";
  example.getCell(1, 1).font = { bold: true };
  example.addRow([]);
  example.addRow(headers);
  dressHeader(example, 3);

  const sampleGrade = grades[0]?.label ?? "";
  const sampleRows = allowPairs
    ? [
        ["Ana", "Quispe", sampleGrade, "individual", "", ""],
        ["Luis", "Mamani", sampleGrade, "pareja", "Sofía", "Rojas"],
      ]
    : [
        ["Ana", "Quispe", sampleGrade],
        ["Luis", "Mamani", sampleGrade],
      ];

  for (const values of sampleRows) {
    const row = example.addRow(values);
    for (let column = 1; column <= headers.length; column += 1) {
      row.getCell(column).border = CELL_BORDER;
    }
  }

  const notes = workbook.addWorksheet("Instrucciones");
  notes.columns = [{ width: 100 }];
  notes.addRow(["Cómo llenar esta planilla"]);
  notes.getRow(1).font = { bold: true };
  notes.addRow([""]);
  notes.addRow(["Llena la hoja Participantes: una fila por participante."]);
  notes.addRow([
    allowPairs
      ? "Curso y Modalidad tienen lista desplegable: elige de la lista en vez de escribir."
      : "La columna Curso tiene lista desplegable: elige de la lista en vez de escribir.",
  ]);
  notes.addRow([
    `Cursos válidos en este desafío: ${grades
      .map((grade) => `${grade.label} (${grade.value})`)
      .join(", ")}. Cada estudiante rinde las preguntas de la categoría de su curso.`,
  ]);
  notes.addRow([
    allowPairs
      ? "En pareja, llena también las columnas del compañero. En individual, déjalas vacías."
      : "Este desafío es solo individual, por eso la planilla no pide modalidad ni datos de compañero.",
  ]);
  notes.addRow([
    "Conserva los títulos en la primera fila. Puedes cambiar el orden de las columnas.",
  ]);
  notes.addRow(["Deja sin llenar las filas que te sobren."]);
  notes.addRow([
    "La importación es todo o nada: si una fila tiene errores, no se guarda ninguna.",
  ]);

  const buffer = await workbook.xlsx.writeBuffer();

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="participantes-${group.accessCode}.xlsx"`,
  );
  res.end(Buffer.from(buffer as unknown as ArrayBuffer));
});

app.post("/api/groups/:id/roster", rosterUploadMiddleware, async (req, res) => {
  const group = await prisma.contestGroup.findUnique({
    where: { id: String(req.params.id) },
    include: { contest: true },
  });

  if (
    !group ||
    (req.user?.role === "maestro" && group.createdById !== req.user.id)
  ) {
    res.status(404).json({ message: "Grupo no encontrado." });
    return;
  }

  if (!contestRegistrationIsOpen(group.contest)) {
    res.status(409).json({ message: registrationWindowMessage(group.contest) });
    return;
  }

  if (contestHasEnded(computeContestState(group.contest).state)) {
    res
      .status(409)
      .json({ message: "El desafío ya cerró; no es posible inscribir." });
    return;
  }

  if (!req.file) {
    res.status(400).json({ message: "Adjunta la planilla." });
    return;
  }

  const leaseOwner = randomUUID();
  const acquiredAt = currentDate();
  const lease = await env.DB.prepare(`INSERT INTO "RosterImportLock" ("contestId", "owner", "acquiredAt")
    VALUES (?, ?, ?)
    ON CONFLICT("contestId") DO UPDATE SET "owner" = excluded."owner", "acquiredAt" = excluded."acquiredAt"
    WHERE "RosterImportLock"."acquiredAt" <= ?`)
    .bind(
      group.contestId,
      leaseOwner,
      acquiredAt.toISOString(),
      new Date(acquiredAt.getTime() - ROSTER_LEASE_MS).toISOString(),
    )
    .run();
  if (lease.meta.changes === 0) {
    if (isE2E() && req.get("x-e2e-release-roster-lease") === "1") {
      await env.DB.prepare(
        'DELETE FROM "RosterImportLock" WHERE "contestId" = ?',
      )
        .bind(group.contestId)
        .run();
    }
    res.status(409).json({
      message:
        "Ya se está importando una planilla para este desafío. Intenta de nuevo cuando termine.",
      code: "ROSTER_IMPORT_IN_PROGRESS",
    });
    return;
  }

  try {
    const workbook = new ExcelJS.Workbook();

    try {
      if (req.file.originalname.toLowerCase().endsWith(".csv")) {
        await workbook.csv.read(
          Readable.from(req.file.buffer.toString("utf8")),
        );
      } else {
        await workbook.xlsx.load(
          req.file.buffer as unknown as Parameters<
            typeof workbook.xlsx.load
          >[0],
        );
      }
    } catch {
      res.status(400).json({
        message: "No pudimos leer la planilla. Usa la plantilla del desafío.",
      });
      return;
    }

    if (workbook.worksheets.length === 0) {
      res.status(400).json({ message: "La planilla está vacía." });
      return;
    }

    // Modalidad solo se exige donde puede variar. En un desafio solo individual
    // la plantilla ya no la trae, pero si el archivo la incluye se respeta.
    const requiredColumns = group.contest.allowPairs
      ? ROSTER_COLUMNS.slice(0, 4)
      : ROSTER_COLUMNS.slice(0, 3);
    const requiredHeaders = requiredColumns.map(normalizeHeader);
    const candidates: Array<{
      sheet: ExcelJS.Worksheet;
      columns: Map<string, number>;
      duplicateHeaders: string[];
    }> = [];

    for (const worksheet of workbook.worksheets) {
      const columns = new Map<string, number>();
      const duplicateHeaders = new Set<string>();
      worksheet.getRow(1).eachCell((cell, column) => {
        const header = normalizeHeader(cell.value);
        if (header && columns.has(header)) {
          duplicateHeaders.add(header);
        }
        columns.set(header, column);
      });
      if (requiredHeaders.every((header) => columns.has(header))) {
        candidates.push({
          sheet: worksheet,
          columns,
          duplicateHeaders: [...duplicateHeaders],
        });
      }
    }

    if (candidates.length === 0) {
      res.status(400).json({
        message: `La planilla necesita una hoja con ${requiredColumns
          .slice(0, -1)
          .join(", ")} y ${requiredColumns.at(-1)} en la primera fila.`,
        code: "ROSTER_SHEET_NOT_FOUND",
      });
      return;
    }
    if (candidates.length > 1) {
      res.status(400).json({
        message:
          "La planilla tiene más de una hoja importable. Deja los datos en una sola hoja.",
        code: "ROSTER_MULTIPLE_SHEETS",
      });
      return;
    }

    const { sheet, columns, duplicateHeaders } = candidates[0];
    const rosterHeaders = new Set(ROSTER_COLUMNS.map(normalizeHeader));
    if (duplicateHeaders.some((header) => rosterHeaders.has(header))) {
      res.status(400).json({
        message:
          "La hoja importable tiene encabezados repetidos. Deja una sola columna por dato.",
        code: "ROSTER_DUPLICATE_HEADERS",
      });
      return;
    }

    const columnOf = (header: string) =>
      columns.get(normalizeHeader(header)) ?? 0;
    const valueText = (value: ExcelJS.CellValue) => {
      if (value === null || value === undefined) {
        return "";
      }
      if (typeof value === "object" && "richText" in value) {
        return value.richText
          .map((part) => part.text)
          .join("")
          .trim();
      }
      if (typeof value === "object" && "text" in value) {
        return String(value.text).trim();
      }
      return String(value).trim();
    };
    const cellText = (row: ExcelJS.Row, column: number) =>
      column ? valueText(row.getCell(column).value) : "";

    const existingTeams = await prisma.team.findMany({
      where: { group: { contestId: group.contestId } },
      select: {
        memberOneFirstName: true,
        memberOneLastName: true,
        memberTwoFirstName: true,
        memberTwoLastName: true,
      },
    });
    const takenKeys = new Set<string>();
    for (const existing of existingTeams) {
      takenKeys.add(
        nameKey(existing.memberOneFirstName, existing.memberOneLastName),
      );
      if (existing.memberTwoFirstName && existing.memberTwoLastName) {
        takenKeys.add(
          nameKey(existing.memberTwoFirstName, existing.memberTwoLastName),
        );
      }
    }

    type RosterDraft = {
      row: number;
      participationMode: "individual" | "pareja";
      grade: string;
      oneFirst: string;
      oneLast: string;
      twoFirst: string | null;
      twoLast: string | null;
    };
    const drafts: RosterDraft[] = [];
    const issues: Array<{ row: number; name: string; reason: string }> = [];

    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const row = sheet.getRow(rowNumber);
      const oneFirst = cellText(row, columnOf("Nombres"));
      const oneLast = cellText(row, columnOf("Apellidos"));
      const gradeText = cellText(row, columnOf("Curso"));
      const modeText = cellText(row, columnOf("Modalidad"));
      const twoFirst = cellText(row, columnOf("Nombres del compañero"));
      const twoLast = cellText(row, columnOf("Apellidos del compañero"));
      const label = `${oneFirst} ${oneLast}`.trim() || "(sin nombre)";
      let hasAnyValue = false;
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (valueText(cell.value)) {
          hasAnyValue = true;
        }
      });

      if (!hasAnyValue) {
        continue;
      }

      const rowIssues: Array<{
        row: number;
        name: string;
        reason: string;
      }> = [];
      const addIssue = (reason: string, name = label) => {
        rowIssues.push({ row: rowNumber, name, reason });
      };
      if (!oneFirst || !oneLast) {
        addIssue("Faltan nombres o apellidos.");
      }

      // Sin columna de modalidad, individual es la unica lectura posible.
      const normalizedMode =
        normalizeHeader(modeText) ||
        (group.contest.allowPairs ? "" : "individual");
      const hasValidMode =
        normalizedMode === "individual" || normalizedMode === "pareja";
      const isPair = normalizedMode === "pareja";
      if (!hasValidMode) {
        addIssue(
          modeText
            ? `Modalidad "${modeText}" no reconocida. Usa individual o pareja.`
            : "Falta la modalidad. Usa individual o pareja.",
        );
      } else {
        if (!isPair && (twoFirst || twoLast)) {
          addIssue(
            "La modalidad individual no puede incluir datos de un compañero.",
          );
        }
        if (isPair && !group.contest.allowPairs) {
          addIssue("Este desafío no permite parejas.");
        }
        if (isPair && (!twoFirst || !twoLast)) {
          addIssue("Faltan los datos del compañero.");
        }
      }

      let grade: string | null = null;
      try {
        grade = gradeFromCell(gradeText, groupCategories(group));
      } catch (error) {
        addIssue(error instanceof Error ? error.message : "Curso inválido.");
      }

      const keyOne = oneFirst && oneLast ? nameKey(oneFirst, oneLast) : "";
      const keyTwo =
        isPair && twoFirst && twoLast ? nameKey(twoFirst, twoLast) : "";
      if (keyOne && keyTwo && keyOne === keyTwo) {
        addIssue("Los dos integrantes son la misma persona.");
      }
      if (keyOne && takenKeys.has(keyOne)) {
        addIssue("Ya está inscrito en este desafío.");
      }
      if (keyTwo && takenKeys.has(keyTwo)) {
        addIssue(
          "Ya está inscrito en este desafío.",
          `${twoFirst} ${twoLast}`.trim(),
        );
      }

      if (rowIssues.length > 0 || !hasValidMode || !grade || !keyOne) {
        issues.push(...rowIssues);
        continue;
      }

      takenKeys.add(keyOne);
      if (keyTwo) {
        takenKeys.add(keyTwo);
      }
      drafts.push({
        row: rowNumber,
        participationMode: isPair ? "pareja" : "individual",
        grade,
        oneFirst: formatName(oneFirst),
        oneLast: formatName(oneLast),
        twoFirst: isPair ? formatName(twoFirst) : null,
        twoLast: isPair ? formatName(twoLast) : null,
      });
    }

    if (issues.length > 0) {
      res.status(422).json({
        message:
          "No se importó ningún participante. Corrige las filas indicadas.",
        code: "ROSTER_VALIDATION_FAILED",
        details: issues,
      });
      return;
    }
    if (drafts.length === 0) {
      res.status(400).json({
        message: "La planilla no contiene participantes para importar.",
        code: "ROSTER_EMPTY",
      });
      return;
    }

    const reservedCodes = new Set<string>();
    const prepared: Array<RosterDraft & { personalCode: string }> = [];
    for (const draft of drafts) {
      let personalCode = await generateUniquePersonalCode();
      while (reservedCodes.has(personalCode)) {
        personalCode = await generateUniquePersonalCode();
      }
      reservedCodes.add(personalCode);
      prepared.push({ ...draft, personalCode });
    }

    const importedAt = currentDate().toISOString();
    await env.DB.batch(prepared.flatMap((draft) => {
      const teamId = randomUUID();
      return [
        env.DB.prepare(`INSERT INTO "Team"
          ("id", "groupId", "participationMode", "grade", "memberOneFirstName", "memberOneLastName",
           "memberTwoFirstName", "memberTwoLastName", "personalCode", "status", "createdAt", "updatedAt")
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'registered', ?, ?)`).bind(
          teamId, group.id, draft.participationMode, draft.grade, draft.oneFirst, draft.oneLast,
          draft.twoFirst, draft.twoLast, draft.personalCode, importedAt, importedAt,
        ),
        env.DB.prepare(`INSERT INTO "Attempt" ("id", "teamId", "status", "createdAt", "updatedAt")
          VALUES (?, ?, 'pending', ?, ?)`).bind(randomUUID(), teamId, importedAt, importedAt),
      ];
    }));

    res.status(201).json({
      created: prepared.map((draft) => ({
        row: draft.row,
        name: `${draft.oneFirst} ${draft.oneLast}`,
        personalCode: draft.personalCode,
      })),
      skipped: [],
    });
  } finally {
    if (!isE2E || req.get("x-e2e-keep-roster-lease") !== "1") {
      await env.DB.prepare(
        'DELETE FROM "RosterImportLock" WHERE "contestId" = ? AND "owner" = ?',
      )
        .bind(group.contestId, leaseOwner)
        .run();
    }
  }
});

app.post("/api/groups/:id/teams", async (req, res) => {
  const group = await prisma.contestGroup.findUnique({
    where: { id: req.params.id },
    include: { contest: true },
  });

  if (
    !group ||
    (req.user?.role === "maestro" && group.createdById !== req.user.id)
  ) {
    res.status(404).json({
      message: "Grupo no encontrado.",
      code: "TEAM_GROUP_NOT_FOUND",
    });
    return;
  }

  if (!contestRegistrationIsOpen(group.contest)) {
    res.status(409).json({ message: registrationWindowMessage(group.contest) });
    return;
  }

  if (contestHasEnded(computeContestState(group.contest).state)) {
    res.status(409).json({
      message: "El desafío ya cerró; no es posible inscribir.",
      code: "TEAM_CONTEST_CLOSED",
    });
    return;
  }

  const mode =
    req.body?.participationMode === "pareja" ? "pareja" : "individual";
  const readField = (value: unknown) =>
    typeof value === "string" ? value.trim() : "";
  const oneFirst = readField(req.body?.memberOneFirstName);
  const oneLast = readField(req.body?.memberOneLastName);
  const twoFirst = readField(req.body?.memberTwoFirstName);
  const twoLast = readField(req.body?.memberTwoLastName);

  if (!oneFirst || !oneLast) {
    res.status(400).json({
      message: "Los nombres y apellidos son obligatorios.",
      code: "TEAM_MEMBER_ONE_REQUIRED",
      fields: [
        ...(!oneFirst ? ["memberOneFirstName"] : []),
        ...(!oneLast ? ["memberOneLastName"] : []),
      ],
    });
    return;
  }

  if (mode === "pareja" && !group.contest.allowPairs) {
    res.status(400).json({
      message: "Este desafío no permite parejas.",
      code: "TEAM_PAIRS_NOT_ALLOWED",
    });
    return;
  }

  if (mode === "pareja" && (!twoFirst || !twoLast)) {
    res.status(400).json({
      message: "Faltan los nombres y apellidos del segundo integrante.",
      code: "TEAM_MEMBER_TWO_REQUIRED",
      fields: [
        ...(!twoFirst ? ["memberTwoFirstName"] : []),
        ...(!twoLast ? ["memberTwoLastName"] : []),
      ],
    });
    return;
  }

  let grade: string;

  try {
    grade = parseGrade(req.body?.grade, groupCategories(group));
  } catch (error) {
    res.status(400).json({
      message: error instanceof Error ? error.message : "Curso inválido.",
      code: "TEAM_GRADE_INVALID",
      field: "grade",
    });
    return;
  }

  const keyOne = nameKey(oneFirst, oneLast);
  const keyTwo = mode === "pareja" ? nameKey(twoFirst, twoLast) : "";

  if (mode === "pareja" && keyOne === keyTwo) {
    res.status(400).json({
      message: "Los dos integrantes no pueden ser la misma persona.",
      code: "TEAM_MEMBERS_IDENTICAL",
      fields: ["memberTwoFirstName", "memberTwoLastName"],
    });
    return;
  }

  const existingTeams = await prisma.team.findMany({
    where: { group: { contestId: group.contestId } },
    select: {
      memberOneFirstName: true,
      memberOneLastName: true,
      memberTwoFirstName: true,
      memberTwoLastName: true,
    },
  });

  const takenKeys = new Set<string>();
  for (const existing of existingTeams) {
    takenKeys.add(
      nameKey(existing.memberOneFirstName, existing.memberOneLastName),
    );
    if (existing.memberTwoFirstName && existing.memberTwoLastName) {
      takenKeys.add(
        nameKey(existing.memberTwoFirstName, existing.memberTwoLastName),
      );
    }
  }

  if (takenKeys.has(keyOne)) {
    res.status(409).json({
      message: `${formatName(oneFirst)} ${formatName(oneLast)} ya está registrado en este desafío.`,
      code: "TEAM_MEMBER_DUPLICATE",
      fields: ["memberOneFirstName", "memberOneLastName"],
    });
    return;
  }

  if (mode === "pareja" && takenKeys.has(keyTwo)) {
    res.status(409).json({
      message: `${formatName(twoFirst)} ${formatName(twoLast)} ya está registrado en este desafío.`,
      code: "TEAM_MEMBER_DUPLICATE",
      fields: ["memberTwoFirstName", "memberTwoLastName"],
    });
    return;
  }

  const personalCode = await generateUniquePersonalCode();

  const team = await prisma.team.create({
    data: {
      groupId: group.id,
      participationMode: mode,
      grade,
      memberOneFirstName: formatName(oneFirst),
      memberOneLastName: formatName(oneLast),
      memberTwoFirstName: mode === "pareja" ? formatName(twoFirst) : null,
      memberTwoLastName: mode === "pareja" ? formatName(twoLast) : null,
      personalCode,
      attempt: { create: { status: "pending" } },
    },
  });

  res.status(201).json(serializeTeam(team));
});

// ---- Entrada del estudiante (público, sin login) ----

app.get("/api/play/group/:code", async (req, res) => {
  const code = String(req.params.code ?? "")
    .trim()
    .toUpperCase();

  const group = await prisma.contestGroup.findUnique({
    where: { accessCode: code },
    include: { contest: true },
  });

  if (!group) {
    res.status(404).json({ message: "Código no encontrado." });
    return;
  }

  if (groupAccessHasExpired(group)) {
    res.status(410).json({ message: "El código ya expiró." });
    return;
  }

  if (!group.contest.publishedAt) {
    res.status(409).json({ message: "El desafío aún no está disponible." });
    return;
  }

  const { state } = computeContestState(group.contest);

  if (contestHasEnded(state)) {
    res.status(409).json({ message: "El desafío ya cerró." });
    return;
  }

  res.json({
    groupName: group.name,
    contestTitle: group.contest.title,
    contestCategories: contestCategories(group.contest),
    // Una practica no se inscribe: se entra con el nombre y ya.
    isPractice: group.contest.isPractice,
    allowPairs: group.contest.allowPairs,
    durationMinutes: group.contest.durationMinutes,
    registrationStartsAt:
      group.contest.registrationStartsAt?.toISOString() ?? null,
    registrationEndsAt: group.contest.registrationEndsAt?.toISOString() ?? null,
    contestStartsAt: group.contest.startsAt?.toISOString() ?? null,
    contestEndsAt: group.contest.endsAt?.toISOString() ?? null,
    category: group.category,
    grades: gradesForCategories(groupCategories(group)),
    state,
  });
});

app.post("/api/play/practice/:code/enter", async (req, res) => {
  const code = String(req.params.code ?? "")
    .trim()
    .toUpperCase();
  const rawName =
    typeof req.body?.name === "string" ? cleanName(req.body.name) : "";

  if (!rawName) {
    res.status(400).json({ message: "Escribe tu nombre." });
    return;
  }

  const group = await prisma.contestGroup.findUnique({
    where: { accessCode: code },
    include: { contest: true },
  });

  if (!group || !group.contest.isPractice) {
    res.status(404).json({ message: "Código no encontrado." });
    return;
  }

  if (groupAccessHasExpired(group)) {
    res.status(410).json({ message: "Esta práctica ya cerró." });
    return;
  }

  if (contestHasEnded(computeContestState(group.contest).state)) {
    res.status(409).json({ message: "Esta práctica ya cerró." });
    return;
  }

  const [first, ...rest] = rawName.split(" ");
  const firstName = formatName(first);
  const lastName = rest.length > 0 ? formatName(rest.join(" ")) : "";
  const key = nameKey(firstName, lastName);

  // El mismo nombre vuelve al mismo intento: asi quien cierra el navegador por
  // accidente retoma donde iba en vez de empezar de cero con otro registro.
  const existing = await prisma.team.findMany({ where: { groupId: group.id } });
  const mine = existing.find(
    (team) => nameKey(team.memberOneFirstName, team.memberOneLastName) === key,
  );

  if (mine && playSessionIsLive(mine)) {
    res.status(409).json({
      message:
        "Ya hay alguien con ese nombre resolviendo la práctica. Si eres tú, espera medio minuto e inténtalo otra vez.",
    });
    return;
  }

  const team =
    mine ??
    (await prisma.team.create({
      data: {
        groupId: group.id,
        participationMode: "individual",
        memberOneFirstName: firstName,
        memberOneLastName: lastName,
        personalCode: await generateUniquePersonalCode(),
        // Sin su intento, /api/play/attempt no encuentra al estudiante.
        attempt: { create: { status: "pending" } },
      },
    }));

  const sessionToken = randomUUID();
  await prisma.team.update({
    where: { id: team.id },
    data: { sessionToken, sessionSeenAt: currentDate() },
  });

  res.status(201).json({
    sessionToken,
    groupName: group.name,
    contestTitle: group.contest.title,
    participationMode: team.participationMode,
    memberOneFirstName: team.memberOneFirstName,
    memberOneLastName: team.memberOneLastName,
    memberTwoFirstName: null,
    memberTwoLastName: null,
  });
});

app.post("/api/play/join", async (req, res) => {
  const code =
    typeof req.body?.accessCode === "string"
      ? req.body.accessCode.trim().toUpperCase()
      : "";
  const mode =
    req.body?.participationMode === "pareja" ? "pareja" : "individual";
  const readField = (value: unknown) =>
    typeof value === "string" ? value.trim() : "";
  const memberOneFirstName = readField(req.body?.memberOneFirstName);
  const memberOneLastName = readField(req.body?.memberOneLastName);
  const memberTwoFirstName = readField(req.body?.memberTwoFirstName);
  const memberTwoLastName = readField(req.body?.memberTwoLastName);

  if (!memberOneFirstName || !memberOneLastName) {
    res
      .status(400)
      .json({ message: "Tus nombres y apellidos son obligatorios." });
    return;
  }

  const group = await prisma.contestGroup.findUnique({
    where: { accessCode: code },
    include: { contest: true },
  });

  if (!group) {
    res.status(404).json({ message: "Código no encontrado." });
    return;
  }

  if (groupAccessHasExpired(group)) {
    res.status(410).json({ message: "El código ya expiró." });
    return;
  }

  if (!group.contest.publishedAt) {
    res.status(409).json({ message: "El desafío aún no está disponible." });
    return;
  }

  if (!contestRegistrationIsOpen(group.contest)) {
    res.status(409).json({ message: registrationWindowMessage(group.contest) });
    return;
  }

  if (contestHasEnded(computeContestState(group.contest).state)) {
    res
      .status(409)
      .json({ message: "El desafío ya cerró; no es posible registrarse." });
    return;
  }

  if (mode === "pareja" && !group.contest.allowPairs) {
    res.status(400).json({ message: "Este desafío no permite parejas." });
    return;
  }

  if (mode === "pareja" && (!memberTwoFirstName || !memberTwoLastName)) {
    res.status(400).json({
      message: "Faltan los nombres y apellidos del segundo integrante.",
    });
    return;
  }

  let grade: string;

  try {
    grade = parseGrade(req.body?.grade, groupCategories(group));
  } catch (error) {
    res.status(400).json({
      message: error instanceof Error ? error.message : "Curso inválido.",
    });
    return;
  }

  const keyOne = nameKey(memberOneFirstName, memberOneLastName);
  const keyTwo =
    mode === "pareja" ? nameKey(memberTwoFirstName, memberTwoLastName) : "";

  if (mode === "pareja" && keyOne === keyTwo) {
    res
      .status(400)
      .json({ message: "Los dos integrantes no pueden ser la misma persona." });
    return;
  }

  const existingTeams = await prisma.team.findMany({
    where: { group: { contestId: group.contestId } },
    select: {
      id: true,
      groupId: true,
      personalCode: true,
      participationMode: true,
      memberOneFirstName: true,
      memberOneLastName: true,
      memberTwoFirstName: true,
      memberTwoLastName: true,
    },
  });

  const teamKeys = (team: (typeof existingTeams)[number]) => {
    const keys = [nameKey(team.memberOneFirstName, team.memberOneLastName)];
    if (team.memberTwoFirstName && team.memberTwoLastName) {
      keys.push(nameKey(team.memberTwoFirstName, team.memberTwoLastName));
    }
    return keys;
  };

  const takenKeys = new Set<string>();
  for (const existing of existingTeams) {
    for (const key of teamKeys(existing)) {
      takenKeys.add(key);
    }
  }

  if (mode === "individual") {
    const sameTeam = existingTeams.find(
      (existing) =>
        existing.groupId === group.id &&
        existing.participationMode === "individual" &&
        nameKey(existing.memberOneFirstName, existing.memberOneLastName) ===
          keyOne,
    );

    if (sameTeam) {
      res.status(200).json({
        personalCode: sameTeam.personalCode,
        teamId: sameTeam.id,
        groupName: group.name,
        contestTitle: group.contest.title,
        alreadyRegistered: true,
      });
      return;
    }
  }

  const oneName = `${formatName(memberOneFirstName)} ${formatName(memberOneLastName)}`;
  if (takenKeys.has(keyOne)) {
    res.status(409).json({
      message: `${oneName} ya está registrado en este desafío.`,
    });
    return;
  }

  if (mode === "pareja" && takenKeys.has(keyTwo)) {
    const twoName = `${formatName(memberTwoFirstName)} ${formatName(memberTwoLastName)}`;
    res.status(409).json({
      message: `${twoName} ya está registrado en este desafío.`,
    });
    return;
  }

  const personalCode = await generateUniquePersonalCode();

  const team = await prisma.team.create({
    data: {
      groupId: group.id,
      participationMode: mode,
      grade,
      memberOneFirstName: formatName(memberOneFirstName),
      memberOneLastName: formatName(memberOneLastName),
      memberTwoFirstName:
        mode === "pareja" ? formatName(memberTwoFirstName) : null,
      memberTwoLastName:
        mode === "pareja" ? formatName(memberTwoLastName) : null,
      personalCode,
      attempt: { create: { status: "pending" } },
    },
  });

  if (
    !group.firstUsedAt &&
    computeContestState(group.contest).state === "abierta"
  ) {
    const firstUsedAt = currentDate();
    const expiresAt =
      group.contest.endsAt ??
      new Date(firstUsedAt.getTime() + GROUP_CODE_LIFETIME_MINUTES * 60000);
    await prisma.contestGroup.update({
      where: { id: group.id },
      data: { firstUsedAt, expiresAt },
    });
  }

  res.status(201).json({
    personalCode,
    teamId: team.id,
    groupName: group.name,
    contestTitle: group.contest.title,
  });
});

app.get("/api/play/team/:personalCode", async (req, res) => {
  const personalCode = String(req.params.personalCode ?? "")
    .trim()
    .toUpperCase();

  const team = await prisma.team.findUnique({
    where: { personalCode },
    include: { group: { include: { contest: true } } },
  });

  if (!team) {
    res.status(404).json({ message: "Registro no encontrado." });
    return;
  }

  res.json({
    personalCode: team.personalCode,
    participationMode: team.participationMode,
    memberOneFirstName: team.memberOneFirstName,
    memberOneLastName: team.memberOneLastName,
    memberTwoFirstName: team.memberTwoFirstName,
    memberTwoLastName: team.memberTwoLastName,
    groupName: team.group.name,
    contestTitle: team.group.contest.title,
    accessCode: team.group.accessCode,
  });
});

function attemptElapsedMs(attempt: {
  startedAt: Date | null;
  finishedAt: Date | null;
}) {
  if (!attempt.startedAt || !attempt.finishedAt) {
    return Number.MAX_SAFE_INTEGER;
  }

  return attempt.finishedAt.getTime() - attempt.startedAt.getTime();
}

/** Cada categoría tiene su propio ranking: sus preguntas son otras. */
async function recomputeRanking(contestId: string) {
  const contest = await prisma.contest.findUnique({
    where: { id: contestId },
    select: { categories: true },
  });
  const categories = contest ? contestCategories(contest) : [];
  const results = await prisma.result.findMany({
    where: { attempt: { team: { group: { contestId } } } },
    select: {
      id: true,
      totalScore: true,
      attempt: {
        select: {
          startedAt: true,
          finishedAt: true,
          team: { select: { grade: true } },
        },
      },
    },
  });

  const byCategory = new Map<string, typeof results>();

  for (const result of results) {
    const category = teamCategory(result.attempt.team.grade, categories) ?? "";
    byCategory.set(category, [...(byCategory.get(category) ?? []), result]);
  }

  for (const group of byCategory.values()) {
    const ranked = group
      .map((result) => ({
        id: result.id,
        totalScore: result.totalScore,
        elapsedMs: attemptElapsedMs(result.attempt),
      }))
      .sort((left, right) => {
        if (left.totalScore !== right.totalScore) {
          return right.totalScore - left.totalScore;
        }

        return left.elapsedMs - right.elapsedMs;
      });

    for (let i = 0; i < ranked.length; i += 1) {
      await prisma.result.update({
        where: { id: ranked[i].id },
        data: { rankPosition: i + 1 },
      });
    }
  }
}

async function finalizeAttempt(attemptId: string, recomputeRank = true) {
  const attempt = await prisma.attempt.findUnique({
    where: { id: attemptId },
    include: {
      answers: true,
      team: {
        include: {
          group: {
            include: {
              contest: { include: { tasks: { include: { taskDraft: true } } } },
            },
          },
        },
      },
    },
  });
  if (!attempt) {
    return null;
  }

  const contest = attempt.team.group.contest;
  const answersByTask = new Map(
    attempt.answers.map((answer) => [answer.taskDraftId, answer]),
  );
  const categoryTasks = tasksOfCategory(
    contest.tasks,
    teamCategory(attempt.team.grade, contestCategories(contest)),
  );

  let totalScore = initialScoreOf(categoryTasks);
  let correctCount = 0;
  let answeredCount = 0;

  for (const contestTask of categoryTasks) {
    const task = deserializeTask(contestTask.taskDraft) as PlayTask;
    const existing = answersByTask.get(contestTask.taskDraftId);
    let payload: unknown = null;
    if (existing) {
      try {
        payload = JSON.parse(existing.responsePayload);
      } catch {
        payload = null;
      }
    }
    const answered = answerHasResponse(task.answerType, payload);
    const correct = answered ? answerIsCorrect(task, payload) : false;
    let score = contestTask.noAnswerScore;
    if (answered) {
      score = correct ? contestTask.maxScore : contestTask.minScore;
      answeredCount += 1;
    }
    if (correct) {
      correctCount += 1;
    }
    totalScore += score;

    if (existing) {
      await prisma.attemptAnswer.update({
        where: { id: existing.id },
        data: { isCorrect: answered ? correct : null, score },
      });
    }
  }

  const now = currentDate();
  const finishedAt =
    attempt.endsAt && attempt.endsAt < now ? attempt.endsAt : now;

  await prisma.attempt.update({
    where: { id: attempt.id },
    data: { status: "finished", finishedAt },
  });
  await prisma.result.upsert({
    where: { attemptId: attempt.id },
    update: { totalScore, correctCount, answeredCount, calculatedAt: now },
    create: {
      attemptId: attempt.id,
      totalScore,
      correctCount,
      answeredCount,
      calculatedAt: now,
    },
  });

  if (recomputeRank) {
    await recomputeRanking(contest.id);
  }

  return { totalScore, correctCount, answeredCount };
}

/**
 * Publica solos los resultados cuya hora ya llegó: cierra los intentos que
 * quedaron abiertos, arma el ranking y los publica. Corre una sola vez por
 * desafío, así que si el administrador los oculta después no vuelven.
 */
async function releaseDueResults(contestId?: string) {
  const now = currentDate();
  const due = await prisma.contest.findMany({
    where: {
      ...(contestId ? { id: contestId } : {}),
      isPractice: false,
      publishedAt: { not: null },
      resultsReleasedAt: null,
      endsAt: { not: null, lt: now },
    },
    select: { id: true, endsAt: true, resultsAt: true },
  });
  let released = false;

  for (const contest of due) {
    const releaseAt =
      contest.resultsAt && contest.resultsAt > contest.endsAt!
        ? contest.resultsAt
        : contest.endsAt!;

    if (releaseAt > now) {
      continue;
    }

    const stamp = now.toISOString();
    const claim = await env.DB.prepare(
      'UPDATE "Contest" SET "resultsReleasedAt" = ? WHERE "id" = ? AND "resultsReleasedAt" IS NULL',
    )
      .bind(stamp, contest.id)
      .run();

    if (!claim.meta.changes) {
      continue;
    }

    await consolidateContest(contest.id);
    await env.DB.prepare(
      'UPDATE "Contest" SET "consolidatedAt" = COALESCE("consolidatedAt", ?), "resultsPublishedAt" = COALESCE("resultsPublishedAt", ?) WHERE "id" = ?',
    )
      .bind(stamp, stamp, contest.id)
      .run();
    released = true;
  }

  return released;
}

async function consolidateContest(contestId: string) {
  const expired = await prisma.attempt.findMany({
    where: {
      status: "in_progress",
      team: { group: { contestId } },
    },
    select: { id: true },
  });

  for (const attempt of expired) {
    await finalizeAttempt(attempt.id, false);
  }

  await recomputeRanking(contestId);

  return expired.length;
}

const playTeamInclude = {
  attempt: true,
  group: {
    include: {
      contest: {
        include: {
          tasks: {
            orderBy: { position: "asc" as const },
            include: { taskDraft: true },
          },
        },
      },
    },
  },
};

const playTeamLightInclude = {
  attempt: true,
  group: { select: { contestId: true, contest: true } },
};

function findTeamForPlay(personalCode: string) {
  return prisma.team.findUnique({
    where: { personalCode },
    include: playTeamInclude,
  });
}

function findTeamBySession(sessionToken: string) {
  return prisma.team.findUnique({
    where: { sessionToken },
    include: playTeamInclude,
  });
}

function findLightTeamForPlay(personalCode: string) {
  return prisma.team.findUnique({
    where: { personalCode },
    include: playTeamLightInclude,
  });
}

function findLightTeamBySession(sessionToken: string) {
  return prisma.team.findUnique({
    where: { sessionToken },
    include: playTeamLightInclude,
  });
}

const PLAY_SESSION_TTL_MS = 30000;

type PlaySessionState = {
  sessionToken: string | null;
  sessionSeenAt: Date | null;
};

function playSessionIsLive(team: PlaySessionState) {
  return Boolean(
    team.sessionToken &&
    team.sessionSeenAt &&
    currentDate().getTime() - team.sessionSeenAt.getTime() <
      PLAY_SESSION_TTL_MS,
  );
}

function readSessionToken(req: {
  header: (name: string) => string | undefined;
}) {
  const value = req.header("x-play-session");
  return typeof value === "string" ? value.trim() : "";
}

type PlayAuthFailure = "not_found" | "session_gone" | "session_taken";

const PLAY_AUTH_ERRORS: Record<
  PlayAuthFailure,
  { status: number; message: string }
> = {
  not_found: { status: 404, message: "Registro no encontrado." },
  session_gone: {
    status: 401,
    message: "Tu sesión se abrió en otro dispositivo. Para seguir aquí, vuelve a entrar con tu código personal.",
  },
  session_taken: {
    status: 409,
    message: "Ya hay una sesión abierta con tu nombre en otro dispositivo.",
  },
};

async function authorizePlay<T extends PlaySessionState & { id: string }>(
  req: { header: (name: string) => string | undefined },
  personalCode: string,
  findByToken: (token: string) => Promise<T | null>,
  findByCode: (code: string) => Promise<T | null>,
): Promise<
  { team: T; error?: never } | { team?: never; error: PlayAuthFailure }
> {
  const token = readSessionToken(req);

  if (token) {
    const team = await findByToken(token);

    if (!team) {
      return { error: "session_gone" };
    }

    await prisma.team.update({
      where: { id: team.id },
      data: { sessionSeenAt: currentDate() },
    });

    return { team };
  }

  const team = personalCode ? await findByCode(personalCode) : null;

  if (!team) {
    return { error: "not_found" };
  }

  if (playSessionIsLive(team)) {
    return { error: "session_taken" };
  }

  return { team };
}

// Rendir la prueba exige el codigo personal que se entrega al inscribirse. El
// codigo del grupo solo sirve para inscribirse, asi que aqui se rechaza con un
// mensaje que explica la diferencia en vez de un "no encontrado" seco.
app.post("/api/play/session", async (req, res) => {
  const personalCode =
    typeof req.body?.personalCode === "string"
      ? req.body.personalCode.trim().toUpperCase()
      : "";

  if (!personalCode) {
    res.status(400).json({ message: "Escribe tu código personal." });
    return;
  }

  const team = await prisma.team.findUnique({
    where: { personalCode },
    include: { group: { include: { contest: true } } },
  });

  if (!team) {
    const isGroupCode = await prisma.contestGroup.findUnique({
      where: { accessCode: personalCode },
      select: { id: true },
    });

    if (isGroupCode) {
      res.status(409).json({
        message:
          "Ese es el código del grupo, sirve para inscribirte. Para rendir usa el código personal que recibiste al inscribirte.",
      });
      return;
    }

    res.status(404).json({ message: "Código no encontrado." });
    return;
  }

  const group = team.group;

  if (groupAccessHasExpired(group)) {
    res.status(410).json({ message: "El código ya expiró." });
    return;
  }

  if (!group.contest.publishedAt) {
    res.status(409).json({ message: "El desafío aún no está disponible." });
    return;
  }

  if (contestHasEnded(computeContestState(group.contest).state)) {
    res.status(409).json({ message: "El desafío ya cerro." });
    return;
  }

  // Entrar con el código personal se queda con la sesión: la que estuviera
  // abierta en otro dispositivo se cierra sola en su próxima consulta.
  if (
    !group.firstUsedAt &&
    computeContestState(group.contest).state === "abierta"
  ) {
    const firstUsedAt = currentDate();
    await prisma.contestGroup.update({
      where: { id: group.id },
      data: {
        firstUsedAt,
        expiresAt:
          group.contest.endsAt ??
          new Date(firstUsedAt.getTime() + GROUP_CODE_LIFETIME_MINUTES * 60000),
      },
    });
  }

  const sessionToken = randomUUID();
  await prisma.team.update({
    where: { id: team.id },
    data: { sessionToken, sessionSeenAt: currentDate() },
  });

  res.status(201).json({
    sessionToken,
    groupName: group.name,
    contestTitle: group.contest.title,
    participationMode: team.participationMode,
    memberOneFirstName: team.memberOneFirstName,
    memberOneLastName: team.memberOneLastName,
    memberTwoFirstName: team.memberTwoFirstName,
    memberTwoLastName: team.memberTwoLastName,
  });
});

app.post("/api/play/session/close", async (req, res) => {
  const token = readSessionToken(req);

  if (token) {
    await prisma.team.updateMany({
      where: { sessionToken: token },
      data: { sessionToken: null, sessionSeenAt: null },
    });
  }

  res.status(204).end();
});

app.post("/api/play/heartbeat", async (req, res) => {
  const token = readSessionToken(req);

  if (!token) {
    res.status(401).json({ message: PLAY_AUTH_ERRORS.session_gone.message });
    return;
  }

  const refreshed = await prisma.team.updateMany({
    where: { sessionToken: token },
    data: { sessionSeenAt: currentDate() },
  });

  if (refreshed.count === 0) {
    res.status(401).json({ message: PLAY_AUTH_ERRORS.session_gone.message });
    return;
  }

  res.json({ ok: true });
});

app.post("/api/play/start", async (req, res) => {
  const personalCode =
    typeof req.body?.personalCode === "string"
      ? req.body.personalCode.trim().toUpperCase()
      : "";
  const auth = await authorizePlay(
    req,
    personalCode,
    findTeamBySession,
    findTeamForPlay,
  );

  if (auth.error) {
    const failure = PLAY_AUTH_ERRORS[auth.error];
    res.status(failure.status).json({ message: failure.message });
    return;
  }

  const team = auth.team;

  if (!team.attempt) {
    res.status(404).json({ message: "Registro no encontrado." });
    return;
  }

  const contest = team.group.contest;
  if (computeContestState(contest).state !== "abierta") {
    res
      .status(409)
      .json({ message: "El desafío no está abierto en este momento." });
    return;
  }

  if (team.attempt.status === "finished") {
    res.status(409).json({ message: "Ya entregaste este desafío." });
    return;
  }

  const category = teamCategory(team.grade, contestCategories(contest));

  if (tasksOfCategory(contest.tasks, category).length === 0) {
    res.status(409).json({
      message: "Este desafío no tiene preguntas para tu curso. Avísale a tu maestro.",
    });
    return;
  }

  if (team.attempt.status === "pending") {
    const now = currentDate();

    if (!contest.endsAt) {
      res.status(409).json({
        message:
          "La fecha del desafío todavía no está definida. Tu maestro la anunciará.",
      });
      return;
    }

    const endsAt = new Date(
      Math.min(
        now.getTime() + contest.durationMinutes * 60000,
        contest.endsAt.getTime(),
      ),
    );

    if (endsAt <= now) {
      res.status(409).json({
        message: "El desafío ya cerró.",
      });
      return;
    }

    await prisma.attempt.update({
      where: { id: team.attempt.id },
      data: { status: "in_progress", startedAt: now, endsAt },
    });
  }

  res.json({ ok: true });
});

const playAttemptHandler: express.RequestHandler = async (req, res) => {
  const personalCode = String(req.params.personalCode ?? "")
    .trim()
    .toUpperCase();
  const auth = await authorizePlay(
    req,
    personalCode,
    findTeamBySession,
    findTeamForPlay,
  );

  if (auth.error) {
    const failure = PLAY_AUTH_ERRORS[auth.error];
    res.status(failure.status).json({ message: failure.message });
    return;
  }

  const team = auth.team;

  if (!team.attempt) {
    res.status(404).json({ message: "Registro no encontrado." });
    return;
  }

  let attempt = team.attempt;
  const contest = team.group.contest;

  if (await releaseDueResults(contest.id)) {
    const fresh = await prisma.contest.findUniqueOrThrow({
      where: { id: contest.id },
      select: { consolidatedAt: true, resultsPublishedAt: true },
    });
    contest.consolidatedAt = fresh.consolidatedAt;
    contest.resultsPublishedAt = fresh.resultsPublishedAt;
    attempt =
      (await prisma.attempt.findUnique({ where: { id: attempt.id } })) ??
      attempt;
  }
  const contestState = computeContestState(contest).state;

  if (
    attempt.status === "in_progress" &&
    attempt.endsAt &&
    contestState !== "suspendida" &&
    currentDate() > attempt.endsAt
  ) {
    await finalizeAttempt(attempt.id);
    attempt = (await prisma.attempt.findUnique({
      where: { id: attempt.id },
    }))!;
  }

  const savedAnswers = await prisma.attemptAnswer.findMany({
    where: { attemptId: attempt.id },
  });
  const answers: Record<string, unknown> = {};
  const correctnessByTask: Record<string, boolean | null> = {};
  for (const answer of savedAnswers) {
    try {
      answers[answer.taskDraftId] = JSON.parse(answer.responsePayload);
    } catch {
      answers[answer.taskDraftId] = null;
    }
    correctnessByTask[answer.taskDraftId] = answer.isCorrect;
  }

  const finished = attempt.status === "finished";
  const resultsPublished = Boolean(contest.resultsPublishedAt);
  // Lo marcado «al entregar» se ve apenas entrega; lo demás, con los resultados.
  const visible = {
    score:
      finished &&
      (contest.showScoreOnSubmit || (resultsPublished && contest.showTotalScore)),
    feedback:
      finished &&
      (contest.showFeedbackOnSubmit ||
        (resultsPublished && contest.showFeedback)),
    solutions:
      finished &&
      (contest.showSolutionsOnSubmit ||
        (resultsPublished && contest.showSolutions)),
  };
  const showResults = visible.feedback || visible.solutions;
  const category = teamCategory(team.grade, contestCategories(contest));
  const tasks = tasksOfCategory(contest.tasks, category).map((contestTask) => {
    const task = deserializeTask(contestTask.taskDraft) as PlayTask;
    const safe: ReturnType<typeof renderSafeTask> & {
      correct?: boolean | null;
      explanationBlocks?: unknown;
    } = renderSafeTask(
      contestTask,
      task,
      contest.shuffleOptions ? attempt.id : undefined,
    );
    if (showResults) {
      safe.correct = correctnessByTask[task.id] ?? null;
    }
    if (visible.solutions) {
      safe.explanationBlocks = task.explanationBlocks;
    }
    return safe;
  });

  const result = visible.score
    ? await prisma.result.findUnique({ where: { attemptId: attempt.id } })
    : null;

  res.json({
    contestTitle: contest.title,
    category,
    rules: contestRules(tasksOfCategory(contest.tasks, category)),
    participationMode: team.participationMode,
    accessCode: team.group.accessCode,
    resultsAt: (contest.resultsAt ?? contest.endsAt)?.toISOString() ?? null,
    // Para que el estudiante confirme que entró con su propio código.
    participant: {
      members: [
        `${team.memberOneFirstName} ${team.memberOneLastName}`.trim(),
        ...(team.memberTwoFirstName
          ? [`${team.memberTwoFirstName} ${team.memberTwoLastName ?? ""}`.trim()]
          : []),
      ],
      grade: team.grade,
    },
    durationMinutes: contest.durationMinutes,
    questionDisplayMode: contest.questionDisplayMode,
    contestStartsAt: contest.startsAt?.toISOString() ?? null,
    contestEndsAt: contest.endsAt?.toISOString() ?? null,
    state: contestState,
    status: attempt.status,
    startedAt: attempt.startedAt?.toISOString() ?? null,
    endsAt: attempt.endsAt?.toISOString() ?? null,
    // Igual a endsAt cuando el intento se cerró por tiempo, así la pantalla
    // final puede decir si se entregó o se acabó el plazo.
    finishedAt: attempt.finishedAt?.toISOString() ?? null,
    suspendedAt: contest.suspendedAt?.toISOString() ?? null,
    resultsPublished,
    showFeedback: visible.feedback,
    showSolutions: visible.solutions,
    showTotalScore: visible.score,
    tasks,
    answers,
    result: result
      ? {
          totalScore: result.totalScore,
          correctCount: result.correctCount,
          answeredCount: result.answeredCount,
          rankPosition: resultsPublished ? result.rankPosition : null,
        }
      : null,
  });
};

app.get("/api/play/attempt", playAttemptHandler);
app.get("/api/play/attempt/:personalCode", playAttemptHandler);

app.post("/api/play/answer", async (req, res) => {
  const personalCode =
    typeof req.body?.personalCode === "string"
      ? req.body.personalCode.trim().toUpperCase()
      : "";
  const taskId = typeof req.body?.taskId === "string" ? req.body.taskId : "";
  const payload = req.body?.payload ?? null;

  const auth = await authorizePlay(
    req,
    personalCode,
    findLightTeamBySession,
    findLightTeamForPlay,
  );

  if (auth.error) {
    const failure = PLAY_AUTH_ERRORS[auth.error];
    res.status(failure.status).json({ message: failure.message });
    return;
  }

  const team = auth.team;

  if (!team.attempt) {
    res.status(404).json({ message: "Registro no encontrado." });
    return;
  }

  if (team.attempt.status !== "in_progress") {
    res.status(409).json({ message: "El desafío no está en curso." });
    return;
  }

  if (computeContestState(team.group.contest).state === "suspendida") {
    res.status(409).json({ message: SUSPENDED_CONTEST_MESSAGE });
    return;
  }

  if (team.attempt.endsAt && currentDate() > team.attempt.endsAt) {
    await finalizeAttempt(team.attempt.id);
    res.status(409).json({ message: "El tiempo terminó." });
    return;
  }

  const contestTask = await prisma.contestTask.findUnique({
    where: {
      contestId_category_taskDraftId: {
        contestId: team.group.contestId,
        category:
          teamCategory(team.grade, contestCategories(team.group.contest)) ?? "",
        taskDraftId: taskId,
      },
    },
    include: { taskDraft: true },
  });

  if (!contestTask) {
    res.status(404).json({ message: "La tarea no pertenece a este desafío." });
    return;
  }

  const task = deserializeTask(contestTask.taskDraft) as PlayTask;
  const answerError = validateTaskAnswer(task, payload);
  if (answerError) {
    res.status(400).json({ message: answerError });
    return;
  }

  await prisma.attemptAnswer.upsert({
    where: {
      attemptId_taskDraftId: {
        attemptId: team.attempt.id,
        taskDraftId: taskId,
      },
    },
    update: {
      responsePayload: JSON.stringify(payload),
      answeredAt: currentDate(),
    },
    create: {
      attemptId: team.attempt.id,
      taskDraftId: taskId,
      responsePayload: JSON.stringify(payload),
      answeredAt: currentDate(),
    },
  });

  res.status(204).send();
});

app.post("/api/play/submit", async (req, res) => {
  const personalCode =
    typeof req.body?.personalCode === "string"
      ? req.body.personalCode.trim().toUpperCase()
      : "";
  const auth = await authorizePlay(
    req,
    personalCode,
    findLightTeamBySession,
    findLightTeamForPlay,
  );

  if (auth.error) {
    const failure = PLAY_AUTH_ERRORS[auth.error];
    res.status(failure.status).json({ message: failure.message });
    return;
  }

  const team = auth.team;

  if (!team.attempt) {
    res.status(404).json({ message: "Registro no encontrado." });
    return;
  }

  if (team.attempt.status === "finished") {
    res.json({ ok: true });
    return;
  }

  if (computeContestState(team.group.contest).state === "suspendida") {
    res.status(409).json({ message: SUSPENDED_CONTEST_MESSAGE });
    return;
  }

  if (team.attempt.status !== "in_progress") {
    res.status(409).json({ message: "El desafío no está en curso." });
    return;
  }

  await finalizeAttempt(team.attempt.id);
  res.json({ ok: true });
});

app.get("/api/contests/:id/results", async (req, res) => {
  await releaseDueResults(String(req.params.id));
  const contest = await prisma.contest.findUnique({
    where: { id: req.params.id },
    include: {
      tasks: true,
      groups: {
        include: {
          teams: { include: { attempt: { include: { result: true } } } },
        },
      },
    },
  });

  if (!contest) {
    res.status(404).json({ message: "Desafío no encontrado." });
    return;
  }

  const categories = contestCategories(contest);
  const rows = contest.groups.flatMap((group) =>
    group.teams.map((team) => ({
      teamId: team.id,
      category: teamCategory(team.grade, categories),
      groupName: group.name,
      participationMode: team.participationMode,
      grade: team.grade,
      memberOneFirstName: team.memberOneFirstName,
      memberOneLastName: team.memberOneLastName,
      memberTwoFirstName: team.memberTwoFirstName,
      memberTwoLastName: team.memberTwoLastName,
      status: team.attempt?.status ?? "pending",
      elapsedSeconds:
        team.attempt && team.attempt.startedAt && team.attempt.finishedAt
          ? Math.round(attemptElapsedMs(team.attempt) / 1000)
          : null,
      totalScore: team.attempt?.result?.totalScore ?? null,
      correctCount: team.attempt?.result?.correctCount ?? null,
      answeredCount: team.attempt?.result?.answeredCount ?? null,
      rankPosition: team.attempt?.result?.rankPosition ?? null,
    })),
  );

  rows.sort((left, right) => {
    if (left.rankPosition && right.rankPosition) {
      return left.rankPosition - right.rankPosition;
    }
    if (left.rankPosition) {
      return -1;
    }
    if (right.rankPosition) {
      return 1;
    }
    return 0;
  });

  res.json({
    contestTitle: contest.title,
    categories,
    taskCounts: Object.fromEntries(
      categories.map((category) => [
        category,
        tasksOfCategory(contest.tasks, category).length,
      ]),
    ),
    state: computeContestState(contest).state,
    rows,
  });
});

async function migrateLegacyDragDropConfigs() {
  const tasks = await prisma.taskDraft.findMany({
    where: { answerType: "drag_drop" },
    select: { id: true, dragDropItems: true },
  });

  for (const task of tasks) {
    const stored = parseJsonValue<unknown>(task.dragDropItems, []);
    if (!Array.isArray(stored)) {
      continue;
    }

    const legacy = normalizeDragDropConfig(stored);
    const targetIds = new Map(
      legacy.targets.map((target) => [target.id, randomUUID()]),
    );
    const migrated = {
      version: 1 as const,
      solutions: [],
      items: legacy.items.map((item) => ({
        ...item,
        correctTargetId: targetIds.get(item.correctTargetId) ?? randomUUID(),
      })),
      targets: legacy.targets.map((target) => ({
        ...target,
        id: targetIds.get(target.id) ?? randomUUID(),
      })),
    };

    await prisma.taskDraft.update({
      where: { id: task.id },
      data: { dragDropItems: serializeJson(migrated) },
    });
  }
}

// Exported for an explicit migration job; Workers cannot perform startup I/O.
export { migrateLegacyDragDropConfigs };

app.use(async (error: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!res.locals.documentsCommitted) {
    await cleanupFiles(...uploadedFiles(req));
  }
  console.error("API request failed", error);
  if (res.headersSent) {
    next(error);
    return;
  }
  res.status(500).json({ message: "No se pudo completar la solicitud." });
});

app.listen(3000);
export default httpServerHandler({ port: 3000 });
