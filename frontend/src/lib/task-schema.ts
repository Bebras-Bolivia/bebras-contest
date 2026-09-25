import type { JSONContent } from "@tiptap/core";
import { hasTaskBlanks } from "@/lib/task-blank";
export const categories = [
  "Algoritmos y programación",
  "Estructuras de datos y representaciones",
  "Procesos computacionales y hardware",
  "Comunicación y redes",
  "Interacción, sistemas y sociedad",
] as const;

export const ageRanges = [
  "5–8",
  "8–10",
  "10–12",
  "12–14",
  "14–16",
  "17–18",
] as const;

export const optionLabels = ["A", "B", "C", "D", "E", "F"] as const;
export const answerTypes = [
  "multiple_choice",
  "short_text",
  "drag_drop",
  "image_hotspot",
  "state_grid",
  "text_cloze",
] as const;
export const answerTypeLabels: Record<(typeof answerTypes)[number], string> = {
  multiple_choice: "Opción múltiple",
  short_text: "Respuesta corta",
  drag_drop: "Arrastrar y soltar",
  image_hotspot: "Zonas sobre la imagen",
  state_grid: "Estados por casilla",
  text_cloze: "Huecos en el texto",
};
export const multipleChoiceOrderModes = ["fixed", "random"] as const;
export const multipleChoiceCorrectnessModes = ["single", "any", "all"] as const;
export const multipleChoiceLayouts = ["vertical", "horizontal"] as const;
export const DEFAULT_DRAG_DROP_ITEM_WIDTH_PERCENT = 12;

export type ContentBlockType = "text" | "image" | "challenge";

export type ContentImage = {
  id: string;
  name: string;
  url: string;
};

export type ContentBlock = {
  id: string;
  type: ContentBlockType;
  content: string;
  richText?: JSONContent;
  image: ContentImage | null;
  widthPercent: number;
};

export type DifficultyKey = (typeof ageRanges)[number];
export type OptionKey = (typeof optionLabels)[number];
export type CategoryValue = (typeof categories)[number] | "";
export type CategoryItem = Exclude<CategoryValue, "">;
export type AnswerType = (typeof answerTypes)[number];
export type MultipleChoiceOrderMode = (typeof multipleChoiceOrderModes)[number];
export type MultipleChoiceCorrectnessMode =
  (typeof multipleChoiceCorrectnessModes)[number];
export type MultipleChoiceLayout = (typeof multipleChoiceLayouts)[number];

/** La disposición de las opciones viaja en answerConfig; vertical es lo de siempre. */
export function readMultipleChoiceLayout(
  answerConfig: Record<string, unknown> | undefined,
): MultipleChoiceLayout {
  return answerConfig?.multipleChoiceLayout === "horizontal"
    ? "horizontal"
    : "vertical";
}

export type StoredTaskAnswer = {
  id: OptionKey;
  blocks: ContentBlock[];
  isCorrect?: boolean;
};

export type StoredTaskDragDropItem = {
  id: string;
  label: string;
  /** Grupo semántico privado; vacío conserva la equivalencia histórica. */
  equivalenceKey?: string;
  image: ContentImage | null;
  correctTargetId: string;
  widthPercent: number;
};

export type StoredTaskDragDropTarget = {
  id: string;
  x: number;
  y: number;
  snapRadius: number;
};

/**
 * Otra forma de resolver la misma tarea: a qué destino va cada objeto.
 * La solución principal ya está en `correctTargetId` de cada objeto; aquí solo
 * viven las alternativas, que pueden ocupar distintos subconjuntos de destinos.
 */
export type StoredTaskDragDropSolution = {
  id: string;
  /** idObjeto -> idDestino. Cubre todos los objetos, sin repetir destino. */
  placements: Record<string, string>;
};

export type StoredTask = {
  id: string;
  title: string;
  /** Procedencia oficial según el cuadernillo Bebras. */
  country: string | null;
  year: number | null;
  sourceTaskCode: string | null;
  categories: CategoryItem[];
  difficulties: Record<DifficultyKey, string>;
  bodyBlocks: ContentBlock[];
  challengeBlocks: ContentBlock[];
  answerType: AnswerType;
  /** Reserved for versioned interactive answer types. */
  answerConfig?: Record<string, unknown>;
  answerKey?: Record<string, unknown>;
  multipleChoiceOrderMode: MultipleChoiceOrderMode;
  answers: StoredTaskAnswer[];
  correctAnswerId: string;
  shortAnswer: string;
  /** Único intervalo aceptado cuando la respuesta es un número. */
  /** `widthPercent`: ancho con que se muestra, en % de la columna (20-100). */
  dragDropBackground: (ContentImage & { widthPercent?: number }) | null;
  dragDropItems: StoredTaskDragDropItem[];
  dragDropTargets: StoredTaskDragDropTarget[];
  dragDropSolutions?: StoredTaskDragDropSolution[];
  explanationBlocks: ContentBlock[];
  updatedAt: string;
};

