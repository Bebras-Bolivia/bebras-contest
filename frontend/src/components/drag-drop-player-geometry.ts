import type { StoredTaskDragDropTarget } from "../lib/task-schema";

export type StageBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export function isPointOutsideStage(
  clientX: number,
  clientY: number,
  stage: StageBounds,
) {
  return (
    clientX < stage.left ||
    clientX > stage.left + stage.width ||
    clientY < stage.top ||
    clientY > stage.top + stage.height
  );
}

export function getSnapRadius(
  snapRadius: number,
  stage: Pick<StageBounds, "width" | "height">,
) {
  return (snapRadius / 100) * Math.min(stage.width, stage.height);
}

/**
 * Destino donde cae una pieza soltada en un punto. El radio guardado puede ser
 * mucho menor que la pieza (6 px para una pieza de 73 px en la tarea 10), así
 * que se acepta al menos `minRadius` y gana el destino más cercano. Solo afecta
 * al gesto: la corrección sigue siendo por identificador de destino.
 */
export function findDropTarget(
  clientX: number,
  clientY: number,
  stage: StageBounds,
  targets: StoredTaskDragDropTarget[],
  minRadius: number,
) {
  return targets
    .map((target) => {
      const radius = Math.max(
        getSnapRadius(target.snapRadius, stage),
        minRadius,
      );
      const x = stage.left + (target.x / 100) * stage.width;
      const y = stage.top + (target.y / 100) * stage.height;
      return { target, radius, distance: Math.hypot(clientX - x, clientY - y) };
    })
    .filter(({ radius, distance }) => radius > 0 && distance <= radius)
    .sort(
      (left, right) =>
        left.distance - right.distance ||
        (left.target.id < right.target.id ? -1 : 1),
    )[0]?.target;
}

export function getSnapCircleStyle(
  snapRadius: number,
  stage: Pick<StageBounds, "width" | "height">,
) {
  const radius = getSnapRadius(snapRadius, stage);
  return {
    width: 2 * radius,
    height: 2 * radius,
    // A border must not force tiny circles beyond their actual diameter.
    borderWidth: Math.min(2, radius),
  };
}

export function findTargetAtPoint(
  clientX: number,
  clientY: number,
  stage: StageBounds,
  targets: StoredTaskDragDropTarget[],
) {
  return targets
    .map((target) => {
      const radius = getSnapRadius(target.snapRadius, stage);
      const x = stage.left + (target.x / 100) * stage.width;
      const y = stage.top + (target.y / 100) * stage.height;
      const distance = Math.hypot(clientX - x, clientY - y);

      return { target, radius, distance };
    })
    .filter(({ radius, distance }) => radius > 0 && distance <= radius)
    .sort(
      (left, right) =>
        left.distance / left.radius - right.distance / right.radius ||
        (left.target.id === right.target.id
          ? 0
          : left.target.id < right.target.id
            ? -1
            : 1),
    )[0]?.target;
}
