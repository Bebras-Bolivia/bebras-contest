import type { PlayTask } from "./types";
import { parseHotspotConfig, validateHotspotAnswer } from "./image-hotspot";
import {
  parseAssignmentConfig,
  validateAssignmentAnswer,
} from "./assignment-answers";
import { validateInteractiveAnswer } from "./interactive";

type ParsedDragDropAnswer =
  | { kind: "targets"; placements: Record<string, string> }
  | {
      kind: "coordinates";
      placements: Record<string, { x: number; y: number }>;
    };

export function parseDragDropAnswer(
  task: PlayTask,
  payload: unknown,
): ParsedDragDropAnswer | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const placements = (payload as Record<string, unknown>).placements;
  if (
    !placements ||
    typeof placements !== "object" ||
    Array.isArray(placements)
  ) {
    return null;
  }

  const entries = Object.entries(placements as Record<string, unknown>);
  const itemIds = new Set(task.dragDropItems.map((item) => item.id));
  if (entries.some(([itemId]) => !itemIds.has(itemId))) {
    return null;
  }

  if (entries.every(([, targetId]) => typeof targetId === "string")) {
    const targetIds = new Set(task.dragDropTargets.map((target) => target.id));
    const occupiedTargetIds = new Set<string>();
    const normalizedPlacements: Record<string, string> = {};

    for (const [itemId, targetId] of entries) {
      const normalizedTargetId = targetId as string;
      if (
        !targetIds.has(normalizedTargetId) ||
        occupiedTargetIds.has(normalizedTargetId)
      ) {
        return null;
      }
      occupiedTargetIds.add(normalizedTargetId);
      normalizedPlacements[itemId] = normalizedTargetId;
    }

    return { kind: "targets", placements: normalizedPlacements };
  }

  const normalizedPlacements: Record<string, { x: number; y: number }> = {};
  for (const [itemId, placement] of entries) {
    if (
      !placement ||
      typeof placement !== "object" ||
      Array.isArray(placement)
    ) {
      return null;
    }

    const { x, y } = placement as Record<string, unknown>;
    if (
      typeof x !== "number" ||
      typeof y !== "number" ||
      !Number.isFinite(x) ||
      !Number.isFinite(y)
    ) {
      return null;
    }
    normalizedPlacements[itemId] = { x, y };
  }

  return { kind: "coordinates", placements: normalizedPlacements };
}

/** Invalid payloads must not overwrite the last saved answer. Empty/partial is valid. */
export function validateTaskAnswer(
  task: PlayTask,
  payload: unknown,
): string | null {
  const invalid = "La respuesta no es válida para esta tarea.";
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return invalid;
  const response = payload as Record<string, unknown>;
  switch (task.answerType) {
    case "state_grid":
    case "text_cloze": {
      try {
        return validateAssignmentAnswer(
          parseAssignmentConfig(task.answerType, task.answerConfig),
          payload,
        )
          ? null
          : invalid;
      } catch {
        return invalid;
      }
    }
    case "image_hotspot": {
      try {
        return validateHotspotAnswer(
          parseHotspotConfig(task.answerConfig),
          payload,
        )
          ? null
          : invalid;
      } catch {
        return invalid;
      }
    }
    case "multiple_choice": {
      const selected = response.selected;
      if (selected === undefined && Object.keys(response).length === 0)
        return null;
      if (
        !Array.isArray(selected) ||
        selected.some((id) => typeof id !== "string") ||
        new Set(selected).size !== selected.length
      )
        return invalid;
      const ids = new Set(task.answers.map((answer) => answer.id));
      return selected.every((id) => ids.has(id)) ? null : invalid;
    }
    case "short_text":
      return typeof response.text === "string" ||
        Object.keys(response).length === 0
        ? null
        : invalid;
    case "interactive":
      return validateInteractiveAnswer(payload) ? null : invalid;
    case "drag_drop": {
      const answer = parseDragDropAnswer(task, payload);
      return answer && (answer.kind === "targets" || task.dragDropVersion === 1)
        ? null
        : "La respuesta de arrastrar y soltar no es válida.";
    }
    default:
      return invalid;
  }
}
