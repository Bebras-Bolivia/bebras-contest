import { apiRequest as request } from "@/lib/api-client";
import type { ClozeConfig, GridConfig } from "@/lib/assignment-answers";
import type { ContestRules, PlayTask } from "@/lib/play-api";
import type { GroupTeam } from "@/lib/groups-api";
import type { ContentImage } from "@/lib/task-schema";
import { formatDateTime } from "@/lib/countdown";
import { DEPARTMENTS } from "@/lib/departments";

export type PaperTask = PlayTask & {
  difficulty: string;
  maxScore: number;
  minScore: number;
};

export type PaperTeam = GroupTeam & {
  category: string | null;
  status: "pending" | "in_progress" | "finished";
  mode: "online" | "paper";
};

export type PaperBundle = {
  group: { id: string; name: string; accessCode: string };
  contest: {
    id: string;
    title: string;
    durationMinutes: number;
    startsAt: string | null;
    endsAt: string | null;
  };
  department: string | null;
  printFrom: string | null;
  canPrint: boolean;
  entryOpen: boolean;
  entryUntil: string | null;
  categories: Array<{ name: string; rules: ContestRules; tasks: PaperTask[] }>;
  teams: PaperTeam[];
};

export type PaperAnswers = {
  status: PaperTeam["status"];
  mode: PaperTeam["mode"];
  savedAt: string | null;
  answers: Record<string, unknown>;
};

export function getPaperBundle(groupId: string) {
  return request<PaperBundle>(`/api/groups/${groupId}/paper`);
}

export function getPaperAnswers(teamId: string) {
  return request<PaperAnswers>(`/api/teams/${teamId}/paper`);
}

export function savePaperAnswers(
  teamId: string,
  answers: Record<string, unknown>,
) {
  return request<{ answeredCount: number; taskCount: number }>(
    `/api/teams/${teamId}/paper`,
    { method: "PUT", body: JSON.stringify({ answers }) },
  );
}

export function clearPaperAnswers(teamId: string) {
  return request<null>(`/api/teams/${teamId}/paper`, { method: "DELETE" });
}

/*
 * Lo que sigue lo comparten el cuadernillo, la hoja de respuestas y la carga
 * del maestro: la letra o el número que se imprime es el que se toca al cargar.
 */

export const letter = (index: number) => String.fromCharCode(65 + index);

/** La letra de una opción es la suya (A-F), como en la prueba en línea. */
export function choiceLetter(id: string, index: number) {
  return /^[A-F]$/.test(id) ? id : letter(index);
}

export function gridConfig(task: PlayTask) {
  return task.answerType === "state_grid" && task.answerConfig?.version === 1
    ? (task.answerConfig as unknown as GridConfig)
    : null;
}

export function clozeConfig(task: PlayTask) {
  return task.answerType === "text_cloze" && task.answerConfig?.version === 1
    ? (task.answerConfig as unknown as ClozeConfig)
    : null;
}

/**
 * Cómo se nombra cada casilla en la hoja: su rótulo si dice algo (como los
 * dígitos de un código) o su número si solo repite el puesto, igual que el
 * reproductor en línea.
 */
export function gridCellLabels(config: GridConfig) {
  const positional = config.cells.every((cell, index) => {
    const label = cell.label.trim().toLowerCase();
    const position = String(index + 1);
    return (
      label === position ||
      label === `posición ${position}` ||
      label === `casilla ${position}`
    );
  });
  return config.cells.map((cell, index) =>
    positional ? String(index + 1) : cell.label.trim(),
  );
}

/** Estados u opciones que se pueden usar, en el orden de sus letras. */
export function usable<T extends { limit: number | null }>(options: T[]) {
  return options.filter((option) => option.limit !== 0);
}

/**
 * Los lugares del arrastre en orden de lectura: de arriba abajo y, en la
 * misma franja, de izquierda a derecha.
 */
export function paperTargets(task: PlayTask) {
  const band = (y: number) => Math.round(y / 8);
  return [...task.dragDropTargets].sort(
    (a, b) => band(a.y) - band(b.y) || a.x - b.x || a.y - b.y,
  );
}

export type PaperPiece = {
  letter: string;
  itemIds: string[];
  label: string;
  image: ContentImage | null;
};

/**
 * Piezas del arrastre. Las que se ven iguales comparten letra: en papel no hay
 * forma de distinguirlas, y al cargar se usa cualquiera de ellas libre.
 */
export function paperPieces(task: PlayTask): PaperPiece[] {
  const pieces: PaperPiece[] = [];
  for (const item of task.dragDropItems) {
    const label = item.label?.trim() ?? "";
    const image = item.image ?? null;
    const same = pieces.find(
      (piece) => piece.label === label && piece.image?.url === image?.url,
    );
    if (same) {
      same.itemIds.push(item.id);
    } else {
      pieces.push({
        letter: letter(pieces.length),
        itemIds: [item.id],
        label,
        image,
      });
    }
  }
  return pieces;
}

/** Cómo se marca cada tipo en la hoja; la portada explica solo los que hay. */
export type MarkKind = "bubble" | "box" | "write" | "cross";

export function markKind(task: PlayTask): MarkKind {
  if (task.answerType === "multiple_choice") return "bubble";
  if (task.answerType === "short_text") return "write";
  if (task.answerType === "image_hotspot") return "cross";
  return "box";
}

/** El castor del departamento del colegio; sin uno claro, el de siempre. */
export function beaverFor(department: string | null) {
  const key = (department ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .trim();
  const found = DEPARTMENTS.find(
    (item) =>
      item.key === key ||
      item.name.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase() === key,
  );
  return {
    full: `/castores/${found?.slug ?? "estandar"}.webp`,
    head: `/castores/${found?.slug ?? "estandar"}-cabeza.webp`,
    name: found?.name ?? null,
  };
}

/** La fecha al final de una frase: «p. m.» ya trae su punto. */
export function dateAtEnd(value: string) {
  const text = formatDateTime(value);
  return text.endsWith(".") ? text : `${text}.`;
}
