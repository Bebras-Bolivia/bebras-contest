import fs from "node:fs";
import { parseTaskAnswerConfig } from "../src/lib/task-answers/config";
import path from "node:path";

export const AGE_RANGES = [
  "5–8",
  "8–10",
  "10–12",
  "12–14",
  "14–16",
  "17–18",
] as const;

export const LEVEL_TO_AGE_RANGE = {
  I: "5–8",
  II: "8–10",
  III: "10–12",
  IV: "12–14",
  V: "14–16",
  VI: "17–18",
} as const;

export const CANONICAL_CATEGORIES = [
  "Algoritmos y programación",
  "Estructuras de datos y representaciones",
  "Procesos computacionales y hardware",
  "Comunicación y redes",
  "Interacción, sistemas y sociedad",
] as const;

type AgeRange = (typeof AGE_RANGES)[number];
type CanonicalCategory = (typeof CANONICAL_CATEGORIES)[number];
type Difficulty = "" | "easy" | "medium" | "hard";
type JsonObject = Record<string, unknown>;

export type TaskMetadata = {
  number: number;
  id: string;
  title: string;
  country: string;
  year: number;
  sourceTaskCode: string;
  difficulties: Record<AgeRange, Difficulty>;
  master: boolean;
  hasSolutionImage: boolean;
};

function difficulties(
  I: Difficulty,
  II: Difficulty,
  III: Difficulty,
  IV: Difficulty,
  V: Difficulty,
  VI: Difficulty,
): Record<AgeRange, Difficulty> {
  return {
    [LEVEL_TO_AGE_RANGE.I]: I,
    [LEVEL_TO_AGE_RANGE.II]: II,
    [LEVEL_TO_AGE_RANGE.III]: III,
    [LEVEL_TO_AGE_RANGE.IV]: IV,
    [LEVEL_TO_AGE_RANGE.V]: V,
    [LEVEL_TO_AGE_RANGE.VI]: VI,
  };
}

