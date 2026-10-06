/**
 * Qué preguntas de práctica resolvió el estudiante. No hay cuenta de
 * estudiante: vive en `sessionStorage`, así se borra al cerrar la pestaña y
 * no queda en un equipo compartido. Una pregunta resuelta queda resuelta
 * aunque después se vuelva a intentar.
 */
const KEY = "bebras:practica:progreso";
const ANSWER_PREFIX = "bebras:respuesta:practica:";

/** Antes la práctica se guardaba en `localStorage`: se borra lo que quedó. */
function forgetLegacyProgress() {
  try {
    localStorage.removeItem(KEY);
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(ANSWER_PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    // Sin acceso al almacenamiento no hay nada que borrar.
  }
}

export type PracticeOutcome = "correct" | "wrong";

function readAll(): Record<string, PracticeOutcome> {
  forgetLegacyProgress();
  try {
    const raw = sessionStorage.getItem(KEY);
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
    sessionStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Sin almacenamiento el progreso solo dura mientras la página está abierta.
  }
}
