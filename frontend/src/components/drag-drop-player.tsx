"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { HelpCircleIcon } from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useCutoutImages } from "@/lib/cutout-images";
import type {
  StoredTaskDragDropItem,
  StoredTaskDragDropTarget,
} from "@/lib/task-schema";
import { DEFAULT_DRAG_DROP_ITEM_WIDTH_PERCENT } from "@/lib/task-schema";
import {
  findDropTarget,
  getSnapCircleStyle,
  isPointOutsideStage,
  type StageBounds,
} from "./drag-drop-player-geometry";

export type DragDropPlacements = Record<string, string>;

type PublicDragDropItem = Pick<
  StoredTaskDragDropItem,
  "id" | "label" | "image" | "widthPercent"
>;

type PointerDrag = {
  itemId: string;
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
  /** Dónde se tomó la pieza, respecto de su centro y en fracción de su ancho. */
  grabX: number;
  grabY: number;
};

/** Punto donde se soltó una pieza, para que se deslice desde ahí a su lugar. */
type Settle = { itemId: string; x: number; y: number };

type DragPreview = {
  itemId: string;
  x: number;
  y: number;
  width: number;
};

type KeyboardCursor = {
  itemId: string;
  x: number;
  y: number;
};

/**
 * Modo del editor: la pieza se suelta donde el autor quiera y ese punto pasa a
 * ser su lugar. Los destinos vacíos se ven como círculos punteados.
 */
export type DragDropAuthoring = {
  /** Se soltó una pieza lejos de todo destino: crear uno en ese punto (%). */
  onPlaceAt: (itemId: string, x: number, y: number) => void;
  /** Se soltó una pieza sobre su propio destino: moverlo a ese punto (%). */
  onMoveTarget: (targetId: string, x: number, y: number) => void;
  /** Toque en el escenario sin pieza elegida; `targetId` si tocó un lugar vacío. */
  onStageTap?: (x: number, y: number, targetId: string | null) => void;
  /** Se arrastró un borde de la imagen: nuevo ancho en % de la columna. */
  onResize?: (widthPercent: number) => void;
};

type DragDropPlayerProps = {
  authoring?: DragDropAuthoring;
  /**
   * Ancho del escenario en % de la columna del estudiante (56 rem), para que el
   * autor lo vea igual que quien responde; sin valor, hasta 48 rem.
   */
  widthPercent?: number;
  backgroundUrl: string;
  items: PublicDragDropItem[];
  targets: StoredTaskDragDropTarget[];
  placements: DragDropPlacements;
  disabled?: boolean;
  onChange: (placements: DragDropPlacements) => void;
};