// Verified against Guía de Soluciones Otoño 2024, in booklet order.
export const TASK_METADATA: readonly TaskMetadata[] = [
  {
    number: 1,
    id: "bebras-2024-01-caja-de-pulseras",
    title: "Caja de Pulseras",
    country: "Brasil",
    year: 2024,
    sourceTaskCode: "2024-BR-04",
    difficulties: difficulties("easy", "easy", "", "", "", ""),
    master: true,
    hasSolutionImage: true,
  },
  {
    number: 2,
    id: "bebras-2024-02-la-pelota",
    title: "La pelota",
    country: "Países Bajos",
    year: 2024,
    sourceTaskCode: "2024-NL-02",
    difficulties: difficulties("easy", "easy", "easy", "", "", ""),
    master: true,
    hasSolutionImage: true,
  },
  {
    number: 3,
    id: "bebras-2024-03-tarjetas-de-riccas",
    title: "Tarjetas de Riccas",
    country: "Suiza",
    year: 2024,
    sourceTaskCode: "2024-CH-03b",
    difficulties: difficulties("medium", "medium", "", "", "", ""),
    master: true,
    hasSolutionImage: true,
  },
  {
    number: 4,
    id: "bebras-2024-04-caminando-bosque",
    title: "Caminando por el bosque",
    country: "Indonesia",
    year: 2024,
    sourceTaskCode: "2024-ID-04",
    difficulties: difficulties("medium", "medium", "", "", "", ""),
    master: false,
    hasSolutionImage: false,
  },
  {
    number: 5,
    id: "bebras-2024-05-pintando",
    title: "Pintando",
    country: "Finlandia",
    year: 2024,
    sourceTaskCode: "2024-FI-01",
    difficulties: difficulties("medium", "medium", "medium", "", "", ""),
    master: true,
    hasSolutionImage: true,
  },
  {
    number: 6,
    id: "bebras-2024-06-treboles-giratorios",
    title: "Tréboles giratorios",
    country: "Irlanda",
    year: 2024,
    sourceTaskCode: "2024-IE-01b",
    difficulties: difficulties("medium", "easy", "", "", "", ""),
    master: true,
    hasSolutionImage: false,
  },
  {
    number: 7,
    id: "bebras-2024-07-fiesta",
    title: "Fiesta",
    country: "Corea del Sur",
    year: 2024,
    sourceTaskCode: "2024-KR-02",
    difficulties: difficulties("hard", "medium", "", "", "", ""),
    master: true,
    hasSolutionImage: true,
  },
  {
    number: 8,
    id: "bebras-2024-08-platos-en-la-repisa",
    title: "Platos en la Repisa",
    country: "Lituania",
    year: 2024,
    sourceTaskCode: "2024-LT-01",
    difficulties: difficulties("medium", "", "", "", "", ""),
    master: true,
    hasSolutionImage: false,
  },
  {
    number: 9,
    id: "bebras-2024-09-tubo-canicas",
    title: "Tubo de Canicas",
    country: "Corea del Sur",
    year: 2024,
    sourceTaskCode: "2024-KR-03a",
    difficulties: difficulties("hard", "hard", "hard", "", "", ""),
    master: false,
    hasSolutionImage: true,
  },
  {
    number: 10,
    id: "bebras-2024-10-video-llamada",
    title: "Video llamada",
    country: "Malasia",
    year: 2024,
    sourceTaskCode: "2024-MY-03",
    difficulties: difficulties("", "hard", "easy", "easy", "", ""),
    master: true,
    hasSolutionImage: true,
  },
  {
    number: 11,
    id: "bebras-2024-11-dibujando-barquitos",
    title: "Dibujando Barquitos",
    country: "Polonia",
    year: 2024,
    sourceTaskCode: "2024-PL-03",
    difficulties: difficulties("", "easy", "easy", "", "", ""),
    master: false,
    hasSolutionImage: true,
  },
  {
    number: 12,
    id: "bebras-2024-12-sonaja-oliver",
    title: "La Sonaja de Oliver",
    country: "Eslovaquia",
    year: 2024,
    sourceTaskCode: "2024-SK-01b",
    difficulties: difficulties("", "medium", "easy", "", "", ""),
    master: true,
    hasSolutionImage: false,
  },
  {
    number: 13,
    id: "bebras-2024-13-arbol-flor-milagrosa",
    title: "El árbol de la flor Milagrosa",
    country: "Alemania",
    year: 2024,
    sourceTaskCode: "2024-DE-03",
    difficulties: difficulties("", "hard", "hard", "hard", "", ""),
    master: true,
    hasSolutionImage: true,
  },
  {
    number: 14,
    id: "bebras-2024-14-camino-de-robot",
    title: "Camino de robot",
    country: "Polonia",
    year: 2024,
    sourceTaskCode: "2024-PL-04",
    difficulties: difficulties("", "hard", "hard", "medium", "", ""),
    master: true,
    hasSolutionImage: true,
  },
  {
    number: 15,
    id: "bebras-2024-15-estacionamiento-barcos",
    title: "Estacionamiento de Barcos",
    country: "Malta",
    year: 2024,
    sourceTaskCode: "2024-MT-02",
    difficulties: difficulties("", "hard", "hard", "hard", "", ""),
    master: true,
    hasSolutionImage: false,
  },
  {
    number: 16,
    id: "bebras-2024-16-fiesta-pizza",
    title: "Fiesta de pizza",
    country: "Alemania",
    year: 2024,
    sourceTaskCode: "2024-DE-02",
    difficulties: difficulties("", "medium", "easy", "easy", "", ""),
    master: false,
    hasSolutionImage: true,
  },
  {
    number: 17,
    id: "bebras-2024-17-faros",
    title: "Faros",
    country: "Chequia",
    year: 2024,
    sourceTaskCode: "2024-CZ-05",
    difficulties: difficulties("", "", "medium", "", "", ""),
    master: false,
    hasSolutionImage: true,
  },
  {
    number: 18,
    id: "bebras-2024-18-tarjetas-monstruos",
    title: "Tarjetas de Monstruos",
    country: "Suiza",
    year: 2024,
    sourceTaskCode: "2024-CH-03a",
    difficulties: difficulties("", "", "medium", "easy", "", ""),
    master: false,
    hasSolutionImage: true,
  },
  {
    number: 19,
    id: "bebras-2024-19-dias-soleados",
    title: "Días Soleados",
    country: "Alemania",
    year: 2024,
    sourceTaskCode: "2024-DE-04a",
    difficulties: difficulties("", "", "medium", "medium", "easy", ""),
    master: true,
    hasSolutionImage: false,
  },
  {
    number: 20,
    id: "bebras-2024-20-creando-juego",
    title: "Creando un juego",
    country: "Alemania",
    year: 2024,
    sourceTaskCode: "2024-DE-07",
    difficulties: difficulties("", "", "medium", "medium", "medium", ""),
    master: false,
    hasSolutionImage: true,
  },
  {
    number: 21,
    id: "bebras-2024-21-tour-bosque",
    title: "Tour por el Bosque",
    country: "Alemania",
    year: 2024,
    sourceTaskCode: "2024-DE-08",
    difficulties: difficulties("", "", "hard", "hard", "medium", ""),
    master: true,
    hasSolutionImage: true,
  },
  {
    number: 22,
    id: "bebras-2024-22-alfombra-roja",
    title: "La alfombra Roja",
    country: "Hungría",
    year: 2024,
    sourceTaskCode: "2024-HU-02",
    difficulties: difficulties("", "", "medium", "easy", "easy", ""),
    master: false,
    hasSolutionImage: false,
  },
  {
    number: 23,
    id: "bebras-2024-23-regla-secreta",
    title: "Regla Secreta",
    country: "India",
    year: 2024,
    sourceTaskCode: "2024-IN-04",
    difficulties: difficulties("", "", "medium", "easy", "easy", ""),
    master: false,
    hasSolutionImage: false,
  },
  {
    number: 24,
    id: "bebras-2024-24-el-siguiente-por-favor",
    title: "El siguiente por favor",
    country: "Eslovenia",
    year: 2024,
    sourceTaskCode: "2024-SI-01",
    difficulties: difficulties("", "", "hard", "hard", "hard", "hard"),
    master: true,
    hasSolutionImage: false,
  },
  {
    number: 25,
    id: "bebras-2024-25-moviendo-bloques",
    title: "Moviendo Bloques",
    country: "Bélgica",
    year: 2024,
    sourceTaskCode: "2024-BE-01a",
    difficulties: difficulties("", "", "", "medium", "medium", ""),
    master: false,
    hasSolutionImage: false,
  },
  {
    number: 26,
    id: "bebras-2024-26-prestamo-canicas",
    title: "Préstamo de Canicas",
    country: "Austria",
    year: 2024,
    sourceTaskCode: "2024-AT-03",
    difficulties: difficulties("", "", "", "medium", "medium", "easy"),
    master: false,
    hasSolutionImage: false,
  },
  {
    number: 27,
    id: "bebras-2024-27-cadenas-de-codigos",
    title: "Cadenas de Códigos",
    country: "Canadá",
    year: 2024,
    sourceTaskCode: "2024-CA-02",
    difficulties: difficulties("", "", "", "medium", "medium", "medium"),
    master: true,
    hasSolutionImage: false,
  },
  {
    number: 28,
    id: "bebras-2024-28-maquina-globos",
    title: "Máquina de Globos",
    country: "Alemania",
    year: 2024,
    sourceTaskCode: "2024-DE-06a",
    difficulties: difficulties("", "", "", "hard", "hard", "hard"),
    master: false,
    hasSolutionImage: true,
  },
  {
    number: 29,
    id: "bebras-2024-29-encontrando-el-tesoro",
    title: "Encontrando el Tesoro",
    country: "Hungría",
    year: 2024,
    sourceTaskCode: "2024-HU-03",
    difficulties: difficulties("", "", "", "hard", "hard", "medium"),
    master: true,
    hasSolutionImage: false,
  },
  {
    number: 30,
    id: "bebras-2024-30-pulsera-mas-larga",
    title: "La pulsera más larga",
    country: "Taiwán",
    year: 2024,
    sourceTaskCode: "2024-TW-03",
    difficulties: difficulties("", "", "", "hard", "hard", "medium"),
    master: true,
    hasSolutionImage: false,
  },
  {
    number: 31,
    id: "bebras-2024-31-secuencia-pelotas",
    title: "Secuencia de Pelotas",
    country: "Bulgaria",
    year: 2024,
    sourceTaskCode: "2024-BG-01b",
    difficulties: difficulties("", "", "", "", "hard", "hard"),
    master: false,
    hasSolutionImage: true,
  },
  {
    number: 32,
    id: "bebras-2024-32-amigos",
    title: "Amigos",
    country: "Lituania",
    year: 2024,
    sourceTaskCode: "2024-LT-05",
    difficulties: difficulties("", "", "", "", "hard", "hard"),
    master: true,
    hasSolutionImage: true,
  },
  {
    number: 33,
    id: "bebras-2024-33-red-trenes",
    title: "Red de trenes",
    country: "Pakistán",
    year: 2024,
    sourceTaskCode: "2024-PK-03",
    difficulties: difficulties("", "", "", "", "hard", "hard"),
    master: false,
    hasSolutionImage: true,
  },
  {
    number: 34,
    id: "bebras-2024-34-puntos-por-letras",
    title: "Puntos por Letras",
    country: "Eslovaquia",
    year: 2024,
    sourceTaskCode: "2024-SK-04",
    difficulties: difficulties("", "", "", "", "hard", "hard"),
    master: true,
    hasSolutionImage: true,
  },
  {
    number: 35,
    id: "bebras-2024-35-escondiendo-comida",
    title: "Escondiendo Comida",
    country: "Italia",
    year: 2024,
    sourceTaskCode: "2024-IT-01b",
    difficulties: difficulties("", "", "", "", "hard", "hard"),
    master: false,
    hasSolutionImage: true,
  },
  {
    number: 36,
    id: "bebras-2024-36-robot-dibujante",
    title: "Robot Dibujante",
    country: "Australia",
    year: 2024,
    sourceTaskCode: "2024-AU-03",
    difficulties: difficulties("", "", "", "", "medium", ""),
    master: false,
    hasSolutionImage: false,
  },
  {
    number: 37,
    id: "bebras-2024-37-dias-soleados-2",
    title: "Días Soleados 2",
    country: "Alemania",
    year: 2024,
    sourceTaskCode: "2024-DE-04b",
    difficulties: difficulties("", "", "", "", "", "medium"),
    master: false,
    hasSolutionImage: false,
  },
  {
    number: 38,
    id: "bebras-2024-38-imagenes-encriptadas",
    title: "Imágenes Encriptadas",
    country: "Australia",
    year: 2024,
    sourceTaskCode: "2024-AU-01",
    difficulties: difficulties("", "", "", "", "", "hard"),
    master: false,
    hasSolutionImage: true,
  },
  {
    number: 39,
    id: "bebras-2024-39-moviendo-bloques-2",
    title: "Moviendo Bloques 2",
    country: "Bélgica",
    year: 2024,
    sourceTaskCode: "2024-BE-01b",
    difficulties: difficulties("", "", "", "", "", "easy"),
    master: false,
    hasSolutionImage: false,
  },
  {
    number: 40,
    id: "bebras-2024-40-explorando",
    title: "Explorando",
    country: "Alemania",
    year: 2024,
    sourceTaskCode: "2024-DE-05",
    difficulties: difficulties("", "", "", "", "", "hard"),
    master: false,
    hasSolutionImage: true,
  },
  {
    number: 41,
    id: "bebras-2024-41-pared-de-ladrillos",
    title: "Pared de Ladrillos",
    country: "Finlandia",
    year: 2024,
    sourceTaskCode: "2024-FI-03",
    difficulties: difficulties("", "", "", "", "", "hard"),
    master: true,
    hasSolutionImage: false,
  },
  {
    number: 42,
    id: "bebras-2024-42-mapas-falsos",
    title: "Mapas Falsos",
    country: "Vietnam",
    year: 2024,
    sourceTaskCode: "2019-VN-04",
    difficulties: difficulties("", "", "", "", "", "hard"),
    master: false,
    hasSolutionImage: true,
  },
  {
    number: 43,
    id: "bebras-2024-43-palago",
    title: "Palago",
    country: "Hungría",
    year: 2024,
    sourceTaskCode: "2024-HU-04",
    difficulties: difficulties("", "", "", "", "", "hard"),
    master: false,
    hasSolutionImage: true,
  },
];

