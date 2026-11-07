import { env } from "cloudflare:workers";
import { httpServerHandler } from "cloudflare:node";
import {
  TASK_IMAGE_FILE,
  externalizeTaskImages,
  taskImageKey,
  type ImageStore,
} from "./lib/task-images";
import express from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { createAuthorizationLetter } from "./lib/documents-pdf";
import { Readable } from "node:stream";
import { extname } from "node:path";
import { db, prisma, queryCount, withRequestPrisma, setTrialScope, trialScope } from "./lib/prisma";
import type { Prisma } from "./generated/prisma/client";
import { formatPersonName } from "./lib/person-name";
import { favoriteContestId, purgeExpiredContests, registerContestLifecycle } from "./lib/contest-lifecycle";
import { parseJsonValue } from "./lib/json";
import { allowedCorsOrigin } from "./lib/cors";
import { cleanName, nameKey, normalizeHeader } from "./lib/text";
import { DEPARTMENTS, placeLabel, titleCase, townName } from "./lib/places";
import {
  BEBRAS_CATEGORIES,
  SCHOOL_GRADES,
  contestCategories,
  contestForCategory,
  contestHasEnded,
  contestRules,
  contestStateAt,
  defaultContestScoring,
  gradesForCategories,
  gradesForGroup,
  groupCategories,
  initialScoreOf,
  isDifficultyKey,
  normalizeCategories,
  paperBlockedReason,
  parseCategorySchedules,
  parseCategorySchedulesInput,
  parseContestScoring,
  parseGrade,
  parseGroupGrade,
  registrationOpenAt,
  resultsWindow,
  schedulesSpan,
  scoresForDifficulty,
  serializeCategorySchedules,
  shiftCategorySchedules,
  teamCategory,
  type ContestScoring,
} from "./lib/contest-rules";
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
import {
  interactiveEngineKey,
  parseInteractiveEngineKey,
} from "./lib/task-answers/interactive";
import {
  authenticateFirebase,
  requireAdmin,
  requireAuth,
  type AuthUser,
} from "./lib/auth";

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

type PublicAssetsEnv = { PUBLIC_ASSETS?: R2Bucket; PUBLIC_ASSETS_URL?: string };

function publicAssets() {
  return env as Cloudflare.Env & PublicAssetsEnv;
}

/** El bucket público con su dominio propio, si este entorno lo tiene. */
function publicStore(): ImageStore | null {
  const assets = publicAssets();
  const base = assets.PUBLIC_ASSETS_URL?.replace(/\/$/, "");
  return assets.PUBLIC_ASSETS && base
    ? { bucket: assets.PUBLIC_ASSETS, baseUrl: `${base}/task-images` }
    : null;
}

/** Sin dominio propio (local, staging) las imágenes salen por el Worker. */
function imageStore(req: express.Request): ImageStore | null {
  const assets = publicAssets();
  if (!assets.PUBLIC_ASSETS) return null;
  const published = publicStore();
  if (published) return published;
  const host = req.get("host") ?? "";
  const scheme = /^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https";
  return {
    bucket: assets.PUBLIC_ASSETS,
    baseUrl: `${scheme}://${host}/api/task-images`,
  };
}

function computeContestState(
  contest: Parameters<typeof contestStateAt>[1],
) {
  return contestStateAt(currentDate(), contest);
}

