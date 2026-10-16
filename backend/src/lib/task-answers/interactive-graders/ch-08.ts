const SLOT_LINES = [2, 3, 5, 6, 8, 10] as const;
const LAST_LINE = 11;
const COPIES_PER_COMMAND = 3;
const MAX_STOCK = 6;
const MAX_STEPS = 1000;

type Instruction =
  | "rock?"
  | "log?"
  | "moveRock"
  | "moveLog"
  | "stop"
  | number
  | null;

function parseAnswer(answer: unknown): unknown {
  if (typeof answer !== "string") return answer;
  try {
    return JSON.parse(answer);
  } catch {
    return undefined;
  }
}

function readSlots(answer: unknown): Array<number | null> | null {
  const parsed = parseAnswer(answer);
  if (!Array.isArray(parsed) || parsed.length !== SLOT_LINES.length)
    return null;
  const byName = new Map<string, unknown>();
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") return null;
    const { name, value } = entry as { name?: unknown; value?: unknown };
    if (typeof name !== "string" || byName.has(name)) return null;
    byName.set(name, value);
  }
  const slots: Array<number | null> = [];
  for (let i = 1; i <= SLOT_LINES.length; i++) {
    const key = `spot${i}`;
    if (!byName.has(key)) return null;
    const value = byName.get(key);
    if (value === null || value === undefined || value === "") {
      slots.push(null);
    } else if (
      typeof value === "number" &&
      Number.isInteger(value) &&
      value >= 1 &&
      value <= LAST_LINE
    ) {
      slots.push(value);
    } else {
      return null;
    }
  }
  const uses = new Map<number, number>();
  for (const value of slots) {
    if (value === null) continue;
    const count = (uses.get(value) ?? 0) + 1;
    if (count > COPIES_PER_COMMAND) return null;
    uses.set(value, count);
  }
  return slots;
}

function run(
  program: Instruction[],
  rocks: number,
  logs: number,
): string | null {
  let line = 1;
  let moved = "";
  for (let steps = 0; line >= 1 && line <= LAST_LINE; steps++) {
    if (steps > MAX_STEPS) return null;
    const instruction = program[line];
    if (instruction === "stop") break;
    if (instruction === "rock?") {
      line += rocks > 0 ? 1 : 2;
    } else if (instruction === "log?") {
      line += logs > 0 ? 1 : 2;
    } else if (instruction === "moveRock") {
      if (rocks === 0) return null;
      rocks--;
      moved += "R";
      line++;
    } else if (instruction === "moveLog") {
      if (logs === 0) return null;
      logs--;
      moved += "L";
      line++;
    } else if (typeof instruction === "number") {
      line = instruction;
    } else {
      line++;
    }
  }
  return moved;
}

export function gradeCh08(answer: unknown): boolean {
  const slots = readSlots(answer);
  if (!slots) return false;
  const program: Instruction[] = [];
  program[1] = "rock?";
  program[4] = "log?";
  program[7] = "moveRock";
  program[9] = "moveLog";
  program[11] = "stop";
  SLOT_LINES.forEach((line, i) => {
    program[line] = slots[i];
  });
  for (let rocks = 0; rocks <= MAX_STOCK; rocks++) {
    for (let logs = 0; logs <= MAX_STOCK; logs++) {
      if (run(program, rocks, logs) !== "RL".repeat(Math.min(rocks, logs)))
        return false;
    }
  }
  return true;
}