function pieceTransitionName(itemId: string) {
  return `piece-${itemId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function getStageBounds(stage: HTMLDivElement): StageBounds {
  const rect = stage.getBoundingClientRect();
  return {
    left: rect.left + stage.clientLeft,
    top: rect.top + stage.clientTop,
    width: stage.clientWidth,
    height: stage.clientHeight,
  };
}

export function DragDropPlayer({
  authoring,
  widthPercent,
  backgroundUrl,
  items,
  targets,
  placements,
  disabled = false,
  onChange,
}: DragDropPlayerProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const columnRef = useRef<HTMLDivElement>(null);
  const [stageWidth, setStageWidth] = useState(0);
  const [stageHeight, setStageHeight] = useState(0);

  useEffect(() => {
    const stage = stageRef.current;

    if (!stage) {
      return;
    }

    const measure = () => {
      setStageWidth(stage.clientWidth);
      setStageHeight(stage.clientHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);

    return () => observer.disconnect();
  }, [backgroundUrl]);
  const itemButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const cutouts = useCutoutImages(
    items.flatMap((item) => (item.image ? [item.image.url] : [])),
  );
  /** La pieza sin su fondo blanco, si lo tenía. */
  const pieceSrc = (url: string) => cutouts[url] ?? url;
  const pointerDragRef = useRef<PointerDrag | null>(null);
  const suppressClickItemIdRef = useRef<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);
  const [hoverTargetId, setHoverTargetId] = useState<string | null>(null);
  const settleRef = useRef<Settle | null>(null);
  const [keyboardCursor, setKeyboardCursor] = useState<KeyboardCursor | null>(
    null,
  );
  const [keyboardMode, setKeyboardMode] = useState(false);
  // La bandeja se ordena a gusto: cada posición guarda qué pieza le toca, y una
  // pieza colocada deja su hueco en la posición donde estaba.
  const [trayOrder, setTrayOrder] = useState(() =>
    items.map((item) => item.id),
  );

  // Reconcile changed draft IDs before rendering children. Placements (including
  // reset) and fresh item objects must not reset the user's tray order.
  const itemIds = new Set(items.map((item) => item.id));
  const keptTrayIds = trayOrder.filter((id) => itemIds.has(id));
  const addedTrayIds = items
    .map((item) => item.id)
    .filter((id) => !trayOrder.includes(id));
  if (keptTrayIds.length !== trayOrder.length || addedTrayIds.length > 0) {
    setTrayOrder([...keptTrayIds, ...addedTrayIds]);
  }

  const targetById = useMemo(
    () => new Map(targets.map((target) => [target.id, target])),
    [targets],
  );
  const placedItems = useMemo(
    () => items.filter((item) => targetById.has(placements[item.id] ?? "")),
    [items, placements, targetById],
  );
  /** Las piezas en el orden que tenga la bandeja, con su posición. */
  const trayItems = useMemo(
    () =>
      trayOrder.flatMap((itemId, slotIndex) => {
        const item = items.find((candidate) => candidate.id === itemId);
        return item ? [{ item, slotIndex }] : [];
      }),
    [items, trayOrder],
  );
  const previewItem = dragPreview
    ? items.find((item) => item.id === dragPreview.itemId)
    : null;
  const keyboardCursorItem = keyboardCursor
    ? items.find((item) => item.id === keyboardCursor.itemId)
    : null;

  const itemWidth = (item: PublicDragDropItem) =>
    Number.isFinite(item.widthPercent) && item.widthPercent > 0
      ? item.widthPercent
      : DEFAULT_DRAG_DROP_ITEM_WIDTH_PERCENT;

  /** Cuánto se puede errar al soltar: al menos media pieza y 24 px. */
  const dropRadius = (itemId: string) => {
    const item = items.find((candidate) => candidate.id === itemId);
    const width = stageRef.current?.clientWidth ?? 0;
    const piece =
      ((item ? itemWidth(item) : DEFAULT_DRAG_DROP_ITEM_WIDTH_PERCENT) / 100) *
      width;
    return Math.max(24, piece * 0.6);
  };

  const dropTargetAt = (itemId: string, clientX: number, clientY: number) => {
    const stageElement = stageRef.current;
    if (!stageElement) return undefined;
    return findDropTarget(
      clientX,
      clientY,
      getStageBounds(stageElement),
      targets,
      dropRadius(itemId),
    );
  };

  // La pieza recién soltada se desliza desde donde quedó el dedo hasta el
  // centro de su destino, en vez de aparecer ahí de golpe.
  useLayoutEffect(() => {
    const settle = settleRef.current;
    settleRef.current = null;
    if (!settle || !targetById.has(placements[settle.itemId] ?? "")) return;
    const element = itemButtonRefs.current.get(settle.itemId);
    if (
      !element?.animate ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    const rect = element.getBoundingClientRect();
    const dx = settle.x - (rect.left + rect.width / 2);
    const dy = settle.y - (rect.top + rect.height / 2);
    element.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(1.06)` },
        { transform: "none" },
      ],
      { duration: 240, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
  }, [placements, targetById]);

  const cursorForItem = (itemId: string): KeyboardCursor => {
    const target = targetById.get(placements[itemId] ?? "");
    return {
      itemId,
      x: target?.x ?? 50,
      y: target?.y ?? 50,
    };
  };

  const clearSelection = () => {
    setSelectedItemId(null);
    setKeyboardCursor(null);
    setKeyboardMode(false);
  };

  const selectItem = (itemId: string, fromKeyboard: boolean) => {
    setSelectedItemId(itemId);
    setKeyboardCursor(cursorForItem(itemId));
    setKeyboardMode(fromKeyboard);

    if (fromKeyboard) {
      window.requestAnimationFrame(() => stageRef.current?.focus());
    }
  };

  const focusItem = (itemId: string) => {
    window.requestAnimationFrame(() => {
      itemButtonRefs.current.get(itemId)?.focus();
    });
  };

  const placeItem = (itemId: string, targetId: string) => {
    if (
      disabled ||
      !targetById.has(targetId) ||
      !items.some((item) => item.id === itemId)
    ) {
      return false;
    }

    const previousTargetId = targetById.has(placements[itemId] ?? "")
      ? placements[itemId]
      : undefined;

    if (previousTargetId === targetId) {
      return false;
    }

    const occupyingItem = items.find(
      (item) => item.id !== itemId && placements[item.id] === targetId,
    );
    const next = Object.fromEntries(
      items.flatMap((item) => {
        const placedTargetId = placements[item.id];
        return targetById.has(placedTargetId ?? "")
          ? [[item.id, placedTargetId]]
          : [];
      }),
    );

    next[itemId] = targetId;

    if (occupyingItem) {
      if (previousTargetId) {
        next[occupyingItem.id] = previousTargetId;
      } else {
        delete next[occupyingItem.id];
      }
    }

    onChange(next);
    clearSelection();
    return true;
  };

  const swapItemLocations = (firstItemId: string, secondItemId: string) => {
    const firstTargetId = targetById.has(placements[firstItemId] ?? "")
      ? placements[firstItemId]
      : undefined;
    const secondTargetId = targetById.has(placements[secondItemId] ?? "")
      ? placements[secondItemId]
      : undefined;

    if (!firstTargetId && !secondTargetId) {
      return false;
    }

    const next = Object.fromEntries(
      items.flatMap((item) => {
        const targetId = placements[item.id];
        return targetById.has(targetId ?? "") ? [[item.id, targetId]] : [];
      }),
    );

    if (secondTargetId) {
      next[firstItemId] = secondTargetId;
    } else {
      delete next[firstItemId];
    }

    if (firstTargetId) {
      next[secondItemId] = firstTargetId;
    } else {
      delete next[secondItemId];
    }

    onChange(next);
    clearSelection();
    return true;
  };

  /** Devuelve una pieza a su hueco en la bandeja, sin tocar a las demás. */
  const returnItem = (itemId: string) => {
    if (disabled || !targetById.has(placements[itemId] ?? "")) {
      return false;
    }

    onChange(
      Object.fromEntries(
        items.flatMap((item) => {
          const targetId = placements[item.id];
          return item.id !== itemId && targetById.has(targetId ?? "")
            ? [[item.id, targetId]]
            : [];
        }),
      ),
    );
    clearSelection();
    return true;
  };

  /** Lleva una pieza a una posición de la bandeja, cambiándola por la que esté. */
  const moveToSlot = (itemId: string, slotIndex: number) => {
    if (disabled) {
      return false;
    }

    let moved = false;
    setTrayOrder((current) => {
      const from = current.indexOf(itemId);

      if (from === -1 || from === slotIndex || slotIndex >= current.length) {
        return current;
      }

      moved = true;
      const next = current.slice();
      [next[from], next[slotIndex]] = [next[slotIndex], next[from]];
      return next;
    });

    return moved;
  };

  const isOutsideStage = (clientX: number, clientY: number) => {
    const stageElement = stageRef.current;

    if (!stageElement) {
      return false;
    }

    const stage = getStageBounds(stageElement);
    return isPointOutsideStage(clientX, clientY, stage);
  };

  const placeItemAtPoint = (
    itemId: string,
    clientX: number,
    clientY: number,
  ) => {
    const stageElement = stageRef.current;

    if (!stageElement || disabled) {
      return false;
    }

    const target = dropTargetAt(itemId, clientX, clientY);

    if (authoring && !isOutsideStage(clientX, clientY)) {
      const point = stagePercent(clientX, clientY);

      if (!target) {
        authoring.onPlaceAt(itemId, point.x, point.y);
        clearSelection();
        return true;
      }

      if (target.id === placements[itemId]) {
        authoring.onMoveTarget(target.id, point.x, point.y);
        clearSelection();
        return true;
      }
    }

    return target ? placeItem(itemId, target.id) : false;
  };

  const stagePercent = (clientX: number, clientY: number) => {
    const stage = getStageBounds(stageRef.current!);
    const clamp = (value: number) =>
      Math.round(Math.min(100, Math.max(0, value)) * 1000) / 1000;
    return {
      x: clamp(((clientX - stage.left) / stage.width) * 100),
      y: clamp(((clientY - stage.top) / stage.height) * 100),
    };
  };

  const occupiedTargetIds = new Set(
    items.flatMap((item) =>
      targetById.has(placements[item.id] ?? "") ? [placements[item.id]] : [],
    ),
  );
  /** Lugar vacío bajo un toque, con al menos 14 px para acertarle. */
  const emptyTargetAt = (clientX: number, clientY: number) => {
    const stageElement = stageRef.current;
    if (!stageElement) return null;
    const stage = getStageBounds(stageElement);
    return (
      findDropTarget(
        clientX,
        clientY,
        stage,
        targets.filter((target) => !occupiedTargetIds.has(target.id)),
        14,
      ) ?? null
    );
  };

  /** Qué posición de la bandeja está bajo el puntero, si es que hay alguna. */
  const traySlotAtPoint = (clientX: number, clientY: number) => {
    const slot = document
      .elementFromPoint(clientX, clientY)
      ?.closest<HTMLElement>("[data-tray-slot]");
    const index = Number(slot?.dataset.traySlot);
    return Number.isInteger(index) ? index : null;
  };

  const handlePointerDown = (
    event: React.PointerEvent<HTMLButtonElement>,
    itemId: string,
  ) => {
    if (disabled || !event.isPrimary || event.button !== 0) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = event.currentTarget.getBoundingClientRect();
    pointerDragRef.current = {
      itemId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      grabX: rect.width
        ? (event.clientX - (rect.left + rect.width / 2)) / rect.width
        : 0,
      grabY: rect.width
        ? (event.clientY - (rect.top + rect.height / 2)) / rect.width
        : 0,
    };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = pointerDragRef.current;

    if (!drag || drag.pointerId !== event.pointerId || disabled) {
      return;
    }

    if (
      !drag.moved &&
      Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4
    ) {
      return;
    }

    drag.moved = true;
    setSelectedItemId(drag.itemId);
    setKeyboardMode(false);
    event.preventDefault();
    const item = items.find((candidate) => candidate.id === drag.itemId);
    const stageWidth = stageRef.current?.clientWidth ?? 0;
    const width = item
      ? (itemWidth(item) / 100) * stageWidth
      : (DEFAULT_DRAG_DROP_ITEM_WIDTH_PERCENT / 100) * stageWidth;
    // La pieza sigue al dedo desde el punto donde se tomó, sin recentrarse.
    const x = event.clientX - drag.grabX * width;
    const y = event.clientY - drag.grabY * width;
    setDragPreview({ itemId: drag.itemId, x, y, width });
    setHoverTargetId(
      isOutsideStage(event.clientX, event.clientY)
        ? null
        : (dropTargetAt(drag.itemId, x, y)?.id ?? null),
    );
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = pointerDragRef.current;

    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    pointerDragRef.current = null;
    const preview = dragPreview;
    setDragPreview(null);
    setHoverTargetId(null);

    if (drag.moved && !disabled) {
      suppressClickItemIdRef.current = drag.itemId;
      window.setTimeout(() => {
        if (suppressClickItemIdRef.current === drag.itemId) {
          suppressClickItemIdRef.current = null;
        }
      }, 0);
      // Soltar fuera del escenario devuelve la pieza a la bandeja, en la
      // posición donde caiga; soltar dentro pero lejos de un destino la deja
      // donde estaba.
      if (isOutsideStage(event.clientX, event.clientY)) {
        const slotIndex = traySlotAtPoint(event.clientX, event.clientY);

        if (slotIndex !== null) {
          moveToSlot(drag.itemId, slotIndex);
        }

        returnItem(drag.itemId);
        clearSelection();
      } else {
        // Cuenta dónde quedó la pieza, no la punta del dedo.
        const x = preview?.itemId === drag.itemId ? preview.x : event.clientX;
        const y = preview?.itemId === drag.itemId ? preview.y : event.clientY;
        settleRef.current = { itemId: drag.itemId, x, y };
        if (!placeItemAtPoint(drag.itemId, x, y)) settleRef.current = null;
      }
    }
  };

  const handlePointerCancel = (
    event: React.PointerEvent<HTMLButtonElement>,
  ) => {
    if (pointerDragRef.current?.pointerId !== event.pointerId) {
      return;
    }

    pointerDragRef.current = null;
    setDragPreview(null);
    setHoverTargetId(null);
  };

  /** La bandeja pinta la pieza igual esté puesta o no, para que el hueco no se mueva. */
  const itemVisual = (item: PublicDragDropItem) =>
    item.image ? (
      <img
        alt=""
        className="block h-auto w-full"
        draggable={false}
        src={pieceSrc(item.image.url)}
      />
    ) : (
      <span className="block px-2 py-6 text-center text-sm font-medium">
        {item.label || "Objeto"}
      </span>
    );

  const slotStyle = (item: PublicDragDropItem) =>
    stageWidth
      ? { width: `${Math.max(40, (itemWidth(item) / 100) * stageWidth)}px` }
      : undefined;

  const itemButtonProps = (item: PublicDragDropItem) => ({
    "aria-label": item.label || "Objeto",
    "aria-pressed": selectedItemId === item.id,
    disabled,
    ref: (node: HTMLButtonElement | null) => {
      if (node) {
        itemButtonRefs.current.set(item.id, node);
      } else {
        itemButtonRefs.current.delete(item.id);
      }
    },
    onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();

      if (disabled) {
        return;
      }

      if (suppressClickItemIdRef.current === item.id) {
        suppressClickItemIdRef.current = null;
        return;
      }

      if (selectedItemId === item.id) {
        clearSelection();
        return;
      }

      // Tocar otra pieza de la bandeja solo mueve la selección; para
      // reordenarlas se arrastra una sobre el lugar de la otra.
      if (selectedItemId) {
        if (swapItemLocations(selectedItemId, item.id)) {
          focusItem(item.id);
        } else {
          selectItem(item.id, event.detail === 0);
        }
      } else {
        selectItem(item.id, event.detail === 0);
      }
    },
    onPointerCancel: handlePointerCancel,
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) =>
      handlePointerDown(event, item.id),
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
  });

  return (
    <div ref={columnRef} className="flex flex-col gap-4">
      <div
        className={cn("group/stage relative mx-auto w-full")}
        style={stageWidthStyle(widthPercent)}
      >
        <div
          ref={stageRef}
          aria-label="Escenario de la tarea. Selecciona un objeto y toca el escenario, o usa las flechas y Enter, para colocarlo."
          className={cn(
            "relative w-full overflow-hidden rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            ((selectedItemId && !disabled) || authoring?.onStageTap) &&
              "cursor-crosshair",
          )}
          onFocus={() => {
            if (!selectedItemId || disabled) {
              return;
            }

            setKeyboardCursor((current) =>
              current?.itemId === selectedItemId
                ? current
                : cursorForItem(selectedItemId),
            );
            setKeyboardMode(true);
          }}
          onKeyDown={(event) => {
            if (!selectedItemId || disabled) {
              return;
            }

            if (event.key === "Escape") {
              event.preventDefault();
              const itemId = selectedItemId;
              clearSelection();
              focusItem(itemId);
              return;
            }

            if (event.key === "Enter") {
              event.preventDefault();
              const stageElement = stageRef.current;
              const cursor = keyboardCursor;
              if (!stageElement || !cursor) {
                return;
              }

              const stage = getStageBounds(stageElement);
              if (
                placeItemAtPoint(
                  selectedItemId,
                  stage.left + (cursor.x / 100) * stage.width,
                  stage.top + (cursor.y / 100) * stage.height,
                )
              ) {
                focusItem(selectedItemId);
              }
              return;
            }

            const movement = {
              ArrowDown: [0, 1],
              ArrowLeft: [-1, 0],
              ArrowRight: [1, 0],
              ArrowUp: [0, -1],
            }[event.key];

            if (!movement) {
              return;
            }

            event.preventDefault();
            const step = event.shiftKey ? 5 : 1;
            setKeyboardCursor((current) => {
              const cursor =
                current?.itemId === selectedItemId
                  ? current
                  : cursorForItem(selectedItemId);
              return {
                itemId: selectedItemId,
                x: Math.min(100, Math.max(0, cursor.x + movement[0] * step)),
                y: Math.min(100, Math.max(0, cursor.y + movement[1] * step)),
              };
            });
            setKeyboardMode(true);
          }}
          onClick={(event) => {
            if (!selectedItemId && authoring?.onStageTap && !disabled) {
              const point = stagePercent(event.clientX, event.clientY);
              authoring.onStageTap(
                point.x,
                point.y,
                emptyTargetAt(event.clientX, event.clientY)?.id ?? null,
              );
              return;
            }

            if (!selectedItemId || disabled) {
              return;
            }

            setKeyboardMode(false);
            placeItemAtPoint(selectedItemId, event.clientX, event.clientY);
          }}
          tabIndex={selectedItemId && !disabled ? 0 : -1}
        >
          <img
            alt="Escenario de la tarea"
            className="block h-auto w-full"
            src={backgroundUrl}
          />

          {authoring &&
            targets
              .filter((target) => !occupiedTargetIds.has(target.id))
              .map((target) => {
                const circle = getSnapCircleStyle(target.snapRadius, {
                  width: stageWidth,
                  height: stageHeight,
                });
                const size = Math.max(20, circle.width);
                return (
                  <span
                    key={target.id}
                    aria-hidden="true"
                    data-empty-target
                    className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed border-primary bg-background/60 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-75"
                    style={{
                      left: `${target.x}%`,
                      top: `${target.y}%`,
                      width: size,
                      height: size,
                    }}
                  />
                );
              })}
          {dragPreview &&
            hoverTargetId &&
            (() => {
              const target = targetById.get(hoverTargetId);
              if (!target) return null;
              const size = Math.max(32, dragPreview.width * 1.15);
              return (
                <span
                  key={target.id}
                  aria-hidden="true"
                  data-drop-hint
                  className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 border-2 border-dashed border-primary bg-primary/15 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-75 motion-safe:duration-150"
                  style={{
                    left: `${target.x}%`,
                    top: `${target.y}%`,
                    width: size,
                    height: size,
                  }}
                />
              );
            })()}
          {placedItems.map((item) => {
            const target = targetById.get(placements[item.id]);

            if (!target) {
              return null;
            }

            return (
              <button
                key={item.id}
                {...itemButtonProps(item)}
                className={cn(
                  "absolute touch-none -translate-x-1/2 -translate-y-1/2 cursor-pointer overflow-hidden rounded-sm border-2 border-transparent bg-transparent p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default",
                  selectedItemId === item.id && "ring-2 ring-primary",
                  dragPreview?.itemId === item.id && "opacity-50",
                )}
                data-piece-transition=""
                style={
                  {
                    left: `${target.x}%`,
                    top: `${target.y}%`,
                    width: `${itemWidth(item)}%`,
                    "--piece-transition-name": pieceTransitionName(item.id),
                  } as CSSProperties
                }
                type="button"
              >
                {item.image ? (
                  <img
                    alt=""
                    className="block h-auto w-full object-contain"
                    draggable={false}
                    src={pieceSrc(item.image.url)}
                  />
                ) : (
                  <span className="block max-w-24 bg-background/90 px-2 py-1 text-sm font-medium">
                    {item.label || "Objeto"}
                  </span>
                )}
              </button>
            );
          })}

          {keyboardMode && keyboardCursor && keyboardCursorItem && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-sm border-2 border-primary bg-background/80 opacity-80 ring-2 ring-ring"
              data-keyboard-cursor
              style={{
                left: `${keyboardCursor.x}%`,
                top: `${keyboardCursor.y}%`,
                width: `${itemWidth(keyboardCursorItem)}%`,
              }}
            >
              {keyboardCursorItem.image ? (
                <img
                  alt=""
                  className="block h-auto w-full object-contain"
                  src={pieceSrc(keyboardCursorItem.image.url)}
                />
              ) : (
                <span className="block bg-background/90 px-2 py-1 text-sm font-medium">
                  {keyboardCursorItem.label || "Objeto"}
                </span>
              )}
            </div>
          )}
        </div>
        {authoring?.onResize && (
          <StageResizeHandles
            columnRef={columnRef}
            stageRef={stageRef}
            onResize={authoring.onResize}
          />
        )}
      </div>

      <div
        className={cn("mx-auto flex w-full flex-col gap-3")}
        style={stageWidthStyle(widthPercent)}
      >
        <div
          className={cn(
            "flex items-center justify-between gap-2",
            // En el editor la bandeja es solo de dónde se toman las piezas.
            authoring && "hidden",
          )}
        >
          <p className="text-sm font-medium text-muted-foreground">Objetos</p>
          <Popover>
            <PopoverTrigger asChild>
              <button
                aria-label="Cómo responder esta pregunta"
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                type="button"
              >
                <HelpCircleIcon className="size-5" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="max-w-80 leading-5">
              <p className="font-medium">Cómo responder</p>
              <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-4 text-muted-foreground">
                <li>
                  Arrastra un objeto hasta su lugar en la imagen, o tócalo y
                  luego toca la imagen.
                </li>
                <li>
                  Con el teclado: Enter para tomarlo, las flechas para moverlo
                  (Shift avanza más rápido) y Enter otra vez para soltarlo.
                </li>
                <li>
                  Para devolverlo, arrástralo fuera de la imagen o toca un hueco
                  de esta fila.
                </li>
                <li>
                  Los objetos de la fila se acomodan a tu gusto: arrastra uno
                  sobre el lugar de otro para intercambiarlos.
                </li>
              </ul>
            </PopoverContent>
          </Popover>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {trayItems.map(({ item, slotIndex }) =>
            targetById.has(placements[item.id] ?? "") ? (
              <button
                key={item.id}
                aria-label={`Lugar ${slotIndex + 1} de la bandeja, vacío`}
                className="flex items-center justify-center rounded-sm border-2 border-dashed border-muted-foreground/40 bg-muted/40 transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:hover:bg-muted/40"
                data-tray-slot={slotIndex}
                disabled={disabled}
                style={slotStyle(item)}
                type="button"
                onClick={() => {
                  // Con una pieza seleccionada, este lugar es su destino: la del
                  // escenario vuelve aquí y la de la bandeja se muda aquí. Sin
                  // selección, vuelve la que salió de este lugar.
                  if (selectedItemId) {
                    moveToSlot(selectedItemId, slotIndex);
                    returnItem(selectedItemId);
                    clearSelection();
                    focusItem(selectedItemId);
                    return;
                  }

                  returnItem(item.id);
                }}
              >
                {/* La pieza va invisible: reserva el tamaño del hueco sin
                    delatar cuál estaba ahí, que da igual porque se pueden
                    intercambiar. */}
                <span aria-hidden="true" className="invisible block w-full">
                  {itemVisual(item)}
                </span>
              </button>
            ) : (
              <button
                key={item.id}
                {...itemButtonProps(item)}
                className={cn(
                  "flex touch-none cursor-pointer items-center justify-center rounded-sm border-2 border-transparent transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-70",
                  selectedItemId === item.id
                    ? "ring-2 ring-primary"
                    : "hover:bg-muted/60",
                  dragPreview?.itemId === item.id && "opacity-50",
                )}
                data-tray-slot={slotIndex}
                data-piece-transition=""
                style={
                  {
                    ...slotStyle(item),
                    "--piece-transition-name": pieceTransitionName(item.id),
                  } as CSSProperties
                }
                type="button"
              >
                {itemVisual(item)}
              </button>
            ),
          )}
        </div>
      </div>

      {dragPreview && previewItem && (
        <div
          aria-hidden="true"
          className={cn(
            "pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-1/2 scale-105 overflow-hidden rounded-sm opacity-95",
          )}
          style={{
            left: dragPreview.x,
            top: dragPreview.y,
            width: `${dragPreview.width}px`,
          }}
        >
          {previewItem.image ? (
            <img
              alt=""
              className="block h-auto w-full object-contain"
              src={pieceSrc(previewItem.image.url)}
            />
          ) : (
            <span className="text-sm font-medium">
              {previewItem.label || "Objeto"}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** Ancho de referencia del escenario: la columna del estudiante, 56 rem. */
const REFERENCE_REM = 56;

/**
 * Mientras se arrastra un borde, `--stage-max` en la columna manda sobre el
 * ancho guardado: así solo se redibuja la imagen, no todo el formulario.
 */
function stageWidthStyle(widthPercent?: number) {
  const saved = widthPercent
    ? `min(100%, ${(widthPercent * REFERENCE_REM) / 100}rem)`
    : "48rem";
  return { maxWidth: `var(--stage-max, ${saved})` };
}

function referencePx() {
  return (
    REFERENCE_REM *
    (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16)
  );
}

/**
 * Tiradores a los lados del escenario para agrandarlo o achicarlo, con el mismo
 * gesto que las imágenes del enunciado. El ancho se guarda en % de la columna.
 */
function StageResizeHandles({
  columnRef,
  stageRef,
  onResize,
}: {
  columnRef: React.RefObject<HTMLDivElement | null>;
  stageRef: React.RefObject<HTMLDivElement | null>;
  onResize: (widthPercent: number) => void;
}) {
  const resizeRef = useRef<{
    pointerId: number;
    side: "left" | "right";
    startX: number;
    startWidth: number;
    limit: number;
    width: number;
  } | null>(null);
  const [resizing, setResizing] = useState(false);

  const toPercent = (width: number) =>
    Math.round(Math.max(20, (width / referencePx()) * 100));

  const finish = (save: boolean) => {
    const state = resizeRef.current;
    resizeRef.current = null;
    setResizing(false);
    if (state && save) onResize(toPercent(state.width));
    // Tras guardar, el ancho vuelve a salir de lo guardado.
    requestAnimationFrame(() =>
      columnRef.current?.style.removeProperty("--stage-max"),
    );
  };

  const handle = (side: "left" | "right") => (
    <button
      type="button"
      aria-label={`Achicar o agrandar la imagen desde la ${
        side === "left" ? "izquierda" : "derecha"
      }`}
      className={cn(
        "group/handle absolute inset-y-0 z-10 flex w-5 cursor-ew-resize touch-none items-center justify-center outline-none transition-opacity",
        side === "left" ? "left-0 -translate-x-1/2" : "right-0 translate-x-1/2",
        !resizing &&
          "opacity-0 group-hover/stage:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100",
      )}
      onPointerDown={(event) => {
        const column = columnRef.current?.getBoundingClientRect().width;
        const stage = stageRef.current?.getBoundingClientRect().width;
        if (!event.isPrimary || event.button !== 0 || !column || !stage) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        resizeRef.current = {
          pointerId: event.pointerId,
          side,
          startX: event.clientX,
          startWidth: stage,
          // No puede pasar del ancho disponible ni del de referencia.
          limit: Math.min(column, referencePx()),
          width: stage,
        };
        setResizing(true);
      }}
      onPointerMove={(event) => {
        const state = resizeRef.current;
        if (!state || state.pointerId !== event.pointerId) return;
        event.preventDefault();
        const delta = event.clientX - state.startX;
        // La imagen está centrada: cada lado crece el doble de lo que se tira.
        state.width = Math.max(
          referencePx() * 0.2,
          Math.min(
            state.limit,
            state.startWidth + (state.side === "right" ? delta : -delta) * 2,
          ),
        );
        columnRef.current?.style.setProperty("--stage-max", `${state.width}px`);
      }}
      onPointerUp={(event) => {
        if (resizeRef.current?.pointerId !== event.pointerId) return;
        finish(true);
      }}
      onPointerCancel={() => finish(false)}
      onKeyDown={(event) => {
        const column = columnRef.current?.getBoundingClientRect().width;
        const stage = stageRef.current?.getBoundingClientRect().width;
        const step = { ArrowLeft: -5, ArrowRight: 5 }[event.key];
        if (!step || !column || !stage) return;
        event.preventDefault();
        const grow = side === "right" ? step : -step;
        const max = (Math.min(column, referencePx()) / referencePx()) * 100;
        onResize(
          Math.round(
            Math.max(20, Math.min(max, (stage / referencePx()) * 100 + grow)),
          ),
        );
      }}
    >
      <span
        className={cn(
          "block h-10 w-1 rounded-full bg-foreground/50 shadow-[0_0_0_2px_var(--background)] transition-colors group-hover/handle:bg-primary group-focus-visible/handle:bg-primary",
          resizing && "bg-primary",
        )}
      />
    </button>
  );

  return (
    <>
      {handle("left")}
      {handle("right")}
    </>
  );
}