export const LEGACY_ID_ALIASES: Readonly<Record<string, string>> = {
  "bebras-2024-14-camino-robot": "bebras-2024-14-camino-de-robot",
};

// Every category spelling present in the legacy catalog is listed here.
export const CATEGORY_ALIASES: Readonly<Record<string, CanonicalCategory>> = {
  "Algoritmos y programación": "Algoritmos y programación",
  "Estructuras de datos y representaciones":
    "Estructuras de datos y representaciones",
  "Procesos computacionales y hardware": "Procesos computacionales y hardware",
  "Comunicación y redes": "Comunicación y redes",
  "Interacción, sistemas y sociedad": "Interacción, sistemas y sociedad",
  "Estructuras de datos y lógica": "Estructuras de datos y representaciones",
  "Pensamiento computacional": "Algoritmos y programación",
  "Estructuras de datos": "Estructuras de datos y representaciones",
  Optimización: "Algoritmos y programación",
  "Tipos de datos": "Estructuras de datos y representaciones",
  "Autómatas y lenguajes": "Algoritmos y programación",
  "Sistemas y estados": "Estructuras de datos y representaciones",
  "Codificación binaria": "Estructuras de datos y representaciones",
  Criptografía: "Estructuras de datos y representaciones",
  Ordenamiento: "Algoritmos y programación",
  "Teoría de grafos": "Estructuras de datos y representaciones",
  "Teoría de juegos": "Algoritmos y programación",
  "Estrategia algorítmica": "Algoritmos y programación",
};

// Hand-authored final contracts; legacy PDF placeholders are never publishable.
export const INTERACTIVE_TASK_TYPES: Readonly<Record<string, string>> = {
  "bebras-2024-04-caminando-bosque": "image_hotspot",
  "bebras-2024-09-tubo-canicas": "state_grid",
  "bebras-2024-11-dibujando-barquitos": "image_hotspot",
  "bebras-2024-19-dias-soleados": "text_cloze",
  "bebras-2024-31-secuencia-pelotas": "state_grid",
  "bebras-2024-37-dias-soleados-2": "text_cloze",
  "bebras-2024-40-explorando": "text_cloze",
};

