/** Started answers include partial configurations; empty answers earn no penalty. */
export function answerHasResponse(
  answerType: string,
  payload: unknown,
): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return false;
  const response = payload as Record<string, unknown>;
  switch (answerType) {
    case "state_grid":
    case "text_cloze": {
      const assignments =
        response[answerType === "state_grid" ? "cells" : "blanks"];
      return (
        response.version === 1 &&
        Boolean(assignments) &&
        typeof assignments === "object" &&
        !Array.isArray(assignments) &&
        Object.keys(assignments as object).length > 0
      );
    }
    case "image_hotspot":
      return (
        response.version === 1 &&
        typeof response.regionId === "string" &&
        response.regionId.trim().length > 0
      );
    case "multiple_choice":
      return Array.isArray(response.selected) && response.selected.length > 0;
    case "short_text":
      return (
        typeof response.text === "string" && response.text.trim().length > 0
      );
    case "drag_drop":
      return (
        Boolean(response.placements) &&
        typeof response.placements === "object" &&
        !Array.isArray(response.placements) &&
        Object.keys(response.placements as object).length > 0
      );
    case "interactive":
      return (
        response.version === 1 &&
        typeof response.answer === "string" &&
        response.answer.trim().length > 0
      );
    default:
      return false;
  }
}
