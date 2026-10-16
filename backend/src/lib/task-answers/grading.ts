import { isDragDropAnswerCorrect } from "../drag-drop-grading";
import type { PlayTask } from "./types";
import { parseMcCorrectness } from "./multiple-choice";
import { answerHasResponse } from "./presence";
import { validateTaskAnswer, parseDragDropAnswer } from "./validation";
import {
  assignmentAnswerIsCorrect,
  parseAssignmentConfig,
} from "./assignment-answers";
import { interactiveAnswerIsCorrect } from "./interactive";

export function answerIsCorrect(task: PlayTask, payload: unknown) {
  if (
    !answerHasResponse(task.answerType, payload) ||
    validateTaskAnswer(task, payload)
  )
    return false;
  const response =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  const type = task.answerType;
  if (type === "interactive") {
    return interactiveAnswerIsCorrect(task.answerKey, payload);
  }
  if (type === "state_grid" || type === "text_cloze") {
    try {
      return assignmentAnswerIsCorrect(
        parseAssignmentConfig(type, task.answerConfig),
        task.answerKey,
        payload,
      );
    } catch {
      return false;
    }
  }
  if (type === "image_hotspot") {
    const key = task.answerKey;
    return (
      key?.version === 1 &&
      Array.isArray(key.acceptedRegionIds) &&
      key.acceptedRegionIds.includes(response.regionId)
    );
  }
  if (type === "multiple_choice") {
    const selected = Array.isArray(response.selected)
      ? response.selected.map(String)
      : [];
    if (selected.length === 0 || new Set(selected).size !== selected.length) {
      return false;
    }
    const { mode, ids } = parseMcCorrectness(task.correctAnswerId);
    if (mode === "single") {
      return selected.length === 1 && selected[0] === ids[0];
    }
    if (mode === "any") {
      return selected.length === 1 && ids.includes(selected[0]);
    }
    return (
      selected.length === ids.length &&
      selected.every((item: string) => ids.includes(item))
    );
  }
  if (type === "short_text") {
    const text = typeof response.text === "string" ? response.text : "";
    return (
      text.trim().toLowerCase() ===
      String(task.shortAnswer ?? "")
        .trim()
        .toLowerCase()
    );
  }
  if (type === "drag_drop") {
    const items = task.dragDropItems;
    if (items.length === 0) {
      return false;
    }

    const answer = parseDragDropAnswer(task, payload);
    if (!answer) {
      return false;
    }

    const solutions = task.dragDropSolutions ?? [];

    if (answer.kind === "targets") {
      return isDragDropAnswerCorrect(items, solutions, answer.placements);
    }

    if (task.dragDropVersion !== 1) {
      return false;
    }

    // Respuestas viejas, guardadas como coordenadas: primero se resuelve en
    // qué destino cayó cada objeto y desde ahí se corrige igual que el resto.
    const placements: Record<string, string> = {};

    for (const item of items) {
      const placement = answer.placements[item.id];

      if (!placement) {
        return false;
      }

      let closest: { id: string; distance: number } | null = null;

      for (const target of task.dragDropTargets) {
        const distance = Math.hypot(
          placement.x - target.x,
          placement.y - target.y,
        );

        if (
          distance <= target.snapRadius &&
          (!closest || distance < closest.distance)
        ) {
          closest = { id: target.id, distance };
        }
      }

      if (!closest) {
        return false;
      }

      placements[item.id] = closest.id;
    }

    return isDragDropAnswerCorrect(items, solutions, placements);
  }
  return false;
}
