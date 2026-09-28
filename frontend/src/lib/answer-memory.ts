/**
 * Respuestas a medio hacer que sobreviven a salir de la tarea y volver (con
 * «Volver», el botón atrás del navegador o recargando). Viven en
 * `sessionStorage`: se pierden al cerrar la pestaña y nunca salen del equipo.
 * Con `lasting` (la práctica) van a `localStorage` y el progreso sigue ahí otro
 * día. El almacenamiento puede no estar disponible (modo privado, cuota), así
 * que todo falla en silencio y la tarea sigue funcionando sin memoria.
 */
const PREFIX = "bebras:respuesta:";

export type SavedAnswer<Result> = {
  answer: unknown;
  result: Result | null;
};

type MemoryOptions = { lasting?: boolean };

function storage({ lasting = false }: MemoryOptions) {
  return lasting ? localStorage : sessionStorage;
}

export function readSavedAnswer<Result>(
  key: string,
  options: MemoryOptions = {},
): SavedAnswer<Result> | null {
  try {
    const raw = storage(options).getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as SavedAnswer<Result>) : null;
  } catch {
    return null;
  }
}

export function saveAnswer<Result>(
  key: string,
  saved: SavedAnswer<Result>,
  options: MemoryOptions = {},
) {
  try {
    if (saved.answer === undefined && saved.result === null) {
      storage(options).removeItem(PREFIX + key);
    } else {
      storage(options).setItem(PREFIX + key, JSON.stringify(saved));
    }
  } catch {
    // Sin almacenamiento la respuesta solo dura mientras la página está abierta.
  }
}
