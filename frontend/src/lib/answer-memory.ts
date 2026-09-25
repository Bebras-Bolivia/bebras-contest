/**
 * Respuestas a medio hacer que sobreviven a salir de la tarea y volver (con
 * «Volver», el botón atrás del navegador o recargando). Viven en
 * `sessionStorage`: se pierden al cerrar la pestaña y nunca salen del equipo.
 * El almacenamiento puede no estar disponible (modo privado, cuota), así que
 * todo falla en silencio y la tarea sigue funcionando sin memoria.
 */
const PREFIX = "bebras:respuesta:";

export type SavedAnswer<Result> = {
  answer: unknown;
  result: Result | null;
};

export function readSavedAnswer<Result>(
  key: string,
): SavedAnswer<Result> | null {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as SavedAnswer<Result>) : null;
  } catch {
    return null;
  }
}

export function saveAnswer<Result>(key: string, saved: SavedAnswer<Result>) {
  try {
    if (saved.answer === undefined && saved.result === null) {
      sessionStorage.removeItem(PREFIX + key);
    } else {
      sessionStorage.setItem(PREFIX + key, JSON.stringify(saved));
    }
  } catch {
    // Sin almacenamiento la respuesta solo dura mientras la página está abierta.
  }
}
