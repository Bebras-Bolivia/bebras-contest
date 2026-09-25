import {
  dragDropPrimaryPlacements,
  dragDropSignature,
  type DragDropSolution,
} from "../drag-drop-grading";
import type { DragDropItem, DragDropTarget, DragDropConfig } from "./types";
import { parseMcCorrectness } from "./multiple-choice";
import { parseHotspotConfig, parseHotspotKey } from "./image-hotspot";
import {
  collectTaskBlankIds,
  parseAssignmentConfig,
  parseAssignmentKey,
} from "./assignment-answers";

const serializeJson = JSON.stringify;
const TASK_ANSWER_TYPES = [
  "multiple_choice",
  "short_text",
  "drag_drop",
  "image_hotspot",
  "state_grid",
  "text_cloze",
];

type ContentBlockInput = {
  content?: unknown;
  image?: unknown;
};

function blockHasContent(block: unknown) {
  if (!block || typeof block !== "object") {
    return false;
  }

  const typed = block as ContentBlockInput;
  const text = typeof typed.content === "string" ? typed.content.trim() : "";
  return (
    text.length > 0 ||
    Boolean(typed.image) ||
    collectTaskBlankIds([block]).length > 0
  );
}

export function countFilledBlocks(value: unknown) {
  return Array.isArray(value) ? value.filter(blockHasContent).length : 0;
}

function readText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function validDragDropImage(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const image = value as Record<string, unknown>;
  if (
    !readText(image.id) ||
    !readText(image.name) ||
    typeof image.url !== "string" ||
    image.url !== image.url.trim()
  )
    return false;
  if (/^\/(?!\/)[^\s\\]+$/.test(image.url)) return true;
  if (/^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/]+={0,2}$/i.test(image.url))
    return true;
  const svg = /^data:image\/svg\+xml(?:;charset=utf-8)?,(.+)$/i.exec(image.url);
  if (svg) {
    try {
      return decodeURIComponent(svg[1]).trim().length > 0;
    } catch {
      return false;
    }
  }
  try {
    const url = new URL(image.url);
    return (
      ["https:", "http:"].includes(url.protocol) &&
      Boolean(url.hostname) &&
      !/\s/.test(image.url)
    );
  } catch {
    return false;
  }
}

function readFiniteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizeDragDropCoordinate(value: unknown) {
  return Math.round(readFiniteNumber(value) * 1000) / 1000;
}

function normalizeDragDropWidth(value: unknown) {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= 100
    ? value
    : 12;
}

function legacyDragDropTargetId(
  index: number,
  itemId: string,
  x: number,
  y: number,
  snapRadius: number,
) {
  const value = `${index}\u0000${itemId}\u0000${x}\u0000${y}\u0000${snapRadius}`;
  let hash = 2166136261;

  for (let character = 0; character < value.length; character += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(character), 16777619);
  }

  return `legacy-target-${(hash >>> 0).toString(36)}`;
}

function normalizeDragDropSolutions(value: unknown): DragDropSolution[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const solutions: DragDropSolution[] = [];

  value.forEach((entry, index) => {
    const solution =
      entry && typeof entry === "object" && !Array.isArray(entry)
        ? (entry as Record<string, unknown>)
        : {};
    const raw = solution.placements;

    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return;
    }

    const placements: Record<string, string> = {};

    for (const [itemId, targetId] of Object.entries(
      raw as Record<string, unknown>,
    )) {
      if (typeof targetId === "string" && targetId) {
        placements[itemId] = targetId;
      }
    }

    solutions.push({
      id:
        typeof solution.id === "string" && solution.id
          ? solution.id
          : `solution-${index + 1}`,
      placements,
    });
  });

  return solutions;
}