export function createContentBlock(
  type: ContentBlockType = "text",
): ContentBlock {
  return {
    id: crypto.randomUUID(),
    type,
    content: "",
    image: null,
    widthPercent: 100,
  };
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("No se pudo leer la imagen."));
    };

    reader.onerror = () =>
      reject(reader.error ?? new Error("No se pudo leer la imagen."));
    reader.readAsDataURL(file);
  });
}

export async function createContentImages(files: FileList | null) {
  if (!files) {
    return [];
  }

  const imageFiles = Array.from(files).filter((file) =>
    file.type.startsWith("image/"),
  );

  return Promise.all(
    imageFiles.map(async (file) => ({
      id: crypto.randomUUID(),
      name: file.name,
      url: await readFileAsDataUrl(file),
    })),
  );
}

export function getNonEmptyBlocks(blocks: ContentBlock[]) {
  return blocks.filter((block) => {
    if (block.type === "image") {
      return block.image !== null;
    }

    return block.content.trim().length > 0 || hasTaskBlanks(block.richText);
  });
}

export function getQuestionSummary(blocks: ContentBlock[]) {
  const challengeBlock = blocks.find(
    (block) => block.type === "challenge" && block.content.trim().length > 0,
  );

  if (challengeBlock) {
    return challengeBlock.content.trim();
  }

  const firstTextBlock = blocks.find(
    (block) => block.content.trim().length > 0,
  );
  return firstTextBlock?.content.trim() ?? "Sin pregunta definida";
}

export function getBlocksSummary(blocks: ContentBlock[]) {
  const parts = blocks.flatMap((block) => {
    if (block.type === "image") {
      return block.image ? [`imagen:${block.image.name}`] : [];
    }

    const content = block.content.trim().toLowerCase();
    return content ? [content] : [];
  });

  return parts.join(" | ");
}

export function buildAgeSummary(difficulties: Record<DifficultyKey, string>) {
  const activeRanges = ageRanges.filter((range) => difficulties[range]);
  return activeRanges.length > 0
    ? activeRanges.join(", ")
    : "Sin rango asignado";
}

export function normalizeCategories(value: unknown): CategoryItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (item): item is CategoryItem =>
      typeof item === "string" &&
      (categories as readonly string[]).includes(item),
  );
}

function isOptionKey(value: string): value is OptionKey {
  return (optionLabels as readonly string[]).includes(value);
}

function normalizeOptionKeys(values: string[]) {
  return [...new Set(values.filter(isOptionKey))];
}

export function encodeMultipleChoiceCorrectness(
  mode: MultipleChoiceCorrectnessMode,
  correctOptionIds: OptionKey[],
) {
  const uniqueOptions = [...new Set(correctOptionIds)].filter(isOptionKey);

  if (mode === "single") {
    return `single:${uniqueOptions[0] ?? "A"}`;
  }

  const prefix = mode === "all" ? "all" : "any";
  return `${prefix}:${uniqueOptions.join(",")}`;
}

/**
 * Lee `correctAnswerId`. El formato es `modo:opciones` (`single:B`, `any:B,C`,
 * `all:B,D`). Una letra suelta es el formato viejo y se lee como `single`.
 */
export function parseMultipleChoiceCorrectness(
  value: string | null | undefined,
) {
  const rawValue = String(value ?? "").trim();
  const separatorAt = rawValue.indexOf(":");

  if (separatorAt !== -1) {
    const rawMode = rawValue.slice(0, separatorAt);
    const mode = (
      (multipleChoiceCorrectnessModes as readonly string[]).includes(rawMode)
        ? rawMode
        : "single"
    ) as MultipleChoiceCorrectnessMode;
    const correctOptionIds = normalizeOptionKeys(
      rawValue
        .slice(separatorAt + 1)
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    );

    return {
      mode,
      correctOptionIds:
        mode === "single" ? correctOptionIds.slice(0, 1) : correctOptionIds,
    };
  }

  return {
    mode: "single" as MultipleChoiceCorrectnessMode,
    correctOptionIds: isOptionKey(rawValue) ? [rawValue] : [],
  };
}
