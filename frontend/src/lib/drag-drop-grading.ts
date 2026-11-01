/**
 * Corrección de las tareas de arrastrar y soltar.
 *
 * Dos cosas que el Bebras da por hechas y antes no contemplábamos:
 *
 * 1. **Piezas iguales.** Si una tarea reparte dos fichas idénticas —las dos B
 *    de «Puntos por Letras»— da lo mismo cuál cae en cuál destino. Dos objetos
 *    cuentan como la misma pieza cuando comparten una clave de equivalencia
 *    explícita o, para tareas antiguas sin clave, la imagen o etiqueta.
 * 2. **Varias soluciones.** Cada acomodo puede ocupar un subconjunto distinto
 *    de destinos. La solución principal sigue viviendo en el `correctTargetId`
 *    de cada objeto y las demás se guardan aparte.
 * 3. **Piezas que sobran.** Un objeto sin `correctTargetId` no va en ningún
 *    destino: la respuesta correcta lo deja afuera.
 *
 * El truco para resolver ambas de una vez es no comparar objeto por objeto,
 * sino reducir cada acomodo a una firma: qué *clase* de pieza quedó en cada
 * destino. Intercambiar dos piezas iguales no cambia la firma, y basta con que
 * la firma del estudiante coincida con la de alguna solución.
 */

export type GradableDragDropItem = {
  id: string;
  label?: unknown;
  image?: unknown;
  equivalenceKey?: string;
  correctTargetId: string;
};

export type DragDropSolution = {
  id?: string;
  placements: Record<string, string>;
};

/** Qué pieza es esta, a efectos de corrección. */
export function dragDropPieceKey(item: GradableDragDropItem) {
  const equivalenceKey = item.equivalenceKey?.trim();
  if (equivalenceKey) {
    return `equivalent:${equivalenceKey}`;
  }

  const image = item.image as { url?: unknown } | null | undefined;
  const url = typeof image?.url === "string" ? image.url.trim() : "";

  if (url) {
    return `img:${url}`;
  }

  const label = typeof item.label === "string" ? item.label.trim() : "";

  // Sin imagen ni nombre no hay forma de saber si dos objetos son la misma
  // pieza, así que cada uno responde solo por sí mismo.
  return label ? `label:${label}` : `id:${item.id}`;
}

/**
 * Firma de un acomodo, o `null` si no coloca nada, nombra un objeto que no es
 * de la tarea o es imposible (dos objetos en el mismo destino).
 */
export function dragDropSignature(
  items: GradableDragDropItem[],
  placements: Record<string, string>,
) {
  const itemIds = new Set(items.map((item) => item.id));
  const placed = Object.entries(placements).filter(([, targetId]) => targetId);

  if (
    placed.length === 0 ||
    placed.some(([itemId]) => !itemIds.has(itemId))
  ) {
    return null;
  }

  const pieceByTarget = new Map<string, string>();

  for (const item of items) {
    const targetId = placements[item.id];

    if (!targetId) {
      continue;
    }

    if (pieceByTarget.has(targetId)) {
      return null;
    }

    pieceByTarget.set(targetId, dragDropPieceKey(item));
  }

  return JSON.stringify(
    [...pieceByTarget.entries()].sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    ),
  );
}

/** El acomodo que describen los `correctTargetId`. */
export function dragDropPrimaryPlacements(items: GradableDragDropItem[]) {
  const placements: Record<string, string> = {};

  for (const item of items) {
    if (item.correctTargetId) {
      placements[item.id] = item.correctTargetId;
    }
  }

  return placements;
}

/** Todos los acomodos aceptados: el principal y las alternativas guardadas. */
export function dragDropAcceptedSignatures(
  items: GradableDragDropItem[],
  solutions: DragDropSolution[],
) {
  const signatures = new Set<string>();

  for (const placements of [
    dragDropPrimaryPlacements(items),
    ...solutions.map((solution) => solution.placements),
  ]) {
    const signature = dragDropSignature(items, placements);

    if (signature) {
      signatures.add(signature);
    }
  }

  return signatures;
}

export function isDragDropAnswerCorrect(
  items: GradableDragDropItem[],
  solutions: DragDropSolution[],
  placements: Record<string, string>,
) {
  if (items.length === 0) {
    return false;
  }

  const answer = dragDropSignature(items, placements);

  return answer
    ? dragDropAcceptedSignatures(items, solutions).has(answer)
    : false;
}
