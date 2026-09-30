/** Shared, dependency-free contract for constructed and inline answers. */
export type AssignmentImage = { id: string; name: string; url: string };
export type AssignmentOption = {
  id: string;
  label: string;
  image: AssignmentImage | null;
  limit: number | null;
};
export type GridConfig = {
  version: 1;
  rows: number;
  columns: number;
  cells: Array<{ id: string; label: string }>;
  states: AssignmentOption[];
};
export type ClozeConfig = {
  version: 1;
  options: AssignmentOption[];
  blanks: Array<{ id: string; allowedOptionIds: string[] }>;
};
export type AssignmentConfig = GridConfig | ClozeConfig;
export type AssignmentKey = {
  version: 1;
  acceptedAssignments: Array<Record<string, string>>;
};

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function id(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value !== value.trim() ||
    value.length > 100 ||
    ["__proto__", "prototype", "constructor"].includes(value)
  )
    throw new Error("Cada casilla y opción debe tener un ID válido.");
  return value;
}
function integer(value: unknown, min: number, max: number): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
  );
}
function unique(ids: string[], message: string) {
  if (new Set(ids).size !== ids.length) throw new Error(message);
}
function list(value: unknown, max: number, label: string): unknown[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > max)
    throw new Error(`Debes definir entre 1 y ${max} ${label}.`);
  return value;
}
function options(value: unknown): AssignmentOption[] {
  const result = list(value, 64, "opciones").map((entry) => {
    if (!object(entry)) throw new Error("La opción no es válida.");
    const label = typeof entry.label === "string" ? entry.label.trim() : "";
    if (!label || label.length > 1000)
      throw new Error(
        "Cada opción necesita una etiqueta de hasta 1000 caracteres.",
      );
    let image: AssignmentImage | null = null;
    if (entry.image !== null && entry.image !== undefined) {
      const raw = entry.image;
      if (
        !object(raw) ||
        typeof raw.name !== "string" ||
        typeof raw.url !== "string" ||
        !raw.url.trim()
      )
        throw new Error("La imagen de la opción no es válida.");
      image = { id: id(raw.id), name: raw.name, url: raw.url };
    }
    if (entry.limit !== null && !integer(entry.limit, 0, 144))
      throw new Error(
        "La cantidad disponible debe ser un entero entre 0 y 144, o ilimitada.",
      );
    return {
      id: id(entry.id),
      label,
      image,
      limit: entry.limit as number | null,
    };
  });
  unique(
    result.map((entry) => entry.id),
    "Los IDs de las opciones deben ser únicos.",
  );
  return result;
}

export function parseGridConfig(value: unknown): GridConfig {
  if (!object(value) || value.version !== 1)
    throw new Error("La configuración de casillas no es válida.");
  if (!integer(value.rows, 1, 12) || !integer(value.columns, 1, 12))
    throw new Error("La rejilla debe tener entre 1 y 12 filas y columnas.");
  const cells = list(value.cells, 144, "casillas").map((entry) => {
    if (
      !object(entry) ||
      typeof entry.label !== "string" ||
      !entry.label.trim() ||
      entry.label.length > 1000
    )
      throw new Error("Cada casilla necesita una etiqueta.");
    return { id: id(entry.id), label: entry.label.trim() };
  });
  if (cells.length !== value.rows * value.columns)
    throw new Error(
      "La cantidad de casillas debe coincidir con las filas y columnas.",
    );
  unique(
    cells.map((entry) => entry.id),
    "Los IDs de las casillas deben ser únicos.",
  );
  return {
    version: 1,
    rows: value.rows,
    columns: value.columns,
    cells,
    states: options(value.states),
  };
}

/** Local renderer/editor contract, mirrored in backend task-answers.
 * Only visible text/challenge documents define positions; metadata is not traversed.
 * Depth starts at the doc (0), as in renderRichTextDocument.
 */
export function collectTaskBlankIds(blocks: unknown): string[] {
  const ids: string[] = [];
  function visit(node: unknown, parent: string, depth: number) {
    const children: Record<string, string[]> = {
      root: ["doc"],
      doc: ["paragraph", "bulletList", "orderedList"],
      paragraph: ["text", "hardBreak", "taskBlank", "image"],
      bulletList: ["listItem"],
      orderedList: ["listItem"],
      listItem: ["paragraph", "bulletList", "orderedList"],
    };
    if (
      depth > 20 ||
      !object(node) ||
      typeof node.type !== "string" ||
      !children[parent]?.includes(node.type) ||
      (node.content !== undefined && !Array.isArray(node.content)) ||
      (node.type === "text" && typeof node.text !== "string") ||
      (node.marks !== undefined &&
        (!Array.isArray(node.marks) ||
          node.marks.some(
            (mark) => !object(mark) || typeof mark.type !== "string",
          )))
    )
      throw new Error(
        "El documento de huecos no es compatible con el renderer (profundidad máxima: 20).",
      );
    if (node.type === "taskBlank") {
      if (!object(node.attrs))
        throw new Error("El hueco del texto necesita un ID.");
      ids.push(id(node.attrs.blankId));
    }
    if (Array.isArray(node.content))
      node.content.forEach((child) =>
        visit(child, node.type as string, depth + 1),
      );
  }
  if (Array.isArray(blocks)) {
    for (const block of blocks) {
      if (
        !object(block) ||
        block.richText === undefined ||
        block.richText === null
      )
        continue;
      if (
        !["text", "challenge"].includes(block.type as string) ||
        typeof block.content !== "string"
      )
        throw new Error(
          "Los huecos deben estar en bloques de texto renderizables.",
        );
      visit(block.richText, "root", 0);
    }
  }
  return ids;
}