export function normalizeDragDropConfig(value: unknown): DragDropConfig {
  if (Array.isArray(value)) {
    const items: DragDropItem[] = [];
    const targets: DragDropTarget[] = [];
    const targetIds = new Set<string>();

    value.forEach((entry, index) => {
      const item =
        entry && typeof entry === "object"
          ? (entry as Record<string, unknown>)
          : {};
      const id =
        typeof item.id === "string" && item.id
          ? item.id
          : `legacy-item-${index + 1}`;
      const x = normalizeDragDropCoordinate(item.targetX);
      const y = normalizeDragDropCoordinate(item.targetY);
      const snapRadius = readFiniteNumber(item.tolerance);
      const targetIdBase = legacyDragDropTargetId(index, id, x, y, snapRadius);
      let targetId = targetIdBase;
      let collisionSuffix = 2;
      while (targetIds.has(targetId)) {
        targetId = `${targetIdBase}-${collisionSuffix}`;
        collisionSuffix += 1;
      }
      targetIds.add(targetId);

      items.push({
        id,
        label: item.label ?? "",
        image: item.image ?? null,
        equivalenceKey:
          typeof item.equivalenceKey === "string"
            ? item.equivalenceKey.trim() || undefined
            : undefined,
        widthPercent: normalizeDragDropWidth(item.widthPercent),
        correctTargetId: targetId,
      });
      targets.push({ id: targetId, x, y, snapRadius });
    });

    return { version: 1, items, targets, solutions: [] };
  }

  if (!value || typeof value !== "object") {
    return { version: 2, items: [], targets: [], solutions: [] };
  }

  const config = value as Record<string, unknown>;
  if (
    (config.version !== 1 && config.version !== 2) ||
    !Array.isArray(config.items) ||
    !Array.isArray(config.targets)
  ) {
    return { version: 2, items: [], targets: [], solutions: [] };
  }

  return {
    version: config.version,
    solutions: normalizeDragDropSolutions(config.solutions),
    items: config.items.map((entry, index) => {
      const item =
        entry && typeof entry === "object"
          ? (entry as Record<string, unknown>)
          : {};
      return {
        id:
          typeof item.id === "string" && item.id
            ? item.id
            : `item-${index + 1}`,
        label: item.label ?? "",
        image: item.image ?? null,
        equivalenceKey:
          typeof item.equivalenceKey === "string"
            ? item.equivalenceKey.trim() || undefined
            : undefined,
        widthPercent: normalizeDragDropWidth(item.widthPercent),
        correctTargetId:
          typeof item.correctTargetId === "string" ? item.correctTargetId : "",
      };
    }),
    targets: config.targets.map((entry, index) => {
      const target =
        entry && typeof entry === "object"
          ? (entry as Record<string, unknown>)
          : {};
      return {
        id:
          typeof target.id === "string" && target.id
            ? target.id
            : `target-${index + 1}`,
        x: normalizeDragDropCoordinate(target.x),
        y: normalizeDragDropCoordinate(target.y),
        snapRadius: readFiniteNumber(target.snapRadius),
      };
    }),
  };
}

// Reserved until each new answer type brings a versioned validator.
function reservedDocument(value: unknown, field: string) {
  if (value === undefined) return "{}";
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length > 0
  ) {
    throw new Error(
      `El campo ${field} debe ser un objeto vacío para este tipo de respuesta.`,
    );
  }
  return "{}";
}

/**
 * La opción múltiple guarda en answerConfig cómo se muestran sus opciones.
 * El resto de los tipos sigue con el documento reservado y vacío.
 */
function parseAnswerConfigDocument(value: unknown, answerType: string) {
  if (answerType !== "multiple_choice") {
    return reservedDocument(value, "answerConfig");
  }

  if (value === undefined) {
    return serializeJson({ multipleChoiceLayout: "vertical" });
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("El campo answerConfig debe ser un objeto.");
  }

  const config = value as Record<string, unknown>;
  const unknownKey = Object.keys(config).find(
    (key) => key !== "multipleChoiceLayout",
  );

  if (unknownKey) {
    throw new Error(
      `El campo answerConfig no acepta "${unknownKey}" en una opción múltiple.`,
    );
  }

  return serializeJson({
    multipleChoiceLayout:
      config.multipleChoiceLayout === "horizontal" ? "horizontal" : "vertical",
  });
}

