export const MX_02B_CODE = "2026-MX-02b";

const COOK_TIMES = [
  [3, 5, 2],
  [5, 3, 11],
  [5, 5, 11],
];
const ORDER_LENGTH = 8;
const OVERLOAD_MINUTES = 10;
const FREE_MEAL_MINUTES = 15;

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function readSequence(answer: unknown): number[] | null {
  let result = parseJson(answer);
  if (typeof result === "string") result = parseJson(result);
  if (!result || typeof result !== "object") return null;
  const sequence = (result as { sequence?: unknown }).sequence;
  if (!Array.isArray(sequence) || sequence.length !== ORDER_LENGTH) return null;
  if (!sequence.every((t) => t === 0 || t === 1 || t === 2)) return null;
  return sequence as number[];
}

export function tacoOrderMakespan(sequence: number[]): number {
  const times = [0, 0, 0];
  for (const taco of sequence) {
    let available = [0, 1, 2].filter((c) => times[c] < OVERLOAD_MINUTES);
    if (available.length === 0) available = [0, 1, 2];
    available.sort(
      (a, b) =>
        COOK_TIMES[a][taco] - COOK_TIMES[b][taco] || times[a] - times[b],
    );
    const chosen = available[0];
    times[chosen] += COOK_TIMES[chosen][taco];
  }
  return Math.max(...times);
}

export function isCorrectMx02b(answer: unknown): boolean {
  const sequence = readSequence(answer);
  if (!sequence) return false;
  return tacoOrderMakespan(sequence) > FREE_MEAL_MINUTES;
}