export function parseClozeConfig(
  value: unknown,
  blocks?: unknown,
): ClozeConfig {
  if (!object(value) || value.version !== 1)
    throw new Error("La configuración de huecos no es válida.");
  const bank = options(value.options);
  const optionIds = new Set(bank.map((entry) => entry.id));
  const blanks = list(value.blanks, 144, "huecos").map((entry) => {
    if (!object(entry)) throw new Error("El hueco no es válido.");
    const allowedOptionIds = list(
      entry.allowedOptionIds,
      64,
      "opciones por hueco",
    ).map(id);
    unique(allowedOptionIds, "Las opciones permitidas no deben repetirse.");
    if (allowedOptionIds.some((optionId) => !optionIds.has(optionId)))
      throw new Error("Cada hueco debe usar opciones del banco.");
    return { id: id(entry.id), allowedOptionIds };
  });
  unique(
    blanks.map((entry) => entry.id),
    "Los IDs de los huecos deben ser únicos.",
  );
  if (blocks !== undefined) {
    const documentIds = collectTaskBlankIds(blocks);
    unique(documentIds, "Cada hueco debe aparecer una sola vez en el texto.");
    const configured = new Set(blanks.map((blank) => blank.id));
    if (
      documentIds.length !== blanks.length ||
      documentIds.some((blankId) => !configured.has(blankId))
    )
      throw new Error(
        "Los huecos configurados deben coincidir con los huecos del texto.",
      );
  }
  return { version: 1, options: bank, blanks };
}

export function parseAssignmentConfig(
  answerType: string,
  value: unknown,
  blocks?: unknown,
): AssignmentConfig {
  if (answerType === "state_grid") return parseGridConfig(value);
  if (answerType === "text_cloze") return parseClozeConfig(value, blocks);
  throw new Error("El tipo de respuesta construida no es válido.");
}

function assignmentsValid(
  config: AssignmentConfig,
  value: unknown,
  complete: boolean,
): value is Record<string, string> {
  if (!object(value)) return false;
  const grid = "cells" in config;
  const slots = grid ? config.cells : config.blanks;
  const bank = grid ? config.states : config.options;
  const entries = Object.entries(value);
  if (complete && entries.length !== slots.length) return false;
  const counts = new Map<string, number>();
  for (const [slotId, optionId] of entries) {
    const slot = slots.find((entry) => entry.id === slotId);
    const option = bank.find((entry) => entry.id === optionId);
    if (!slot || !option) return false;
    if (
      "allowedOptionIds" in slot &&
      !slot.allowedOptionIds.includes(option.id)
    )
      return false;
    const count = (counts.get(option.id) ?? 0) + 1;
    if (option.limit !== null && count > option.limit) return false;
    counts.set(option.id, count);
  }
  return !complete || slots.every((slot) => Object.hasOwn(value, slot.id));
}

function signature(value: Record<string, string>): string {
  return JSON.stringify(
    Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

export function parseAssignmentKey(
  value: unknown,
  config: AssignmentConfig,
): AssignmentKey {
  if (!object(value) || value.version !== 1)
    throw new Error("Debes definir la solución de la tarea.");
  const signatures = new Set<string>();
  const acceptedAssignments = list(
    value.acceptedAssignments,
    100,
    "soluciones",
  ).map((entry) => {
    if (!assignmentsValid(config, entry, true))
      throw new Error(
        "Cada solución debe completar todas las casillas con opciones permitidas y disponibles.",
      );
    const key = signature(entry);
    if (signatures.has(key))
      throw new Error("Las soluciones no deben repetirse.");
    signatures.add(key);
    return Object.fromEntries(Object.entries(entry));
  });
  return { version: 1, acceptedAssignments };
}

/** Partial and cleared responses can be saved; malformed values cannot overwrite them. */
export function validateAssignmentAnswer(
  config: AssignmentConfig,
  payload: unknown,
): boolean {
  if (!object(payload)) return false;
  if (Object.keys(payload).length === 0) return true;
  const field = "cells" in config ? "cells" : "blanks";
  return (
    payload.version === 1 &&
    Object.keys(payload).every((key) => key === "version" || key === field) &&
    assignmentsValid(config, payload[field], false)
  );
}

export function assignmentAnswerIsCorrect(
  config: AssignmentConfig,
  key: unknown,
  payload: unknown,
): boolean {
  if (!validateAssignmentAnswer(config, payload) || !object(payload))
    return false;
  const value = payload["cells" in config ? "cells" : "blanks"];
  if (!assignmentsValid(config, value, true)) return false;
  try {
    return parseAssignmentKey(key, config).acceptedAssignments.some(
      (accepted) => signature(accepted) === signature(value),
    );
  } catch {
    return false;
  }
}
