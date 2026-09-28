/**
 * Qué preguntas de práctica resolvió el estudiante en este navegador. No hay
 * cuenta de estudiante: vive en `localStorage` y una pregunta resuelta queda
 * resuelta aunque después se vuelva a intentar.
 */
const KEY = "bebras:practica:progreso";

export type PracticeOutcome = "correct" | "wrong";

function readAll(): Record<string, PracticeOutcome> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record<string, PracticeOutcome>) : {};
  } catch {
    return {};
  }
}

export function practiceOutcome(taskId: string): PracticeOutcome | null {
  return readAll()[taskId] ?? null;
}

export function recordPracticeOutcome(taskId: string, correct: boolean) {
  const all = readAll();
  if (all[taskId] === "correct") return;
  all[taskId] = correct ? "correct" : "wrong";
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Sin almacenamiento el progreso solo dura mientras la página está abierta.
  }
}