function contestRegistrationIsOpen(
  contest: Parameters<typeof registrationOpenAt>[1],
) {
  return registrationOpenAt(currentDate(), contest);
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

/** Fila de los títulos en la plantilla: arriba van el título, el grupo y las instrucciones. */
const ROSTER_TEMPLATE_HEADER_ROW = 5;

const ROSTER_COLUMNS = [
  "Nombres",
  "Apellidos",
  "Curso",
  "Modalidad",
  "Nombres del compañero",
  "Apellidos del compañero",
];

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
  "Dinamarca",
  "EE.UU.",
  "Ecuador",
  "Eslovaquia",
  "Eslovenia",
  "España",
  "Estonia",
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
  "Japón",
  "Letonia",
  "Lituania",
  "Macedonia del Norte",
  "Malasia",
  "Malta",
  "Montenegro",
  "México",
  "Noruega",
  "Pakistán",
  "Paraguay",
  "Países Bajos",
  "Polonia",
  "Portugal",
  "Reino Unido",
  "Serbia",
  "Sudáfrica",
  "Suiza",
  "Tailandia",
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

  const answerFields = parseTaskAnswerConfig(body);

  const row = {
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
  const rowBytes = Object.values(row).reduce<number>(
    (total, value) =>
      total + (typeof value === "string" ? Buffer.byteLength(value) : 8),
    0,
  );

  if (rowBytes > TASK_ROW_MAX_BYTES) {
    throw new Error(
      `La tarea pesa ${(rowBytes / 1_000_000).toFixed(1).replace(".", ",")} MB y el máximo es 1,9 MB. Achica sus imágenes.`,
    );
  }

  return row;
}

const TASK_ROW_MAX_BYTES = 1_900_000;

async function interactiveEngineProblem(payload: {
  answerType: string;
  answerConfig: string;
}) {
  if (payload.answerType !== "interactive") return null;
  const { engine } = JSON.parse(payload.answerConfig) as {
    engine: { name: string; version: string };
  };
  const stored = await env.UPLOADS.head(interactiveEngineKey(engine));
  return stored
    ? null
    : `El motor ${engine.name} ${engine.version} de la actividad no está subido.`;
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

const CATEGORY_AGE_RANGE: Record<string, string> = Object.fromEntries(
  BEBRAS_CATEGORIES.map((category) => [category.name, category.ageRange]),
);

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

function tasksOfCategory<T extends { category: string }>(
  tasks: T[],
  category: string | null,
) {
  return category ? tasks.filter((task) => task.category === category) : [];
}

const SUSPENDED_CONTEST_MESSAGE =
  "El desafío está suspendido. Tu tiempo quedó en pausa; espera a que lo reanuden.";

function groupAccessHasExpired(group: {
  expiresAt: Date | null;
  contest: { endsAt: Date | null; stoppedAt?: Date | null };
}) {
  if (group.contest.stoppedAt) return false;
  const effectiveExpiry = group.contest.endsAt ?? group.expiresAt;
  return Boolean(effectiveExpiry && effectiveExpiry < currentDate());
}

function registrationWindowMessage(contest: {
  registrationStartsAt?: Date | null;
  registrationEndsAt?: Date | null;
  startsAt?: Date | null;
}) {
  if (
    contest.registrationStartsAt &&
    currentDate() < contest.registrationStartsAt
  ) {
    return "La fase de inscripción todavía no comenzó.";
  }

  if (
    !contest.registrationEndsAt &&
    contest.startsAt &&
    currentDate() >= contest.startsAt
  ) {
    return "La inscripción cerró porque la prueba ya empezó.";
  }

  return "La fase de inscripción ya terminó.";
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
  schedules?: string | null;
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
  stoppedAt?: Date | null;
  trashedAt?: Date | null;
  consolidatedAt: Date | null;
  resultsPublishedAt: Date | null;
  resultsAt: Date | null;
  resultsUntil: Date | null;
  isTest?: boolean;
  collectUsage?: boolean;
  linkedContestId?: string | null;
  unlisted?: boolean;
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
}, favoriteId: string | null = null) {
  const { state, isOpen } = computeContestState(contest);
  const categories = contestCategories(contest);
  const tasks = (contest.tasks ?? [])
    .filter((task) => categories.includes(task.category))
    .sort((left, right) => left.position - right.position);

  return {
    id: contest.id,
    title: contest.title,
    categories,
    durationMinutes: contest.durationMinutes,
    registrationStartsAt: contest.registrationStartsAt?.toISOString() ?? null,
    registrationEndsAt: contest.registrationEndsAt?.toISOString() ?? null,
    startsAt: contest.startsAt?.toISOString() ?? null,
    endsAt: contest.endsAt?.toISOString() ?? null,
    schedules: Object.fromEntries(
      Object.entries(parseCategorySchedules(contest.schedules))
        .filter(([category]) => categories.includes(category))
        .map(([category, window]) => [
          category,
          {
            startsAt: window.startsAt.toISOString(),
            endsAt: window.endsAt.toISOString(),
          },
        ]),
    ),
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
    stoppedAt: contest.stoppedAt?.toISOString() ?? null,
    trashedAt: contest.trashedAt?.toISOString() ?? null,
    isFavorite: contest.id === favoriteId,
    consolidatedAt: contest.consolidatedAt?.toISOString() ?? null,
    resultsPublishedAt: contest.resultsPublishedAt?.toISOString() ?? null,
    resultsAt: contest.resultsAt?.toISOString() ?? null,
    resultsUntil: contest.resultsUntil?.toISOString() ?? null,
    isTest: Boolean(contest.isTest),
    collectUsage: Boolean(contest.collectUsage),
    linkedContestId: contest.linkedContestId ?? null,
    unlisted: Boolean(contest.unlisted),
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

  if (categories.length !== new Set(requested).size) {
    throw new Error("Hay una categoría que no es válida.");
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

  const isTest = body.isTest === true;
  const basePayload = {
    title,
    categories,
    isTest,
    collectUsage: isTest && body.collectUsage === true,
    unlisted: isTest && body.unlisted === true,
    linkedContestId:
      isTest &&
      typeof body.linkedContestId === "string" &&
      body.linkedContestId.trim()
        ? body.linkedContestId.trim()
        : null,
    durationMinutes,
    scoring: parseContestScoring(body.scoring),
    questionDisplayMode,
    allowPairs: !isTest && body.allowPairs === true,
    shuffleOptions: body.shuffleOptions === true,
    showFeedback: isTest || body.showFeedback === true,
    showSolutions: isTest || body.showSolutions === true,
    showTotalScore:
      isTest || body.showTotalScore === true || body.showScoreOnSubmit === true,
    showScoreOnSubmit: isTest || body.showScoreOnSubmit === true,
    showFeedbackOnSubmit: isTest || body.showFeedbackOnSubmit === true,
    showSolutionsOnSubmit: isTest || body.showSolutionsOnSubmit === true,
    tasks,
  };

  // Las fechas son opcionales, también al publicar; solo tienen que cuadrar.
  const schedules = parseCategorySchedulesInput(body.schedules, categories);
  const span = schedulesSpan(schedules);
  const bySchedules = Object.keys(schedules).length > 0;
  const startsAt = bySchedules
    ? span.startsAt
    : body.startsAt
      ? parseDateInput(body.startsAt, "startsAt")
      : null;
  const endsAt = bySchedules
    ? span.endsAt
    : body.endsAt
      ? parseDateInput(body.endsAt, "endsAt")
      : null;
  const registrationStartsAt =
    !isTest && body.registrationStartsAt
      ? parseDateInput(body.registrationStartsAt, "registrationStartsAt")
      : null;
  const registrationEndsAt =
    !isTest && body.registrationEndsAt
      ? parseDateInput(body.registrationEndsAt, "registrationEndsAt")
      : null;
  const resultsAt =
    !isTest && body.resultsAt
      ? parseDateInput(body.resultsAt, "resultsAt")
      : null;

  if (resultsAt && endsAt && resultsAt < endsAt) {
    throw new Error(
      "Los resultados no pueden publicarse antes de que cierre la rendición.",
    );
  }

  const resultsUntil =
    !isTest && body.resultsUntil
      ? parseDateInput(body.resultsUntil, "resultsUntil")
      : null;
  const resultsFrom = resultsAt ?? endsAt;

  if (resultsUntil && resultsFrom && resultsUntil <= resultsFrom) {
    throw new Error(
      "Los resultados tienen que mostrarse hasta después de publicarse.",
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

  if (registrationEndsAt && startsAt && registrationEndsAt > startsAt) {
    throw new Error(
      "La inscripción tiene que cerrar antes de que empiece la rendición, o a la misma hora.",
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
    schedules,
    resultsAt,
    resultsUntil,
  };
}

// El ingreso con Google pasa por el propio dominio: los navegadores del celular
// bloquean el almacenamiento de terceros y la ventana de firebaseapp.com se cortaba.
app.get(/^\/__\/(auth|firebase)\//, async (req, res) => {
  const project = (env as Cloudflare.Env & { FIREBASE_PROJECT_ID?: string })
    .FIREBASE_PROJECT_ID;
  if (!project) {
    res.sendStatus(404);
    return;
  }
  const upstream = await fetch(
    `https://${project}.firebaseapp.com${req.originalUrl}`,
    { headers: { accept: req.headers.accept ?? "*/*" } },
  );
  res.status(upstream.status);
  for (const [name, value] of upstream.headers) {
    if (!["content-encoding", "content-length", "transfer-encoding", "connection"].includes(name)) {
      res.setHeader(name, value);
    }
  }
  res.send(Buffer.from(await upstream.arrayBuffer()));
});

app.use((_req, res, next) => {
  if (!isE2E()) {
    withRequestPrisma(next);
    return;
  }
  // En local cada respuesta dice cuántas sentencias mandó a D1, para medir
  // las peticiones contra el límite por invocación de Cloudflare.
  withRequestPrisma(() => {
    const end = res.end.bind(res) as (...args: unknown[]) => express.Response;
    res.end = ((...args: unknown[]) => {
      if (!res.headersSent) res.setHeader("X-D1-Queries", String(queryCount()));
      return end(...args);
    }) as typeof res.end;
    next();
  }, true);
});

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

  const origin = allowedCorsOrigin(
    req.headers.origin,
    (env as Cloudflare.Env & { FRONTEND_ORIGIN?: string }).FRONTEND_ORIGIN,
  );
  if (origin) {
    res.header("Access-Control-Allow-Origin", origin);
  }
  res.header("Vary", "Origin");
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Play-Session, X-Trial-As, X-Trial-Session",
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

app.use(async (req, res, next) => {
  if (req.path.startsWith("/api/admin/trial")) {
    if (req.headers["x-trial-session"]) {
      res.status(403).json({ message: "Gestiona las pruebas desde la pestaña principal." });
      return;
    }
    await requireAdmin(req, res, () => {
      setTrialScope(false);
      next();
    });
    return;
  }
  const sessionId = req.headers["x-trial-session"];
  if (typeof sessionId !== "string" || !sessionId) {
    if (req.headers["x-trial-as"]) {
      res.status(403).json({ message: "Vuelve a abrir esta vista desde la guía de la prueba." });
      return;
    }
    return next();
  }
  setTrialScope(false);
  const session = await prisma.trialSession.findUnique({ where: { id: sessionId } });
  if (!session) {
    res.status(404).json({ message: "Esta prueba ya no existe." });
    return;
  }
  if (req.headers.authorization) {
    const authenticated = await authenticateFirebase(req, { allowUnverified: req.path === "/api/auth/register" });
    if ("failure" in authenticated) {
      res.status(authenticated.failure.status).json(authenticated.failure.body);
      return;
    }
    const profile = await prisma.user.findUnique({ where: { firebaseUid: authenticated.identity.uid } });
    if (profile?.role === "admin" && !profile.trialSessionId) {
      const actor = session.role === "admin" ? await trialOrganizer(session) : await trialTeacher(session);
      req.user = { id: actor.id, email: actor.email, role: actor.role, firebaseUid: authenticated.identity.uid };
    } else if (profile?.trialSessionId !== sessionId &&
      !(!profile && session.role === "maestro" && ["/api/auth/register", "/api/auth/session"].includes(req.path))) {
      res.status(403).json({ message: "Esta cuenta no pertenece a la prueba." });
      return;
    }
  }
  setTrialScope(sessionId);
  if (req.path.startsWith("/api/e2e") || (req.path.startsWith("/api/admin") && req.path !== "/api/admin/interactive-engines/latest")) {
    res.status(403).json({ message: "Esta opción no está disponible en el entorno de ensayo." });
    return;
  }
  const resource = req.path.match(/^\/api\/(tasks|contests|groups|teams|users)\/([^/]+)/);
  if (resource && !["draft", "trash", "contests", "courses", "students.xlsx", "maestros", "schools"].includes(resource[2])) {
    const id = decodeURIComponent(resource[2]);
    const where = { id };
    const exists = resource[1] === "tasks" ? await prisma.taskDraft.findUnique({ where, select: { id: true } })
      : resource[1] === "contests" ? await prisma.contest.findUnique({ where, select: { id: true } })
      : resource[1] === "groups" ? await prisma.contestGroup.findUnique({ where, select: { id: true } })
      : resource[1] === "teams" ? await prisma.team.findUnique({ where, select: { id: true } })
      : await prisma.user.findUnique({ where: { id: Number(id) || -1 }, select: { id: true } });
    if (!exists) {
      res.status(404).json({ message: "Este dato no pertenece al entorno de ensayo." });
      return;
    }
  }
  next();
});

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

  const catalog = user.schoolCodUe
    ? await prisma.school.findUnique({
        where: { codUe: user.schoolCodUe },
        select: { dep: true, sec: true },
      })
    : null;
  const department = DEPARTMENTS[catalog?.dep ?? user.department ?? ""];

  res.json({
    id: user.id,
    email: user.email,
    place: placeLabel(
      catalog?.dep ?? user.department,
      catalog ? townName(catalog.sec) : (user.city ?? ""),
    ),
    departmentSlug: department?.slug ?? null,
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

const OWN_DOCUMENT_FIELDS = {
  letter: "letterFilename",
  idFront: "idFrontFilename",
  idBack: "idBackFilename",
} as const;

app.get("/api/auth/me/documents/:doc", requireAuth, async (req, res) => {
  const field =
    OWN_DOCUMENT_FIELDS[req.params.doc as keyof typeof OWN_DOCUMENT_FIELDS];
  if (!field) {
    res.status(400).json({ message: "Documento inválido." });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { letterFilename: true, idFrontFilename: true, idBackFilename: true },
  });
  const name = user?.[field];

  if (!name || name.includes("..") || name.includes("/") || name.includes("\\")) {
    res.status(404).json({ message: "Todavía no subiste ese documento." });
    return;
  }

  await sendPrivateDocument(res, name);
});

app.get("/api/auth/me/schools/:id/letter", requireAuth, async (req, res) => {
  const school = await prisma.teacherSchool.findFirst({
    where: { id: String(req.params.id), userId: req.user!.id },
    select: { letterFilename: true },
  });
  const name = school?.letterFilename;

  if (!name || name.includes("..") || name.includes("/") || name.includes("\\")) {
    res.status(404).json({ message: "Todavía no subiste esa carta." });
    return;
  }

  await sendPrivateDocument(res, name);
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

    if (
      schoolCodUe &&
      !(await prisma.school.findUnique({
        where: { codUe: schoolCodUe },
        select: { codUe: true },
      }))
    ) {
      await cleanupFiles(letterFile);
      res.status(400).json({ message: "Ese colegio no está en el catálogo." });
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

  if (await prisma.contestGroup.count({ where: { schoolId: school.id } })) {
    res.status(409).json({
      message: "Ese colegio ya tiene cursos con estudiantes; no se puede quitar.",
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

  if (!(await teacherRegistrationOpen())) {
    await cleanupFiles(...allFiles);
    res.status(403).json({
      message: "El registro de maestros está cerrado por ahora.",
    });
    return;
  }

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

  const listedSchool = schoolCodUe
    ? await prisma.school.findUnique({
        where: { codUe: schoolCodUe },
        select: { name: true },
      })
    : null;

  if (schoolCodUe && !listedSchool) {
    await cleanupFiles(...allFiles);
    res.status(400).json({
      message: "Ese colegio no está en el catálogo.",
      field: "schoolName",
    });
    return;
  }

  const department =
    typeof req.body?.department === "string" ? req.body.department.trim() : "";
  const city = typeof req.body?.city === "string" ? req.body.city.trim() : "";

  if (!schoolCodUe) {
    if (!DEPARTMENTS[department]) {
      await cleanupFiles(...allFiles);
      res.status(400).json({ message: "Elige tu departamento.", field: "department" });
      return;
    }
    if (!/^[\p{L}][\p{L} .'-]{1,59}$/u.test(city)) {
      await cleanupFiles(...allFiles);
      res.status(400).json({ message: "Elige tu ciudad.", field: "city" });
      return;
    }
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
        schoolName: listedSchool?.name ?? schoolName,
        institutionType,
        department: schoolCodUe ? null : department,
        city: schoolCodUe ? null : city,
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

app.get("/api/public-contests", async (req, res) => {
  await releaseDueResults();
  const wantedId =
    typeof req.query.id === "string" && req.query.id ? req.query.id : null;
  const contests = await prisma.contest.findMany({
    where: {
      OR: [{ unlisted: false }, ...(wantedId ? [{ id: wantedId }] : [])],
      publishedAt: { not: null },
      isPractice: false,
      trashedAt: null,
      stoppedAt: null,
      title: { not: { startsWith: TRIAL_PREFIX } },
    },
    orderBy: { startsAt: "asc" },
    select: {
      id: true,
      title: true,
      categories: true,
      schedules: true,
      durationMinutes: true,
      registrationStartsAt: true,
      registrationEndsAt: true,
      startsAt: true,
      endsAt: true,
      publishedAt: true,
      suspendedAt: true,
      consolidatedAt: true,
      resultsPublishedAt: true,
      resultsAt: true,
      resultsUntil: true,
      isTest: true,
      linkedContestId: true,
    },
  });

  const enrolled = await prisma.team.findMany({
    where: {
      group: {
        contestId: {
          in: contests.filter((contest) => !contest.isTest).map((contest) => contest.id),
        },
      },
    },
    select: { participationMode: true, group: { select: { contestId: true } } },
  });
  const participantsOf = new Map<string, number>();
  for (const team of enrolled) {
    participantsOf.set(
      team.group.contestId,
      (participantsOf.get(team.group.contestId) ?? 0) +
        (team.participationMode === "pareja" ? 2 : 1),
    );
  }

  res.json(
    contests.map((contest) => {
      const { state, isOpen } = computeContestState(contest);
      const window = resultsWindow(contest);
      return {
        isTest: contest.isTest,
        linked: Boolean(contest.linkedContestId),
        participants: participantsOf.get(contest.id) ?? 0,
        resultsAt: window.from?.toISOString() ?? null,
        resultsUntil: window.until?.toISOString() ?? null,
        id: contest.id,
        title: contest.title,
        categories: contestCategories(contest),
        schedules: Object.fromEntries(
          Object.entries(parseCategorySchedules(contest.schedules)).map(
            ([category, window]) => [
              category,
              {
                startsAt: window.startsAt.toISOString(),
                endsAt: window.endsAt.toISOString(),
              },
            ],
          ),
        ),
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

/** «Ana Quispe»: en lo público va el primer nombre y el primer apellido, nunca el nombre completo. */
function publicName(first: string, last: string | null) {
  const firstName = first.trim().split(/\s+/)[0] ?? "";
  const lastName = last?.trim().split(/\s+/)[0] ?? "";
  return [firstName, lastName].filter(Boolean).join(" ");
}

const PUBLIC_RANKING_SIZE = 10;

type OriginGroup = { createdById: number | null; schoolId?: string | null };

/** Colegio, lugar y castor del departamento de cada grupo: el colegio del curso o el de quien lo creó. */
async function groupOrigins(groups: OriginGroup[]) {
  const ownerIds = [
    ...new Set(
      groups
        .map((group) => group.createdById)
        .filter((id): id is number => id !== null),
    ),
  ];
  const schoolIds = [
    ...new Set(
      groups
        .map((group) => group.schoolId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const [owners, extraSchools] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: ownerIds } },
      select: {
        id: true,
        schoolName: true,
        schoolCodUe: true,
        department: true,
        city: true,
      },
    }),
    prisma.teacherSchool.findMany({
      where: { id: { in: schoolIds } },
      select: { id: true, schoolName: true, schoolCodUe: true },
    }),
  ]);
  const places = await prisma.school.findMany({
    where: {
      codUe: {
        in: [...owners, ...extraSchools]
          .map((item) => item.schoolCodUe)
          .filter((code): code is string => Boolean(code)),
      },
    },
    select: { codUe: true, dep: true, sec: true },
  });
  const placeOf = new Map(places.map((place) => [place.codUe, place]));
  const originOf = (source: {
    schoolName: string | null;
    schoolCodUe: string | null;
    department?: string | null;
    city?: string | null;
  }) => {
    const place = source.schoolCodUe
      ? placeOf.get(source.schoolCodUe)
      : source.department
        ? { dep: source.department, sec: source.city ?? "" }
        : undefined;
    const department = place ? DEPARTMENTS[place.dep] : undefined;
    const town = place ? townName(place.sec) : null;
    return {
      school: source.schoolName ? titleCase(source.schoolName) : null,
      department: department?.slug ?? null,
      place: department
        ? town && normalizeHeader(town) !== normalizeHeader(department.name)
          ? `${town}, ${department.name}`
          : department.name
        : null,
    };
  };
  const ownerOrigin = new Map(owners.map((owner) => [owner.id, originOf(owner)]));
  const schoolOrigin = new Map(
    extraSchools.map((school) => [school.id, originOf(school)]),
  );
  return (group: OriginGroup) =>
    (group.schoolId ? schoolOrigin.get(group.schoolId) : undefined) ??
    (group.createdById !== null ? ownerOrigin.get(group.createdById) : undefined);
}

app.get("/api/public-ranking", async (_req, res) => {
  await releaseDueResults();
  const now = currentDate();
  const contests = await prisma.contest.findMany({
    where: {
      publishedAt: { not: null },
      isPractice: false,
      isTest: false,
      trashedAt: null,
      resultsPublishedAt: { not: null },
    },
    orderBy: { endsAt: "desc" },
    select: {
      id: true,
      title: true,
      categories: true,
      endsAt: true,
      resultsAt: true,
      resultsUntil: true,
    },
  });
  const visible = contests.filter((contest) => {
    const { until } = resultsWindow(contest);
    return Boolean(until && now < until);
  });

  const ranking = [];

  for (const contest of visible) {
    const categories = contestCategories(contest);
    const results = await prisma.result.findMany({
      where: {
        rankPosition: { not: null, lte: PUBLIC_RANKING_SIZE },
        attempt: { team: { group: { contestId: contest.id } } },
      },
      orderBy: [{ rankPosition: "asc" }, { totalScore: "desc" }],
      include: {
        attempt: {
          include: {
            team: {
              include: { group: { select: { createdById: true, schoolId: true } } },
            },
          },
        },
      },
    });
    const originOf = await groupOrigins(
      results.map((result) => result.attempt.team.group),
    );

    const byCategory = categories
      .map((name) => ({
        name,
        rows: results
          .filter(
            (result) =>
              teamCategory(result.attempt.team.grade, categories) === name,
          )
          .map((result) => {
            const team = result.attempt.team;
            const one = publicName(
              team.memberOneFirstName,
              team.memberOneLastName,
            );
            const two =
              team.participationMode === "pareja" && team.memberTwoFirstName
                ? publicName(team.memberTwoFirstName, team.memberTwoLastName)
                : null;
            const origin = originOf(team.group);
            return {
              rank: result.rankPosition!,
              name: two ? `${one} y ${two}` : one,
              school: origin?.school ?? null,
              place: origin?.place ?? null,
              department: origin?.department ?? null,
              score: result.totalScore,
            };
          }),
      }))
      .filter((category) => category.rows.length > 0);

    // La portada muestra solo el más reciente: no hace falta armar los demás.
    if (byCategory.length > 0) {
      ranking.push({ id: contest.id, title: contest.title, categories: byCategory });
      break;
    }
  }

  res.json(ranking);
});

// ---- Certificados para el sitio informativo ----
// El CMS del sitio informativo descarga esta lista con la clave que genera el
// administrador y la guarda, porque el concurso no queda en línea para siempre.

const CERTIFICATES_KEY = "certificatesKey";

function fullName(first: string, last: string | null) {
  return [first, last].map((part) => part?.trim()).filter(Boolean).join(" ");
}

async function certificatesExport() {
  await releaseDueResults();
  const contests = await prisma.contest.findMany({
    where: {
      isPractice: false,
      isTest: false,
      trashedAt: null,
      publishedAt: { not: null },
      resultsPublishedAt: { not: null },
    },
    orderBy: { endsAt: "asc" },
    select: {
      id: true,
      title: true,
      categories: true,
      startsAt: true,
      endsAt: true,
      resultsPublishedAt: true,
      tasks: { select: { category: true } },
    },
  });
  const contestById = new Map(contests.map((contest) => [contest.id, contest]));

  // Todos los resultados de una vez, no desafío por desafío: la cantidad de
  // consultas no crece con los años de concurso.
  const results = await prisma.result.findMany({
    where: {
      attempt: {
        startedAt: { not: null },
        team: {
          group: {
            contest: {
              isPractice: false,
              isTest: false,
              trashedAt: null,
              publishedAt: { not: null },
              resultsPublishedAt: { not: null },
            },
          },
        },
      },
    },
    include: {
      attempt: {
        include: {
          team: {
            include: {
              group: {
                select: { createdById: true, schoolId: true, contestId: true },
              },
            },
          },
        },
      },
    },
  });
  const originOf = await groupOrigins(
    results.map((result) => result.attempt.team.group),
  );

  const categoryOf = (result: (typeof results)[number]) => {
    const contest = contestById.get(result.attempt.team.group.contestId);
    return contest
      ? teamCategory(result.attempt.team.grade, contestCategories(contest))
      : null;
  };
  const ranked = new Map<string, number>();
  for (const result of results) {
    const category = categoryOf(result);
    if (category && result.rankPosition !== null) {
      const key = `${result.attempt.team.group.contestId}|${category}`;
      ranked.set(key, (ranked.get(key) ?? 0) + 1);
    }
  }

  const certificates = [];
  for (const result of results) {
    const contest = contestById.get(result.attempt.team.group.contestId);
    const category = categoryOf(result);
    if (!contest || !category) continue;
    const team = result.attempt.team;
    const origin = originOf(team.group);
    const participants = [
      fullName(team.memberOneFirstName, team.memberOneLastName),
    ];
    if (team.participationMode === "pareja" && team.memberTwoFirstName) {
      participants.push(fullName(team.memberTwoFirstName, team.memberTwoLastName));
    }
    certificates.push({
      code: team.personalCode,
      contestId: contest.id,
      participants,
      category,
      grade:
        SCHOOL_GRADES.find((grade) => grade.value === team.grade)?.label ??
        null,
      school: origin?.school ?? null,
      place: origin?.place ?? null,
      department: origin?.department ?? null,
      score: result.totalScore,
      correct: result.correctCount,
      questions: contest.tasks.filter((task) => task.category === category)
        .length,
      rank: result.rankPosition,
      rankOf: ranked.get(`${contest.id}|${category}`) ?? null,
    });
  }

  return {
    version: 1,
    generatedAt: currentDate().toISOString(),
    contests: contests.map((contest) => ({
      id: contest.id,
      title: contest.title,
      year: (contest.startsAt ?? contest.endsAt ?? contest.resultsPublishedAt!)
        .getUTCFullYear(),
      startsAt: contest.startsAt?.toISOString() ?? null,
      endsAt: contest.endsAt?.toISOString() ?? null,
      resultsPublishedAt: contest.resultsPublishedAt!.toISOString(),
    })),
    certificates,
  };
}

function sameSecret(given: string, expected: string) {
  const left = new TextEncoder().encode(given);
  const right = new TextEncoder().encode(expected);
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

app.get("/api/certificates/export", async (req, res) => {
  const header = req.headers.authorization ?? "";
  const given = header.startsWith("Bearer ")
    ? header.slice(7).trim()
    : typeof req.query.key === "string"
      ? req.query.key.trim()
      : "";
  const stored = await prisma.siteSetting.findUnique({
    where: { key: CERTIFICATES_KEY },
  });

  if (!stored?.value || !given || !sameSecret(given, stored.value)) {
    res.status(401).json({ message: "El enlace de certificados no es válido." });
    return;
  }

  res.setHeader("Cache-Control", "no-store");
  res.json(await certificatesExport());
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

// La práctica es pública y la abren todos a la vez: lo que se lee de D1 se
// guarda unos segundos por isolate. Un cambio de visibilidad tarda a lo más
// ese tiempo en verse.
const PRACTICE_TTL_MS = 30_000;
let practiceListCache: {
  loadedAt: number;
  tasks: Awaited<ReturnType<typeof readPracticeTasks>>;
} | null = null;
const practiceTaskCache = new Map<
  string,
  { loadedAt: number; task: PlayTask | null }
>();

async function loadPracticeTasks() {
  if (practiceListCache && Date.now() - practiceListCache.loadedAt < PRACTICE_TTL_MS) {
    return practiceListCache.tasks;
  }
  const tasks = await readPracticeTasks();
  practiceListCache = { loadedAt: Date.now(), tasks };
  return tasks;
}

async function loadPracticeTask(id: string) {
  const cached = practiceTaskCache.get(id);
  if (cached && Date.now() - cached.loadedAt < PRACTICE_TTL_MS) {
    return cached.task;
  }
  const raw = await prisma.taskDraft.findFirst({
    where: { id, isPractice: true },
  });
  const task = raw ? (deserializeTask(raw) as PlayTask) : null;
  practiceTaskCache.delete(id);
  if (practiceTaskCache.size >= 12) {
    const oldest = practiceTaskCache.keys().next().value;
    if (oldest) practiceTaskCache.delete(oldest);
  }
  practiceTaskCache.set(id, { loadedAt: Date.now(), task });
  return task;
}

async function readPracticeTasks() {
  const tasks = await prisma.taskDraft.findMany({
    where: { isPractice: true },
    select: {
      id: true,
      title: true,
      country: true,
      sourceTaskCode: true,
      answerType: true,
      difficulties: true,
    },
  });
  return tasks.map((task) => ({
    ...task,
    difficulties: normalizeTaskDifficulties(task.difficulties),
  }));
}

type PracticeRow = Awaited<ReturnType<typeof readPracticeTasks>>[number];

function practiceCategoriesPayload(tasks: PracticeRow[]) {
  return PRACTICE_CATEGORIES.map((category) => ({
    name: category.name,
    age: category.age,
    count: tasks.filter((task) => taskMatchesCategory(task, category)).length,
  })).filter((category) => category.count > 0);
}

function practiceListPayload(
  category: (typeof PRACTICE_CATEGORIES)[number],
  tasks: PracticeRow[],
) {
  const range = category.ranges[0];
  const rank = { easy: 0, medium: 1, hard: 2 } as Record<string, number>;
  const orderOf = new Map(
    tasks.map((task) => [task.id, task.sourceTaskCode ?? task.title]),
  );
  const rows = tasks
    .filter((task) => taskMatchesCategory(task, category))
    .map((task) => {
      const level = (task.difficulties as Record<string, unknown> | null)?.[
        range
      ];
      return {
        id: task.id,
        title: task.title,
        country: task.country,
        answerType: task.answerType,
        difficulty: typeof level === "string" && level in rank ? level : null,
      };
    })
    .sort(
      (a, b) =>
        (rank[a.difficulty ?? ""] ?? 3) - (rank[b.difficulty ?? ""] ?? 3) ||
        (orderOf.get(a.id) ?? "").localeCompare(orderOf.get(b.id) ?? "", "es", {
          numeric: true,
        }),
    );
  return { category: category.name, age: category.age, tasks: rows };
}

app.get("/api/practice/categories", async (_req, res) => {
  res.json(practiceCategoriesPayload(await loadPracticeTasks()));
});

app.get("/api/practice/tasks", async (req, res) => {
  const categoryName =
    typeof req.query.category === "string" ? req.query.category : "";
  const category = PRACTICE_CATEGORIES.find((c) => c.name === categoryName);

  if (!category) {
    res.status(404).json({ message: "Categoría no encontrada." });
    return;
  }

  res.json(practiceListPayload(category, await loadPracticeTasks()));
});

app.get("/api/practice/tasks/:id", async (req, res) => {
  const task = await loadPracticeTask(String(req.params.id));

  if (!task) {
    res.status(404).json({ message: "Tarea no encontrada." });
    return;
  }

  res.json(
    await externalizeTaskImages(
      renderSafeTask({ position: 0 }, task),
      imageStore(req),
    ),
  );
});

/** Sin tildes: el frontend arma la misma dirección. */
function practiceFileName(name: string) {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/**
 * La práctica también se publica como archivos en el bucket público: el sitio
 * la lee de ahí sin pasar por el Worker. Se regenera cuando cambia el conjunto
 * de tareas de práctica (huella de ids y fechas), por cron y al editar tareas.
 */
async function refreshPracticeSnapshot(force = false) {
  const store = publicStore();
  if (!store) return;
  const blocked = String(env.REGISTRATION_ONLY) === "true";
  const row = await db()
    .prepare(
      `SELECT group_concat("id" || ':' || "updatedAt", ',') AS "print"
      FROM (SELECT "id", "updatedAt" FROM "TaskDraft" WHERE "isPractice" = 1 ORDER BY "id")`,
    )
    .first<{ print: string | null }>();
  const print = blocked ? "bloqueada" : `v2|${row?.print ?? ""}`;
  const current = await store.bucket.get("practice/huella.txt");
  const previous = current ? await current.text() : "";
  if (!force && previous === print) return;
  // Solo se vuelve a escribir la tarea que cambió desde la última vez.
  const unchanged = new Set(
    force || !previous.startsWith("v2|") ? [] : previous.slice(3).split(","),
  );

  const json = (body: unknown) => ({
    body: JSON.stringify(body),
    options: {
      httpMetadata: {
        contentType: "application/json; charset=utf-8",
        cacheControl: "public, max-age=60",
      },
    },
  });
  const keep = new Set<string>();
  const put = async (key: string, body: unknown) => {
    keep.add(key);
    const file = json(body);
    await store.bucket.put(key, file.body, file.options);
  };

  if (!blocked) {
    const tasks = await readPracticeTasks();
    await put("practice/categories.json", practiceCategoriesPayload(tasks));
    for (const category of PRACTICE_CATEGORIES) {
      await put(
        `practice/tasks/${practiceFileName(category.name)}.json`,
        practiceListPayload(category, tasks),
      );
    }
    const stamps = new Map(
      (row?.print ?? "")
        .split(",")
        .filter(Boolean)
        .map((entry) => [entry.slice(0, entry.indexOf(":")), entry]),
    );
    for (const { id } of tasks) {
      const key = `practice/task/${encodeURIComponent(id)}.json`;
      if (unchanged.has(stamps.get(id) ?? "")) {
        keep.add(key);
        continue;
      }
      const raw = await prisma.taskDraft.findFirst({
        where: { id, isPractice: true },
      });
      if (!raw) continue;
      await put(
        key,
        await externalizeTaskImages(
          renderSafeTask({ position: 0 }, deserializeTask(raw) as PlayTask),
          store,
        ),
      );
    }
  }

  let cursor: string | undefined;
  do {
    const page = await store.bucket.list({ prefix: "practice/", cursor });
    const stale = page.objects
      .map((object) => object.key)
      .filter((key) => !keep.has(key) && key !== "practice/huella.txt");
    if (stale.length) await store.bucket.delete(stale);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  await store.bucket.put("practice/huella.txt", print);
}

/** Tras editar tareas: la práctica publicada no debe quedar atrasada. */
async function refreshPracticeSnapshotQuietly() {
  if (typeof trialScope() === "string") return;
  try {
    await refreshPracticeSnapshot();
  } catch (error) {
    console.error("No se pudo publicar la práctica", error);
  }
}

app.post("/api/practice/tasks/:id/check", async (req, res) => {
  const task = await loadPracticeTask(String(req.params.id));

  if (!task) {
    res.status(404).json({ message: "Tarea no encontrada." });
    return;
  }

  const payload = req.body?.payload;
  const error = validateTaskAnswer(task, payload);
  if (error) {
    res.status(400).json({ message: error });
    return;
  }
  const correct = answerIsCorrect(task, payload);

  res.json({
    correct,
    explanationBlocks: await externalizeTaskImages(
      task.explanationBlocks,
      imageStore(req),
    ),
  });
});

app.get("/api/task-images/:file", async (req, res) => {
  const file = String(req.params.file);
  const bucket = publicAssets().PUBLIC_ASSETS;
  const object =
    bucket && TASK_IMAGE_FILE.test(file)
      ? await bucket.get(taskImageKey(file))
      : null;

  if (!object) {
    res.status(404).json({ message: "Imagen no encontrada." });
    return;
  }

  res.setHeader(
    "Content-Type",
    object.httpMetadata?.contentType ?? "application/octet-stream",
  );
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(Buffer.from(await object.arrayBuffer()));
});

app.get("/api/interactive/engines/:name/:file", async (req, res) => {
  const version = /^([0-9a-f]{12})\.js$/.exec(String(req.params.file))?.[1];
  const engine = version
    ? parseInteractiveEngineKey(
        interactiveEngineKey({ name: String(req.params.name), version }),
      )
    : null;
  const object = engine
    ? await env.UPLOADS.get(interactiveEngineKey(engine))
    : null;

  if (!object) {
    res.status(404).json({ message: "Motor no encontrado." });
    return;
  }

  res.setHeader("Content-Type", "text/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(Buffer.from(await object.arrayBuffer()));
});

// Banco de tareas, desafíos y gestión de usuarios: solo admin.
app.use(["/api/tasks", "/api/contests", "/api/users"], requireAdmin);

app.use("/api/admin", requireAdmin);

app.get("/api/admin/interactive-engines/latest", async (_req, res) => {
  const engines = [];
  let cursor: string | undefined;
  do {
    const page = await env.UPLOADS.list({
      prefix: "interactive/engines/",
      cursor,
    });
    for (const object of page.objects) {
      const engine = parseInteractiveEngineKey(object.key);
      if (engine) engines.push({ ...engine, uploaded: object.uploaded });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  const latest = engines.sort(
    (left, right) => right.uploaded.getTime() - left.uploaded.getTime(),
  )[0];

  if (!latest) {
    res.status(404).json({ message: "No hay motores subidos." });
    return;
  }

  res.json({
    name: latest.name,
    version: latest.version,
    uploadedAt: latest.uploaded.toISOString(),
  });
});

const INFO_SITE_KEY = "infoSiteUrl";
const TEACHER_REGISTRATION_KEY = "teacherRegistration";

async function readSiteSetting(key: string) {
  const row = await prisma.siteSetting.findUnique({ where: { key } });
  return row?.value || null;
}

async function teacherRegistrationOpen() {
  return (await readSiteSetting(TEACHER_REGISTRATION_KEY)) !== "closed";
}

app.get("/api/site-settings", async (_req, res) => {
  res.json({
    infoSiteUrl: await readSiteSetting(INFO_SITE_KEY),
    teacherRegistration: await teacherRegistrationOpen(),
  });
});

app.put("/api/admin/teacher-registration", async (req, res) => {
  if (typeof req.body?.enabled !== "boolean") {
    res.status(400).json({ message: "Falta indicar si el registro queda abierto." });
    return;
  }

  if (req.body.enabled) {
    await prisma.siteSetting.deleteMany({ where: { key: TEACHER_REGISTRATION_KEY } });
  } else {
    await prisma.siteSetting.upsert({
      where: { key: TEACHER_REGISTRATION_KEY },
      create: { key: TEACHER_REGISTRATION_KEY, value: "closed" },
      update: { value: "closed" },
    });
  }

  res.json({ teacherRegistration: req.body.enabled });
});

app.put("/api/admin/site-settings", async (req, res) => {
  const raw =
    typeof req.body?.infoSiteUrl === "string" ? req.body.infoSiteUrl.trim() : "";
  let value = "";

  if (raw) {
    try {
      const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
      if (!["http:", "https:"].includes(url.protocol) || !url.hostname.includes(".")) {
        throw new Error();
      }
      value = url.toString();
    } catch {
      res.status(400).json({
        message: "Ese enlace no es válido. Ejemplo: https://bebras.bo",
        field: "infoSiteUrl",
      });
      return;
    }
  }

  if (value) {
    await prisma.siteSetting.upsert({
      where: { key: INFO_SITE_KEY },
      create: { key: INFO_SITE_KEY, value },
      update: { value },
    });
  } else {
    await prisma.siteSetting.deleteMany({ where: { key: INFO_SITE_KEY } });
  }

  res.json({
    infoSiteUrl: value || null,
    teacherRegistration: await teacherRegistrationOpen(),
  });
});

async function certificatesSummary() {
  const data = await certificatesExport();
  return { contests: data.contests.length, certificates: data.certificates.length };
}

app.get("/api/admin/certificates", async (_req, res) => {
  res.json({
    key: await readSiteSetting(CERTIFICATES_KEY),
    ...(await certificatesSummary()),
  });
});

// Genera la clave del enlace; una nueva invalida la anterior.
app.post("/api/admin/certificates/key", async (_req, res) => {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const value = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  await prisma.siteSetting.upsert({
    where: { key: CERTIFICATES_KEY },
    create: { key: CERTIFICATES_KEY, value },
    update: { value },
  });
  res.json({ key: value, ...(await certificatesSummary()) });
});

function serializeAdmin(
  user: { id: number; email: string; name: string | null },
  selfId?: number,
) {
  return {
    id: user.id,
    email: user.email,
    name: user.name === null ? null : formatPersonName(user.name),
    isSelf: user.id === selfId,
  };
}

app.get("/api/admin/admins", async (req, res) => {
  const admins = await prisma.user.findMany({
    where: { role: "admin" },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, name: true },
  });
  res.json(admins.map((admin) => serializeAdmin(admin, req.user?.id)));
});

app.post("/api/admin/admins", async (req, res) => {
  const email =
    typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ message: "Escribe un correo válido.", field: "email" });
    return;
  }

  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing?.role === "admin") {
    res.status(409).json({ message: "Ese correo ya es administrador.", field: "email" });
    return;
  }

  const admin = existing
    ? await prisma.user.update({
        where: { id: existing.id },
        data: { role: "admin", status: "approved" },
      })
    : await prisma.user.create({
        data: { email, role: "admin", status: "approved" },
      });

  res.status(201).json(serializeAdmin(admin, req.user?.id));
});

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
app.use(["/api/groups/:id", "/api/teams/:id"], async (req, res, next) => {
  if (req.params.id === "course" || req.params.id === "courses") return next();
  const id = String(req.params.id);
  const removed = req.baseUrl.startsWith("/api/teams/")
    ? await prisma.team.findFirst({ where: { id, group: { contest: { trashedAt: { not: null } } } }, select: { id: true } })
    : await prisma.contestGroup.findFirst({ where: { id, contest: { trashedAt: { not: null } } }, select: { id: true } });
  if (removed) {
    res.status(404).json({ message: "El desafío está en la papelera." });
    return;
  }
  next();
});
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
  groups: {
    id: string;
    accessCode: string;
    createdAt: Date;
    teams: { id: string }[];
  }[];
  _count: { practiceResults: number };
}) {
  const groups = [...contest.groups].sort(
    (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
  );
  return {
    id: contest.id,
    // El primero es el que se crea junto con la practica: ese es el codigo que
    // se reparte. Si el maestro agrega mas grupos, viven en Grupos como
    // cualquier otro.
    accessCode: groups[0]?.accessCode ?? null,
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
    resultCount: contest._count.practiceResults,
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
    select: {
      id: true,
      accessCode: true,
      createdAt: true,
      teams: { select: { id: true } },
    },
  },
  _count: { select: { practiceResults: true } },
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
    select: { id: true, title: true, country: true, difficulties: true },
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
      ? [{ id: draft.id, title: draft.title, country: draft.country, difficulty }]
      : [];
  });

  res.json({ category, ageRange, tasks: usable });
});

app.get("/api/practices/tasks/:id", async (req, res) => {
  const raw = await prisma.taskDraft.findFirst({
    where: { id: String(req.params.id), ...TEACHER_TASKS },
  });
  if (!raw) {
    res.status(404).json({ message: "Tarea no encontrada." });
    return;
  }
  res.json(
    await externalizeTaskImages(
      renderSafeTask({ position: 0 }, deserializeTask(raw)),
      imageStore(req),
    ),
  );
});

app.post("/api/practices/tasks/:id/check", async (req, res) => {
  const raw = await prisma.taskDraft.findFirst({
    where: { id: String(req.params.id), ...TEACHER_TASKS },
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
    explanationBlocks: await externalizeTaskImages(
      task.explanationBlocks,
      imageStore(req),
    ),
  });
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

  // Sin horario la práctica nunca abre: el intento necesita saber cuándo cierra.
  if (!startsAt || !endsAt) {
    res.status(400).json({
      message: "Elige cuándo empieza y cuándo termina la práctica.",
    });
    return;
  }

  if (endsAt <= startsAt) {
    res.status(400).json({
      message: "El horario de cierre debe ser posterior al de inicio.",
    });
    return;
  }

  const windowMinutes = (endsAt.getTime() - startsAt.getTime()) / 60000;
  if (windowMinutes < durationMinutes) {
    res.status(400).json({
      message: `El horario (${Math.round(windowMinutes)} min) es más corto que la duración de la práctica (${durationMinutes} min).`,
    });
    return;
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
    },
    include: practiceInclude,
  });

  res.status(201).json(serializePractice(practice));
});

async function loadPracticeResults(req: express.Request) {
  const practice = await prisma.contest.findFirst({
    where: { id: String(req.params.id), ...practiceOwnerWhere(req) },
    select: {
      id: true,
      title: true,
      updatedAt: true,
      categories: true,
      durationMinutes: true,
      startsAt: true,
      endsAt: true,
      createdAt: true,
      createdById: true,
    },
  });

  if (!practice) return null;

  const category = contestCategories(practice)[0] ?? null;
  const tasks = tasksOfCategory(await contestTasksFor(practice), category);
  const results = await prisma.practiceResult.findMany({
    where: { contestId: practice.id },
    orderBy: [{ totalScore: "desc" }, { finishedAt: "asc" }],
    include: {
      team: {
        select: {
          memberOneFirstName: true,
          memberOneLastName: true,
          grade: true,
        },
      },
    },
  });

  const grades = SCHOOL_GRADES.filter((grade) => grade.category === category).map(
    (grade) => grade.value,
  );
  const enrolled =
    practice.createdById && grades.length > 0
      ? await prisma.team.findMany({
          where: {
            grade: { in: grades },
            group: {
              createdById: practice.createdById,
              contest: { isPractice: false, trashedAt: null },
            },
          },
          select: {
            id: true,
            memberOneFirstName: true,
            memberOneLastName: true,
            grade: true,
          },
        })
      : [];
  const done = new Set(
    results.map((result) =>
      `${nameKey(result.team.memberOneFirstName, result.team.memberOneLastName)}|${result.team.grade ?? ""}`,
    ),
  );
  const pending = new Map<string, { id: string; name: string; grade: string | null }>();
  for (const team of enrolled) {
    const name = `${team.memberOneFirstName} ${team.memberOneLastName}`.trim();
    const key = `${nameKey(team.memberOneFirstName, team.memberOneLastName)}|${team.grade ?? ""}`;
    if (done.has(key) || pending.has(key)) continue;
    pending.set(key, { id: team.id, name, grade: team.grade });
  }

  return {
    practice: {
      id: practice.id,
      title: practice.title,
      category: category ?? "",
      durationMinutes: practice.durationMinutes,
      startsAt: practice.startsAt?.toISOString() ?? null,
      endsAt: practice.endsAt?.toISOString() ?? null,
      state: computeContestState({
        publishedAt: practice.createdAt,
        startsAt: practice.startsAt,
        endsAt: practice.endsAt,
        isPractice: true,
      }).state,
    },
    tasks: tasks.map((task) => ({
      id: task.taskDraftId,
      title: task.play.title,
      difficulty: task.difficulty,
      maxScore: task.maxScore,
    })),
    maxScore: initialScoreOf(tasks) + tasks.reduce((total, task) => total + task.maxScore, 0),
    results: results.map((result) => ({
      id: result.id,
      name: `${result.team.memberOneFirstName} ${result.team.memberOneLastName}`.trim(),
      grade: result.team.grade,
      totalScore: result.totalScore,
      correctCount: result.correctCount,
      answeredCount: result.answeredCount,
      taskCount: result.taskCount,
      marks: result.marks,
      finishedAt: result.finishedAt.toISOString(),
    })),
    pending: [...pending.values()].sort((left, right) =>
      left.name.localeCompare(right.name, "es"),
    ),
  };
}

app.get("/api/practices/:id/results", async (req, res) => {
  const data = await loadPracticeResults(req);
  if (!data) {
    res.status(404).json({ message: "Práctica no encontrada." });
    return;
  }
  res.json(data);
});

app.get("/api/practices/:id/results.xlsx", async (req, res) => {
  const data = await loadPracticeResults(req);
  if (!data) {
    res.status(404).json({ message: "Práctica no encontrada." });
    return;
  }

  const { ANSWER_CELLS, writeBanner, writeHeader, writeRow } = excelKit();
  const workbook = new ExcelJS.Workbook();
  const gradeName = (grade: string | null) =>
    SCHOOL_GRADES.find((item) => item.value === grade)?.label ?? "";
  const subtitle = [data.practice.title, `Categoría ${data.practice.category}`].join(
    "   ·   ",
  );
  const HEADER_ROW = 5;

  const headers = [
    "N.º",
    "Estudiante",
    "Curso",
    "Puntaje",
    "Correctas",
    ...data.tasks.map((_, index) => `P${index + 1}`),
  ];
  const fixed = headers.length - data.tasks.length;
  const sheet = workbook.addWorksheet("Resultados", {
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  sheet.columns = headers.map((_, index) => ({
    width: index < fixed ? [6, 34, 18, 10, 11][index] : 5,
  }));
  writeBanner(sheet, Math.max(headers.length, 5), [
    "Resultados de la práctica",
    subtitle,
    "Las columnas P1, P2… son las preguntas en orden: ✓ correcta, ✗ incorrecta, — sin responder.",
  ]);
  writeHeader(sheet, HEADER_ROW, headers);
  data.tasks.forEach((task, index) => {
    sheet.getRow(HEADER_ROW).getCell(fixed + index + 1).note = task.title;
  });
  const MARKS = { C: ANSWER_CELLS.correct, X: ANSWER_CELLS.wrong } as const;
  data.results.forEach((result, index) => {
    const row = writeRow(
      sheet,
      HEADER_ROW + 1 + index,
      [
        index + 1,
        result.name,
        gradeName(result.grade),
        result.totalScore,
        `${result.correctCount} de ${result.taskCount}`,
      ],
      headers.length,
    );
    data.tasks.forEach((_, taskIndex) => {
      const mark = result.marks[taskIndex];
      const style = mark === "C" || mark === "X" ? MARKS[mark] : ANSWER_CELLS.blank;
      const cell = row.getCell(fixed + taskIndex + 1);
      cell.value = style.text;
      cell.fill = style.fill;
      cell.font = { bold: true, color: { argb: style.color } };
    });
  });
  data.pending.forEach((student, index) => {
    const row = writeRow(
      sheet,
      HEADER_ROW + 1 + data.results.length + index,
      ["", student.name, gradeName(student.grade), "Todavía no la hizo"],
      fixed,
    );
    row.getCell(4).font = { color: { argb: "FF7F7F7F" } };
  });

  if (data.results.length > 0) {
    const questionHeaders = [
      "N.º",
      "Pregunta",
      "Dificultad",
      "Correctas",
      "Incorrectas",
      "Sin responder",
      "% de acierto",
    ];
    const questions = workbook.addWorksheet("Preguntas", {
      pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    questions.columns = questionHeaders.map((header) => ({
      width: header === "Pregunta" ? 40 : header === "N.º" ? 6 : 14,
    }));
    writeBanner(questions, questionHeaders.length, [
      "Preguntas",
      subtitle,
      `Cuántos de los ${data.results.length} que la terminaron respondieron bien cada pregunta.`,
    ]);
    writeHeader(questions, HEADER_ROW, questionHeaders);
    data.tasks.forEach((task, index) => {
      const correct = data.results.filter((result) => result.marks[index] === "C").length;
      const wrong = data.results.filter((result) => result.marks[index] === "X").length;
      const row = writeRow(
        questions,
        HEADER_ROW + 1 + index,
        [
          `P${index + 1}`,
          task.title,
          DIFFICULTY_LABELS[task.difficulty] ?? task.difficulty,
          correct,
          wrong,
          data.results.length - correct - wrong,
          correct / data.results.length,
        ],
        questionHeaders.length,
      );
      row.getCell(questionHeaders.length).numFmt = "0%";
    });
  }

  await sendWorkbook(
    res,
    workbook,
    `practica-${excelFileName(data.practice.title)}.xlsx`,
  );
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

// Todas las tareas pesan decenas de MB (imágenes y tareas interactivas): se
// leen y serializan de a pocas para no pasar el límite de memoria del Worker.
app.get("/api/tasks", async (req, res) => {
  // Las listas solo muestran datos de cada tarea: sin enunciados ni imágenes
  // la respuesta baja de decenas de MB a unos KB.
  if (req.query.resumen === "1") {
    const rows = await prisma.taskDraft.findMany({
      orderBy: { updatedAt: "desc" },
      omit: {
        bodyBlocks: true,
        challengeBlocks: true,
        answerConfig: true,
        answerKey: true,
        answers: true,
        shortAnswer: true,
        dragDropBackground: true,
        dragDropItems: true,
        explanationBlocks: true,
      },
    });
    res.json(
      rows.map((row) =>
        deserializeTask({
          ...row,
          bodyBlocks: "[]",
          challengeBlocks: "[]",
          answerConfig: "{}",
          answerKey: "{}",
          answers: "[]",
          shortAnswer: "",
          dragDropBackground: "null",
          dragDropItems: "[]",
          explanationBlocks: "[]",
        }),
      ),
    );
    return;
  }

  const ids = await prisma.taskDraft.findMany({
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  const parts: string[] = [];
  for (let start = 0; start < ids.length; start += 8) {
    const chunk = ids.slice(start, start + 8).map((row) => row.id);
    const rows = await prisma.taskDraft.findMany({
      where: { id: { in: chunk } },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const id of chunk) {
      const row = byId.get(id);
      if (row) parts.push(JSON.stringify(deserializeTask(row)));
    }
  }

  res.type("application/json").send(`[${parts.join(",")}]`);
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

  const engineProblem = await interactiveEngineProblem(payload);
  if (engineProblem) {
    res.status(400).json({ message: engineProblem });
    return;
  }

  const task = await prisma.taskDraft.create({
    data: {
      ...payload,
      isPractice: req.body?.isPractice === true,
    },
  });

  await refreshPracticeSnapshotQuietly();
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

  const engineProblem = await interactiveEngineProblem(payload);
  if (engineProblem) {
    res.status(400).json({ message: engineProblem });
    return;
  }

  const existing = await prisma.taskDraft.findUnique({
    where: { id: req.params.id },
    select: {
      id: true,
      contestTasks: {
        select: {
          contest: {
            select: {
              title: true,
              isPractice: true,
              publishedAt: true,
              suspendedAt: true,
              stoppedAt: true,
              trashedAt: true,
              registrationStartsAt: true,
              registrationEndsAt: true,
              startsAt: true,
              endsAt: true,
            },
          },
        },
      },
    },
  });

  if (!existing) {
    res.status(404).json({ message: "Task not found" });
    return;
  }

  // Cambiarla mientras se rinde corregiría a unos con una clave y a otros con otra.
  const running = existing.contestTasks.find(({ contest }) => {
    if (contest.isPractice) return false;
    const { state } = computeContestState(contest);
    return ["preparacion", "abierta", "suspendida"].includes(state);
  });

  if (running) {
    res.status(409).json({
      message: `Esta tarea está en «${running.contest.title}», que ya comenzó. Sus preguntas están bloqueadas.`,
      code: "TASK_IN_RUNNING_CONTEST",
    });
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

  await refreshPracticeSnapshotQuietly();
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
  await refreshPracticeSnapshotQuietly();
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
  await refreshPracticeSnapshotQuietly();
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

  await refreshPracticeSnapshotQuietly();
  res.status(204).send();
});

/** Lo de cada tarea que muestran las listas de desafíos. */
const taskSummarySelect = {
  id: true,
  title: true,
  country: true,
  year: true,
  sourceTaskCode: true,
  category: true,
  difficulties: true,
} satisfies Prisma.TaskDraftSelect;

registerContestLifecycle(app, currentDate, (contest) => deserializeContest(contest));

app.get("/api/contests", async (_req, res) => {
  await purgeExpiredContests();
  await releaseDueResults();
  // La relación va sin ordenar: con más de 100 desafíos Prisma la parte en
  // tandas (D1 admite 100 parámetros por consulta), y ordenada no puede.
  const contests = await prisma.contest.findMany({
    where: { isPractice: false, trashedAt: null },
    include: { tasks: { include: { taskDraft: { select: taskSummarySelect } } } },
    orderBy: { updatedAt: "desc" },
  });

  const favoriteId = await favoriteContestId();
  res.json(contests.map((contest) => deserializeContest(contest, favoriteId)));
});

app.get("/api/contests/:id", async (req, res) => {
  await releaseDueResults(String(req.params.id));
  const contest = await prisma.contest.findUnique({
    where: {
      id: req.params.id,
    },
    include: { tasks: { include: { taskDraft: { select: taskSummarySelect } } } },
  });

  if (!contest) {
    res.status(404).json({
      message: "Contest not found",
    });
    return;
  }

  res.json(deserializeContest(contest, await favoriteContestId()));
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
      isTest: payload.isTest,
      collectUsage: payload.collectUsage,
      unlisted: payload.unlisted,
      linkedContestId: payload.linkedContestId,
      categories: JSON.stringify(payload.categories),
      durationMinutes: payload.durationMinutes,
      registrationStartsAt: payload.registrationStartsAt,
      registrationEndsAt: payload.registrationEndsAt,
      startsAt: payload.startsAt,
      endsAt: payload.endsAt,
      schedules: serializeCategorySchedules(payload.schedules),
      resultsAt: payload.resultsAt,
      resultsUntil: payload.resultsUntil,
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
  });

  if (!existingContest) {
    res.status(404).json({
      message: "Contest not found",
    });
    return;
  }

  if (existingContest.isTest !== payload.isTest) {
    const enrolled = await prisma.team.findFirst({
      where: { group: { contestId: existingContest.id } },
      select: { id: true },
    });
    if (existingContest.publishedAt || enrolled) {
      res.status(400).json({
        message:
          "Solo un borrador sin estudiantes puede pasar a prueba o dejar de serlo.",
      });
      return;
    }
  }

  const { state: currentState } = computeContestState(existingContest);

  const alreadyRunning =
    ["preparacion", "abierta", "suspendida"].includes(currentState);

  if (alreadyRunning || contestHasEnded(currentState)) {
    res.status(409).json({
      message: alreadyRunning
        ? "El desafío ya comenzó. Puedes ampliar el cierre y cambiar las fechas de resultados; el inicio, las preguntas y las demás opciones están bloqueados."
        : "El desafío ya terminó; no se puede modificar.",
    });
    return;
  }

  if (existingContest.publishedAt && !existingContest.stoppedAt && payload.categories.length === 0) {
    res.status(400).json({ message: "Un desafío publicado debe conservar al menos una categoría." });
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
  await db().batch([
    db().prepare('DELETE FROM "ContestTask" WHERE "contestId" = ?').bind(contestId),
    db().prepare(`UPDATE "Contest" SET
      "title" = ?, "isTest" = ?, "collectUsage" = ?, "unlisted" = ?, "linkedContestId" = ?, "categories" = ?, "durationMinutes" = ?,
      "registrationStartsAt" = ?, "registrationEndsAt" = ?, "startsAt" = ?, "endsAt" = ?, "schedules" = ?, "resultsAt" = ?, "resultsUntil" = ?,
      "scoring" = ?, "questionDisplayMode" = ?,
      "allowPairs" = ?, "shuffleOptions" = ?, "showFeedback" = ?, "showSolutions" = ?, "showTotalScore" = ?,
      "showScoreOnSubmit" = ?, "showFeedbackOnSubmit" = ?, "showSolutionsOnSubmit" = ?,
      "updatedAt" = ? WHERE "id" = ?`).bind(
      payload.title, Number(payload.isTest), Number(payload.collectUsage), Number(payload.unlisted), payload.linkedContestId, JSON.stringify(payload.categories), payload.durationMinutes,
      payload.registrationStartsAt?.toISOString() ?? null,
      payload.registrationEndsAt?.toISOString() ?? null,
      payload.startsAt?.toISOString() ?? null, payload.endsAt?.toISOString() ?? null,
      serializeCategorySchedules(payload.schedules),
      payload.resultsAt?.toISOString() ?? null,
      payload.resultsUntil?.toISOString() ?? null,
      JSON.stringify(payload.scoring), payload.questionDisplayMode,
      Number(payload.allowPairs), Number(payload.shuffleOptions), Number(payload.showFeedback), Number(payload.showSolutions),
      Number(payload.showTotalScore), Number(payload.showScoreOnSubmit),
      Number(payload.showFeedbackOnSubmit), Number(payload.showSolutionsOnSubmit), now, contestId,
    ),
    ...taskWrites.map((task) => db().prepare(`INSERT INTO "ContestTask"
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

/**
 * Solo se leen las preguntas de la categoría que se prueba: el desafío entero,
 * con sus imágenes y tareas interactivas, no cabe en la memoria del Worker.
 */
async function loadContestPreview(contestId: string, requested: unknown) {
  const contest = await prisma.contest.findUnique({ where: { id: contestId } });
  if (!contest) return null;
  const category = previewCategory(contest, requested);
  const categoryTasks = category
    ? await prisma.contestTask.findMany({
        where: { contestId, category },
        orderBy: { position: "asc" },
        include: { taskDraft: true },
      })
    : [];
  return { contest, category, categoryTasks };
}

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
  const preview = await loadContestPreview(
    String(req.params.id),
    req.query.categoria,
  );

  if (!preview) {
    res.status(404).json({ message: "Contest not found" });
    return;
  }

  const { contest, category, categoryTasks } = preview;
  if (req.user && contest.title.startsWith(TRIAL_PREFIX)) {
    await prisma.trialEvent.create({
      data: { userId: req.user.id, kind: `preview:${contest.id}` },
    });
  }
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
    tasks: await externalizeTaskImages(tasks, imageStore(req)),
    answers: {},
    result: null,
  });
});

/**
 * Corrige las respuestas de una vista previa con las mismas reglas que un
 * intento real, pero sin guardar nada.
 */
app.post("/api/contests/:id/preview/score", async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const preview = await loadContestPreview(
    String(req.params.id),
    body.category,
  );

  if (!preview) {
    res.status(404).json({ message: "Contest not found" });
    return;
  }

  const answers = (
    body.answers && typeof body.answers === "object" ? body.answers : {}
  ) as Record<string, unknown>;

  const { categoryTasks } = preview;
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
    tasks: await externalizeTaskImages(tasks, imageStore(req)),
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
  const pausedAttempts = await prisma.attempt.count({
    where: {
      status: "in_progress",
      endsAt: { not: null },
      team: { group: { contestId: contest.id } },
    },
  });

  // El tiempo de la pausa se devuelve entero: a cada intento en curso y al
  // desafío, cuyo cierre (y el de sus resultados) se corre lo mismo. Una sola
  // sentencia por tabla, sin importar cuántos estudiantes estén rindiendo.
  const resumedAt = currentDate().toISOString();
  const shift = (value: Date | null) =>
    value ? new Date(value.getTime() + pausedMs).toISOString() : null;
  await db().batch([
    db().prepare(`UPDATE "Attempt" SET
        "endsAt" = strftime('%Y-%m-%dT%H:%M:%fZ', "endsAt", ?),
        "updatedAt" = ?
      WHERE "status" = 'in_progress' AND "endsAt" IS NOT NULL
      AND "teamId" IN (
        SELECT t."id" FROM "Team" t JOIN "ContestGroup" g ON g."id" = t."groupId"
        WHERE g."contestId" = ?
      )
      AND EXISTS (SELECT 1 FROM "Contest" WHERE "id" = ? AND "suspendedAt" IS NOT NULL)`)
      .bind(`+${(pausedMs / 1000).toFixed(3)} seconds`, resumedAt, contest.id, contest.id),
    db().prepare(`UPDATE "Contest" SET "suspendedAt" = NULL, "endsAt" = ?, "schedules" = ?,
        "resultsAt" = ?, "resultsUntil" = ?, "updatedAt" = ?
      WHERE "id" = ? AND "suspendedAt" IS NOT NULL`)
      .bind(
        shift(contest.endsAt),
        serializeCategorySchedules(
          shiftCategorySchedules(
            parseCategorySchedules(contest.schedules),
            contest.suspendedAt,
            pausedMs,
          ),
        ),
        shift(contest.resultsAt),
        shift(contest.resultsUntil),
        resumedAt,
        contest.id,
      ),
  ]);

  const resumed = await prisma.contest.findUniqueOrThrow({
    where: { id: contest.id },
    include: contestWithTasks,
  });

  res.json({
    ...deserializeContest(resumed),
    resumedAttempts: pausedAttempts,
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
    select: { id: true, consolidatedAt: true, isTest: true },
  });

  if (!contest) {
    res.status(404).json({ message: "Contest not found" });
    return;
  }

  if (contest.isTest) {
    res.status(409).json({
      message: "Un desafío de prueba no publica resultados ni sale en el ranking.",
    });
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

function formatName(value: string) {
  return cleanName(value)
    .toLowerCase()
    .replace(
      /(^|\s|-)(\p{L})/gu,
      (_match, sep, letter) => sep + letter.toUpperCase(),
    );
}

/**
 * Nombres ya inscritos en un grupo. El control de duplicados es por grupo: en
 * un desafío nacional hay estudiantes distintos con el mismo nombre.
 */
async function groupNameKeys(groupId: string, exceptTeamId?: string) {
  const teams = await prisma.team.findMany({
    where: {
      groupId,
      ...(exceptTeamId ? { id: { not: exceptTeamId } } : {}),
    },
    select: {
      memberOneFirstName: true,
      memberOneLastName: true,
      memberTwoFirstName: true,
      memberTwoLastName: true,
    },
  });
  const keys = new Set<string>();
  for (const team of teams) {
    keys.add(nameKey(team.memberOneFirstName, team.memberOneLastName));
    if (team.memberTwoFirstName && team.memberTwoLastName) {
      keys.add(nameKey(team.memberTwoFirstName, team.memberTwoLastName));
    }
  }
  return keys;
}

function serializeGroup(group: {
  id: string;
  name: string;
  category: string | null;
  grade: string | null;
  autoKey: string | null;
  createdById: number | null;
  schoolId?: string | null;
  school?: { schoolName: string } | null;
  accessCode: string;
  contestId: string;
  firstUsedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  contest?:
    | (Parameters<typeof contestStateAt>[1] & {
        title: string;
        categories: string;
        allowPairs: boolean;
        createdAt?: Date;
      })
    | null;
  createdBy?: {
    role: string;
    name: string | null;
    firstName: string | null;
    lastName: string | null;
    email: string;
    schoolName?: string | null;
    department?: string | null;
  } | null;
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
  const responsible = group.createdBy?.role === "maestro" ? group.createdBy : null;
  const ownerName = responsible
    ? [responsible.firstName, responsible.lastName]
        .filter(Boolean)
        .join(" ") || responsible.name
    : null;
  return {
    id: group.id,
    name: group.name,
    accessCode: group.accessCode,
    contestId: group.contestId,
    grade: group.grade,
    isDefault: Boolean(group.autoKey),
    isFavorite: false,
    ownerId: group.createdById,
    contestTitle: group.contest?.title ?? "",
    contestState: group.contest
      ? computeContestState(group.contest).state
      : "borrador",
    ownerName: ownerName
      ? formatPersonName(ownerName)
      : responsible?.email ?? null,
    ownerEmail: responsible?.email ?? null,
    schoolId: group.schoolId ?? null,
    ownerSchool: group.school?.schoolName ?? responsible?.schoolName ?? null,
    ownerDepartment: responsible?.department ?? null,
    contestCreatedAt: group.contest?.createdAt?.toISOString() ?? group.createdAt.toISOString(),
    category: group.category,
    contestCategories: group.contest ? contestCategories(group.contest) : [],
    contestAllowPairs: group.contest?.allowPairs ?? false,
    firstUsedAt: group.firstUsedAt?.toISOString() ?? null,
    expiresAt: group.expiresAt?.toISOString() ?? null,
    createdAt: group.createdAt.toISOString(),
    teamCount: group.teams?.length ?? 0,
    studentCount:
      group.teams?.reduce(
        (total, team) => total + (team.participationMode === "pareja" ? 2 : 1),
        0,
      ) ?? 0,
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
  contest: {
    select: {
      title: true,
      categories: true,
      allowPairs: true,
      isPractice: true,
      createdAt: true,
      stoppedAt: true,
      trashedAt: true,
      publishedAt: true,
      suspendedAt: true,
      consolidatedAt: true,
      resultsPublishedAt: true,
      registrationStartsAt: true,
      registrationEndsAt: true,
      startsAt: true,
      endsAt: true,
    },
  },
  createdBy: {
    select: {
      role: true,
      name: true,
      firstName: true,
      lastName: true,
      email: true,
      schoolName: true,
      department: true,
    },
  },
  school: true,
} as const;

// ---- Gestión de maestros (solo admin) ----

const MAESTRO_SELECT = {
  id: true,
  name: true,
  firstName: true,
  lastName: true,
  email: true,
  status: true,
  schoolName: true,
  schoolCodUe: true,
  institutionType: true,
  phone: true,
  department: true,
  city: true,
  letterFilename: true,
  idFrontFilename: true,
  idBackFilename: true,
  createdAt: true,
  schools: true,
} as const;

type MaestroRecord = Prisma.UserGetPayload<{ select: typeof MAESTRO_SELECT }>;

async function serializeMaestros(maestros: MaestroRecord[]) {
  const catalog = await prisma.school.findMany({
    where: {
      codUe: {
        in: maestros
          .map((maestro) => maestro.schoolCodUe)
          .filter((code): code is string => Boolean(code)),
      },
    },
    select: { codUe: true, dep: true, sec: true },
  });
  const catalogOf = new Map(catalog.map((school) => [school.codUe, school]));

  return maestros.map(
    ({
      letterFilename,
      idFrontFilename,
      idBackFilename,
      institutionType,
      schools,
      ...maestro
    }) => {
      const listed = maestro.schoolCodUe
        ? catalogOf.get(maestro.schoolCodUe)
        : undefined;
      const type =
        institutionType ?? (maestro.schoolCodUe ? "school" : "homeschool");
      return {
        ...maestro,
        name: maestro.name === null ? null : formatPersonName(maestro.name),
        place: placeLabel(
          listed?.dep ?? maestro.department,
          listed ? townName(listed.sec) : (maestro.city ?? ""),
        ),
        schools: [...schools]
          .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
          .map(serializeTeacherSchool),
        institutionType: type,
        isHomeschool: type === "homeschool",
        hasLetter: Boolean(letterFilename),
        hasIdFront: Boolean(idFrontFilename),
        hasIdBack: Boolean(idBackFilename),
        createdAt: maestro.createdAt.toISOString(),
      };
    },
  );
}

app.get("/api/users/maestros", async (_req, res) => {
  const maestros = await prisma.user.findMany({
    where: { role: "maestro", ...(trialScope() === null ? { trialSessionId: null } : {}) },
    orderBy: { createdAt: "desc" },
    select: MAESTRO_SELECT,
  });
  res.json(await serializeMaestros(maestros));
});

/** El administrador corrige lo que el maestro escribió mal. El correo no se toca: es su cuenta de Firebase. */
app.put("/api/users/:id", async (req, res) => {
  const id = Number(req.params.id);
  const current = await prisma.user.findFirst({
    where: { id, role: "maestro" },
    select: { id: true },
  });
  if (!current) {
    res.status(404).json({ message: "Maestro no encontrado." });
    return;
  }

  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const firstName = validateRegistrationText(text(req.body?.firstName), "firstName");
  const lastName = validateRegistrationText(text(req.body?.lastName), "lastName");
  const phone = validatePhone(text(req.body?.phone));
  const institutionType =
    req.body?.institutionType === "homeschool" ? "homeschool" : "school";
  const schoolCodUe =
    institutionType === "school" && text(req.body?.schoolCodUe).trim()
      ? text(req.body?.schoolCodUe).trim()
      : null;
  const school =
    institutionType === "homeschool"
      ? { value: "Educación en casa", error: undefined }
      : schoolCodUe
        ? { value: text(req.body?.schoolName).trim(), error: undefined }
        : validateRegistrationText(text(req.body?.schoolName), "schoolName");
  const department = text(req.body?.department).trim();
  const city = text(req.body?.city).trim();

  for (const [field, error] of [
    ["firstName", firstName.error],
    ["lastName", lastName.error],
    ["phone", phone.error],
    ["schoolName", school.error],
  ] as const) {
    if (error) {
      res.status(400).json({ message: error, field });
      return;
    }
  }
  if (!firstName.value || !lastName.value || !school.value) {
    res.status(400).json({ message: "Completa nombres, apellidos y colegio." });
    return;
  }

  let listed: { name: string } | null = null;
  if (schoolCodUe) {
    listed = await prisma.school.findUnique({
      where: { codUe: schoolCodUe },
      select: { name: true },
    });
    if (!listed) {
      res.status(400).json({ message: "Ese colegio no está en el catálogo.", field: "schoolName" });
      return;
    }
  } else {
    if (!DEPARTMENTS[department]) {
      res.status(400).json({ message: "Elige el departamento.", field: "department" });
      return;
    }
    if (!/^[\p{L}][\p{L} .'-]{1,59}$/u.test(city)) {
      res.status(400).json({ message: "Elige la ciudad.", field: "city" });
      return;
    }
  }

  const updated = await prisma.user.update({
    where: { id },
    data: {
      firstName: firstName.value,
      lastName: lastName.value,
      name: `${firstName.value} ${lastName.value}`,
      phone: phone.number,
      institutionType,
      schoolCodUe,
      schoolName: listed?.name ?? school.value,
      department: schoolCodUe ? null : department,
      city: schoolCodUe ? null : city,
    },
    select: MAESTRO_SELECT,
  });
  const [maestro] = await serializeMaestros([updated]);
  res.json(maestro);
});

/** Los administradores no se aprueban, rechazan ni suspenden: solo maestros. */
async function setTeacherStatus(
  req: express.Request,
  res: express.Response,
  status: "approved" | "rejected" | "suspended",
) {
  const id = Number(req.params.id);
  const { count } = Number.isInteger(id)
    ? await prisma.user.updateMany({
        where: { id, role: "maestro" },
        data: { status },
      })
    : { count: 0 };
  if (count === 0) {
    res.status(404).json({ message: "Maestro no encontrado." });
    return;
  }
  res.json({ id, status });
}

app.post("/api/users/:id/approve", (req, res) =>
  setTeacherStatus(req, res, "approved"),
);

app.post("/api/users/:id/reject", (req, res) =>
  setTeacherStatus(req, res, "rejected"),
);

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

app.post("/api/users/:id/suspend", (req, res) =>
  setTeacherStatus(req, res, "suspended"),
);

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
      ? { OR: [{ isPractice: false, isTest: false }, { createdById: req.user.id }] }
      : { isPractice: false, isTest: false };

  const hideTrial = trialScope() === null;
  const contests = await prisma.contest.findMany({
    where: {
      trashedAt: null,
      ...(req.user?.role === "admin" ? {} : { publishedAt: { not: null } }),
      AND: [
        visibility,
        ...(hideTrial
          ? [{ NOT: { title: { startsWith: TRIAL_PREFIX } } }]
          : []),
      ],
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      categories: true,
      publishedAt: true,
      isPractice: true,
      createdAt: true,
      stoppedAt: true,
      trashedAt: true,
      suspendedAt: true,
      consolidatedAt: true,
      resultsPublishedAt: true,
      registrationStartsAt: true,
      registrationEndsAt: true,
      startsAt: true,
      endsAt: true,
    },
  });
  const favoriteId = await favoriteContestId();
  res.json(
    contests
      .map((contest) => ({
        ...contest,
        state: computeContestState(contest).state,
        isFavorite: contest.id === favoriteId,
        canEnroll: contestCategories(contest).length > 0 && (req.user?.role === "admin" || contestRegistrationIsOpen(contest)),
        categories: contestCategories(contest),
        registrationStartsAt: contest.registrationStartsAt?.toISOString() ?? null,
        registrationEndsAt: contest.registrationEndsAt?.toISOString() ?? null,
        startsAt: contest.startsAt?.toISOString() ?? null,
        endsAt: contest.endsAt?.toISOString() ?? null,
      })),
  );
});

// ---- Grupos: el admin ve todos; el maestro solo los suyos ----

function groupListFilters(req: express.Request) {
  const maestro = req.user?.role === "maestro";
  const contestId =
    typeof req.query.contestId === "string" && req.query.contestId
      ? req.query.contestId
      : null;
  const requestedOwner = Number(req.query.ownerId);
  const ownerId = maestro
    ? req.user!.id
    : Number.isInteger(requestedOwner) && requestedOwner > 0
      ? requestedOwner
      : null;
  return { contestId, ownerId };
}

async function groupCounts(filters: {
  contestId: string | null;
  ownerId: number | null;
}) {
  const conditions = ['c."trashedAt" IS NULL'];
  const params: Array<string | number | null> = [];
  const scope = trialScope();
  if (scope !== false) {
    conditions.push('c."trialSessionId" IS ?');
    params.push(scope);
  }
  if (filters.contestId) {
    conditions.push('g."contestId" = ?');
    params.push(filters.contestId);
  }
  if (filters.ownerId) {
    conditions.push('g."createdById" = ?');
    params.push(filters.ownerId);
  }
  const { results } = await db()
    .prepare(
      `SELECT t."groupId" AS "groupId", COUNT(*) AS "teams",
        SUM(CASE WHEN t."participationMode" = 'pareja' THEN 2 ELSE 1 END) AS "students"
      FROM "Team" t
      JOIN "ContestGroup" g ON g."id" = t."groupId"
      JOIN "Contest" c ON c."id" = g."contestId"
      WHERE ${conditions.join(" AND ")}
      GROUP BY t."groupId"`,
    )
    .bind(...params)
    .all<{ groupId: string; teams: number; students: number }>();
  return new Map(
    results.map((row) => [
      row.groupId,
      { teams: Number(row.teams), students: Number(row.students) },
    ]),
  );
}

app.get("/api/groups", async (req, res) => {
  const filters = groupListFilters(req);

  const [groups, counts, favoriteId] = await Promise.all([
    prisma.contestGroup.findMany({
      where: {
        contest: { trashedAt: null },
        ...(filters.ownerId ? { createdById: filters.ownerId } : {}),
        ...(filters.contestId ? { contestId: filters.contestId } : {}),
      },
      include: groupContestSelect,
      orderBy: { createdAt: "desc" },
    }),
    groupCounts(filters),
    favoriteContestId(),
  ]);

  res.json(
    groups.map((group) => {
      const count = counts.get(group.id);
      return {
        ...serializeGroup(group),
        teamCount: count?.teams ?? 0,
        studentCount: count?.students ?? 0,
        isFavorite: group.contestId === favoriteId,
      };
    }),
  );
});

app.get("/api/groups/students.xlsx", async (req, res) => {
  await trialTouch(req, "codes");
  const { ownerId } = groupListFilters(req);
  const groupId =
    typeof req.query.groupId === "string" && req.query.groupId
      ? req.query.groupId
      : null;
  const contestId = typeof req.query.contestId === "string" ? req.query.contestId : "";
  const contest = contestId
    ? await prisma.contest.findFirst({
        where: { id: contestId, isPractice: false, isTest: false, trashedAt: null },
      })
    : null;

  if (!contest) {
    res.status(404).json({ message: "Desafío no encontrado." });
    return;
  }

  const schoolFilter =
    ownerId && typeof req.query.schoolId === "string"
      ? { schoolId: req.query.schoolId === "principal" ? null : req.query.schoolId }
      : {};
  const groups = await prisma.contestGroup.findMany({
    where: {
      contestId: contest.id,
      ...(groupId ? { id: groupId } : {}),
      ...(ownerId ? { createdById: ownerId } : {}),
      ...schoolFilter,
    },
    select: {
      name: true,
      grade: true,
      accessCode: true,
      school: true,
      createdBy: {
        select: { firstName: true, lastName: true, email: true, schoolName: true },
      },
      teams: {
        select: {
          personalCode: true,
          grade: true,
          participationMode: true,
          memberOneFirstName: true,
          memberOneLastName: true,
          memberTwoFirstName: true,
          memberTwoLastName: true,
        },
      },
    },
  });

  const withOwner = !ownerId;
  const gradeOrder = (grade: string | null) => {
    const index = SCHOOL_GRADES.findIndex((item) => item.value === grade);
    return index === -1 ? SCHOOL_GRADES.length : index;
  };
  const gradeName = (grade: string | null) =>
    SCHOOL_GRADES.find((item) => item.value === grade)?.label ?? "";
  const ownerName = (group: (typeof groups)[number]) =>
    group.createdBy
      ? `${group.createdBy.firstName ?? ""} ${group.createdBy.lastName ?? ""}`.trim() ||
        group.createdBy.email
      : "";
  const students = groups
    .flatMap((group) =>
      group.teams.map((team) => ({
        school: (group.school?.schoolName ?? group.createdBy?.schoolName) ?? "",
        owner: ownerName(group),
        grade: team.grade ?? group.grade,
        name: [
          `${team.memberOneLastName} ${team.memberOneFirstName}`.trim(),
          team.participationMode === "pareja" && team.memberTwoFirstName
            ? `${team.memberTwoLastName ?? ""} ${team.memberTwoFirstName}`.trim()
            : null,
        ]
          .filter(Boolean)
          .join(" y "),
        code: team.personalCode,
      })),
    )
    .sort(
      (left, right) =>
        left.school.localeCompare(right.school, "es") ||
        left.owner.localeCompare(right.owner, "es") ||
        gradeOrder(left.grade) - gradeOrder(right.grade) ||
        left.name.localeCompare(right.name, "es"),
    );

  const { CELL_BORDER, fill, writeBanner, writeHeader, writeRow } = excelKit();
  const workbook = new ExcelJS.Workbook();
  const subtitle = [
    contest.title,
    !withOwner && groups[0]
      ? ownerName(groups[0])
      : "",
    groupId && groups[0] ? (groups[0].grade ? gradeName(groups[0].grade) : groups[0].name) : "",
  ]
    .filter(Boolean)
    .join("   ·   ");

  const headers = [
    "N.º",
    "Estudiante",
    "Curso",
    "Código personal",
    ...(withOwner ? ["Colegio", "Maestro"] : []),
  ];
  const sheet = workbook.addWorksheet("Estudiantes", {
    pageSetup: { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  sheet.columns = headers.map((header) => ({
    width: { "N.º": 6, Estudiante: 40, Curso: 20, "Código personal": 18 }[header] ?? 32,
  }));
  writeBanner(sheet, headers.length, [
    "Estudiantes y sus códigos",
    subtitle,
    "Cada estudiante entra al desafío con su código personal.",
  ]);
  const HEADER_ROW = 5;
  writeHeader(sheet, HEADER_ROW, headers);
  students.forEach((student, index) => {
    const row = writeRow(
      sheet,
      HEADER_ROW + 1 + index,
      [
        index + 1,
        student.name,
        gradeName(student.grade),
        student.code,
        ...(withOwner ? [student.school, student.owner] : []),
      ],
      headers.length,
      withOwner ? [1, 4, 5] : [1],
    );
    row.getCell(4).font = { bold: true, name: "Consolas" };
  });
  if (students.length > 0) {
    sheet.autoFilter = {
      from: { row: HEADER_ROW, column: 1 },
      to: { row: HEADER_ROW + students.length, column: headers.length },
    };
  }

  if (contestRegistrationIsOpen(contest)) {
    const courseHeaders = [
      "Curso",
      "Código del curso",
      "Estudiantes",
      ...(withOwner ? ["Colegio", "Maestro"] : []),
    ];
    const courses = workbook.addWorksheet("Cursos");
    courses.columns = courseHeaders.map((header) => ({
      width: header === "Curso" ? 22 : header === "Código del curso" ? 20 : header === "Estudiantes" ? 14 : 32,
    }));
    writeBanner(courses, courseHeaders.length, [
      "Códigos de los cursos",
      subtitle,
      "Con el código del curso los estudiantes pueden inscribirse solos mientras la inscripción esté abierta.",
    ]);
    writeHeader(courses, HEADER_ROW, courseHeaders);
    courses.views = [{ state: "frozen", ySplit: HEADER_ROW }];
    [...groups]
      .sort(
        (left, right) =>
          ((left.school?.schoolName ?? left.createdBy?.schoolName) ?? "").localeCompare((right.school?.schoolName ?? right.createdBy?.schoolName) ?? "", "es") ||
          ownerName(left).localeCompare(ownerName(right), "es") ||
          gradeOrder(left.grade) - gradeOrder(right.grade),
      )
      .forEach((group, index) => {
        const row = writeRow(
          courses,
          HEADER_ROW + 1 + index,
          [
            group.grade ? gradeName(group.grade) : group.name,
            group.accessCode,
            group.teams.length,
            ...(withOwner ? [(group.school?.schoolName ?? group.createdBy?.schoolName) ?? "", ownerName(group)] : []),
          ],
          courseHeaders.length,
          withOwner ? [0, 3, 4] : [0],
        );
        row.getCell(2).font = { bold: true, name: "Consolas" };
        row.getCell(2).fill = fill("FFFFF4E5");
        row.getCell(2).border = CELL_BORDER;
      });
  }

  const owner = withOwner && !groupId ? null : groups[0];
  const fileLabel = [
    (owner?.school?.schoolName ?? owner?.createdBy?.schoolName)?.trim() ||
      (owner ? ownerName(owner) : "") ||
      contest.title,
    groupId && groups[0] ? (groups[0].grade ? gradeName(groups[0].grade) : groups[0].name) : "",
  ]
    .filter(Boolean)
    .join(" ");
  await sendWorkbook(res, workbook, `codigos-${excelFileName(fileLabel)}.xlsx`);
});

app.get("/api/groups/contests", async (req, res) => {
  const { ownerId } = groupListFilters(req);
  const scope = trialScope();
  const { results } = await db()
    .prepare(
      `SELECT g."contestId" AS "contestId", COUNT(DISTINCT g."id") AS "groups",
        COALESCE(SUM(CASE WHEN t."id" IS NULL THEN 0
          WHEN t."participationMode" = 'pareja' THEN 2 ELSE 1 END), 0) AS "students"
      FROM "ContestGroup" g
      JOIN "Contest" c ON c."id" = g."contestId"
      LEFT JOIN "Team" t ON t."groupId" = g."id"
      WHERE c."trashedAt" IS NULL AND c."isTest" = 0${scope !== false ? ' AND c."trialSessionId" IS ?' : ""}${req.user?.role === "admin" ? ' AND c."isPractice" = 0' : ""}${ownerId ? ' AND g."createdById" = ?' : ""}
      GROUP BY g."contestId"`,
    )
    .bind(...(scope !== false ? [scope] : []), ...(ownerId ? [ownerId] : []))
    .all<{ contestId: string; groups: number; students: number }>();

  const ids = results.map((row) => row.contestId);
  const [contests, favoriteId] = await Promise.all([
    ids.length
      ? prisma.contest.findMany({
          where: { id: { in: ids } },
          select: {
            id: true,
            ...groupContestSelect.contest.select,
          },
        })
      : Promise.resolve([]),
    favoriteContestId(),
  ]);
  const byId = new Map(contests.map((contest) => [contest.id, contest]));

  res.json(
    results.flatMap((row) => {
      const contest = byId.get(row.contestId);
      if (!contest) return [];
      return [
        {
          id: contest.id,
          title: contest.title,
          state: computeContestState(contest).state,
          createdAt: contest.createdAt.toISOString(),
          isFavorite: contest.id === favoriteId,
          groups: Number(row.groups),
          students: Number(row.students),
        },
      ];
    }),
  );
});

app.get("/api/groups/:id", async (req, res) => {
  await trialTouch(req, `group:${req.params.id}`);
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

async function loadGroupResults(
  groupId: string,
  user: AuthUser | undefined,
) {
  const owner = await prisma.contestGroup.findUnique({
    where: { id: groupId },
    select: { createdById: true, contestId: true },
  });

  if (!owner || (user?.role === "maestro" && owner.createdById !== user.id)) {
    return null;
  }

  await releaseDueResults(owner.contestId);

  const group = await prisma.contestGroup.findUniqueOrThrow({
    where: { id: groupId },
    include: {
      contest: {
        include: {
          tasks: {
            orderBy: { position: "asc" },
            include: {
              taskDraft: { select: { title: true, answerType: true } },
            },
          },
        },
      },
      teams: {
        orderBy: { createdAt: "asc" },
        include: {
          attempt: {
            include: {
              result: true,
              answers: {
                select: { taskDraftId: true, isCorrect: true, answeredAt: true },
              },
            },
          },
        },
      },
    },
  });
  const contest = group.contest;
  const { state } = computeContestState(contest);
  const paper = paperWindow(contest, user);
  const paperBlocked = paperBlockedReason(
    contest.tasks.map((task) => task.taskDraft.answerType),
  );
  if (paperBlocked) {
    paper.canPrint = false;
    paper.entryOpen = false;
  }
  // Durante la rendición el maestro solo ve el avance; los aciertos, cuando cierra.
  const showScores = contest.isPractice || contestHasEnded(state);
  const categories = groupCategories(group);

  const teams = group.teams.map((team) => {
    const category = teamCategory(team.grade, contestCategories(contest));
    const tasks = tasksOfCategory(contest.tasks, category);
    const attempt = team.attempt;
    const answers = new Map(
      (attempt?.answers ?? []).map((answer) => [answer.taskDraftId, answer]),
    );
    const finished = attempt?.status === "finished";
    const scored = showScores && finished;

    return {
      ...serializeTeam(team),
      category,
      progress: finished
        ? "finished"
        : attempt?.startedAt
          ? "in_progress"
          : "not_started",
      paper: attempt?.mode === "paper",
      startedAt: attempt?.startedAt?.toISOString() ?? null,
      finishedAt: attempt?.finishedAt?.toISOString() ?? null,
      taskCount: tasks.length,
      answeredCount: tasks.filter((task) =>
        Boolean(answers.get(task.taskDraftId)?.answeredAt),
      ).length,
      score: scored ? (attempt?.result?.totalScore ?? null) : null,
      maxScore: scored
        ? initialScoreOf(tasks) +
          tasks.reduce((total, task) => total + task.maxScore, 0)
        : null,
      correctCount: scored ? (attempt?.result?.correctCount ?? null) : null,
      rank:
        scored && contest.resultsPublishedAt
          ? (attempt?.result?.rankPosition ?? null)
          : null,
      answers: scored
        ? tasks.map((task) => {
            const answer = answers.get(task.taskDraftId);
            return !answer?.answeredAt
              ? "blank"
              : answer.isCorrect
                ? "correct"
                : "wrong";
          })
        : null,
    };
  });

  const tasks = showScores
    ? contest.tasks
        .filter((task) => categories.includes(task.category))
        .map((task) => {
          const takers = teams.filter(
            (team) =>
              team.category === task.category && team.progress === "finished",
          );
          const index = tasksOfCategory(contest.tasks, task.category).indexOf(
            task,
          );
          return {
            id: task.taskDraftId,
            title: task.taskDraft.title,
            category: task.category,
            difficulty: task.difficulty,
            takers: takers.length,
            correct: takers.filter((team) => team.answers?.[index] === "correct")
              .length,
            wrong: takers.filter((team) => team.answers?.[index] === "wrong")
              .length,
          };
        })
    : [];

  return {
    group: {
      id: group.id,
      name: group.name,
      accessCode: group.accessCode,
      category: group.category,
      grade: group.grade,
    },
    contest: {
      id: contest.id,
      title: contest.title,
      state,
      isPractice: contest.isPractice,
      startsAt: contest.startsAt?.toISOString() ?? null,
      endsAt: contest.endsAt?.toISOString() ?? null,
      resultsPublished: Boolean(contest.resultsPublishedAt),
      registrationOpen: contestRegistrationIsOpen(contest),
      canEnroll: groupCategories(group).length > 0 && (user?.role === "admin" || contestRegistrationIsOpen(contest)),
      paperEntryOpen: paper.entryOpen,
      paperEntryUntil: paper.entryUntil?.toISOString() ?? null,
      printFrom: paper.printFrom?.toISOString() ?? null,
      canPrint: paper.canPrint,
      paperBlocked,
    },
    categories,
    showScores,
    teams,
    tasks,
  };
}

app.get("/api/groups/:id/results", async (req, res) => {
  const results = await loadGroupResults(req.params.id, req.user);

  if (!results) {
    res.status(404).json({ message: "Grupo no encontrado." });
    return;
  }

  res.json(results);
});

const PROGRESS_LABELS = {
  not_started: "No empezó",
  in_progress: "Rindiendo",
  finished: "Terminó",
} as const;

const DIFFICULTY_LABELS: Record<string, string> = {
  easy: "Fácil",
  medium: "Medio",
  hard: "Difícil",
};

function excelKit() {
  const thin = { style: "thin" as const, color: { argb: "FFBFBFBF" } };
  const CELL_BORDER: Partial<ExcelJS.Borders> = {
    top: thin,
    left: thin,
    bottom: thin,
    right: thin,
  };
  const fill = (argb: string): ExcelJS.Fill => ({
    type: "pattern",
    pattern: "solid",
    fgColor: { argb },
  });
  const ANSWER_CELLS = {
    correct: { text: "✓", fill: fill("FFD6F0DA"), color: "FF1E7B34" },
    wrong: { text: "✗", fill: fill("FFFADAD7"), color: "FFB3261E" },
    blank: { text: "—", fill: fill("FFEFEFEF"), color: "FF7F7F7F" },
  };

  const writeBanner = (
    sheet: ExcelJS.Worksheet,
    width: number,
    lines: string[],
  ) => {
    const fonts: Partial<ExcelJS.Font>[] = [
      { bold: true, size: 18, color: { argb: "FFE34234" } },
      { bold: true, size: 11 },
      { size: 10, color: { argb: "FF595959" } },
    ];
    lines.forEach((value, index) => {
      const rowNumber = index + 1;
      sheet.mergeCells(rowNumber, 1, rowNumber, width);
      const cell = sheet.getCell(rowNumber, 1);
      cell.value = value;
      cell.font = fonts[index];
      cell.alignment = { vertical: "middle", wrapText: true };
      sheet.getRow(rowNumber).height = index === 0 ? 30 : 20;
    });
  };

  const writeHeader = (
    sheet: ExcelJS.Worksheet,
    rowNumber: number,
    headers: string[],
  ) => {
    const row = sheet.getRow(rowNumber);
    row.values = headers;
    row.height = 22;
    headers.forEach((_, index) => {
      const cell = row.getCell(index + 1);
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = fill("FF1F1F1F");
      cell.alignment = { vertical: "middle", horizontal: "center" };
      cell.border = CELL_BORDER;
    });
    row.getCell(2).alignment = { vertical: "middle", indent: 1 };
    sheet.views = [{ state: "frozen", ySplit: rowNumber, xSplit: 2 }];
  };

  const writeRow = (
    sheet: ExcelJS.Worksheet,
    rowNumber: number,
    values: ExcelJS.CellValue[],
    width: number,
    leftColumns: number[] = [1],
  ) => {
    const row = sheet.getRow(rowNumber);
    row.values = values;
    row.height = 20;
    for (let column = 0; column < width; column += 1) {
      const cell = row.getCell(column + 1);
      const left = leftColumns.includes(column);
      cell.border = CELL_BORDER;
      cell.alignment = {
        vertical: "middle",
        horizontal: left ? "left" : "center",
        indent: left ? 1 : 0,
      };
    }
    return row;
  };

  return { CELL_BORDER, fill, ANSWER_CELLS, writeBanner, writeHeader, writeRow };
}

async function sendWorkbook(
  res: express.Response,
  workbook: ExcelJS.Workbook,
  filename: string,
) {
  const buffer = await workbook.xlsx.writeBuffer();
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${filename.replace(/[^\w.-]+/g, "-")}"`,
  );
  res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
  res.end(Buffer.from(buffer as unknown as ArrayBuffer));
}

function excelFileName(text: string) {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\w-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

app.get("/api/groups/:id/results.xlsx", async (req, res) => {
  await trialTouch(req, "results-excel");
  const results = await loadGroupResults(req.params.id, req.user);

  if (!results) {
    res.status(404).json({ message: "Grupo no encontrado." });
    return;
  }

  const { group, contest, showScores } = results;
  const withRank = showScores && contest.resultsPublished;
  const { CELL_BORDER, fill, ANSWER_CELLS, writeBanner, writeHeader } =
    excelKit();

  const workbook = new ExcelJS.Workbook();
  const categories = results.categories.filter((category) =>
    results.teams.some((team) => team.category === category),
  );
  const sheets = categories.length > 0 ? categories : [null];

  for (const category of sheets) {
    const teams = results.teams
      .filter((team) => category === null || team.category === category)
      .sort((a, b) => {
        if (showScores) return (b.score ?? -Infinity) - (a.score ?? -Infinity);
        const order: Record<string, number> = {
          in_progress: 0,
          finished: 1,
          not_started: 2,
        };
        return order[a.progress] - order[b.progress];
      });
    const tasks = results.tasks.filter(
      (task) => category === null || task.category === category,
    );
    const headers = [
      "N.º",
      "Estudiante",
      "Código personal",
      "Curso",
      "Estado",
      "Respondidas",
      ...(showScores ? ["Puntaje", "Correctas"] : []),
      ...(withRank ? ["Lugar"] : []),
      ...tasks.map((_, index) => `P${index + 1}`),
    ];
    const widths = [6, 34, 16, 18, 12, 13, 10, 11, 8];
    const fixed = headers.length - tasks.length;

    const sheet = workbook.addWorksheet(category ?? "Resultados", {
      pageSetup: {
        orientation: "landscape",
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
      },
    });
    sheet.columns = headers.map((_, index) => ({
      width: index < fixed ? widths[index] : 5,
    }));

    writeBanner(sheet, Math.max(headers.length, 6), [
      "Resultados del grupo",
      [
        `Grupo ${group.name}`,
        contest.title,
        category ? `Categoría ${category}` : null,
        `Código ${group.accessCode}`,
      ]
        .filter(Boolean)
        .join("   ·   "),
      showScores
        ? "Las columnas P1, P2… son las preguntas en el orden del desafío: ✓ correcta, ✗ incorrecta, — sin responder."
        : "Los puntajes aparecen cuando termine la rendición.",
    ]);

    const HEADER_ROW = 5;
    writeHeader(sheet, HEADER_ROW, headers);
    tasks.forEach((task, index) => {
      sheet.getRow(HEADER_ROW).getCell(fixed + index + 1).note = task.title;
    });

    teams.forEach((team, index) => {
      const row = sheet.getRow(HEADER_ROW + 1 + index);
      const name = [
        `${team.memberOneFirstName} ${team.memberOneLastName}`.trim(),
        team.participationMode === "pareja" && team.memberTwoFirstName
          ? `${team.memberTwoFirstName} ${team.memberTwoLastName ?? ""}`.trim()
          : null,
      ]
        .filter(Boolean)
        .join(" y ");
      row.values = [
        index + 1,
        name,
        team.personalCode ?? "",
        SCHOOL_GRADES.find((grade) => grade.value === team.grade)?.label ?? "",
        team.paper
          ? "En papel"
          : PROGRESS_LABELS[team.progress as keyof typeof PROGRESS_LABELS],
        team.answeredCount,
        ...(showScores ? [team.score ?? "", team.correctCount ?? ""] : []),
        ...(withRank ? [team.rank ?? ""] : []),
      ];
      row.height = 20;
      headers.forEach((_, column) => {
        const cell = row.getCell(column + 1);
        cell.border = CELL_BORDER;
        cell.alignment = {
          vertical: "middle",
          horizontal: column === 1 ? "left" : "center",
          indent: column === 1 ? 1 : 0,
        };
      });
      team.answers?.forEach((answer, taskIndex) => {
        const style = ANSWER_CELLS[answer as keyof typeof ANSWER_CELLS];
        const cell = row.getCell(fixed + taskIndex + 1);
        cell.value = style.text;
        cell.fill = style.fill;
        cell.font = { bold: true, color: { argb: style.color } };
      });
    });

    if (teams.length > 0) {
      sheet.autoFilter = {
        from: { row: HEADER_ROW, column: 1 },
        to: { row: HEADER_ROW + teams.length, column: fixed },
      };
    }
  }

  if (showScores && results.tasks.length > 0) {
    const multiple = categories.length > 1;
    const headers = [
      "N.º",
      "Pregunta",
      ...(multiple ? ["Categoría"] : []),
      "Dificultad",
      "Rindieron",
      "Correctas",
      "Incorrectas",
      "Sin responder",
      "% de acierto",
    ];
    const sheet = workbook.addWorksheet("Preguntas", {
      pageSetup: {
        orientation: "landscape",
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
      },
    });
    sheet.columns = headers.map((header) => ({
      width: header === "Pregunta" ? 40 : header === "N.º" ? 6 : 14,
    }));
    writeBanner(sheet, headers.length, [
      "Preguntas",
      `Grupo ${group.name}   ·   ${contest.title}`,
      "Cuántos estudiantes del grupo respondieron bien cada pregunta.",
    ]);
    const HEADER_ROW = 5;
    writeHeader(sheet, HEADER_ROW, headers);

    const numbers = new Map<string, number>();
    results.tasks.forEach((task, index) => {
      const number = (numbers.get(task.category) ?? 0) + 1;
      numbers.set(task.category, number);
      const row = sheet.getRow(HEADER_ROW + 1 + index);
      row.values = [
        `P${number}`,
        task.title,
        ...(multiple ? [task.category] : []),
        DIFFICULTY_LABELS[task.difficulty] ?? task.difficulty,
        task.takers,
        task.correct,
        task.wrong,
        task.takers - task.correct - task.wrong,
        task.takers > 0 ? task.correct / task.takers : "",
      ];
      row.height = 20;
      headers.forEach((_, column) => {
        const cell = row.getCell(column + 1);
        cell.border = CELL_BORDER;
        cell.alignment = {
          vertical: "middle",
          horizontal: column === 1 ? "left" : "center",
          indent: column === 1 ? 1 : 0,
          wrapText: column === 1,
        };
      });
      row.getCell(headers.length).numFmt = "0%";
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="resultados-${group.accessCode}.xlsx"`,
  );
  res.end(Buffer.from(buffer as unknown as ArrayBuffer));
});

function courseKey(
  ownerId: number,
  contestId: string,
  grade: string,
  schoolId: string | null,
) {
  return `${ownerId}:${contestId}:${grade}${schoolId ? `:${schoolId}` : ""}`;
}

function courseGroupInsert(
  contestId: string,
  grade: (typeof SCHOOL_GRADES)[number],
  ownerId: number,
  accessCode: string,
  stamp: string,
  schoolId: string | null = null,
) {
  return db().prepare(`INSERT INTO "ContestGroup"
    ("id", "contestId", "createdById", "name", "category", "grade", "autoKey",
     "schoolId", "accessCode", "recoveryCode", "createdAt", "updatedAt")
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM "Contest" c
    WHERE c."id" = ? AND c."trashedAt" IS NULL
      AND EXISTS (SELECT 1 FROM json_each(c."categories") WHERE value = ?)
    ON CONFLICT("autoKey") DO NOTHING`)
    .bind(
      randomUUID(), contestId, ownerId, grade.label, grade.category, grade.value,
      courseKey(ownerId, contestId, grade.value, schoolId), schoolId, accessCode,
      generateCode(10), stamp, stamp, contestId, grade.category,
    );
}

async function ensureCourseGroup(
  contestId: string,
  grade: (typeof SCHOOL_GRADES)[number],
  ownerId: number,
  schoolId: string | null = null,
) {
  const autoKey = courseKey(ownerId, contestId, grade.value, schoolId);
  const existing = await prisma.contestGroup.findUnique({ where: { autoKey } });
  if (existing) return existing;
  await courseGroupInsert(contestId, grade, ownerId, await generateUniqueAccessCode(), currentDate().toISOString(), schoolId).run();
  return prisma.contestGroup.findUniqueOrThrow({ where: { autoKey } });
}

async function requestedSchool(req: express.Request, raw: unknown) {
  if (req.user?.role !== "maestro" || typeof raw !== "string" || !raw) {
    return { schoolId: null };
  }
  const school = await prisma.teacherSchool.findFirst({
    where: { id: raw, userId: req.user.id, status: "approved" },
    select: { id: true },
  });
  return school ? { schoolId: school.id } : null;
}

app.post("/api/groups/courses", async (req, res) => {
  const contestId = typeof req.body?.contestId === "string" ? req.body.contestId : "";
  const contest = await prisma.contest.findUnique({ where: { id: contestId } });
  if (!contest || contest.trashedAt || (!contest.publishedAt && req.user?.role !== "admin")) {
    res.status(404).json({ message: "Desafío no encontrado." });
    return;
  }
  if (contest.isPractice && req.user?.role === "maestro" && contest.createdById !== req.user.id) {
    res.status(404).json({ message: "Desafío no encontrado." });
    return;
  }
  if (req.user?.role !== "admin" && !contestRegistrationIsOpen(contest)) {
    res.status(409).json({ message: registrationWindowMessage(contest) });
    return;
  }
  const chosen = await requestedSchool(req, req.body?.schoolId);
  if (!chosen) {
    res.status(404).json({ message: "Colegio no encontrado." });
    return;
  }
  const { schoolId } = chosen;
  const grades = gradesForCategories(contestCategories(contest));
  const ownerId = req.user!.id;
  const existing = await prisma.contestGroup.findMany({
    where: { contestId, createdById: ownerId, autoKey: { not: null } },
    select: { autoKey: true },
  });
  const keys = new Set(existing.map((group) => group.autoKey));
  const missing = grades.filter(
    (grade) => !keys.has(courseKey(ownerId, contestId, grade.value, schoolId)),
  );
  const reserved = new Set<string>();
  const inserts: D1PreparedStatement[] = [];
  const stamp = currentDate().toISOString();
  for (const grade of missing) {
    let code = await generateUniqueAccessCode();
    while (reserved.has(code)) code = await generateUniqueAccessCode();
    reserved.add(code);
    inserts.push(courseGroupInsert(contestId, grade, ownerId, code, stamp, schoolId));
  }
  if (inserts.length) await db().batch(inserts);
  const groups = await prisma.contestGroup.findMany({
    where: { contestId, createdById: ownerId, schoolId, autoKey: { not: null }, grade: { in: grades.map((grade) => grade.value) } },
    include: { ...groupContestSelect, teams: true },
  });
  res.json(groups.map(serializeGroup));
});

app.post("/api/groups/course", async (req, res) => {
  const contestId = typeof req.body?.contestId === "string" ? req.body.contestId : "";
  const contest = await prisma.contest.findUnique({ where: { id: contestId } });
  if (!contest || contest.trashedAt || (!contest.publishedAt && req.user?.role !== "admin")) {
    res.status(400).json({ message: "El desafío debe estar publicado." });
    return;
  }
  if (contest.isPractice && req.user?.role === "maestro" && contest.createdById !== req.user.id) {
    res.status(404).json({ message: "Desafío no encontrado." });
    return;
  }
  if (req.user?.role !== "admin" && !contestRegistrationIsOpen(contest)) {
    res.status(409).json({ message: registrationWindowMessage(contest) });
    return;
  }
  let grade: string;
  try {
    grade = parseGrade(req.body?.grade, contestCategories(contest));
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : "Curso inválido." });
    return;
  }
  const chosen = await requestedSchool(req, req.body?.schoolId);
  if (!chosen) {
    res.status(404).json({ message: "Colegio no encontrado." });
    return;
  }
  const course = SCHOOL_GRADES.find((item) => item.value === grade)!;
  const courseGroup = await ensureCourseGroup(contest.id, course, req.user!.id, chosen.schoolId);
  const group = await prisma.contestGroup.findUniqueOrThrow({
    where: { id: courseGroup.id },
    include: { ...groupContestSelect, teams: true },
  });
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

  if (contest.trashedAt || (!contest.publishedAt && req.user?.role !== "admin")) {
    res.status(400).json({
      message: "El desafío debe estar publicado para crear grupos.",
      code: "GROUP_CONTEST_UNPUBLISHED",
      field: "contestId",
    });
    return;
  }
  if (contest.isPractice && req.user?.role === "maestro" && contest.createdById !== req.user.id) {
    res.status(404).json({ message: "Desafío no encontrado." });
    return;
  }

  if (req.user?.role !== "admin" && !contestRegistrationIsOpen(contest)) {
    res.status(409).json({ message: registrationWindowMessage(contest) });
    return;
  }

  if (
    req.user?.role !== "admin" &&
    contestHasEnded(computeContestState(contest).state)
  ) {
    res.status(409).json({
      message: "El desafío ya cerró; no es posible crear grupos.",
      code: "GROUP_CONTEST_CLOSED",
      field: "contestId",
    });
    return;
  }

  const categories = contestCategories(contest);
  let course: (typeof SCHOOL_GRADES)[number] | undefined;
  if (req.body?.grade) {
    try {
      const grade = parseGrade(req.body.grade, categories);
      course = SCHOOL_GRADES.find((item) => item.value === grade);
    } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : "Curso inválido.", field: "grade" });
      return;
    }
  }
  const requestedCategory =
    typeof req.body?.category === "string" ? req.body.category.trim() : "";
  const category =
    course?.category || requestedCategory || (categories.length === 1 ? categories[0] : "");

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
      grade: course?.value ?? null,
      accessCode,
      recoveryCode,
      createdById: req.user?.id ?? null,
    },
    include: { ...groupContestSelect, teams: true },
  });

  res.status(201).json(serializeGroup(group));
});

app.patch("/api/groups/:id", async (req, res) => {
  const group = await prisma.contestGroup.findUnique({
    where: { id: req.params.id },
    select: { createdById: true },
  });

  if (
    !group ||
    (req.user?.role === "maestro" && group.createdById !== req.user.id)
  ) {
    res.status(404).json({ message: "Grupo no encontrado." });
    return;
  }

  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";

  if (!name) {
    res.status(400).json({
      message: "Ponle un nombre al grupo.",
      code: "GROUP_NAME_REQUIRED",
      field: "name",
    });
    return;
  }

  if (name.length > 80) {
    res.status(400).json({
      message: "El nombre es muy largo: usa 80 caracteres o menos.",
      code: "GROUP_NAME_TOO_LONG",
      field: "name",
    });
    return;
  }

  const updated = await prisma.contestGroup.update({
    where: { id: req.params.id },
    data: { name },
    include: { ...groupContestSelect, teams: true },
  });

  res.json(serializeGroup(updated));
});

app.delete("/api/groups/:id", async (req, res) => {
  const group = await prisma.contestGroup.findUnique({
    where: { id: req.params.id },
    select: {
      createdById: true,
      contest: true,
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

  if (!contestRegistrationIsOpen(group.contest)) {
    res.status(409).json({
      message: "La inscripción ya cerró: el grupo no se puede eliminar.",
      code: "GROUP_REGISTRATION_CLOSED",
    });
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
      group: { select: { createdById: true, contest: true } },
    },
  });

  if (
    !team ||
    (req.user?.role === "maestro" && team.group.createdById !== req.user.id)
  ) {
    res.status(404).json({ message: "Participante no encontrado." });
    return;
  }

  if (!contestRegistrationIsOpen(team.group.contest)) {
    res.status(409).json({
      message: "La inscripción ya cerró: no se puede quitar a nadie.",
      code: "TEAM_REGISTRATION_CLOSED",
    });
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
    include: {
      group: { include: { contest: true } },
      attempt: { select: { startedAt: true } },
    },
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
    grade = parseGroupGrade(req.body?.grade, team.group);
  } catch (error) {
    res.status(400).json({
      message: error instanceof Error ? error.message : "Curso inválido.",
      code: "TEAM_GRADE_INVALID",
      field: "grade",
    });
    return;
  }

  if (team.attempt?.startedAt && grade !== team.grade) {
    res.status(409).json({
      message:
        "El estudiante ya empezó a rendir: su curso ya no se puede cambiar.",
      code: "TEAM_GRADE_LOCKED",
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

  const takenKeys = await groupNameKeys(team.groupId, team.id);

  if (takenKeys.has(keyOne)) {
    res.status(409).json({
      message: `${formatName(oneFirst)} ${formatName(oneLast)} ya está en este grupo.`,
      code: "TEAM_MEMBER_DUPLICATE",
      fields: ["memberOneFirstName", "memberOneLastName"],
    });
    return;
  }

  if (isPareja && takenKeys.has(keyTwo)) {
    res.status(409).json({
      message: `${formatName(twoFirst)} ${formatName(twoLast)} ya está en este grupo.`,
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

// ---- Prueba en papel: cuadernillo, hojas de respuestas y carga del maestro ----

/** Con cuánta anticipación se imprime la prueba: hay que fotocopiarla. */
const PAPER_PRINT_LEAD_MS = 48 * 60 * 60 * 1000;

function paperWindow(
  contest: {
    isPractice: boolean;
    startsAt: Date | null;
    endsAt: Date | null;
    resultsAt: Date | null;
    resultsPublishedAt: Date | null;
    resultsReleasedAt: Date | null;
  },
  user: AuthUser | undefined,
) {
  const now = currentDate();
  const printFrom = contest.startsAt
    ? new Date(contest.startsAt.getTime() - PAPER_PRINT_LEAD_MS)
    : null;
  // Se cargan hasta que se calculan los resultados (la misma hora que usa
  // releaseDueResults).
  const entryUntil =
    contest.resultsAt && contest.endsAt && contest.resultsAt > contest.endsAt
      ? contest.resultsAt
      : contest.endsAt;
  return {
    printFrom,
    canPrint:
      contest.isPractice ||
      user?.role === "admin" ||
      Boolean(printFrom && now >= printFrom),
    entryOpen:
      !contest.isPractice &&
      Boolean(contest.startsAt && now >= contest.startsAt) &&
      !contest.resultsPublishedAt &&
      !contest.resultsReleasedAt,
    entryUntil,
  };
}

async function contestPaperBlocked(contestId: string) {
  const tasks = await prisma.contestTask.findMany({
    where: { contestId },
    select: { taskDraft: { select: { answerType: true } } },
  });
  return paperBlockedReason(tasks.map((task) => task.taskDraft.answerType));
}

/** El departamento del colegio del maestro, para el castor de la portada. */
async function teacherDepartment(userId: number | null) {
  if (!userId) return null;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      schoolCodUe: true,
      department: true,
      schools: { select: { schoolCodUe: true } },
    },
  });
  if (!user) return null;
  const codes = [
    ...new Set(
      [user.schoolCodUe, ...user.schools.map((school) => school.schoolCodUe)]
        .filter((code): code is string => Boolean(code)),
    ),
  ].slice(0, 50);
  const schools = codes.length
    ? await prisma.school.findMany({
        where: { codUe: { in: codes } },
        select: { dep: true },
      })
    : [];
  const departments = new Set(
    [...schools.map((school) => school.dep), user.department ?? ""]
      .map((name) =>
        name
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .trim()
          .toUpperCase(),
      )
      .filter(Boolean),
  );
  // Con colegios en varios departamentos no hay uno que elegir.
  return departments.size === 1 ? [...departments][0] : null;
}

app.get("/api/groups/:id/paper", async (req, res) => {
  const owner = await prisma.contestGroup.findUnique({
    where: { id: req.params.id },
    select: { createdById: true, contestId: true },
  });

  if (
    !owner ||
    (req.user?.role === "maestro" && owner.createdById !== req.user.id)
  ) {
    res.status(404).json({ message: "Grupo no encontrado." });
    return;
  }

  await releaseDueResults(owner.contestId);

  const group = await prisma.contestGroup.findUniqueOrThrow({
    where: { id: req.params.id },
    include: {
      contest: true,
      teams: { include: { attempt: { select: { status: true, mode: true } } } },
    },
  });
  const contest = group.contest;
  const window = paperWindow(contest, req.user);
  const paperBlocked = await contestPaperBlocked(contest.id);
  if (paperBlocked) {
    window.canPrint = false;
    window.entryOpen = false;
  }
  const teams = [...group.teams].sort(
    (left, right) =>
      left.createdAt.getTime() - right.createdAt.getTime() ||
      left.id.localeCompare(right.id),
  );
  const allCategories = contestCategories(contest);
  const contestTasks = window.canPrint ? await contestTasksFor(contest) : [];

  res.json({
    group: { id: group.id, name: group.name, accessCode: group.accessCode },
    contest: {
      id: contest.id,
      title: contest.title,
      durationMinutes: contest.durationMinutes,
      startsAt: contest.startsAt?.toISOString() ?? null,
      endsAt: contest.endsAt?.toISOString() ?? null,
    },
    paperBlocked,
    department: await teacherDepartment(group.createdById),
    printFrom: window.printFrom?.toISOString() ?? null,
    canPrint: window.canPrint,
    entryOpen: window.entryOpen,
    entryUntil: window.entryUntil?.toISOString() ?? null,
    categories: groupCategories(group).map((category) => {
      const tasks = tasksOfCategory(contestTasks, category);
      return {
        name: category,
        rules: contestRules(tasks),
        tasks: tasks.map((contestTask) => ({
          ...renderSafeTask(contestTask, contestTask.play),
          difficulty: contestTask.difficulty,
          maxScore: contestTask.maxScore,
          minScore: contestTask.minScore,
        })),
      };
    }),
    teams: teams.map((team) => ({
      ...serializeTeam(team),
      category: teamCategory(team.grade, allCategories),
      status: team.attempt?.status ?? "pending",
      mode: team.attempt?.mode ?? "online",
    })),
  });
});

async function loadPaperTeam(teamId: string, user: AuthUser | undefined) {
  const find = () =>
    prisma.team.findUnique({
      where: { id: teamId },
      include: { attempt: true, group: { include: { contest: true } } },
    });
  const team = await find();
  if (
    !team ||
    (user?.role === "maestro" && team.group.createdById !== user.id)
  ) {
    return null;
  }
  return (await releaseDueResults(team.group.contestId)) ? find() : team;
}

function paperEntryClosedMessage(window: ReturnType<typeof paperWindow>) {
  return window.entryUntil && window.entryUntil < currentDate()
    ? "Los resultados ya se calcularon: ya no se pueden cargar respuestas."
    : "Las respuestas en papel se cargan desde que empieza la prueba.";
}

app.get("/api/teams/:id/paper", async (req, res) => {
  const team = await loadPaperTeam(req.params.id, req.user);

  if (!team) {
    res.status(404).json({ message: "Participante no encontrado." });
    return;
  }

  const answers: Record<string, unknown> = {};
  if (team.attempt?.mode === "paper") {
    const saved = await prisma.attemptAnswer.findMany({
      where: { attemptId: team.attempt.id },
      select: { taskDraftId: true, responsePayload: true },
    });
    for (const answer of saved) {
      answers[answer.taskDraftId] = parseJsonValue<unknown>(
        answer.responsePayload,
        null,
      );
    }
  }

  res.json({
    status: team.attempt?.status ?? "pending",
    mode: team.attempt?.mode ?? "online",
    savedAt:
      team.attempt?.mode === "paper"
        ? (team.attempt.finishedAt?.toISOString() ?? null)
        : null,
    answers,
  });
});

app.put("/api/teams/:id/paper", async (req, res) => {
  const team = await loadPaperTeam(req.params.id, req.user);

  if (!team || !team.attempt) {
    res.status(404).json({ message: "Participante no encontrado." });
    return;
  }

  const contest = team.group.contest;
  const window = paperWindow(contest, req.user);
  const attempt = team.attempt;

  if (!window.entryOpen) {
    res.status(409).json({ message: paperEntryClosedMessage(window) });
    return;
  }

  const paperBlocked = await contestPaperBlocked(contest.id);
  if (paperBlocked) {
    res.status(409).json({ message: paperBlocked });
    return;
  }

  if (attempt.mode !== "paper" && attempt.status !== "pending") {
    res.status(409).json({
      message:
        "Este estudiante rindió en línea: sus respuestas ya están en el sistema.",
    });
    return;
  }

  const category = teamCategory(team.grade, contestCategories(contest));
  const tasks = tasksOfCategory(await contestTasksFor(contest), category);

  if (tasks.length === 0) {
    res.status(409).json({
      message: "El desafío no tiene preguntas para el curso de este estudiante.",
    });
    return;
  }

  const input = req.body?.answers;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    res.status(400).json({ message: "Faltan las respuestas." });
    return;
  }

  const rows = [];
  for (const [index, task] of tasks.entries()) {
    const payload = (input as Record<string, unknown>)[task.taskDraftId];
    if (payload === undefined || payload === null) continue;
    const error = validateTaskAnswer(task.play, payload);
    if (error) {
      res.status(400).json({
        message: `Pregunta ${index + 1}: ${error}`,
        field: task.taskDraftId,
      });
      return;
    }
    const graded = gradeAnswer(task, task.play, payload);
    if (graded.answered) rows.push({ task, payload, graded });
  }

  const now = currentDate();
  // Condicionado: si el estudiante acaba de empezar en línea, vale su intento.
  const claimed = await prisma.attempt.updateMany({
    where: {
      id: attempt.id,
      OR: [{ status: "pending" }, { mode: "paper" }],
    },
    data: {
      status: "in_progress",
      mode: "paper",
      startedAt: now,
      endsAt: null,
      finishedAt: null,
    },
  });

  if (!claimed.count) {
    res.status(409).json({
      message: "Este estudiante empezó a rendir en línea.",
    });
    return;
  }

  const stamp = now.toISOString();
  await db().batch([
    db()
      .prepare('DELETE FROM "AttemptAnswer" WHERE "attemptId" = ?')
      .bind(attempt.id),
    ...rows.map(({ task, payload, graded }) =>
      db()
        .prepare(
          `INSERT INTO "AttemptAnswer"
            ("id", "attemptId", "taskDraftId", "responsePayload", "isCorrect", "score", "answeredAt", "createdAt", "updatedAt")
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          randomUUID(),
          attempt.id,
          task.taskDraftId,
          JSON.stringify(payload),
          graded.isCorrect === null ? null : Number(graded.isCorrect),
          graded.score,
          stamp,
          stamp,
          stamp,
        ),
    ),
  ]);
  await finalizeAttempt(attempt.id);

  res.json({ answeredCount: rows.length, taskCount: tasks.length });
});

app.delete("/api/teams/:id/paper", async (req, res) => {
  const team = await loadPaperTeam(req.params.id, req.user);

  if (!team || !team.attempt) {
    res.status(404).json({ message: "Participante no encontrado." });
    return;
  }

  const window = paperWindow(team.group.contest, req.user);

  if (!window.entryOpen) {
    res.status(409).json({ message: paperEntryClosedMessage(window) });
    return;
  }

  if (team.attempt.mode !== "paper") {
    res
      .status(409)
      .json({ message: "Este estudiante no tiene respuestas en papel." });
    return;
  }

  const attemptId = team.attempt.id;
  await db().batch([
    db()
      .prepare('DELETE FROM "AttemptAnswer" WHERE "attemptId" = ?')
      .bind(attemptId),
    db().prepare('DELETE FROM "Result" WHERE "attemptId" = ?').bind(attemptId),
    db()
      .prepare(
        `UPDATE "Attempt" SET "status" = 'pending', "mode" = 'online',
          "startedAt" = NULL, "endsAt" = NULL, "finishedAt" = NULL, "updatedAt" = ?
        WHERE "id" = ? AND "mode" = 'paper'`,
      )
      .bind(currentDate().toISOString(), attemptId),
  ]);
  if (team.group.contest.consolidatedAt) {
    await recomputeRanking(team.group.contestId);
  }

  res.status(204).send();
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

  const grades = group.grade && group.createdById !== null
    ? gradesForCategories(contestCategories(group.contest))
    : gradesForGroup(group);
  const allowPairs = group.contest.allowPairs;
  // Si el desafio es solo individual, las columnas del companero solo podrian
  // provocar errores: la planilla se queda con lo que de verdad hay que llenar.
  const headers = allowPairs ? ROSTER_COLUMNS : ROSTER_COLUMNS.slice(0, 3);
  const widths = allowPairs ? [24, 24, 24, 14, 24, 24] : [30, 30, 26];
  const HEADER_ROW = ROSTER_TEMPLATE_HEADER_ROW;
  const firstRow = HEADER_ROW + 1;
  const lastRow = HEADER_ROW + 60;
  const categories = groupCategories(group);

  const thin = { style: "thin" as const, color: { argb: "FFBFBFBF" } };
  const CELL_BORDER: Partial<ExcelJS.Borders> = {
    top: thin,
    left: thin,
    bottom: thin,
    right: thin,
  };

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Estudiantes", {
    pageSetup: {
      orientation: allowPairs ? "landscape" : "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
  });

  // Las listas viven en una hoja oculta y se referencian por rango: escritas
  // dentro de la formula el formato las limita a 255 caracteres y Excel las
  // descarta sin avisar. El importador acepta el codigo (P3) o la etiqueta
  // (3.º de primaria); se ofrece la etiqueta porque es la que el maestro lee.
  const data = workbook.addWorksheet("Datos", { state: "veryHidden" });
  grades.forEach((grade, index) => {
    data.getCell(`A${index + 1}`).value = grade.label;
  });
  if (allowPairs) {
    data.getCell("B1").value = "individual";
    data.getCell("B2").value = "pareja";
  }

  sheet.columns = headers.map((_, index) => ({ width: widths[index] }));

  const banner = (
    rowNumber: number,
    value: string,
    font: Partial<ExcelJS.Font>,
    height?: number,
  ) => {
    sheet.mergeCells(rowNumber, 1, rowNumber, headers.length);
    const cell = sheet.getCell(rowNumber, 1);
    cell.value = value;
    cell.font = font;
    cell.alignment = { vertical: "middle", wrapText: true };
    if (height) sheet.getRow(rowNumber).height = height;
  };

  banner(1, "Lista de estudiantes", {
    bold: true,
    size: 18,
    color: { argb: "FFE34234" },
  }, 30);
  banner(
    2,
    [
      `Grupo ${group.name}`,
      group.contest.title,
      categories.length === 1
        ? `Categoría ${categories[0]}`
        : `Categorías ${categories.join(", ")}`,
      `Código ${group.accessCode}`,
    ].join("   ·   "),
    { bold: true, size: 11 },
    20,
  );
  banner(
    3,
    [
      "Escribe un estudiante por fila. El curso se elige de la lista: toca la celda y abre la flechita.",
      allowPairs
        ? "Si rinden en pareja, elige «pareja» y llena también las columnas del compañero; si no, déjalas vacías."
        : "",
      "Cuando termines, guarda el archivo y súbelo en la pantalla del grupo, en «súbela llena». Las filas vacías no se leen.",
    ]
      .filter(Boolean)
      .join("\n"),
    { size: 10, color: { argb: "FF595959" } },
    allowPairs ? 44 : 32,
  );

  const header = sheet.getRow(HEADER_ROW);
  header.values = headers;
  header.height = 22;
  headers.forEach((_, index) => {
    const cell = header.getCell(index + 1);
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1F1F1F" },
    };
    cell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    cell.border = CELL_BORDER;
  });
  sheet.views = [{ state: "frozen", ySplit: HEADER_ROW }];

  for (let rowNumber = firstRow; rowNumber <= lastRow; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    row.height = 20;
    headers.forEach((_, index) => {
      const cell = row.getCell(index + 1);
      cell.border = CELL_BORDER;
      cell.alignment = { vertical: "middle", indent: 1 };
      // La columna del curso se ve distinta: se elige, no se escribe.
      if (index === 2 || index === 3) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFFFF4E5" },
        };
      }
    });
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

  validations.add(`C${firstRow}:C${lastRow}`, {
    type: "list",
    allowBlank: true,
    formulae: [`Datos!$A$1:$A$${grades.length}`],
    showInputMessage: true,
    promptTitle: "Curso",
    prompt: "Elige el curso de la lista.",
    showErrorMessage: true,
    errorStyle: "stop",
    errorTitle: "Curso no válido",
    error: `Elige uno de estos: ${grades.map((grade) => grade.label).join(", ")}.`,
  });

  if (allowPairs) {
    validations.add(`D${firstRow}:D${lastRow}`, {
      type: "list",
      allowBlank: true,
      formulae: ["Datos!$B$1:$B$2"],
      showInputMessage: true,
      promptTitle: "Modalidad",
      prompt: "Vacío o «individual» si rinde solo; «pareja» si rinde con un compañero.",
      showErrorMessage: true,
      errorStyle: "stop",
      errorTitle: "Modalidad no válida",
      error: "Elige individual o pareja.",
    });
  }

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

  if (req.user?.role !== "admin" && !contestRegistrationIsOpen(group.contest)) {
    res.status(409).json({ message: registrationWindowMessage(group.contest) });
    return;
  }

  const availableCategories = contestCategories(group.contest);
  if (!groupCategories(group).length) {
    res.status(409).json({ message: "La categoría del grupo no participa en este desafío." });
    return;
  }

  if (
    req.user?.role !== "admin" &&
    contestHasEnded(computeContestState(group.contest).state)
  ) {
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
  const lease = await db().prepare(`INSERT INTO "RosterImportLock" ("contestId", "owner", "acquiredAt")
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
      await db().prepare(
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

    // Modalidad es opcional: vacía, se deduce de si hay datos del compañero.
    const requiredColumns = ROSTER_COLUMNS.slice(0, 3);
    const requiredHeaders = requiredColumns.map(normalizeHeader);
    const candidates: Array<{
      sheet: ExcelJS.Worksheet;
      headerRow: number;
      columns: Map<string, number>;
      duplicateHeaders: string[];
    }> = [];

    // Los títulos pueden no estar en la primera fila: la plantilla pone arriba
    // el nombre del grupo y las instrucciones. La hoja «Ejemplo» de las
    // plantillas antiguas no se importa.
    for (const worksheet of workbook.worksheets) {
      if (normalizeHeader(worksheet.name) === "ejemplo") {
        continue;
      }
      for (let rowNumber = 1; rowNumber <= 10; rowNumber += 1) {
        const columns = new Map<string, number>();
        const duplicateHeaders = new Set<string>();
        worksheet.getRow(rowNumber).eachCell((cell, column) => {
          const header = normalizeHeader(cell.value);
          if (header && columns.has(header)) {
            duplicateHeaders.add(header);
          }
          columns.set(header, column);
        });
        if (requiredHeaders.every((header) => columns.has(header))) {
          candidates.push({
            sheet: worksheet,
            headerRow: rowNumber,
            columns,
            duplicateHeaders: [...duplicateHeaders],
          });
          break;
        }
      }
    }

    if (candidates.length === 0) {
      res.status(400).json({
        message: `La planilla necesita una hoja con ${requiredColumns
          .slice(0, -1)
          .join(", ")} y ${requiredColumns.at(-1)} como títulos de columna.`,
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

    const { sheet, headerRow, columns, duplicateHeaders } = candidates[0];
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

    const distributeByGrade = Boolean(
      group.grade &&
      group.createdById !== null &&
      req.body?.distributeByGrade === "true",
    );
    const destinations = new Map<string, string>();
    if (distributeByGrade) {
      const courseGroups = await prisma.contestGroup.findMany({
        where: {
          contestId: group.contestId,
          createdById: group.createdById,
          schoolId: group.schoolId,
          autoKey: { not: null },
        },
        select: { id: true, grade: true },
      });
      for (const destination of courseGroups) {
        if (destination.grade) destinations.set(destination.grade, destination.id);
      }
      destinations.set(group.grade!, group.id);
    }
    const takenKeysByCourse = new Map<string, Set<string>>();

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

    for (
      let rowNumber = headerRow + 1;
      rowNumber <= sheet.rowCount;
      rowNumber += 1
    ) {
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

      const normalizedMode =
        normalizeHeader(modeText) ||
        (twoFirst || twoLast ? "pareja" : "individual");
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
        grade = gradeFromCell(
          gradeText,
          distributeByGrade ? availableCategories : groupCategories(group).filter((category) => availableCategories.includes(category)),
        );
        if (!distributeByGrade) grade = parseGroupGrade(grade, group);
      } catch (error) {
        addIssue(error instanceof Error ? error.message : "Curso inválido.");
      }

      const courseKey = distributeByGrade ? grade ?? "" : group.id;
      let takenKeys = takenKeysByCourse.get(courseKey);
      if (!takenKeys) {
        const destinationId = distributeByGrade ? destinations.get(courseKey) : group.id;
        takenKeys = destinationId ? await groupNameKeys(destinationId) : new Set<string>();
        takenKeysByCourse.set(courseKey, takenKeys);
      }
      const keyOne = oneFirst && oneLast ? nameKey(oneFirst, oneLast) : "";
      const keyTwo =
        isPair && twoFirst && twoLast ? nameKey(twoFirst, twoLast) : "";
      if (keyOne && keyTwo && keyOne === keyTwo) {
        addIssue("Los dos integrantes son la misma persona.");
      }
      if (keyOne && takenKeys.has(keyOne)) {
        addIssue("Ya está en este grupo o repetido en la planilla.");
      }
      if (keyTwo && takenKeys.has(keyTwo)) {
        addIssue(
          "Ya está en este grupo o repetido en la planilla.",
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

    if (distributeByGrade) {
      for (const grade of new Set(drafts.map((draft) => draft.grade))) {
        if (destinations.has(grade)) continue;
        const course = SCHOOL_GRADES.find((item) => item.value === grade)!;
        const destination = await ensureCourseGroup(group.contestId, course, group.createdById!, group.schoolId);
        destinations.set(grade, destination.id);
      }
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
    await db().batch(prepared.flatMap((draft) => {
      const teamId = randomUUID();
      return [
        db().prepare(`INSERT INTO "Team"
          ("id", "groupId", "participationMode", "grade", "memberOneFirstName", "memberOneLastName",
           "memberTwoFirstName", "memberTwoLastName", "personalCode", "status", "createdAt", "updatedAt")
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'registered', ?, ?)`).bind(
          teamId, distributeByGrade ? destinations.get(draft.grade)! : group.id, draft.participationMode, draft.grade, draft.oneFirst, draft.oneLast,
          draft.twoFirst, draft.twoLast, draft.personalCode, importedAt, importedAt,
        ),
        db().prepare(`INSERT INTO "Attempt" ("id", "teamId", "status", "createdAt", "updatedAt")
          VALUES (?, ?, 'pending', ?, ?)`).bind(randomUUID(), teamId, importedAt, importedAt),
      ];
    }));

    res.status(201).json({
      created: prepared.map((draft) => ({
        row: draft.row,
        name: `${draft.oneFirst} ${draft.oneLast}`,
        personalCode: draft.personalCode,
        grade: draft.grade,
      })),
      groups: distributeByGrade
        ? [...new Set(prepared.map((draft) => draft.grade))].map((grade) => ({
            id: destinations.get(grade)!,
            grade,
            count: prepared.filter((draft) => draft.grade === grade).length,
          }))
        : [],
      skipped: [],
    });
  } finally {
    if (!isE2E() || req.get("x-e2e-keep-roster-lease") !== "1") {
      await db().prepare(
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

  if (req.user?.role !== "admin" && !contestRegistrationIsOpen(group.contest)) {
    res.status(409).json({ message: registrationWindowMessage(group.contest) });
    return;
  }

  if (
    req.user?.role !== "admin" &&
    contestHasEnded(computeContestState(group.contest).state)
  ) {
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
    grade = parseGroupGrade(req.body?.grade, group);
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

  const takenKeys = await groupNameKeys(group.id);

  if (takenKeys.has(keyOne)) {
    res.status(409).json({
      message: `${formatName(oneFirst)} ${formatName(oneLast)} ya está en este grupo.`,
      code: "TEAM_MEMBER_DUPLICATE",
      fields: ["memberOneFirstName", "memberOneLastName"],
    });
    return;
  }

  if (mode === "pareja" && takenKeys.has(keyTwo)) {
    res.status(409).json({
      message: `${formatName(twoFirst)} ${formatName(twoLast)} ya está en este grupo.`,
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

  const group = await prisma.contestGroup.findFirst({
    where: { accessCode: code, contest: { trashedAt: null } },
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

  if (group.contest.isPractice) {
    res.status(410).json({
      message: "Las prácticas ahora se abren con tu código personal.",
    });
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
    contestStartsAt:
      contestForCategory(group.contest, group.category).startsAt?.toISOString() ??
      null,
    contestEndsAt:
      contestForCategory(group.contest, group.category).endsAt?.toISOString() ??
      null,
    category: group.category,
    grades: gradesForGroup(group),
    state,
  });
});

async function practiceStudent(rawCode: unknown) {
  const personalCode =
    typeof rawCode === "string" ? rawCode.trim().toUpperCase() : "";
  if (!personalCode) return null;
  const team = await prisma.team.findUnique({
    where: { personalCode },
    select: {
      id: true,
      grade: true,
      memberOneFirstName: true,
      memberOneLastName: true,
      group: {
        select: {
          createdById: true,
          contest: {
            select: { categories: true, isPractice: true, trashedAt: true },
          },
        },
      },
    },
  });
  if (
    !team ||
    !team.group.createdById ||
    team.group.contest.isPractice ||
    team.group.contest.trashedAt
  ) {
    return null;
  }
  const category = teamCategory(
    team.grade,
    contestCategories(team.group.contest),
  );
  if (!category) return null;
  return { team, teacherId: team.group.createdById, category };
}

async function studentPractice(id: string, rawCode: unknown) {
  const student = await practiceStudent(rawCode);
  if (!student) return null;
  const contest = await prisma.contest.findFirst({
    where: {
      id,
      isPractice: true,
      createdById: student.teacherId,
      trashedAt: null,
    },
  });
  if (
    !contest ||
    !contestCategories(contest).includes(student.category) ||
    computeContestState(contest).state !== "abierta"
  ) {
    return null;
  }
  const tasks = tasksOfCategory(
    await contestTasksFor(contest),
    student.category,
  );
  return { student, contest, tasks };
}

const PRACTICE_CLOSED = "Esta práctica no está abierta ahora.";

app.post("/api/play/practice/:code/enter", (_req, res) => {
  res.status(410).json({
    message: "Las prácticas ahora se abren con tu código personal.",
  });
});

async function linkedTestSource(rawCode: unknown) {
  const personalCode =
    typeof rawCode === "string" ? rawCode.trim().toUpperCase() : "";
  if (!personalCode) return null;
  const team = await prisma.team.findUnique({
    where: { personalCode },
    include: { group: { include: { contest: true } } },
  });
  const contest = team?.group.contest;
  if (
    !team ||
    !contest ||
    team.sourceTeamId ||
    contest.trashedAt ||
    contest.isTest ||
    contest.isPractice
  ) {
    return null;
  }
  const category = teamCategory(team.grade, contestCategories(contest));
  if (!category) return null;
  return { team, category };
}

async function openLinkedTests(
  source: NonNullable<Awaited<ReturnType<typeof linkedTestSource>>>,
) {
  const contests = await prisma.contest.findMany({
    where: {
      isTest: true,
      unlisted: false,
      linkedContestId: source.team.group.contestId,
      trashedAt: null,
      stoppedAt: null,
      publishedAt: { not: null },
    },
    include: { tasks: { select: { category: true } } },
    orderBy: { startsAt: "asc" },
  });
  return contests.filter(
    (contest) =>
      contestCategories(contest).includes(source.category) &&
      computeContestState(contest).state === "abierta",
  );
}

async function linkedTestsOffer(rawCode: unknown) {
  const source = await linkedTestSource(rawCode);
  if (!source) return { name: undefined, tests: [] };
  const contests = await openLinkedTests(source);
  return {
    name: source.team.memberOneFirstName,
    tests: contests.map((contest) => ({
      id: contest.id,
      title: contest.title,
      durationMinutes: contest.durationMinutes,
      taskCount: contest.tasks.filter(
        (task) => task.category === source.category,
      ).length,
      endsAt: contest.endsAt?.toISOString() ?? null,
    })),
  };
}

app.post("/api/play/practices", async (req, res) => {
  const offer = await linkedTestsOffer(req.body?.personalCode);
  const student = await practiceStudent(req.body?.personalCode);
  if (!student) {
    res.json({ name: offer.name, practices: [], tests: offer.tests });
    return;
  }

  const contests = await prisma.contest.findMany({
    where: { isPractice: true, createdById: student.teacherId, trashedAt: null },
    include: { _count: { select: { tasks: true } } },
    orderBy: { endsAt: "asc" },
  });

  res.json({
    name: student.team.memberOneFirstName,
    tests: offer.tests,
    practices: contests
      .filter(
        (contest) =>
          contestCategories(contest).includes(student.category) &&
          computeContestState(contest).state === "abierta",
      )
      .map((contest) => ({
        id: contest.id,
        title: contest.title,
        taskCount: contest._count.tasks,
        endsAt: contest.endsAt?.toISOString() ?? null,
      })),
  });
});

app.post("/api/play/linked-session", async (req, res) => {
  const source = await linkedTestSource(req.body?.personalCode);
  const contestId =
    typeof req.body?.contestId === "string" ? req.body.contestId : "";
  const test = source
    ? (await openLinkedTests(source)).find((contest) => contest.id === contestId)
    : undefined;

  if (!source || !test) {
    res
      .status(404)
      .json({ message: "Esta prueba no está abierta para tu código." });
    return;
  }

  const sourceGroup = source.team.group;
  const autoKey = `linked:${test.id}:${sourceGroup.id}`;
  let group = await prisma.contestGroup.findUnique({ where: { autoKey } });

  if (!group) {
    try {
      group = await prisma.contestGroup.create({
        data: {
          contestId: test.id,
          createdById: sourceGroup.createdById,
          schoolId: sourceGroup.schoolId,
          name: sourceGroup.name,
          category: sourceGroup.category,
          grade: sourceGroup.grade,
          autoKey,
          accessCode: await generateUniqueAccessCode(),
          recoveryCode: generateCode(10),
        },
      });
    } catch {
      group = await prisma.contestGroup.findUnique({ where: { autoKey } });
    }
  }

  if (!group) {
    res.status(500).json({ message: "No pudimos preparar tu prueba." });
    return;
  }

  const mirror = { groupId: group.id, sourceTeamId: source.team.id };
  let team = await prisma.team.findFirst({ where: mirror });

  if (!team) {
    try {
      team = await prisma.team.create({
        data: {
          ...mirror,
          participationMode: source.team.participationMode,
          grade: source.team.grade,
          memberOneFirstName: source.team.memberOneFirstName,
          memberOneLastName: source.team.memberOneLastName,
          memberTwoFirstName: source.team.memberTwoFirstName,
          memberTwoLastName: source.team.memberTwoLastName,
          personalCode: await generateUniquePersonalCode(),
          attempt: { create: { status: "pending" } },
        },
      });
    } catch {
      team = await prisma.team.findFirst({ where: mirror });
    }
  }

  if (!team) {
    res.status(500).json({ message: "No pudimos preparar tu prueba." });
    return;
  }

  const sessionToken = randomUUID();
  await prisma.team.update({
    where: { id: team.id },
    data: { sessionToken, sessionSeenAt: currentDate() },
  });

  res.status(201).json({
    sessionToken,
    groupName: group.name,
    contestTitle: test.title,
    participationMode: team.participationMode,
    memberOneFirstName: team.memberOneFirstName,
    memberOneLastName: team.memberOneLastName,
    memberTwoFirstName: team.memberTwoFirstName,
    memberTwoLastName: team.memberTwoLastName,
  });
});

app.post("/api/play/practices/:id/tasks", async (req, res) => {
  const found = await studentPractice(
    String(req.params.id),
    req.body?.personalCode,
  );
  if (!found) {
    res.status(404).json({ message: PRACTICE_CLOSED });
    return;
  }

  res.json({
    title: found.contest.title,
    category: found.student.category,
    rules: contestRules(found.tasks),
    tasks: await externalizeTaskImages(
      found.tasks.map((contestTask) =>
        renderSafeTask(contestTask, contestTask.play),
      ),
      imageStore(req),
    ),
  });
});

app.post("/api/play/practices/:id/check", async (req, res) => {
  const found = await studentPractice(
    String(req.params.id),
    req.body?.personalCode,
  );
  if (!found) {
    res.status(404).json({ message: PRACTICE_CLOSED });
    return;
  }

  const contestTask = found.tasks.find(
    (item) => item.taskDraftId === req.body?.taskId,
  );
  if (!contestTask) {
    res.status(404).json({ message: "Pregunta no encontrada." });
    return;
  }

  const payload = req.body?.payload;
  const error = validateTaskAnswer(contestTask.play, payload);
  if (error) {
    res.status(400).json({ message: error });
    return;
  }

  res.json({
    correct: answerIsCorrect(contestTask.play, payload),
    explanationBlocks: await externalizeTaskImages(
      contestTask.play.explanationBlocks,
      imageStore(req),
    ),
  });
});

app.post("/api/play/practices/:id/finish", async (req, res) => {
  const found = await studentPractice(
    String(req.params.id),
    req.body?.personalCode,
  );
  if (!found) {
    res.status(404).json({ message: PRACTICE_CLOSED });
    return;
  }

  const answers = (
    req.body?.answers && typeof req.body.answers === "object"
      ? req.body.answers
      : {}
  ) as Record<string, unknown>;
  let totalScore = initialScoreOf(found.tasks);
  let correctCount = 0;
  let answeredCount = 0;
  let marks = "";

  for (const contestTask of found.tasks) {
    const raw = answers[contestTask.taskDraftId] ?? null;
    const payload =
      raw !== null && !validateTaskAnswer(contestTask.play, raw) ? raw : null;
    const graded = gradeAnswer(contestTask, contestTask.play, payload);
    totalScore += graded.score;
    if (graded.answered) answeredCount += 1;
    if (graded.isCorrect) correctCount += 1;
    marks += !graded.answered ? "-" : graded.isCorrect ? "C" : "X";
  }

  const summary = {
    totalScore,
    correctCount,
    answeredCount,
    taskCount: found.tasks.length,
  };

  await prisma.practiceResult.upsert({
    where: {
      contestId_teamId: {
        contestId: found.contest.id,
        teamId: found.student.team.id,
      },
    },
    create: {
      contestId: found.contest.id,
      teamId: found.student.team.id,
      ...summary,
      marks,
    },
    update: { ...summary, marks, finishedAt: currentDate() },
  });

  res.json(summary);
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

  const group = await prisma.contestGroup.findFirst({
    where: { accessCode: code, contest: { trashedAt: null } },
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
    grade = parseGroupGrade(req.body?.grade, group);
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

  // El código personal es la única credencial para rendir: nunca se le
  // devuelve a quien solo escribe un nombre que ya está inscrito.
  const takenKeys = await groupNameKeys(group.id);
  const already = "ya está inscrito en este grupo. Si es tu nombre, pídele tu código personal a tu maestro.";

  if (takenKeys.has(keyOne)) {
    res.status(409).json({
      message: `${formatName(memberOneFirstName)} ${formatName(memberOneLastName)} ${already}`,
      code: "TEAM_MEMBER_DUPLICATE",
    });
    return;
  }

  if (mode === "pareja" && takenKeys.has(keyTwo)) {
    res.status(409).json({
      message: `${formatName(memberTwoFirstName)} ${formatName(memberTwoLastName)} ${already}`,
      code: "TEAM_MEMBER_DUPLICATE",
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

app.post("/api/play/test-join", async (req, res) => {
  const readField = (value: unknown) =>
    typeof value === "string" ? value.trim() : "";
  const firstName = readField(req.body?.firstName);
  const lastName = readField(req.body?.lastName);

  if (!firstName || !lastName) {
    res
      .status(400)
      .json({ message: "Tus nombres y apellidos son obligatorios." });
    return;
  }

  const contest = await prisma.contest.findFirst({
    where: {
      id: readField(req.body?.contestId),
      isTest: true,
      linkedContestId: null,
      trashedAt: null,
      stoppedAt: null,
      publishedAt: { not: null },
    },
  });

  if (!contest) {
    res.status(404).json({ message: "Prueba no encontrada." });
    return;
  }

  if (contestHasEnded(computeContestState(contest).state)) {
    res.status(409).json({ message: "La prueba ya terminó." });
    return;
  }

  let grade: string;

  try {
    grade = parseGrade(req.body?.grade, contestCategories(contest));
  } catch (error) {
    res.status(400).json({
      message: error instanceof Error ? error.message : "Curso inválido.",
    });
    return;
  }

  const autoKey = `test:${contest.id}:${grade}`;
  let group = await prisma.contestGroup.findUnique({ where: { autoKey } });

  if (!group) {
    try {
      group = await prisma.contestGroup.create({
        data: {
          contestId: contest.id,
          name: SCHOOL_GRADES.find((item) => item.value === grade)?.label ?? grade,
          grade,
          autoKey,
          accessCode: await generateUniqueAccessCode(),
          recoveryCode: generateCode(10),
        },
      });
    } catch {
      group = await prisma.contestGroup.findUnique({ where: { autoKey } });
    }
  }

  if (!group) {
    res.status(500).json({ message: "No pudimos preparar tu ingreso." });
    return;
  }

  const personalCode = await generateUniquePersonalCode();

  await prisma.team.create({
    data: {
      groupId: group.id,
      participationMode: "individual",
      grade,
      memberOneFirstName: formatName(firstName),
      memberOneLastName: formatName(lastName),
      personalCode,
      attempt: { create: { status: "pending" } },
    },
  });

  res.status(201).json({ personalCode });
});

app.get("/api/play/team/:personalCode", async (req, res) => {
  const personalCode = String(req.params.personalCode ?? "")
    .trim()
    .toUpperCase();

  const team = await prisma.team.findFirst({
    where: { personalCode, group: { contest: { trashedAt: null } } },
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

/**
 * Categoría de cada curso como expresión SQL, con la misma regla que
 * `teamCategory`: la del curso si participa, si no la única del desafío.
 */
function teamCategorySql(categories: string[]) {
  const fallback = categories.length === 1 ? categories[0] : "";
  const cases = SCHOOL_GRADES.filter((grade) =>
    categories.includes(grade.category),
  ).map((grade) => `WHEN '${grade.value}' THEN '${grade.category}'`);
  return cases.length > 0
    ? `CASE t."grade" ${cases.join(" ")} ELSE '${fallback}' END`
    : `'${fallback}'`;
}

/** Puntaje inicial de cada equipo como expresión SQL, según su categoría. */
function initialScoreSql(
  categories: string[],
  tasks: Array<{ category: string; minScore: number }>,
) {
  const initial = (category: string | null) =>
    Math.trunc(initialScoreOf(tasksOfCategory(tasks, category)));
  const fallback = initial(teamCategory(null, categories));
  const cases = SCHOOL_GRADES.filter((grade) =>
    categories.includes(grade.category),
  ).map((grade) => `WHEN '${grade.value}' THEN ${initial(grade.category)}`);
  return cases.length > 0
    ? `CASE t."grade" ${cases.join(" ")} ELSE ${fallback} END`
    : String(fallback);
}

/**
 * Cada categoría tiene su propio ranking: sus preguntas son otras. Una sola
 * sentencia para todo el desafío, sin importar cuántos participen.
 */
async function recomputeRanking(contestId: string) {
  const contest = await prisma.contest.findUnique({
    where: { id: contestId },
    select: { categories: true },
  });
  const categories = contest ? contestCategories(contest) : [];

  await db()
    .prepare(
      `UPDATE "Result" SET "rankPosition" = ranked."position"
      FROM (
        SELECT r."id" AS "id", ROW_NUMBER() OVER (
          PARTITION BY ${teamCategorySql(categories)}
          ORDER BY r."totalScore" DESC,
            CASE WHEN a."startedAt" IS NULL OR a."finishedAt" IS NULL OR a."mode" = 'paper' THEN 1 ELSE 0 END,
            julianday(a."finishedAt") - julianday(a."startedAt"),
            r."id"
        ) AS "position"
        FROM "Result" r
        JOIN "Attempt" a ON a."id" = r."attemptId"
        JOIN "Team" t ON t."id" = a."teamId"
        JOIN "ContestGroup" g ON g."id" = t."groupId"
        WHERE g."contestId" = ?
      ) AS ranked
      WHERE "Result"."id" = ranked."id"`,
    )
    .bind(contestId)
    .run();
}

type ContestTaskRow = Prisma.ContestTaskGetPayload<{
  include: { taskDraft: true };
}>;
type LoadedContestTask = Omit<ContestTaskRow, "taskDraft"> & { play: PlayTask };

const CONTEST_TASKS_TTL_MS = 30_000;
const contestTasksCache = new Map<
  string,
  { key: string; loadedAt: number; tasks: LoadedContestTask[] }
>();

/**
 * Preguntas de un desafío con su tarea completa. Pesan (las imágenes van en
 * la tarea) y son las mismas para todos los que rinden, así que cada instancia
 * del Worker las guarda un momento en memoria en vez de leerlas en cada
 * petición. Un desafío en curso no se puede editar, ni sus tareas. Se guarda
 * el resultado y no la promesa: esperar una lectura iniciada por otra
 * petición hace que Workers corte la espera.
 */
async function contestTasksFor(contest: { id: string; updatedAt: Date }) {
  const key = contest.updatedAt.toISOString();
  const cached = contestTasksCache.get(contest.id);
  if (
    cached &&
    cached.key === key &&
    Date.now() - cached.loadedAt < CONTEST_TASKS_TTL_MS
  ) {
    return cached.tasks;
  }

  // Con cientos de estudiantes empezando a la vez, Cloudflare abre muchas
  // instancias y cada una leería las preguntas de D1, que atiende de a una
  // consulta: la copia en R2 se lee en paralelo y D1 se consulta una vez.
  const edited = await db()
    .prepare(
      `SELECT MAX(t."updatedAt") AS "at" FROM "ContestTask" ct
      JOIN "TaskDraft" t ON t."id" = ct."taskDraftId" WHERE ct."contestId" = ?`,
    )
    .bind(contest.id)
    .first<{ at: string | null }>();
  const snapshotKey = `contest-tasks/${contest.id}-${contest.updatedAt.getTime()}-${Date.parse(edited?.at ?? "") || 0}.json`;
  let tasks: LoadedContestTask[] | null = null;
  try {
    const stored = await env.UPLOADS.get(snapshotKey);
    if (stored) {
      tasks = (await stored.json<LoadedContestTask[]>()).map((task) => ({
        ...task,
        createdAt: new Date(task.createdAt),
      }));
    }
  } catch {
    tasks = null;
  }

  if (!tasks) {
    const rows = await prisma.contestTask.findMany({
      where: { contestId: contest.id },
      orderBy: { position: "asc" },
      include: { taskDraft: true },
    });
    // El borrador crudo no se guarda: duplicaría en memoria cada imagen.
    tasks = rows.map(({ taskDraft, ...row }) => ({
      ...row,
      play: deserializeTask(taskDraft) as PlayTask,
    }));
    try {
      await env.UPLOADS.put(snapshotKey, JSON.stringify(tasks), {
        httpMetadata: { contentType: "application/json" },
      });
    } catch {
      // Sin la copia se sigue leyendo de D1, como antes.
    }
  }

  contestTasksCache.delete(contest.id);
  if (contestTasksCache.size >= 8) {
    const oldest = contestTasksCache.keys().next().value;
    if (oldest) contestTasksCache.delete(oldest);
  }
  contestTasksCache.set(contest.id, { key, loadedAt: Date.now(), tasks });
  return tasks;
}

/** Cómo queda una respuesta al guardarla: si cuenta, si es correcta y cuánto vale. */
function gradeAnswer(
  contestTask: { minScore: number; maxScore: number; noAnswerScore: number },
  task: PlayTask,
  payload: unknown,
) {
  const answered = answerHasResponse(task.answerType, payload);
  const correct = answered ? answerIsCorrect(task, payload) : false;
  return {
    answered,
    isCorrect: answered ? correct : null,
    score: answered
      ? correct
        ? contestTask.maxScore
        : contestTask.minScore
      : contestTask.noAnswerScore,
  };
}

/**
 * Cierra intentos en curso: uno (al entregar o al vencer su plazo) o todos los
 * de un desafío (al consolidar). Cada respuesta ya se corrigió al guardarla,
 * así que el cierre son sumas en SQL y no depende de cuántos participen.
 */
async function finalizeAttempts(
  contestId: string,
  target: { attemptId: string } | "open",
) {
  const contest = await prisma.contest.findUnique({
    where: { id: contestId },
    select: { id: true, categories: true, updatedAt: true },
  });
  if (!contest) {
    return 0;
  }

  const categories = contestCategories(contest);
  const tasks = await contestTasksFor(contest);
  const attemptFilter =
    target === "open"
      ? {
          status: "in_progress",
          team: { group: { contestId } },
        }
      : { id: target.attemptId, status: "in_progress" };

  // Respuestas guardadas antes de que se corrigiera al guardar: se corrigen ahora.
  const ungraded = await prisma.attemptAnswer.findMany({
    where: { isCorrect: null, answeredAt: { not: null }, attempt: attemptFilter },
    select: {
      id: true,
      taskDraftId: true,
      responsePayload: true,
      attempt: { select: { team: { select: { grade: true } } } },
    },
  });
  const regraded = ungraded.map((answer) => {
    const category = teamCategory(answer.attempt.team.grade, categories);
    const contestTask = tasks.find(
      (task) =>
        task.category === category && task.taskDraftId === answer.taskDraftId,
    );
    let payload: unknown = null;
    try {
      payload = JSON.parse(answer.responsePayload);
    } catch {
      payload = null;
    }
    const graded = contestTask
      ? gradeAnswer(contestTask, contestTask.play, payload)
      : { answered: false, isCorrect: null, score: 0 };
    return db()
      .prepare(
        'UPDATE "AttemptAnswer" SET "isCorrect" = ?, "score" = ?, "answeredAt" = CASE WHEN ? THEN "answeredAt" ELSE NULL END WHERE "id" = ?',
      )
      .bind(
        graded.isCorrect === null ? null : Number(graded.isCorrect),
        graded.score,
        Number(graded.answered),
        answer.id,
      );
  });
  for (let index = 0; index < regraded.length; index += 200) {
    await db().batch(regraded.slice(index, index + 200));
  }

  const now = currentDate().toISOString();
  const scope =
    target === "open"
      ? 'a."status" = \'in_progress\' AND g."contestId" = ?'
      : 'a."status" = \'in_progress\' AND a."id" = ?';
  const scopeValue = target === "open" ? contestId : target.attemptId;

  const [, closed] = await db().batch([
    db()
      .prepare(
        `INSERT INTO "Result" ("id", "attemptId", "totalScore", "correctCount", "answeredCount", "calculatedAt", "createdAt", "updatedAt")
        SELECT lower(hex(randomblob(12))), a."id",
          ${initialScoreSql(categories, tasks)} + COALESCE(SUM(aa."score"), 0),
          COALESCE(SUM(CASE WHEN aa."isCorrect" = 1 THEN 1 ELSE 0 END), 0),
          COALESCE(SUM(CASE WHEN aa."isCorrect" IS NOT NULL THEN 1 ELSE 0 END), 0),
          ?, ?, ?
        FROM "Attempt" a
        JOIN "Team" t ON t."id" = a."teamId"
        JOIN "ContestGroup" g ON g."id" = t."groupId"
        LEFT JOIN "AttemptAnswer" aa ON aa."attemptId" = a."id"
          AND EXISTS (
            SELECT 1 FROM "ContestTask" ct
            WHERE ct."contestId" = g."contestId" AND ct."taskDraftId" = aa."taskDraftId"
          )
        WHERE ${scope}
        GROUP BY a."id"
        ON CONFLICT ("attemptId") DO UPDATE SET
          "totalScore" = excluded."totalScore",
          "correctCount" = excluded."correctCount",
          "answeredCount" = excluded."answeredCount",
          "calculatedAt" = excluded."calculatedAt",
          "updatedAt" = excluded."updatedAt"`,
      )
      .bind(now, now, now, scopeValue),
    db()
      .prepare(
        `UPDATE "Attempt" SET "status" = 'finished',
          "finishedAt" = CASE
            WHEN "endsAt" IS NOT NULL AND julianday("endsAt") < julianday(?) THEN "endsAt"
            ELSE ? END,
          "updatedAt" = ?
        WHERE "id" IN (
          SELECT a."id" FROM "Attempt" a
          JOIN "Team" t ON t."id" = a."teamId"
          JOIN "ContestGroup" g ON g."id" = t."groupId"
          WHERE ${scope}
        )`,
      )
      .bind(now, now, now, scopeValue),
  ]);

  return closed.meta.changes ?? 0;
}

/** Cierra un intento. El ranking se arma al consolidar, no en cada entrega. */
async function finalizeAttempt(attemptId: string) {
  const attempt = await prisma.attempt.findUnique({
    where: { id: attemptId },
    select: {
      team: {
        select: {
          group: {
            select: { contest: { select: { id: true, consolidatedAt: true } } },
          },
        },
      },
    },
  });
  if (!attempt) {
    return;
  }

  const contest = attempt.team.group.contest;
  await finalizeAttempts(contest.id, { attemptId });
  if (contest.consolidatedAt) {
    await recomputeRanking(contest.id);
  }
}

/**
 * Publica solos los resultados cuya hora ya llegó: cierra los intentos que
 * quedaron abiertos, arma el ranking y los publica. Corre una sola vez por
 * desafío, así que si el administrador los oculta después no vuelven. Un
 * desafío pausado espera a que lo reanuden.
 */
async function releaseDueResults(contestId?: string) {
  const now = currentDate();
  const due = await prisma.contest.findMany({
    where: {
      ...(contestId ? { id: contestId } : {}),
      isPractice: false,
      isTest: false,
      publishedAt: { not: null },
      suspendedAt: null,
      stoppedAt: null,
      trashedAt: null,
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
    const claim = await db().prepare(
      'UPDATE "Contest" SET "resultsReleasedAt" = ? WHERE "id" = ? AND "resultsReleasedAt" IS NULL',
    )
      .bind(stamp, contest.id)
      .run();

    if (!claim.meta.changes) {
      continue;
    }

    try {
      await consolidateContest(contest.id);
      await db().prepare(
        'UPDATE "Contest" SET "consolidatedAt" = COALESCE("consolidatedAt", ?), "resultsPublishedAt" = COALESCE("resultsPublishedAt", ?) WHERE "id" = ?',
      )
        .bind(stamp, stamp, contest.id)
        .run();
    } catch (error) {
      // Si algo falla a mitad, se suelta la marca para que otra petición lo
      // vuelva a intentar; consolidar dos veces da el mismo resultado.
      await db()
        .prepare(
          'UPDATE "Contest" SET "resultsReleasedAt" = NULL WHERE "id" = ? AND "resultsReleasedAt" = ?',
        )
        .bind(contest.id, stamp)
        .run();
      throw error;
    }
    released = true;
  }

  return released;
}

async function consolidateContest(contestId: string) {
  const closed = await finalizeAttempts(contestId, "open");
  await recomputeRanking(contestId);
  return closed;
}

// Las preguntas no vienen con el equipo: salen de `contestTasksFor`.
const playTeamLightInclude = {
  attempt: true,
  group: { select: { contestId: true, accessCode: true, contest: true } },
};

function findLightTeamForPlay(personalCode: string) {
  return prisma.team.findFirst({
    where: { personalCode, group: { contest: { trashedAt: null } } },
    include: playTeamLightInclude,
  });
}

function findLightTeamBySession(sessionToken: string) {
  return prisma.team.findFirst({
    where: { sessionToken, group: { contest: { trashedAt: null } } },
    include: playTeamLightInclude,
  });
}

type AnswerTeam = {
  id: string;
  sessionToken: string | null;
  sessionSeenAt: Date | null;
  grade: string | null;
  attempt: {
    id: string;
    status: string;
    mode: string;
    endsAt: Date | null;
  } | null;
  group: {
    contest: Parameters<typeof contestStateAt>[1] & {
      id: string;
      updatedAt: Date;
      categories: string;
    };
  };
};

function sqlDate(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(value as string | number);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Guardar una respuesta es lo más frecuente durante la prueba: equipo,
 * intento y desafío salen de una sola sentencia en vez de las cuatro de Prisma.
 */
async function findAnswerTeamBySession(
  sessionToken: string,
): Promise<AnswerTeam | null> {
  const row = await db()
    .prepare(
      `SELECT t."id", t."sessionToken", t."sessionSeenAt", t."grade",
        a."id" AS "attemptId", a."status" AS "attemptStatus", a."mode" AS "attemptMode", a."endsAt" AS "attemptEndsAt",
        c."id" AS "contestId", c."updatedAt", c."categories", c."publishedAt", c."suspendedAt",
        c."consolidatedAt", c."resultsPublishedAt", c."registrationStartsAt", c."registrationEndsAt",
        c."startsAt", c."endsAt", c."isPractice", c."isTest", c."stoppedAt", c."trashedAt"
      FROM "Team" t
      JOIN "ContestGroup" g ON g."id" = t."groupId"
      JOIN "Contest" c ON c."id" = g."contestId"
      LEFT JOIN "Attempt" a ON a."teamId" = t."id"
      WHERE t."sessionToken" = ? AND c."trashedAt" IS NULL`,
    )
    .bind(sessionToken)
    .first<Record<string, unknown>>();
  if (!row) return null;
  return {
    id: String(row.id),
    sessionToken: (row.sessionToken as string | null) ?? null,
    sessionSeenAt: sqlDate(row.sessionSeenAt),
    grade: (row.grade as string | null) ?? null,
    attempt: row.attemptId
      ? {
          id: String(row.attemptId),
          status: String(row.attemptStatus),
          mode: String(row.attemptMode),
          endsAt: sqlDate(row.attemptEndsAt),
        }
      : null,
    group: {
      contest: {
        id: String(row.contestId),
        updatedAt: sqlDate(row.updatedAt) ?? new Date(0),
        categories: String(row.categories ?? "[]"),
        publishedAt: sqlDate(row.publishedAt),
        suspendedAt: sqlDate(row.suspendedAt),
        stoppedAt: sqlDate(row.stoppedAt),
        trashedAt: sqlDate(row.trashedAt),
        consolidatedAt: sqlDate(row.consolidatedAt),
        resultsPublishedAt: sqlDate(row.resultsPublishedAt),
        registrationStartsAt: sqlDate(row.registrationStartsAt),
        registrationEndsAt: sqlDate(row.registrationEndsAt),
        startsAt: sqlDate(row.startsAt),
        endsAt: sqlDate(row.endsAt),
        isPractice: Boolean(row.isPractice),
        isTest: Boolean(row.isTest),
      },
    },
  };
}

const PLAY_SESSION_TTL_MS = 70000;
const PLAY_HEARTBEAT_MS = 30000;

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

    // El latido ya la mantiene viva: solo se escribe si quedó atrasada, para
    // no sumar una escritura por cada respuesta guardada.
    const seenMs = team.sessionSeenAt?.getTime() ?? 0;
    if (currentDate().getTime() - seenMs > PLAY_HEARTBEAT_MS) {
      await prisma.team.update({
        where: { id: team.id },
        data: { sessionSeenAt: currentDate() },
      });
    }

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

  const team = await prisma.team.findFirst({
    where: { personalCode, group: { contest: { trashedAt: null } } },
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

  // Una sola sentencia: renueva la sesión y trae lo que la pantalla necesita
  // para enterarse de una pausa o de un plazo que cambió.
  const now = currentDate();
  const state = await db()
    .prepare(
      `UPDATE "Team" SET "sessionSeenAt" = ? WHERE "sessionToken" = ?
      RETURNING
        (SELECT COALESCE(c."suspendedAt", c."stoppedAt") FROM "ContestGroup" g JOIN "Contest" c ON c."id" = g."contestId" WHERE g."id" = "Team"."groupId") AS "suspendedAt",
        (SELECT a."id" FROM "Attempt" a WHERE a."teamId" = "Team"."id") AS "attemptId",
        (SELECT a."endsAt" FROM "Attempt" a WHERE a."teamId" = "Team"."id") AS "endsAt",
        (SELECT a."status" FROM "Attempt" a WHERE a."teamId" = "Team"."id") AS "status"`,
    )
    .bind(now.toISOString(), token)
    .first<{
      suspendedAt: string | null;
      attemptId: string | null;
      endsAt: string | null;
      status: string | null;
    }>();

  if (!state) {
    res.status(401).json({ message: PLAY_AUTH_ERRORS.session_gone.message });
    return;
  }

  const iso = (value: string | null) =>
    value ? new Date(value).toISOString() : null;
  res.json({
    ok: true,
    serverNow: now.toISOString(),
    suspended: Boolean(state.suspendedAt),
    attemptId: state.attemptId,
    endsAt: iso(state.endsAt),
    status: state.status,
  });
});

app.post("/api/play/start", async (req, res) => {
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

  const category = teamCategory(
    team.grade,
    contestCategories(team.group.contest),
  );
  const contest = contestForCategory(team.group.contest, category);
  const contestTasks = await contestTasksFor(contest);
  if (computeContestState(contest).state !== "abierta") {
    res
      .status(409)
      .json({ message: "El desafío no está abierto en este momento." });
    return;
  }

  if (team.attempt.status === "finished" || team.attempt.mode === "paper") {
    res.status(409).json({
      message:
        team.attempt.mode === "paper"
          ? "Rendiste en papel: tu maestro ya cargó tus respuestas."
          : "Ya entregaste este desafío.",
    });
    return;
  }

  if (tasksOfCategory(contestTasks, category).length === 0) {
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

    // Condicionado a «pendiente»: dos toques seguidos no reinician el reloj.
    await prisma.attempt.updateMany({
      where: { id: team.attempt.id, status: "pending" },
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

  let attempt = team.attempt;
  const contest = team.group.contest;

  // Solo un desafío ya cerrado puede tener resultados pendientes de publicar.
  if (
    contest.endsAt &&
    contest.endsAt < currentDate() &&
    (await releaseDueResults(contest.id))
  ) {
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
  const category = teamCategory(team.grade, contestCategories(contest));
  const categoryContest = contestForCategory(contest, category);
  const contestState = computeContestState(categoryContest).state;
  const contestTasks = await contestTasksFor(contest);

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
  const resultsPublished = contest.isTest || Boolean(contest.resultsPublishedAt);
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
  // Antes de empezar basta saber cuántas preguntas son: el enunciado completo
  // (con sus imágenes) pesa y la pantalla de espera se consulta seguido.
  const categoryTasks = tasksOfCategory(contestTasks, category);
  // Sin orden al azar ni resultados por estudiante, las preguntas proyectadas
  // son las mismas para toda la categoría: se arman y serializan una sola vez.
  const sharedTasksKey =
    attempt.status !== "pending" && !contest.shuffleOptions && !showResults
      ? `${contest.id}:${contest.updatedAt.toISOString()}:${category}:${visible.solutions}`
      : null;
  const sharedTasks = sharedTasksKey
    ? playTasksJsonCache.get(sharedTasksKey)
    : undefined;
  const tasks = (attempt.status === "pending" || sharedTasks ? [] : categoryTasks).map((contestTask) => {
    const task = contestTask.play;
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

  const projectedTasks = await externalizeTaskImages(tasks, imageStore(req));
  let tasksJson = sharedTasks;
  if (sharedTasksKey && !tasksJson) {
    tasksJson = JSON.stringify(projectedTasks);
    if (playTasksJsonCache.size >= 4) {
      const oldest = playTasksJsonCache.keys().next().value;
      if (oldest) playTasksJsonCache.delete(oldest);
    }
    playTasksJsonCache.set(sharedTasksKey, tasksJson);
  }

  const usageRow =
    contest.isTest && contest.collectUsage
      ? await db()
          .prepare(
            'SELECT "stars", "comment" FROM "TestTrace" WHERE "attemptId" = ?',
          )
          .bind(attempt.id)
          .first<{ stars: number | null; comment: string | null }>()
      : null;

  const body = {
    contestTitle: contest.title,
    attemptId: attempt.id,
    // Hora del servidor: la cuenta regresiva no depende del reloj del equipo.
    serverNow: currentDate().toISOString(),
    category,
    rules: contestRules(categoryTasks),
    taskCount: categoryTasks.length,
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
    contestStartsAt: categoryContest.startsAt?.toISOString() ?? null,
    contestEndsAt: categoryContest.endsAt?.toISOString() ?? null,
    state: contestState,
    status: attempt.status,
    startedAt: attempt.startedAt?.toISOString() ?? null,
    endsAt: attempt.endsAt?.toISOString() ?? null,
    // Igual a endsAt cuando el intento se cerró por tiempo, así la pantalla
    // final puede decir si se entregó o se acabó el plazo.
    finishedAt: attempt.finishedAt?.toISOString() ?? null,
    suspendedAt: contest.suspendedAt?.toISOString() ?? null,
    resultsPublished,
    collectUsage: Boolean(contest.isTest && contest.collectUsage),
    usageReviewed: Boolean(
      usageRow && (usageRow.stars !== null || usageRow.comment),
    ),
    showFeedback: visible.feedback,
    showSolutions: visible.solutions,
    showTotalScore: visible.score,
    tasks: tasksJson
      ? (playTasksPlaceholder ||= `__bebras_play_tasks_${randomUUID()}__`)
      : projectedTasks,
    answers,
    result: result
      ? {
          totalScore: result.totalScore,
          correctCount: result.correctCount,
          answeredCount: result.answeredCount,
          rankPosition: resultsPublished ? result.rankPosition : null,
        }
      : null,
  };

  if (!tasksJson) {
    res.json(body);
    return;
  }
  const json = JSON.stringify(body);
  const at = json.indexOf(`"${playTasksPlaceholder}"`);
  res
    .type("application/json")
    .send(
      json.slice(0, at) +
        tasksJson +
        json.slice(at + playTasksPlaceholder.length + 2),
    );
};

// Se crea en la primera petición: Workers no deja generar azar al cargar.
let playTasksPlaceholder = "";
const playTasksJsonCache = new Map<string, string>();

app.get("/api/play/attempt", playAttemptHandler);
app.get("/api/play/attempt/:personalCode", playAttemptHandler);

app.post("/api/play/answer", async (req, res) => {
  const personalCode =
    typeof req.body?.personalCode === "string"
      ? req.body.personalCode.trim().toUpperCase()
      : "";
  const taskId = typeof req.body?.taskId === "string" ? req.body.taskId : "";
  const payload = req.body?.payload ?? null;

  const auth = await authorizePlay<AnswerTeam>(
    req,
    personalCode,
    findAnswerTeamBySession,
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

  if (team.attempt.status !== "in_progress" || team.attempt.mode === "paper") {
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

  const contest = team.group.contest;
  const category = teamCategory(team.grade, contestCategories(contest));
  const contestTask = (await contestTasksFor(contest)).find(
    (item) => item.category === category && item.taskDraftId === taskId,
  );

  if (!contestTask) {
    res.status(404).json({ message: "La tarea no pertenece a este desafío." });
    return;
  }

  if (typeof req.body?.attemptId === "string" && req.body.attemptId !== team.attempt.id) {
    res.status(409).json({ message: "El intento se reinició. Actualiza el desafío antes de responder." });
    return;
  }
  const answerError = validateTaskAnswer(contestTask.play, payload);
  if (answerError) {
    res.status(400).json({ message: answerError });
    return;
  }

  // Se corrige al guardar: así cerrar el intento es sumar, y el resultado
  // queda oculto hasta que el desafío deje verlo.
  const graded = gradeAnswer(contestTask, contestTask.play, payload);
  const now = currentDate().toISOString();
  // Una sola sentencia: es la escritura más frecuente durante la prueba.
  const written = await db()
    .prepare(
      `INSERT INTO "AttemptAnswer"
        ("id", "attemptId", "taskDraftId", "responsePayload", "isCorrect", "score", "answeredAt", "createdAt", "updatedAt")
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (
        SELECT 1 FROM "Attempt" a JOIN "Team" t ON t."id" = a."teamId"
        JOIN "ContestGroup" g ON g."id" = t."groupId" JOIN "Contest" c ON c."id" = g."contestId"
        WHERE a."id" = ? AND a."status" = 'in_progress' AND c."stoppedAt" IS NULL AND c."trashedAt" IS NULL
          AND (strftime('%Y-%m-%dT%H:%M:%fZ', c."updatedAt") = ? OR c."updatedAt" = ?))
      ON CONFLICT ("attemptId", "taskDraftId") DO UPDATE SET
        "responsePayload" = excluded."responsePayload",
        "isCorrect" = excluded."isCorrect",
        "score" = excluded."score",
        "answeredAt" = excluded."answeredAt",
        "updatedAt" = excluded."updatedAt"`,
    )
    .bind(
      randomUUID(),
      team.attempt.id,
      taskId,
      JSON.stringify(payload),
      graded.isCorrect === null ? null : Number(graded.isCorrect),
      graded.score,
      graded.answered ? now : null,
      now,
      now,
      team.attempt.id,
      team.group.contest.updatedAt.toISOString(),
      team.group.contest.updatedAt.getTime(),
    )
    .run();

  if (!written.meta.changes) {
    res.status(409).json({ message: "El desafío cambió. Actualiza la página antes de responder." });
    return;
  }

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

  if (team.attempt.status !== "in_progress" || team.group.contest.stoppedAt ||
      (typeof req.body?.attemptId === "string" && req.body.attemptId !== team.attempt.id)) {
    res.status(409).json({ message: "El intento se reinició o todavía no empezó." });
    return;
  }

  if (computeContestState(team.group.contest).state === "suspendida") {
    res.status(409).json({ message: SUSPENDED_CONTEST_MESSAGE });
    return;
  }

  await finalizeAttempt(team.attempt.id);
  res.json({ ok: true });
});

async function usageAttemptId(req: express.Request) {
  const token = readSessionToken(req);
  if (!token) {
    return null;
  }
  const team = await findLightTeamBySession(token);
  const contest = team?.group.contest;
  return team?.attempt && contest?.isTest && contest.collectUsage
    ? team.attempt.id
    : null;
}

function usageDevice(value: unknown) {
  const source =
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const size = (raw: unknown) => {
    const number = Math.round(Number(raw));
    return Number.isFinite(number) && number > 0 && number < 20000 ? number : 0;
  };
  return {
    kind: source.kind === "mobile" ? "mobile" : "desktop",
    width: size(source.width),
    height: size(source.height),
  };
}

app.post("/api/play/review", async (req, res) => {
  const attemptId = await usageAttemptId(req);

  if (!attemptId) {
    res.status(204).send();
    return;
  }

  const rawStars = Math.round(Number(req.body?.stars));
  const stars = rawStars >= 1 && rawStars <= 5 ? rawStars : null;
  const comment =
    typeof req.body?.comment === "string"
      ? req.body.comment.trim().slice(0, 500)
      : "";

  if (stars === null && !comment) {
    res
      .status(400)
      .json({ message: "Elige las estrellas o escribe un comentario." });
    return;
  }

  const now = currentDate().toISOString();
  await db()
    .prepare(
      `INSERT INTO "TestTrace" ("attemptId", "device", "stars", "comment", "createdAt", "updatedAt")
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT ("attemptId") DO UPDATE SET
        "device" = excluded."device",
        "stars" = excluded."stars",
        "comment" = excluded."comment",
        "updatedAt" = excluded."updatedAt"`,
    )
    .bind(
      attemptId,
      JSON.stringify(usageDevice(req.body?.device)),
      stars,
      comment || null,
      now,
      now,
    )
    .run();

  res.status(204).send();
});

app.put("/api/contests/:id/usage-setting", async (req, res) => {
  const contest = await prisma.contest.findUnique({
    where: { id: req.params.id },
    select: { id: true, isTest: true, trashedAt: true },
  });

  if (!contest || contest.trashedAt) {
    res.status(404).json({ message: "Desafío no encontrado." });
    return;
  }

  if (!contest.isTest) {
    res.status(409).json({
      message: "Solo un desafío de prueba puede recoger uso y opiniones.",
    });
    return;
  }

  const enabled = req.body?.enabled === true;
  await db()
    .prepare('UPDATE "Contest" SET "collectUsage" = ? WHERE "id" = ?')
    .bind(Number(enabled), contest.id)
    .run();

  res.json({ collectUsage: enabled });
});

app.get("/api/contests/:id/usage", async (req, res) => {
  const contest = await prisma.contest.findUnique({
    where: { id: req.params.id },
    select: {
      id: true,
      title: true,
      isTest: true,
      collectUsage: true,
      categories: true,
      trashedAt: true,
    },
  });

  if (!contest || contest.trashedAt) {
    res.status(404).json({ message: "Desafío no encontrado." });
    return;
  }

  if (!contest.isTest) {
    res.status(409).json({
      message: "Solo un desafío de prueba recoge uso y opiniones.",
    });
    return;
  }

  const { results } = await db()
    .prepare(
      `SELECT t."grade", t."memberOneFirstName", t."memberOneLastName",
        a."status", a."startedAt", a."endsAt", a."finishedAt",
        r."totalScore", r."correctCount", r."answeredCount",
        x."device", x."stars", x."comment"
      FROM "Team" t
      JOIN "ContestGroup" g ON g."id" = t."groupId"
      LEFT JOIN "Attempt" a ON a."teamId" = t."id"
      LEFT JOIN "Result" r ON r."attemptId" = a."id"
      LEFT JOIN "TestTrace" x ON x."attemptId" = a."id"
      WHERE g."contestId" = ?
      ORDER BY t."createdAt", t."id"`,
    )
    .bind(contest.id)
    .all<Record<string, unknown>>();

  const categories = contestCategories(contest);
  const rows = results.map((row, index) => {
    const startedAt = sqlDate(row.startedAt);
    const endsAt = sqlDate(row.endsAt);
    const finishedAt = sqlDate(row.finishedAt);
    const grade = (row.grade as string | null) ?? null;
    let device: { kind: string; width: number; height: number } | null = null;
    try {
      device = row.device ? JSON.parse(String(row.device)) : null;
    } catch {
      device = null;
    }
    return {
      code: `E${String(index + 1).padStart(2, "0")}`,
      name: `${row.memberOneFirstName} ${row.memberOneLastName}`.trim(),
      grade: SCHOOL_GRADES.find((item) => item.value === grade)?.label ?? grade,
      category: teamCategory(grade, categories),
      status: String(row.status ?? "pending"),
      seconds:
        startedAt && finishedAt
          ? Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000)
          : null,
      closedBy: finishedAt
        ? endsAt && finishedAt.getTime() >= endsAt.getTime()
          ? "timeout"
          : "student"
        : null,
      totalScore: (row.totalScore as number | null) ?? null,
      correctCount: (row.correctCount as number | null) ?? null,
      answeredCount: (row.answeredCount as number | null) ?? null,
      device: device && device.width ? device : null,
      stars: (row.stars as number | null) ?? null,
      comment: (row.comment as string | null) ?? null,
    };
  });
  const rated = rows.filter((row) => row.stars !== null);

  res.json({
    contestTitle: contest.title,
    collectUsage: contest.collectUsage,
    rows,
    summary: {
      students: rows.length,
      finished: rows.filter((row) => row.status === "finished").length,
      reviewed: rows.filter((row) => row.stars !== null || row.comment).length,
      averageStars: rated.length
        ? Math.round(
            (rated.reduce((sum, row) => sum + (row.stars ?? 0), 0) /
              rated.length) *
              10,
          ) / 10
        : null,
    },
  });
});

const TRIAL_TASKS: Record<"maestro" | "admin", string[]> = {
  maestro: ["M1", "M2", "M3", "M4", "M5", "M6", "M7"],
  admin: ["A1", "A2", "A3", "A4", "A5", "A6"],
};
const TRIAL_CRITICAL = ["M2", "M4", "A3", "A6"];
const TRIAL_RESULTS = ["alone", "help", "failed"];

function trialSusScore(answers: number[]) {
  const sum = answers.reduce(
    (total, value, index) => total + (index % 2 === 0 ? value - 1 : 5 - value),
    0,
  );
  return sum * 2.5;
}

const TRIAL_PREFIX = "[Ensayo]";
const TRIAL_CATEGORY = "Titi";
const TRIAL_GRADE = SCHOOL_GRADES.find((grade) => grade.value === "P5")!;
const TRIAL_TITLES = {
  inscripcion: `${TRIAL_PREFIX} Inscripción abierta`,
  curso: `${TRIAL_PREFIX} En curso`,
  terminado: `${TRIAL_PREFIX} Terminado`,
  porPublicar: `${TRIAL_PREFIX} Resultados por publicar`,
};
const TRIAL_SCENARIO_TASKS = ["M1", "M2", "M3", "M4", "M5", "M6", "M7", "A1", "A2", "A3", "A4", "A5", "A6"];
const TRIAL_ACCOUNT_KIND = "m1-account";
const TRIAL_DAY = 24 * 3_600_000;
const TRIAL_ROSTER: Array<[string, string]> = [
  ["Pedro", "Vargas"],
  ["Lucia", "Rojas"],
  ["Diego", "Ticona"],
  ["Elena", "Huanca"],
  ["Mateo", "Salazar"],
];
const TRIAL_STUDENTS: Array<[string, string]> = [
  ["Maria", "Flores"],
  ["Ana", "Quispe"],
  ["Carlos", "Choque"],
  ["Rosa", "Mendoza"],
  ["Jose", "Condori"],
  ["Luis", "Mamani"],
];

type TrialKind = keyof typeof TRIAL_TITLES;
type TrialSessionRow = { id: string; firstName: string; lastName: string };

function trialLabel(session: TrialSessionRow) {
  return `${session.firstName} ${session.lastName} #${session.id.slice(-4)}`;
}

async function trialQuestionBank(session: TrialSessionRow) {
  const block = (content: string) => [{ id: randomUUID(), type: "text", content, image: null, widthPercent: 100 }];
  for (let index = 1; index <= 5; index += 1) {
    const id = `ensayo-${session.id}-${index}`;
    if (await prisma.taskDraft.findUnique({ where: { id }, select: { id: true } })) continue;
    const payload = parseTaskPayload({
      title: `Pregunta de ensayo ${index}`,
      categories: [TASK_CATEGORIES[0]],
      difficulties: Object.fromEntries(TASK_AGE_RANGES.map((range) => [range, "easy"])),
      bodyBlocks: block(`Un castor ordena ${index + 2} fichas numeradas de menor a mayor.`),
      challengeBlocks: block("¿Qué número queda primero?"),
      answers: ["1", String(index + 2)].map((text, position) => ({ id: position ? "B" : "A", blocks: block(text) })),
      correctAnswerId: "A",
    });
    await prisma.taskDraft.create({ data: { id, ...payload, trialSessionId: session.id, forTeachers: true } });
  }
  return prisma.taskDraft.findMany({
    where: { trialSessionId: session.id, id: { startsWith: `ensayo-${session.id}-` } },
    select: { id: true, difficulties: true },
    orderBy: { id: "asc" },
  });
}

async function trialContest(kind: TrialKind, session: TrialSessionRow) {
  const label = trialLabel(session);
  const now = currentDate();
  const title = `${TRIAL_TITLES[kind]} · ${label}`;
  const found = await prisma.contest.findFirst({
    where: { title, trashedAt: null },
    orderBy: { createdAt: "desc" },
  });
  const usable =
    found &&
    (kind === "inscripcion"
      ? Boolean(
          found.registrationEndsAt &&
            found.registrationEndsAt.getTime() > now.getTime() + TRIAL_DAY,
        )
      : kind === "curso"
        ? Boolean(
            found.endsAt && found.endsAt.getTime() > now.getTime() + TRIAL_DAY,
          )
        : kind === "terminado" || !found.resultsPublishedAt);
  if (found && usable) {
    return found;
  }

  const drafts = await trialQuestionBank(session);
  const ageRange = CATEGORY_AGE_RANGE[TRIAL_CATEGORY];
  const taskInputs = drafts
    .filter((draft) =>
      isDifficultyKey(
        parseJsonValue<Record<string, unknown>>(draft.difficulties, {})[ageRange],
      ),
    )
    .slice(0, 5)
    .map((draft) => ({ taskId: draft.id, category: TRIAL_CATEGORY }));
  const scoring = parseContestScoring(undefined);
  const writes = await buildContestTaskWrites(taskInputs, [TRIAL_CATEGORY], scoring);
  const at = (days: number) => new Date(now.getTime() + days * TRIAL_DAY);
  const windows =
    kind === "inscripcion"
      ? { registrationStartsAt: at(-1), registrationEndsAt: at(14), startsAt: at(15), endsAt: at(16), durationMinutes: 45 }
      : kind === "curso"
        ? { registrationStartsAt: at(-10), registrationEndsAt: at(-2), startsAt: at(-1), endsAt: at(14), durationMinutes: 240 }
        : { registrationStartsAt: at(-10), registrationEndsAt: at(-5), startsAt: at(-4), endsAt: at(-3), durationMinutes: 45 };
  const ended = kind === "terminado" || kind === "porPublicar";

  return prisma.contest.create({
    data: {
      title,
      trialSessionId: session.id,
      categories: JSON.stringify([TRIAL_CATEGORY]),
      scoring: JSON.stringify(scoring),
      publishedAt: now,
      showTotalScore: true,
      showScoreOnSubmit: true,
      showFeedback: true,
      showSolutions: true,
      consolidatedAt: ended ? now : null,
      resultsReleasedAt: ended ? now : null,
      resultsPublishedAt: kind === "terminado" ? now : null,
      ...windows,
      tasks: { create: writes },
    },
  });
}

async function trialSeedGroup(
  contest: { id: string },
  ownerId: number,
  mode: "inscripcion" | "curso" | "terminado",
  names: Array<[string, string]>,
) {
  const group = await ensureCourseGroup(contest.id, TRIAL_GRADE, ownerId, null);
  if ((await prisma.team.count({ where: { groupId: group.id } })) > 0) {
    return group;
  }

  const tasks = await prisma.contestTask.findMany({
    where: { contestId: contest.id, category: TRIAL_CATEGORY },
    orderBy: { position: "asc" },
  });
  const now = currentDate();
  const minutes = (value: number) => value * 60_000;
  const answersFor = (studentIndex: number, count: number, answeredAt: Date) =>
    tasks.slice(0, count).map((task, taskIndex) => {
      const correct = (studentIndex + taskIndex) % 3 !== 0;
      return {
        taskDraftId: task.taskDraftId,
        responsePayload: "{}",
        isCorrect: correct,
        score: correct ? task.maxScore : task.minScore,
        answeredAt,
      };
    });
  const toFinish: string[] = [];

  for (let index = 0; index < names.length; index += 1) {
    const [first, last] = names[index];
    let attempt: Record<string, unknown> = { status: "pending" };
    let finishNow = false;

    if (mode === "curso") {
      if (index < 3) {
        const startedAt = new Date(now.getTime() - minutes(20));
        attempt = {
          status: "in_progress",
          startedAt,
          endsAt: new Date(now.getTime() + minutes(220)),
          answers: { create: answersFor(index, 2, startedAt) },
        };
      } else if (index < 5) {
        const startedAt = new Date(now.getTime() - minutes(60));
        attempt = {
          status: "in_progress",
          startedAt,
          endsAt: new Date(now.getTime() + minutes(180)),
          answers: { create: answersFor(index, tasks.length, startedAt) },
        };
        finishNow = true;
      }
    } else if (mode === "terminado") {
      const startedAt = new Date(now.getTime() - 3.5 * TRIAL_DAY + minutes(index * 5));
      attempt = {
        status: "in_progress",
        startedAt,
        endsAt: new Date(startedAt.getTime() + minutes(45)),
        answers: { create: answersFor(index, tasks.length, startedAt) },
      };
    }

    const team = await prisma.team.create({
      data: {
        groupId: group.id,
        participationMode: "individual",
        grade: TRIAL_GRADE.value,
        memberOneFirstName: first,
        memberOneLastName: last,
        personalCode: await generateUniquePersonalCode(),
        attempt: { create: attempt as never },
      },
      include: { attempt: true },
    });
    if (finishNow && team.attempt) {
      toFinish.push(team.attempt.id);
    }
  }

  for (const attemptId of toFinish) {
    await finalizeAttempt(attemptId);
  }
  if (mode === "terminado") {
    await consolidateContest(contest.id);
  }
  return group;
}

async function trialDropCreatedAccounts(sessionId?: string) {
  await prisma.user.deleteMany({
    where: {
      role: "maestro",
      status: "pending",
      ...(sessionId ? { trialSessionId: sessionId } : {}),
      trialEvents: { some: { kind: TRIAL_ACCOUNT_KIND } },
    },
  });
}

async function trialCloseRegistration(sessionId: string) {
  const key = `trial:${sessionId}:${TEACHER_REGISTRATION_KEY}`;
  await prisma.siteSetting.upsert({
    where: { key },
    create: { key, value: "closed" },
    update: { value: "closed" },
  });
}

async function trialPrepare(
  userId: number,
  session: TrialSessionRow,
  taskCode: string,
) {
  if (taskCode === "M1") {
    await prisma.siteSetting.upsert({
      where: { key: `trial:${session.id}:${TEACHER_REGISTRATION_KEY}` },
      create: { key: `trial:${session.id}:${TEACHER_REGISTRATION_KEY}`, value: "open" },
      update: { value: "open" },
    });
    return {
      note: "El registro está abierto en este entorno de ensayo. La cuenta que cree pertenece únicamente a esta prueba.",
    };
  }

  if (taskCode === "M2") {
    const contest = await trialContest("inscripcion", session);
    await ensureCourseGroup(contest.id, TRIAL_GRADE, userId, null);
    return {
      note: `Preparamos el desafío «${contest.title}». Tienes una planilla de ejemplo para subir.`,
      planilla: true,
    };
  }

  if (taskCode === "M3" || taskCode === "M4") {
    const contest = await trialContest("inscripcion", session);
    const group = await trialSeedGroup(contest, userId, "inscripcion", [
      ["Mria", "Flres"],
      ...TRIAL_STUDENTS.slice(1),
    ]);
    if (taskCode === "M3") {
      await trialEnsureTypo(group.id);
    }
    return {
      note:
        taskCode === "M3"
          ? `Hay estudiantes inscritos en «${contest.title}». Uno tiene el nombre mal escrito.`
          : `Hay estudiantes inscritos en «${contest.title}».`,
    };
  }

  if (taskCode === "M5") {
    const contest = await trialContest("curso", session);
    await trialSeedGroup(contest, userId, "curso", TRIAL_STUDENTS);
    return {
      note: `Hay un desafío en curso: «${contest.title}», con estudiantes rindiendo.`,
    };
  }

  if (taskCode === "M6") {
    const contest = await trialContest("terminado", session);
    await trialSeedGroup(contest, userId, "terminado", TRIAL_STUDENTS);
    return {
      note: `Hay un desafío terminado con resultados: «${contest.title}».`,
    };
  }

  if (taskCode === "M7") {
    await trialQuestionBank(session);
    return { note: "Tienes preguntas de ensayo disponibles para armar la práctica." };
  }

  if (taskCode === "A1") {
    const email = trialPendingEmail(session);
    const found = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (!found) {
      await prisma.user.create({
        data: {
          email,
          trialSessionId: session.id,
          firstName: "Maestro",
          lastName: `Ensayo ${session.firstName}`,
          role: "maestro",
          status: "pending",
          schoolName: "Unidad Educativa de Ensayo",
          department: "Cochabamba",
          city: "Cochabamba",
        },
      });
    }
    return {
      note: "Hay una solicitud de maestro pendiente de aprobar.",
      path: "/",
    };
  }

  if (taskCode === "A2") {
    return { note: null, path: "/" };
  }

  if (taskCode === "A3") {
    await trialQuestionBank(session);
    return { note: "Tienes preguntas de ensayo disponibles para elegir.", path: "/" };
  }

  if (taskCode === "A4") {
    const contest = await trialContest("inscripcion", session);
    return {
      note: `Puedes probar el desafío «${contest.title}».`,
      path: "/",
    };
  }

  if (taskCode === "A5") {
    const contest = await trialContest("curso", session);
    return {
      note: `Hay un desafío en curso: «${contest.title}».`,
      path: "/",
    };
  }

  const contest = await trialContest("terminado", session);
  await trialSeedGroup(contest, userId, "terminado", TRIAL_STUDENTS);
  return {
    note: `Hay un desafío terminado con resultados: «${contest.title}».`,
    path: "/",
  };
}

async function trialLoadSession(req: express.Request, res: express.Response) {
  const session = await prisma.trialSession.findUnique({
    where: { id: String(req.params.id) },
  });
  if (!session) {
    res.status(404).json({ message: "Prueba no encontrada." });
    return null;
  }
  return session;
}

function trialSessionRole(session: { role: string }) {
  return session.role === "admin" ? "admin" : "maestro";
}

function trialTeacherEmail(session: TrialSessionRow) {
  return `ensayo.${session.id.slice(-8).toLowerCase()}@prueba.bo`;
}

async function trialTeacher(session: TrialSessionRow) {
  const email = trialTeacherEmail(session);
  const found = await prisma.user.findUnique({ where: { email } });
  if (found) {
    return found;
  }
  return prisma.user.create({
    data: {
      email,
      trialSessionId: session.id,
      firstName: session.firstName,
      lastName: session.lastName,
      name: `${session.firstName} ${session.lastName}`,
      role: "maestro",
      status: "approved",
      schoolName: "Unidad Educativa de Ensayo",
      department: "Cochabamba",
      city: "Cochabamba",
    },
  });
}

async function trialOrganizer(session: TrialSessionRow) {
  const email = `ensayo.a${session.id.slice(-8).toLowerCase()}@prueba.bo`;
  return prisma.user.upsert({
    where: { email },
    create: { email, trialSessionId: session.id, firstName: session.firstName, lastName: session.lastName,
      name: `${session.firstName} ${session.lastName}`, role: "admin", status: "approved" },
    update: {},
  });
}

function trialPendingEmail(session: TrialSessionRow) {
  return `ensayo.p${session.id.slice(-8).toLowerCase()}@prueba.bo`;
}

async function trialEnsureTypo(groupId: string) {
  const same = await prisma.team.findFirst({
    where: { groupId, memberOneLastName: { in: ["Flres", "Flores"] } },
    select: { id: true },
  });
  if (same) {
    return;
  }
  await prisma.team.create({
    data: {
      groupId,
      participationMode: "individual",
      grade: TRIAL_GRADE.value,
      memberOneFirstName: "Mria",
      memberOneLastName: "Flres",
      personalCode: await generateUniquePersonalCode(),
      attempt: { create: { status: "pending" } },
    },
  });
}

async function trialTouch(req: express.Request, kind: string) {
  const user = req.user;
  if (!user || !user.email.startsWith("ensayo.")) {
    return;
  }
  await prisma.trialEvent.create({ data: { userId: user.id, kind } });
}

async function trialCheck(
  session: TrialSessionRow & { role: string },
  taskCode: string,
  since: Date,
) {
  const label = trialLabel(session);
  const owner =
    trialSessionRole(session) === "maestro" ? await trialTeacher(session) : await trialOrganizer(session);
  const titleOf = (kind: TrialKind) => `${TRIAL_TITLES[kind]} · ${label}`;
  const groupOf = async (kind: TrialKind) => {
    if (!owner) {
      return null;
    }
    const contest = await prisma.contest.findFirst({
      where: { title: titleOf(kind), trashedAt: null },
      select: { id: true },
    });
    if (!contest) {
      return null;
    }
    return prisma.contestGroup.findFirst({
      where: {
        contestId: contest.id,
        createdById: owner.id,
        grade: TRIAL_GRADE.value,
      },
      select: { id: true },
    });
  };
  const eventAt = async (kind: string) => {
    if (!owner) {
      return null;
    }
    const event = await prisma.trialEvent.findFirst({
      where: { userId: owner.id, kind, createdAt: { gt: since } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });
    return event?.createdAt ?? null;
  };

  let at: Date | null = null;

  if (taskCode === "M1") {
    const teacher = await prisma.user.findFirst({
      where: {
        role: "maestro",
        trialSessionId: session.id,
        createdAt: { gt: since },
        NOT: { email: { startsWith: "ensayo." } },
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, createdAt: true },
    });
    if (teacher) {
      const flagged = await prisma.trialEvent.findFirst({
        where: { userId: teacher.id, kind: TRIAL_ACCOUNT_KIND },
        select: { id: true },
      });
      if (!flagged) {
        await prisma.trialEvent.create({
          data: { userId: teacher.id, kind: TRIAL_ACCOUNT_KIND },
        });
      }
    }
    at = teacher?.createdAt ?? null;
  } else if (taskCode === "M2") {
    const group = await groupOf("inscripcion");
    const team = group
      ? await prisma.team.findFirst({
          where: { groupId: group.id, createdAt: { gt: since } },
          orderBy: { createdAt: "asc" },
          select: { createdAt: true },
        })
      : null;
    at = team?.createdAt ?? null;
  } else if (taskCode === "M3") {
    const group = await groupOf("inscripcion");
    const team = group
      ? await prisma.team.findFirst({
          where: {
            groupId: group.id,
            memberOneLastName: "Flores",
            memberOneFirstName: { in: ["Maria", "María"] },
            updatedAt: { gt: since },
          },
          select: { updatedAt: true },
        })
      : null;
    at = team?.updatedAt ?? null;
  } else if (taskCode === "M4") {
    at = await eventAt("codes");
  } else if (taskCode === "M5") {
    const group = await groupOf("curso");
    at = group ? await eventAt(`group:${group.id}`) : null;
  } else if (taskCode === "M6") {
    at = await eventAt("results-excel");
  } else if (taskCode === "M7") {
    const practice = owner
      ? await prisma.contest.findFirst({
          where: {
            isPractice: true,
            createdById: owner.id,
            createdAt: { gt: since },
          },
          select: { createdAt: true },
        })
      : null;
    at = practice?.createdAt ?? null;
  } else if (taskCode === "A1") {
    const teacher = await prisma.user.findUnique({
      where: { email: trialPendingEmail(session) },
      select: { status: true, updatedAt: true },
    });
    at =
      teacher && teacher.status === "approved" && teacher.updatedAt > since
        ? teacher.updatedAt
        : null;
  } else if (taskCode === "A2") {
    const draft = await prisma.taskDraft.findFirst({
      where: { trialSessionId: session.id, createdAt: { gt: since }, answerType: "multiple_choice", NOT: { id: { startsWith: `ensayo-${session.id}-` } } },
      select: { createdAt: true },
    });
    at = draft?.createdAt ?? null;
  } else if (taskCode === "A3") {
    const made = await prisma.contest.findMany({
      where: {
        createdAt: { gt: since },
        trialSessionId: session.id,
        publishedAt: { not: null },
        isPractice: false,
        isTest: false,
        NOT: { title: { startsWith: TRIAL_PREFIX } },
      },
      select: { publishedAt: true, categories: true },
    });
    at =
      made.find((contest) => contestCategories(contest).length >= 2)
        ?.publishedAt ?? null;
  } else if (taskCode === "A4") {
    const contest = await prisma.contest.findFirst({
      where: { title: titleOf("inscripcion"), trashedAt: null },
      select: { id: true },
    });
    const event = contest
      ? await prisma.trialEvent.findFirst({
          where: {
            kind: `preview:${contest.id}`,
            createdAt: { gt: since },
          },
          orderBy: { createdAt: "asc" },
          select: { createdAt: true },
        })
      : null;
    at = event?.createdAt ?? null;
  } else if (taskCode === "A5") {
    const contest = await prisma.contest.findFirst({
      where: { title: titleOf("curso"), trashedAt: null },
      select: { createdAt: true, endsAt: true, updatedAt: true },
    });
    at =
      contest?.endsAt &&
      contest.endsAt.getTime() - contest.createdAt.getTime() >
        14 * TRIAL_DAY + 60_000
        ? contest.updatedAt
        : null;
  } else if (taskCode === "A6") {
    const contest = await prisma.contest.findFirst({
      where: { title: titleOf("terminado"), trashedAt: null },
      select: { id: true },
    });
    const event = contest
      ? await prisma.trialEvent.findFirst({
          where: { kind: `results:${contest.id}`, createdAt: { gt: since } },
          orderBy: { createdAt: "asc" },
          select: { createdAt: true },
        })
      : null;
    at = event?.createdAt ?? null;
  }

  return { done: Boolean(at), at: at?.toISOString() ?? null };
}

app.post("/api/admin/trial/sessions", async (req, res) => {
  const role =
    req.body?.role === "admin" || req.body?.role === "maestro"
      ? (req.body.role as "admin" | "maestro")
      : null;
  const clean = (value: unknown) =>
    formatName(typeof value === "string" ? value : "");
  const firstName = clean(req.body?.firstName);
  const lastName = clean(req.body?.lastName);

  if (!role) {
    res.status(400).json({ message: "Elige qué prueba es." });
    return;
  }

  if (
    firstName.length < 2 ||
    lastName.length < 2 ||
    firstName.length > 40 ||
    lastName.length > 40
  ) {
    res.status(400).json({ message: "Escribe el nombre y el apellido." });
    return;
  }

  const session = await prisma.trialSession.create({
    data: { role, firstName, lastName },
  });
  if (role === "maestro") {
    await trialTeacher(session);
  } else {
    await trialOrganizer(session);
  }
  res.status(201).json({ id: session.id });
});

app.get("/api/admin/trial/sessions/:id", async (req, res) => {
  const session = await trialLoadSession(req, res);
  if (!session) {
    return;
  }

  const [runs, sus] = await Promise.all([
    prisma.trialRun.findMany({
      where: { sessionId: session.id },
      select: { taskCode: true, result: true, seconds: true, comment: true },
    }),
    prisma.trialSus.findUnique({
      where: { sessionId: session.id },
      select: { sessionId: true },
    }),
  ]);
  const role = trialSessionRole(session);
  const teacher = role === "maestro" ? await trialTeacher(session) : null;
  const actor = teacher ?? await trialOrganizer(session);

  res.json({
    role,
    tasks: TRIAL_TASKS[role],
    runs,
    susDone: Boolean(sus),
    person: { firstName: session.firstName, lastName: session.lastName },
    teacher: teacher
      ? { id: teacher.id, email: teacher.email, name: teacher.name ?? "" }
      : null,
    actor: { id: actor.id, email: actor.email, name: actor.name ?? "", role: actor.role },
  });
});

app.put("/api/admin/trial/sessions/:id/runs/:taskCode", async (req, res) => {
  const session = await trialLoadSession(req, res);
  if (!session) {
    return;
  }

  const taskCode = String(req.params.taskCode).toUpperCase();
  const result = String(req.body?.result ?? "");

  if (!TRIAL_TASKS[trialSessionRole(session)].includes(taskCode)) {
    res.status(404).json({ message: "Esa tarea no es de esta prueba." });
    return;
  }

  if (!TRIAL_RESULTS.includes(result)) {
    res.status(400).json({ message: "Elige cómo le fue con la tarea." });
    return;
  }

  const seconds = Math.min(
    Math.max(Math.round(Number(req.body?.seconds) || 0), 0),
    86400,
  );
  const comment =
    typeof req.body?.comment === "string"
      ? req.body.comment.trim().slice(0, 500) || null
      : null;

  await prisma.trialRun.upsert({
    where: { sessionId_taskCode: { sessionId: session.id, taskCode } },
    create: { sessionId: session.id, taskCode, result, seconds, comment },
    update: { result, seconds, comment },
  });

  if (taskCode === "M1") {
    await trialCloseRegistration(session.id);
  }

  res.status(204).send();
});

app.put("/api/admin/trial/sessions/:id/sus", async (req, res) => {
  const session = await trialLoadSession(req, res);
  if (!session) {
    return;
  }

  const answers = req.body?.answers;

  if (
    !Array.isArray(answers) ||
    answers.length !== 10 ||
    !answers.every(
      (value) => Number.isInteger(value) && value >= 1 && value <= 5,
    )
  ) {
    res.status(400).json({ message: "Responde las 10 frases." });
    return;
  }

  const score = trialSusScore(answers as number[]);
  await prisma.trialSus.upsert({
    where: { sessionId: session.id },
    create: { sessionId: session.id, answers: JSON.stringify(answers), score },
    update: { answers: JSON.stringify(answers), score },
  });

  res.status(204).send();
});

app.post("/api/admin/trial/sessions/:id/prepare/:taskCode", async (req, res) => {
  const session = await trialLoadSession(req, res);
  if (!session) {
    return;
  }

  const taskCode = String(req.params.taskCode).toUpperCase();

  if (!TRIAL_TASKS[trialSessionRole(session)].includes(taskCode)) {
    res.status(404).json({ message: "Esa tarea no es de esta prueba." });
    return;
  }

  if (!TRIAL_SCENARIO_TASKS.includes(taskCode)) {
    res.json({ note: null });
    return;
  }

  const owner =
    trialSessionRole(session) === "maestro"
      ? (await trialTeacher(session)).id
      : (await trialOrganizer(session)).id;
  res.json(await trialPrepare(owner, session, taskCode));
});

app.delete("/api/admin/trial/sessions/:id", async (req, res) => {
  const session = await trialLoadSession(req, res);
  if (!session) {
    return;
  }

  await trialClearSessionData(session.id);
  await prisma.trialSession.delete({ where: { id: session.id } });
  res.status(204).send();
});

app.get("/api/admin/trial/sessions/:id/check/:taskCode", async (req, res) => {
  const session = await trialLoadSession(req, res);
  if (!session) {
    return;
  }

  const taskCode = String(req.params.taskCode).toUpperCase();
  const since = new Date(Number(req.query.since));

  if (Number.isNaN(since.getTime())) {
    res.status(400).json({ message: "Falta la hora de inicio." });
    return;
  }

  if (!TRIAL_TASKS[trialSessionRole(session)].includes(taskCode)) {
    res.status(404).json({ message: "Esa tarea no es de esta prueba." });
    return;
  }

  res.json(await trialCheck(session, taskCode, since));
});

app.get("/api/admin/trial/planilla.xlsx", async (_req, res) => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Estudiantes");
  sheet.columns = [{ width: 24 }, { width: 24 }, { width: 22 }];
  sheet.addRow(["Nombres", "Apellidos", "Curso"]).font = { bold: true };
  for (const [first, last] of TRIAL_ROSTER) {
    sheet.addRow([first, last, TRIAL_GRADE.label]);
  }
  await sendWorkbook(res, workbook, "planilla-de-ejemplo.xlsx");
});

app.delete("/api/admin/trial-scenarios", async (_req, res) => {
  const sessions = await prisma.trialSession.findMany({ select: { id: true } });
  const contests = await prisma.contest.count({ where: { OR: [{ trialSessionId: { not: null } }, { title: { startsWith: TRIAL_PREFIX } }] } });
  const users = await prisma.user.count({ where: { OR: [{ trialSessionId: { not: null } }, { email: { startsWith: "ensayo.", endsWith: "@prueba.bo" } }] } });
  for (const session of sessions) await trialClearSessionData(session.id);
  const contestWhere = { title: { startsWith: TRIAL_PREFIX } };
  const userWhere = {
    email: { startsWith: "ensayo.", endsWith: "@prueba.bo" },
  };
  await prisma.contest.deleteMany({ where: contestWhere });
  await prisma.user.deleteMany({ where: userWhere });
  await trialDropCreatedAccounts();
  res.json({ contests, users });
});

async function trialClearSessionData(sessionId: string) {
  await prisma.contest.deleteMany({ where: { trialSessionId: sessionId } });
  await prisma.taskDraft.deleteMany({ where: { trialSessionId: sessionId } });
  await trialDropCreatedAccounts(sessionId);
  await prisma.user.deleteMany({ where: { trialSessionId: sessionId } });
  await prisma.siteSetting.deleteMany({ where: { key: { startsWith: `trial:${sessionId}:` } } });
}

app.get("/api/admin/trial", async (_req, res) => {
  const sessions = await prisma.trialSession.findMany({
    select: {
      id: true,
      role: true,
      firstName: true,
      lastName: true,
      runs: {
        select: { taskCode: true, result: true, seconds: true, comment: true },
      },
      sus: { select: { score: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const counters = { maestro: 0, admin: 0 };
  const participants = sessions.map((session) => {
    const role = trialSessionRole(session);
    counters[role] += 1;
    const tasks = Object.fromEntries(
      session.runs.map((run) => [
        run.taskCode,
        { result: run.result, seconds: run.seconds, comment: run.comment },
      ]),
    );
    return {
      id: session.id,
      code: `${role === "admin" ? "A" : "M"}${String(counters[role]).padStart(2, "0")}`,
      name: `${session.firstName} ${session.lastName}`,
      role,
      tasks,
      sus: session.sus?.score ?? null,
      criticalDone: TRIAL_CRITICAL.filter((code) => TRIAL_TASKS[role].includes(code)).every(
        (code) => tasks[code] && tasks[code].result !== "failed",
      ),
    };
  });

  const summary = Object.fromEntries(
    (["maestro", "admin"] as const).map((role) => {
      const members = participants.filter((item) => item.role === role);
      const runs = members.flatMap((item) => Object.values(item.tasks));
      const scores = members.flatMap((item) =>
        item.sus === null ? [] : [item.sus],
      );
      return [
        role,
        {
          participants: members.length,
          alone: runs.filter((run) => run.result === "alone").length,
          help: runs.filter((run) => run.result === "help").length,
          failed: runs.filter((run) => run.result === "failed").length,
          averageSus: scores.length
            ? Math.round(
                (scores.reduce((sum, value) => sum + value, 0) /
                  scores.length) *
                  10,
              ) / 10
            : null,
        },
      ];
    }),
  );

  res.json({ participants, summary });
});

app.get("/api/contests/:id/results", async (req, res) => {
  await releaseDueResults(String(req.params.id));
  if (req.user) {
    const viewed = await prisma.contest.findUnique({
      where: { id: String(req.params.id) },
      select: { id: true, title: true },
    });
    if (viewed?.title.startsWith(TRIAL_PREFIX)) {
      await prisma.trialEvent.create({
        data: { userId: req.user.id, kind: `results:${viewed.id}` },
      });
    }
  }
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
        team.attempt?.mode !== "paper" &&
        team.attempt?.startedAt &&
        team.attempt.finishedAt
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
const server = httpServerHandler({ port: 3000 });

export default {
  ...server,
  // Cada cinco minutos: publica la práctica si cambió algo que no pasó por
  // las rutas de tareas (scripts de carga, cambios directos en D1).
  async scheduled(_controller: ScheduledController, _env: unknown, ctx: ExecutionContext) {
    ctx.waitUntil(withRequestPrisma(async () => {
      await purgeExpiredContests();
      await refreshPracticeSnapshotQuietly();
    }));
  },
};