export const SOLUTION_IMAGE_TASK_IDS = new Set(
  TASK_METADATA.filter((task) => task.hasSolutionImage).map((task) => task.id),
);

export const MASTER_TASK_IDS = new Set(
  TASK_METADATA.filter((task) => task.master).map((task) => task.id),
);

const TASK_BY_ID = new Map(TASK_METADATA.map((task) => [task.id, task]));
const PNG_DATA_URL_PREFIX = "data:image/png;base64,iVBORw0KGgo";
const SOURCE_CODE_PATTERN = /^\d{4}-[A-Z]{2}(?:-[A-Za-z0-9]+)+$/;
const TASK_ID_PATTERN = /^bebras-2024-(\d{2})-/;
const ANSWER_TYPES = new Set([
  "multiple_choice",
  "short_text",
  "drag_drop",
  "image_hotspot",
  "state_grid",
  "text_cloze",
]);
/** Los tipos que no se pueden derivar del PDF: se redactan a mano. */
const INTERACTIVE_ANSWER_TYPES = new Set([
  "image_hotspot",
  "state_grid",
  "text_cloze",
]);
const BLOCK_TYPES = new Set(["text", "image", "challenge"]);
const DIFFICULTIES = new Set(["", "easy", "medium", "hard"]);
const TASK_FIELDS = new Set([
  "id",
  "title",
  "country",
  "year",
  "sourceTaskCode",
  "categories",
  "difficulties",
  "bodyBlocks",
  "challengeBlocks",
  "answerType",
  "answerConfig",
  "answerKey",
  "multipleChoiceOrderMode",
  "answers",
  "correctAnswerId",
  "shortAnswer",
  "dragDropBackground",
  "dragDropItems",
  "dragDropTargets",
  "dragDropSolutions",
  "explanationBlocks",
  "isPractice",
]);

function fail(message: string): never {
  throw new Error(`Catalog validation failed: ${message}`);
}

function objectValue(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  return value as JsonObject;
}

function arrayValue(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    fail(`${label} must be an array`);
  }
  return value;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`${label} must be a non-empty string`);
  }
  return value;
}

function assertOnlyFields(
  value: JsonObject,
  allowed: ReadonlySet<string>,
  label: string,
) {
  const unsupported = Object.keys(value).filter((key) => !allowed.has(key));
  if (unsupported.length > 0) {
    fail(`${label} has unsupported fields: ${unsupported.join(", ")}`);
  }
}

function canonicalLegacyId(id: string) {
  return LEGACY_ID_ALIASES[id] ?? id;
}

function normalizeCategories(task: JsonObject, label: string) {
  const source = task.categories ?? task.category;
  if (!Array.isArray(source) || source.length === 0) {
    fail(`${label} must have at least one category`);
  }

  const normalized: CanonicalCategory[] = [];
  for (const category of source) {
    if (typeof category !== "string" || !(category in CATEGORY_ALIASES)) {
      fail(`${label} has unknown category ${JSON.stringify(category)}`);
    }
    const canonical = CATEGORY_ALIASES[category];
    if (!normalized.includes(canonical)) {
      normalized.push(canonical);
    }
  }
  return normalized;
}

function normalizeImage(value: unknown, fallbackId: string, label: string) {
  const image = objectValue(value, label);
  const name = stringValue(image.name, `${label}.name`);
  const url = stringValue(image.url, `${label}.url`);
  if (!url.startsWith(PNG_DATA_URL_PREFIX)) {
    fail(`${label}.url is not a PNG data URL`);
  }
  return {
    id:
      typeof image.id === "string" && image.id.trim().length > 0
        ? image.id
        : fallbackId,
    name,
    url,
  };
}

function normalizeBlock(
  value: unknown,
  taskId: string,
  scope: string,
  index: number,
  forceChallenge = false,
) {
  const label = `${taskId}.${scope}[${index}]`;
  const block = objectValue(value, label);
  const id = `${taskId}-${scope}-${index + 1}-block`;
  const type = forceChallenge ? "challenge" : block.type;
  if (typeof type !== "string" || !BLOCK_TYPES.has(type)) {
    fail(`${label}.type is invalid`);
  }
  const widthPercent =
    typeof block.widthPercent === "number" &&
    Number.isFinite(block.widthPercent) &&
    block.widthPercent > 0 &&
    block.widthPercent <= 100
      ? block.widthPercent
      : 100;
  return {
    id,
    type,
    content: typeof block.content === "string" ? block.content : "",
    image:
      block.image === null || block.image === undefined
        ? null
        : normalizeImage(block.image, `${id}-image`, `${label}.image`),
    widthPercent,
  };
}

function normalizeBlocks(
  value: unknown,
  taskId: string,
  scope: string,
  forceChallenge = false,
) {
  return arrayValue(value, `${taskId}.${scope}`).map((block, index) =>
    normalizeBlock(block, taskId, scope, index, forceChallenge),
  );
}

function normalizeCorrectAnswer(value: unknown, taskId: string) {
  const answer = stringValue(value, `${taskId}.correctAnswerId`).trim();
  if (/^[A-F]$/.test(answer)) {
    return `single:${answer}`;
  }
  if (!/^(single:[A-F]|(?:any|all):[A-F](?:,[A-F])+)$/u.test(answer)) {
    fail(`${taskId}.correctAnswerId has an invalid format`);
  }
  return answer;
}

function referencedAnswers(correctAnswerId: string) {
  return new Set(
    correctAnswerId.slice(correctAnswerId.indexOf(":") + 1).split(","),
  );
}

function createExplanationTextBlock(taskId: string, explanation: unknown) {
  return {
    id: `${taskId}-explanation-text`,
    type: "text",
    content: stringValue(explanation, `${taskId}.explanation`).trim(),
    image: null,
    widthPercent: 100,
  };
}

export function createSolutionImageBlock(taskId: string, value: unknown) {
  const url = stringValue(value, `${taskId}._solutionImage`);
  if (!url.startsWith(PNG_DATA_URL_PREFIX)) {
    fail(`${taskId}._solutionImage is not a PNG data URL`);
  }
  return {
    id: `${taskId}-solution-image-block`,
    type: "image",
    content: "",
    image: {
      id: `${taskId}-solution-image`,
      name: `${taskId}-solution.png`,
      url,
    },
    widthPercent: 100,
  };
}