/** Disposición con la que se pintan las opciones; vertical es lo de siempre. */
export function readMultipleChoiceLayout(config: unknown) {
  return config &&
    typeof config === "object" &&
    (config as Record<string, unknown>).multipleChoiceLayout === "horizontal"
    ? "horizontal"
    : "vertical";
}

export function parseTaskAnswerConfig(body: Record<string, unknown>) {
  const answerType = readText(body.answerType) || "multiple_choice";

  if (
    answerType === "image_hotspot" ||
    answerType === "state_grid" ||
    answerType === "text_cloze"
  ) {
    const blocks = [
      ...(Array.isArray(body.bodyBlocks) ? body.bodyBlocks : []),
      ...(Array.isArray(body.challengeBlocks) ? body.challengeBlocks : []),
    ];
    const config =
      answerType === "image_hotspot"
        ? parseHotspotConfig(body.answerConfig)
        : parseAssignmentConfig(answerType, body.answerConfig, blocks);
    const key =
      "regions" in config
        ? parseHotspotKey(body.answerKey, config)
        : parseAssignmentKey(body.answerKey, config);
    return {
      answerType,
      answerConfig: serializeJson(config),
      answerKey: serializeJson(key),
      multipleChoiceOrderMode: "fixed",
      answers: "[]",
      correctAnswerId: "",
      shortAnswer: "",
      dragDropBackground: "null",
      dragDropItems: "[]",
    };
  }

  if (!TASK_ANSWER_TYPES.includes(answerType)) {
    throw new Error("El tipo de respuesta no es válido.");
  }

  const answers = Array.isArray(body.answers) ? body.answers : [];
  const correctAnswerId = readText(body.correctAnswerId);
  const shortAnswer = readText(body.shortAnswer);
  const dragDropItems = Array.isArray(body.dragDropItems)
    ? body.dragDropItems
    : [];
  const dragDropTargets = Array.isArray(body.dragDropTargets)
    ? body.dragDropTargets
    : [];
  const dragDropSolutions = Array.isArray(body.dragDropSolutions)
    ? body.dragDropSolutions
    : [];
  let dragDropConfig: {
    version: 2;
    items: DragDropItem[];
    targets: DragDropTarget[];
    solutions: DragDropSolution[];
  } = {
    version: 2,
    items: [],
    targets: [],
    solutions: [],
  };

  if (answerType === "multiple_choice") {
    const filledAnswers = answers.filter(
      (answer) =>
        answer &&
        typeof answer === "object" &&
        countFilledBlocks((answer as { blocks?: unknown }).blocks) > 0,
    );

    if (filledAnswers.length < 2) {
      throw new Error("Debes completar al menos dos respuestas.");
    }

    const { mode, ids } = parseMcCorrectness(correctAnswerId);

    if (mode === "single" && ids.length !== 1) {
      throw new Error("Debes marcar exactamente una respuesta correcta.");
    }

    if (mode !== "single" && ids.length < 2) {
      throw new Error("Debes marcar al menos dos respuestas correctas.");
    }

    const filledIds = new Set(
      filledAnswers.map((answer) => String((answer as { id?: unknown }).id)),
    );
    const missing = ids.find((id) => !filledIds.has(id));

    if (missing) {
      throw new Error(
        "Las respuestas marcadas como correctas deben tener contenido.",
      );
    }
  }

  if (answerType === "short_text" && !shortAnswer) {
    throw new Error("Debes definir la respuesta corta esperada.");
  }

  if (answerType === "drag_drop") {
    const backgroundWidth = (
      body.dragDropBackground as Record<string, unknown> | null
    )?.widthPercent;
    if (
      !validDragDropImage(body.dragDropBackground) ||
      (backgroundWidth !== undefined &&
        (typeof backgroundWidth !== "number" ||
          !Number.isFinite(backgroundWidth) ||
          backgroundWidth < 20 ||
          backgroundWidth > 100))
    ) {
      throw new Error(
        "Debes agregar la imagen de fondo para arrastrar y soltar.",
      );
    }

    if (dragDropItems.length === 0 || dragDropTargets.length === 0) {
      throw new Error(
        "Debes agregar al menos un objeto arrastrable y un destino.",
      );
    }

    if (dragDropItems.length > dragDropTargets.length) {
      throw new Error(
        "Debe haber al menos tantos destinos como objetos arrastrables.",
      );
    }

    const normalizedItems: DragDropItem[] = [];
    const normalizedTargets: DragDropTarget[] = [];
    const itemIds = new Set<string>();
    const targetIds = new Set<string>();

    for (const dragDropItem of dragDropItems) {
      const item = (dragDropItem ?? {}) as Record<string, unknown>;
      const id = readText(item.id);
      const label = readText(item.label);
      const widthPercent = item.widthPercent;
      const correctTargetId = readText(item.correctTargetId);
      if (
        item.equivalenceKey !== undefined &&
        (typeof item.equivalenceKey !== "string" ||
          item.equivalenceKey.trim().length > 100)
      ) {
        throw new Error(
          "La clave de piezas equivalentes debe ser un texto de hasta 100 caracteres.",
        );
      }
      const equivalenceKey = readText(item.equivalenceKey) || undefined;

      if (!id) {
        throw new Error("Cada objeto arrastrable debe tener un ID.");
      }

      if (itemIds.has(id)) {
        throw new Error(
          "Los IDs de los objetos arrastrables deben ser únicos.",
        );
      }
      itemIds.add(id);

      if (!label) {
        throw new Error("Cada objeto arrastrable debe tener un nombre.");
      }

      if (!validDragDropImage(item.image)) {
        throw new Error("Cada objeto arrastrable debe tener una imagen.");
      }

      if (
        typeof widthPercent !== "number" ||
        !Number.isFinite(widthPercent) ||
        widthPercent <= 0 ||
        widthPercent > 100
      ) {
        throw new Error(
          "El ancho de cada objeto arrastrable debe ser mayor que 0 y menor o igual a 100.",
        );
      }

      if (!correctTargetId) {
        throw new Error(
          "Cada objeto arrastrable debe tener un destino correcto.",
        );
      }

      normalizedItems.push({
        id,
        label,
        image: item.image,
        equivalenceKey,
        widthPercent,
        correctTargetId,
      });
    }

    for (const dragDropTarget of dragDropTargets) {
      const target = (dragDropTarget ?? {}) as Record<string, unknown>;
      const id = readText(target.id);
      const x = target.x;
      const y = target.y;
      const snapRadius = target.snapRadius;

      if (!id) {
        throw new Error("Cada destino debe tener un ID.");
      }

      if (targetIds.has(id)) {
        throw new Error("Los IDs de los destinos deben ser únicos.");
      }
      targetIds.add(id);

      if (
        typeof x !== "number" ||
        typeof y !== "number" ||
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        x < 0 ||
        x > 100 ||
        y < 0 ||
        y > 100
      ) {
        throw new Error(
          "La posición de cada destino debe estar entre 0 y 100.",
        );
      }

      if (
        typeof snapRadius !== "number" ||
        !Number.isFinite(snapRadius) ||
        snapRadius <= 0 ||
        snapRadius > 100
      ) {
        throw new Error(
          "El radio de ajuste de cada destino debe ser mayor que 0 y menor o igual a 100.",
        );
      }

      normalizedTargets.push({
        id,
        x: normalizeDragDropCoordinate(x),
        y: normalizeDragDropCoordinate(y),
        snapRadius,
      });
    }

    const usedTargetIds = new Set<string>();
    for (const item of normalizedItems) {
      if (!targetIds.has(item.correctTargetId)) {
        throw new Error(
          "El destino correcto de cada objeto debe existir en la tarea.",
        );
      }

      if (usedTargetIds.has(item.correctTargetId)) {
        throw new Error(
          "Cada destino debe ser la respuesta correcta de un solo objeto.",
        );
      }
      usedTargetIds.add(item.correctTargetId);
    }

    // Alternativas: cada una coloca todos los objetos en destinos elegibles,
    // dejando libres los demás. Dos alternativas que solo intercambian piezas
    // idénticas son la misma respuesta, así que se rechazan por repetidas.
    const normalizedSolutions: DragDropSolution[] = [];
    const solutionIds = new Set<string>();
    const seenSignatures = new Set<string>();
    const primarySignature = dragDropSignature(
      normalizedItems,
      dragDropPrimaryPlacements(normalizedItems),
    );

    if (primarySignature) {
      seenSignatures.add(primarySignature);
    }

    for (const dragDropSolution of dragDropSolutions) {
      const solution = (dragDropSolution ?? {}) as Record<string, unknown>;
      const id = readText(solution.id);

      if (!id) {
        throw new Error("Cada solución alternativa debe tener un ID.");
      }

      if (solutionIds.has(id)) {
        throw new Error(
          "Los IDs de las soluciones alternativas deben ser únicos.",
        );
      }
      solutionIds.add(id);

      const rawPlacements = solution.placements;

      if (
        !rawPlacements ||
        typeof rawPlacements !== "object" ||
        Array.isArray(rawPlacements)
      ) {
        throw new Error(
          "Cada solución alternativa debe indicar dónde va cada objeto.",
        );
      }

      const placements: Record<string, string> = {};
      const usedInSolution = new Set<string>();

      if (Object.keys(rawPlacements).some((itemId) => !itemIds.has(itemId))) {
        throw new Error(
          "Las soluciones alternativas solo pueden incluir objetos de la tarea.",
        );
      }

      for (const item of normalizedItems) {
        if (!Object.hasOwn(rawPlacements, item.id)) {
          throw new Error(
            "Cada solución alternativa debe colocar todos los objetos en destinos de la tarea.",
          );
        }
        const targetId = readText(
          (rawPlacements as Record<string, unknown>)[item.id],
        );

        if (!targetId || !targetIds.has(targetId)) {
          throw new Error(
            "Cada solución alternativa debe colocar todos los objetos en destinos de la tarea.",
          );
        }

        if (usedInSolution.has(targetId)) {
          throw new Error(
            "En cada solución alternativa, cada destino debe recibir un solo objeto.",
          );
        }
        usedInSolution.add(targetId);
        placements[item.id] = targetId;
      }

      const signature = dragDropSignature(normalizedItems, placements);

      if (!signature || seenSignatures.has(signature)) {
        throw new Error(
          "Esa solución alternativa es igual a otra que ya guardaste.",
        );
      }
      seenSignatures.add(signature);

      normalizedSolutions.push({ id, placements });
    }

    dragDropConfig = {
      version: 2,
      items: normalizedItems,
      targets: normalizedTargets,
      solutions: normalizedSolutions,
    };
  }

  return {
    answerType,
    multipleChoiceOrderMode:
      body.multipleChoiceOrderMode === "random" ? "random" : "fixed",
    answers: serializeJson(answers),
    correctAnswerId,
    shortAnswer: answerType === "short_text" ? shortAnswer : "",
    dragDropBackground: serializeJson(
      answerType === "drag_drop" ? (body.dragDropBackground ?? null) : null,
    ),
    dragDropItems: serializeJson(
      answerType === "drag_drop" ? dragDropConfig : [],
    ),
    answerConfig: parseAnswerConfigDocument(body.answerConfig, answerType),
    answerKey: reservedDocument(body.answerKey, "answerKey"),
  };
}