function normalizeLegacyTask(task: JsonObject, metadata: TaskMetadata) {
  const taskId = metadata.id;
  const answerType =
    task.answerType === "short_answer" ? "short_text" : task.answerType;
  const explanationBlocks: unknown[] = [
    createExplanationTextBlock(taskId, task.explanation),
  ];
  if (metadata.hasSolutionImage) {
    explanationBlocks.push(
      createSolutionImageBlock(taskId, task._solutionImage),
    );
  }

  const base = {
    id: taskId,
    title: metadata.title,
    country: metadata.country,
    year: metadata.year,
    sourceTaskCode: metadata.sourceTaskCode,
    categories: normalizeCategories(task, taskId),
    difficulties: metadata.difficulties,
    bodyBlocks: normalizeBlocks(task.bodyBlocks, taskId, "body"),
    challengeBlocks: normalizeBlocks(
      task.challengeBlocks,
      taskId,
      "challenge",
      true,
    ),
  };

  if (answerType === "multiple_choice") {
    const correctAnswerId = normalizeCorrectAnswer(
      task.correctAnswerId,
      taskId,
    );
    const correctIds = referencedAnswers(correctAnswerId);
    const answers = arrayValue(task.answers, `${taskId}.answers`).map(
      (answerValue, index) => {
        const answer = objectValue(answerValue, `${taskId}.answers[${index}]`);
        const id = stringValue(answer.id, `${taskId}.answers[${index}].id`);
        return {
          id,
          blocks: normalizeBlocks(answer.blocks, taskId, `answer-${id}`),
          isCorrect: correctIds.has(id),
        };
      },
    );
    return {
      ...base,
      answerType,
      multipleChoiceOrderMode:
        task.multipleChoiceOrderMode === "random" ? "random" : "fixed",
      answers,
      correctAnswerId,
      isPractice: !Object.hasOwn(INTERACTIVE_TASK_TYPES, taskId),
      explanationBlocks,
    };
  }

  if (answerType === "short_text") {
    return {
      ...base,
      answerType,
      shortAnswer: stringValue(task.shortAnswer, `${taskId}.shortAnswer`),
      answers: [],
      correctAnswerId: "",
      isPractice: !Object.hasOwn(INTERACTIVE_TASK_TYPES, taskId),
      explanationBlocks,
    };
  }

  fail(
    `${taskId} is a legacy-only task with unsupported answer type ${String(answerType)}`,
  );
}

function parseTaskArray(value: unknown, label: string) {
  return arrayValue(value, label).map((task, index) =>
    objectValue(task, `${label}[${index}]`),
  );
}

function indexLegacyTasks(tasks: JsonObject[]) {
  if (tasks.length !== TASK_METADATA.length) {
    fail(`legacy catalog must contain exactly 43 tasks, found ${tasks.length}`);
  }
  const byId = new Map<string, JsonObject>();
  for (const task of tasks) {
    const legacyId = stringValue(task.id, "legacy task id");
    const id = canonicalLegacyId(legacyId);
    if (!TASK_BY_ID.has(id)) {
      fail(`legacy catalog contains unknown task id ${legacyId}`);
    }
    if (byId.has(id)) {
      fail(`legacy catalog contains duplicate canonical task id ${id}`);
    }
    normalizeCategories(task, legacyId);
    const metadata = TASK_BY_ID.get(id)!;
    if (metadata.hasSolutionImage) {
      createSolutionImageBlock(id, task._solutionImage);
    } else if (task._solutionImage !== undefined) {
      fail(`${legacyId} has an unexpected solution image`);
    }
    byId.set(id, task);
  }
  for (const metadata of TASK_METADATA) {
    if (!byId.has(metadata.id)) {
      fail(`legacy catalog is missing ${metadata.id}`);
    }
  }
  return byId;
}

function indexMasterTasks(tasks: JsonObject[]) {
  if (
    tasks.length !== MASTER_TASK_IDS.size &&
    tasks.length !== TASK_METADATA.length
  ) {
    fail(
      `current catalog must contain exactly 21 or 43 tasks, found ${tasks.length}`,
    );
  }
  const byId = new Map<string, JsonObject>();
  const currentIds = new Set<string>();
  for (const task of tasks) {
    const id = stringValue(task.id, "current task id");
    if (!TASK_BY_ID.has(id)) {
      fail(`current catalog contains unknown task ${id}`);
    }
    if (currentIds.has(id)) {
      fail(`current catalog contains duplicate task id ${id}`);
    }
    currentIds.add(id);
    if (MASTER_TASK_IDS.has(id)) byId.set(id, task);
  }
  if (
    tasks.length === TASK_METADATA.length &&
    TASK_METADATA.some((task) => !currentIds.has(task.id))
  ) {
    fail("current 43-task catalog does not contain the exact booklet task set");
  }
  for (const id of MASTER_TASK_IDS) {
    if (!byId.has(id)) {
      fail(`current catalog is missing master task ${id}`);
    }
  }
  return byId;
}

export function migrateCatalog(legacyValue: unknown, currentValue: unknown) {
  const current = parseTaskArray(currentValue, "current catalog");
  if (current.length === TASK_METADATA.length) {
    // The reviewed final JSON is authoritative, including non-master edits and
    // embedded solution images. Never reconstruct it from older PDF exports.
    validateCatalog(current);
    return structuredClone(current);
  }
  const legacyById = indexLegacyTasks(
    parseTaskArray(legacyValue, "legacy catalog"),
  );
  const masterById = indexMasterTasks(current);

  const catalog = TASK_METADATA.map((metadata) => {
    const legacy = legacyById.get(metadata.id)!;
    if (!metadata.master) {
      return normalizeLegacyTask(legacy, metadata);
    }

    const master = structuredClone(masterById.get(metadata.id)!);
    master.sourceTaskCode = metadata.sourceTaskCode;
    if (metadata.hasSolutionImage) {
      const explanationBlocks = arrayValue(
        master.explanationBlocks,
        `${metadata.id}.explanationBlocks`,
      );
      const solutionBlock = createSolutionImageBlock(
        metadata.id,
        legacy._solutionImage,
      );
      const existingSolution = explanationBlocks.find(
        (block) =>
          objectValue(block, `${metadata.id}.explanationBlock`).id ===
          solutionBlock.id,
      );
      if (
        existingSolution !== undefined &&
        JSON.stringify(existingSolution) !== JSON.stringify(solutionBlock)
      ) {
        fail(`${metadata.id} has a conflicting existing solution image block`);
      }
      if (existingSolution === undefined) {
        master.explanationBlocks = [...explanationBlocks, solutionBlock];
      }
    }
    return master;
  });

  if (
    catalog.filter((task) => !MASTER_TASK_IDS.has(String(task.id))).length !==
    22
  ) {
    fail("migration did not add exactly 22 legacy-only tasks");
  }
  validateCatalog(catalog);
  return catalog;
}

function validateImage(value: unknown, label: string, imageIds: Set<string>) {
  const image = objectValue(value, label);
  assertOnlyFields(image, new Set(["id", "name", "url"]), label);
  const id = stringValue(image.id, `${label}.id`);
  stringValue(image.name, `${label}.name`);
  const url = stringValue(image.url, `${label}.url`);
  if (!url.startsWith(PNG_DATA_URL_PREFIX)) {
    fail(`${label}.url is not a PNG data URL`);
  }
  if (imageIds.has(id)) {
    fail(`duplicate image id ${id}`);
  }
  imageIds.add(id);
}

function validateBlock(
  value: unknown,
  label: string,
  blockIds: Set<string>,
  imageIds: Set<string>,
) {
  const block = objectValue(value, label);
  assertOnlyFields(
    block,
    new Set(["id", "type", "content", "image", "widthPercent", "richText"]),
    label,
  );
  const id = stringValue(block.id, `${label}.id`);
  if (blockIds.has(id)) {
    fail(`duplicate block id ${id}`);
  }
  blockIds.add(id);
  if (typeof block.type !== "string" || !BLOCK_TYPES.has(block.type)) {
    fail(`${label}.type is invalid`);
  }
  if (typeof block.content !== "string") {
    fail(`${label}.content must be a string`);
  }
  if (
    typeof block.widthPercent !== "number" ||
    !Number.isFinite(block.widthPercent) ||
    block.widthPercent <= 0 ||
    block.widthPercent > 100
  ) {
    fail(`${label}.widthPercent must be between 0 and 100`);
  }
  if (block.image !== null) {
    validateImage(block.image, `${label}.image`, imageIds);
  } else if (block.type === "image") {
    fail(`${label} is an image block without an image`);
  }
}

function validateBlocks(
  value: unknown,
  label: string,
  blockIds: Set<string>,
  imageIds: Set<string>,
) {
  const blocks = arrayValue(value, label);
  for (let index = 0; index < blocks.length; index += 1) {
    validateBlock(blocks[index], `${label}[${index}]`, blockIds, imageIds);
  }
  return blocks;
}

function validateDifficulties(value: unknown, metadata: TaskMetadata) {
  const difficultyMap = objectValue(value, `${metadata.id}.difficulties`);
  const keys = Object.keys(difficultyMap);
  if (
    keys.length !== AGE_RANGES.length ||
    AGE_RANGES.some((range) => !Object.hasOwn(difficultyMap, range))
  ) {
    fail(
      `${metadata.id}.difficulties must contain the six canonical age ranges`,
    );
  }
  for (const range of AGE_RANGES) {
    if (
      typeof difficultyMap[range] !== "string" ||
      !DIFFICULTIES.has(difficultyMap[range])
    ) {
      fail(`${metadata.id}.difficulties[${range}] is invalid`);
    }
  }
  if (!metadata.master) {
    for (const range of AGE_RANGES) {
      if (difficultyMap[range] !== metadata.difficulties[range]) {
        fail(
          `${metadata.id}.difficulties[${range}] differs from verified metadata`,
        );
      }
    }
  }
}

function parseCorrectness(value: unknown, taskId: string) {
  const correctAnswerId = stringValue(value, `${taskId}.correctAnswerId`);
  const match = /^(single|any|all):([A-F](?:,[A-F])*)$/u.exec(correctAnswerId);
  if (!match) {
    fail(`${taskId}.correctAnswerId has an invalid format`);
  }
  const ids = match[2].split(",");
  if (new Set(ids).size !== ids.length) {
    fail(`${taskId}.correctAnswerId repeats an answer`);
  }
  if (match[1] === "single" && ids.length !== 1) {
    fail(`${taskId}.correctAnswerId must reference one answer`);
  }
  if (match[1] !== "single" && ids.length < 2) {
    fail(`${taskId}.correctAnswerId must reference at least two answers`);
  }
  return new Set(ids);
}

function validateAnswers(
  task: JsonObject,
  taskId: string,
  blockIds: Set<string>,
  imageIds: Set<string>,
) {
  const answers = arrayValue(task.answers, `${taskId}.answers`);
  const correctIds = parseCorrectness(task.correctAnswerId, taskId);
  const answerIds = new Set<string>();
  for (let index = 0; index < answers.length; index += 1) {
    const label = `${taskId}.answers[${index}]`;
    const answer = objectValue(answers[index], label);
    assertOnlyFields(answer, new Set(["id", "blocks", "isCorrect"]), label);
    const id = stringValue(answer.id, `${label}.id`);
    if (!/^[A-F]$/.test(id) || answerIds.has(id)) {
      fail(`${label}.id must be a unique option A-F`);
    }
    answerIds.add(id);
    validateBlocks(answer.blocks, `${label}.blocks`, blockIds, imageIds);
    if (answer.isCorrect !== correctIds.has(id)) {
      fail(`${label}.isCorrect disagrees with correctAnswerId`);
    }
  }
  if (answers.length < 2) {
    fail(`${taskId} must have at least two answers`);
  }
  for (const id of correctIds) {
    if (!answerIds.has(id)) {
      fail(`${taskId}.correctAnswerId references missing answer ${id}`);
    }
  }
  if (
    task.multipleChoiceOrderMode !== "fixed" &&
    task.multipleChoiceOrderMode !== "random"
  ) {
    fail(`${taskId}.multipleChoiceOrderMode is invalid`);
  }
}

function validateDragDrop(
  task: JsonObject,
  taskId: string,
  imageIds: Set<string>,
) {
  validateImage(
    task.dragDropBackground,
    `${taskId}.dragDropBackground`,
    imageIds,
  );
  const targets = arrayValue(task.dragDropTargets, `${taskId}.dragDropTargets`);
  const items = arrayValue(task.dragDropItems, `${taskId}.dragDropItems`);
  if (
    targets.length === 0 ||
    items.length === 0 ||
    items.length > targets.length
  ) {
    fail(`${taskId} has an invalid number of drag-drop items or targets`);
  }

  const targetIds = new Set<string>();
  for (let index = 0; index < targets.length; index += 1) {
    const label = `${taskId}.dragDropTargets[${index}]`;
    const target = objectValue(targets[index], label);
    assertOnlyFields(target, new Set(["id", "x", "y", "snapRadius"]), label);
    const id = stringValue(target.id, `${label}.id`);
    if (targetIds.has(id))
      fail(`${taskId} has duplicate drag-drop target ${id}`);
    targetIds.add(id);
    for (const field of ["x", "y", "snapRadius"] as const) {
      if (
        typeof target[field] !== "number" ||
        !Number.isFinite(target[field])
      ) {
        fail(`${label}.${field} must be a finite number`);
      }
    }
  }

  const itemIds = new Set<string>();
  const primaryTargets = new Set<string>();
  for (let index = 0; index < items.length; index += 1) {
    const label = `${taskId}.dragDropItems[${index}]`;
    const item = objectValue(items[index], label);
    assertOnlyFields(
      item,
      new Set([
        "id",
        "label",
        "image",
        "equivalenceKey",
        "widthPercent",
        "correctTargetId",
      ]),
      label,
    );
    const id = stringValue(item.id, `${label}.id`);
    const correctTargetId = stringValue(
      item.correctTargetId,
      `${label}.correctTargetId`,
    );
    if (itemIds.has(id)) fail(`${taskId} has duplicate drag-drop item ${id}`);
    if (!targetIds.has(correctTargetId)) {
      fail(
        `${label}.correctTargetId references missing target ${correctTargetId}`,
      );
    }
    if (primaryTargets.has(correctTargetId)) {
      fail(`${taskId} assigns multiple drag-drop items to ${correctTargetId}`);
    }
    itemIds.add(id);
    primaryTargets.add(correctTargetId);
    stringValue(item.label, `${label}.label`);
    validateImage(item.image, `${label}.image`, imageIds);
    if (
      typeof item.widthPercent !== "number" ||
      !Number.isFinite(item.widthPercent) ||
      item.widthPercent <= 0 ||
      item.widthPercent > 100
    ) {
      fail(`${label}.widthPercent must be between 0 and 100`);
    }
  }

  const solutions =
    task.dragDropSolutions === undefined
      ? []
      : arrayValue(task.dragDropSolutions, `${taskId}.dragDropSolutions`);
  const solutionIds = new Set<string>();
  for (let index = 0; index < solutions.length; index += 1) {
    const label = `${taskId}.dragDropSolutions[${index}]`;
    const solution = objectValue(solutions[index], label);
    assertOnlyFields(solution, new Set(["id", "placements"]), label);
    const id = stringValue(solution.id, `${label}.id`);
    if (solutionIds.has(id)) fail(`${taskId} has duplicate solution ${id}`);
    solutionIds.add(id);
    const placements = objectValue(solution.placements, `${label}.placements`);
    if (Object.keys(placements).length !== itemIds.size) {
      fail(`${label}.placements must cover every drag-drop item`);
    }
    const usedTargets = new Set<string>();
    for (const [itemId, targetId] of Object.entries(placements)) {
      if (
        !itemIds.has(itemId) ||
        typeof targetId !== "string" ||
        !targetIds.has(targetId)
      ) {
        fail(`${label}.placements contains an unknown item or target`);
      }
      if (usedTargets.has(targetId)) {
        fail(`${label}.placements assigns two items to ${targetId}`);
      }
      usedTargets.add(targetId);
    }
  }
}

export function validateCatalog(value: unknown): asserts value is JsonObject[] {
  const tasks = parseTaskArray(value, "catalog");
  if (tasks.length !== 43) {
    fail(`catalog must contain exactly 43 tasks, found ${tasks.length}`);
  }

  const ids = new Set<string>();
  const codes = new Set<string>();
  const countries = new Set(TASK_METADATA.map((task) => task.country));
  const categories = new Set<string>(CANONICAL_CATEGORIES);
  const blockIds = new Set<string>();
  const imageIds = new Set<string>();
  let solutionImageCount = 0;

  for (let index = 0; index < tasks.length; index += 1) {
    const task = tasks[index];
    assertOnlyFields(task, TASK_FIELDS, `catalog[${index}]`);
    const id = stringValue(task.id, `catalog[${index}].id`);
    const metadata = TASK_BY_ID.get(id);
    if (!metadata) fail(`catalog contains unknown task id ${id}`);
    if (ids.has(id)) fail(`duplicate task id ${id}`);
    ids.add(id);
    const numberMatch = TASK_ID_PATTERN.exec(id);
    if (
      !numberMatch ||
      Number(numberMatch[1]) !== index + 1 ||
      metadata.number !== index + 1
    ) {
      fail(`catalog task at index ${index} is not booklet task ${index + 1}`);
    }

    if (task.title !== metadata.title)
      fail(`${id}.title differs from verified metadata`);
    if (
      task.country !== metadata.country ||
      !countries.has(String(task.country))
    ) {
      fail(`${id}.country is not canonical verified metadata`);
    }
    if (task.year !== metadata.year)
      fail(`${id}.year differs from verified metadata`);
    if (task.sourceTaskCode !== metadata.sourceTaskCode) {
      fail(`${id}.sourceTaskCode differs from verified metadata`);
    }
    const code = String(task.sourceTaskCode);
    if (!SOURCE_CODE_PATTERN.test(code))
      fail(`${id}.sourceTaskCode has an invalid format`);
    if (codes.has(code)) fail(`duplicate sourceTaskCode ${code}`);
    codes.add(code);

    const taskCategories = arrayValue(task.categories, `${id}.categories`);
    if (
      taskCategories.length === 0 ||
      new Set(taskCategories).size !== taskCategories.length
    ) {
      fail(`${id}.categories must be non-empty and unique`);
    }
    for (const category of taskCategories) {
      if (typeof category !== "string" || !categories.has(category)) {
        fail(
          `${id}.categories contains non-canonical category ${String(category)}`,
        );
      }
    }
    validateDifficulties(task.difficulties, metadata);
    validateBlocks(task.bodyBlocks, `${id}.bodyBlocks`, blockIds, imageIds);
    const challengeBlocks = validateBlocks(
      task.challengeBlocks,
      `${id}.challengeBlocks`,
      blockIds,
      imageIds,
    );
    if (!metadata.master) {
      for (const challenge of challengeBlocks) {
        if (
          objectValue(challenge, `${id}.challengeBlock`).type !== "challenge"
        ) {
          fail(`${id} legacy question blocks must use challenge type`);
        }
      }
    }
    const explanationBlocks = validateBlocks(
      task.explanationBlocks,
      `${id}.explanationBlocks`,
      blockIds,
      imageIds,
    );
    if (explanationBlocks.length === 0) fail(`${id} has no explanation blocks`);

    if (
      typeof task.answerType !== "string" ||
      !ANSWER_TYPES.has(task.answerType)
    ) {
      fail(`${id}.answerType is invalid`);
    }
    if (
      Object.hasOwn(INTERACTIVE_TASK_TYPES, id) &&
      task.answerType !== INTERACTIVE_TASK_TYPES[id]
    ) {
      fail(`${id} must remain ${INTERACTIVE_TASK_TYPES[id]}`);
    }
    if (task.answerType === "multiple_choice") {
      validateAnswers(task, id, blockIds, imageIds);
    } else if (task.answerType === "short_text") {
      stringValue(task.shortAnswer, `${id}.shortAnswer`);
      if (
        arrayValue(task.answers, `${id}.answers`).length !== 0 ||
        task.correctAnswerId !== ""
      ) {
        fail(`${id} short_text answer fields are inconsistent`);
      }
    } else if (INTERACTIVE_ANSWER_TYPES.has(String(task.answerType))) {
      if (!Object.hasOwn(INTERACTIVE_TASK_TYPES, id)) {
        fail(`${id} is not one of the hand written interactive tasks`);
      }
      try {
        parseTaskAnswerConfig(task);
      } catch (error) {
        fail(
          `${id} has an invalid interactive answer: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    } else {
      validateDragDrop(task, id, imageIds);
    }

    if (task.isPractice !== true)
      fail(
        `${id}.isPractice must be true; final catalog cannot contain quarantine`,
      );

    const expectedSolutionBlockId = `${id}-solution-image-block`;
    const imageExplanationBlocks = explanationBlocks.filter(
      (block) => objectValue(block, `${id}.explanationBlock`).type === "image",
    );
    const solutionBlocks = explanationBlocks.filter(
      (block) =>
        objectValue(block, `${id}.explanationBlock`).id ===
        expectedSolutionBlockId,
    );
    if (
      solutionBlocks.length !== Number(metadata.hasSolutionImage) ||
      imageExplanationBlocks.length !== solutionBlocks.length
    ) {
      fail(`${id} has an incorrect deterministic solution image block count`);
    }
    if (solutionBlocks.length === 1) {
      const solution = objectValue(
        solutionBlocks[0],
        `${id}.solutionImageBlock`,
      );
      if (
        solution.type !== "image" ||
        solution.content !== "" ||
        solution.widthPercent !== 100
      ) {
        fail(`${id} solution image block has an invalid shape`);
      }
      const image = objectValue(
        solution.image,
        `${id}.solutionImageBlock.image`,
      );
      if (
        image.id !== `${id}-solution-image` ||
        image.name !== `${id}-solution.png`
      ) {
        fail(`${id} solution image identifiers are not deterministic`);
      }
      solutionImageCount += 1;
    }

    if (!metadata.master) {
      const textBlockId = `${id}-explanation-text`;
      if (
        !explanationBlocks.some(
          (block) =>
            objectValue(block, `${id}.explanationBlock`).id === textBlockId,
        )
      ) {
        fail(`${id} is missing its deterministic text explanation block`);
      }
    }
  }

  if (ids.size !== 43 || TASK_METADATA.some((task) => !ids.has(task.id))) {
    fail("task numbers 1 through 43 must appear exactly once");
  }
  if (codes.size !== 43) fail("source task codes must be unique");
  if (solutionImageCount !== 25) {
    fail(
      `expected exactly 25 deterministic solution image blocks, found ${solutionImageCount}`,
    );
  }

  for (const id of [
    "bebras-2024-14-camino-de-robot",
    "bebras-2024-34-puntos-por-letras",
  ]) {
    if (tasks.find((task) => task.id === id)?.answerType !== "drag_drop") {
      fail(`${id} must remain drag_drop`);
    }
  }
  const palago = tasks.find((task) => task.id === "bebras-2024-43-palago");
  if (
    palago?.answerType !== "multiple_choice" ||
    palago.correctAnswerId !== "single:D"
  ) {
    fail("Palago must use multiple_choice with single:D");
  }
}

function readJson(filePath: string, label: string) {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    throw new Error(`Could not read ${label} at ${filePath}`, { cause: error });
  }
  try {
    return JSON.parse(content) as unknown;
  } catch (error) {
    throw new Error(`Could not parse ${label} at ${filePath}`, {
      cause: error,
    });
  }
}

export function serializeCatalog(catalog: unknown) {
  validateCatalog(catalog);
  return `${JSON.stringify(catalog, null, 2)}\n`;
}

export function migrateCatalogFiles(
  legacyPath: string,
  currentPath: string,
  outputPath: string,
  options: { write?: boolean } = {},
) {
  const catalog = migrateCatalog(
    readJson(legacyPath, "legacy catalog"),
    readJson(currentPath, "current catalog"),
  );
  const json = serializeCatalog(catalog);

  if (options.write !== false) {
    const outputDirectory = path.dirname(outputPath);
    if (!fs.existsSync(outputDirectory)) {
      throw new Error(`Output directory does not exist: ${outputDirectory}`);
    }
    fs.writeFileSync(outputPath, json, "utf8");
  }

  return { catalog, json };
}
