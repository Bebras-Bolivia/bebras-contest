"use client";

import {
  StateGridPlayer,
  readAssignments,
} from "@/components/assignment-player";
import type { GridConfig } from "@/lib/assignment-answers";
import { ImageHotspotPlayer } from "@/components/image-hotspot-player";
import type { HotspotConfig } from "@/lib/image-hotspot";

import { TaskContentRenderer } from "@/components/task-content-renderer";
import {
  DragDropPlayer,
  type DragDropPlacements,
} from "@/components/drag-drop-player";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { PlayTask } from "@/lib/play-api";
import {
  readMultipleChoiceLayout,
  type StoredTaskDragDropTarget,
} from "@/lib/task-schema";
import { cn } from "@/lib/utils";

function compareIds(left: string, right: string) {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

function normalizeDragDropPlacements(
  value: unknown,
  itemIds: string[],
  targets: StoredTaskDragDropTarget[],
): DragDropPlacements {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const source = value as Record<string, unknown>;
  const targetIds = new Set(targets.map((target) => target.id));
  const occupiedTargetIds = new Set<string>();
  const normalized: DragDropPlacements = {};

  for (const itemId of itemIds) {
    const placement = source[itemId];

    if (typeof placement === "string") {
      if (targetIds.has(placement) && !occupiedTargetIds.has(placement)) {
        normalized[itemId] = placement;
        occupiedTargetIds.add(placement);
      }
      continue;
    }

    if (
      !placement ||
      typeof placement !== "object" ||
      Array.isArray(placement)
    ) {
      continue;
    }

    const legacy = placement as Record<string, unknown>;
    const x = legacy.x;
    const y = legacy.y;

    if (
      typeof x !== "number" ||
      typeof y !== "number" ||
      !Number.isFinite(x) ||
      !Number.isFinite(y)
    ) {
      continue;
    }

    const target = targets
      .filter(
        (candidate) =>
          Math.hypot(x - candidate.x, y - candidate.y) <= candidate.snapRadius,
      )
      .sort(
        (left, right) =>
          Math.hypot(x - left.x, y - left.y) -
            Math.hypot(x - right.x, y - right.y) ||
          compareIds(left.id, right.id),
      )[0];

    if (target && !occupiedTargetIds.has(target.id)) {
      normalized[itemId] = target.id;
      occupiedTargetIds.add(target.id);
    }
  }

  return normalized;
}

export function PlayTaskFields({
  task,
  value,
  onChange,
  disabled = false,
}: {
  task: PlayTask;
  value: unknown;
  onChange: (payload: unknown) => void;
  disabled?: boolean;
}) {
  const response =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const selected: string[] = Array.isArray(response.selected)
    ? response.selected
    : [];
  const dragDropPlacements = normalizeDragDropPlacements(
    response.placements,
    task.dragDropItems.map((item) => item.id),
    task.dragDropTargets,
  );
  const horizontalChoices =
    readMultipleChoiceLayout(task.answerConfig) === "horizontal";
  const imageChoices =
    task.answerType === "multiple_choice" &&
    task.answers.some((answer) =>
      answer.blocks.some((block) => block.type === "image" && block.image),
    );

  return (
    <>
      {task.answerType === "state_grid" && task.answerConfig?.version === 1 && (
        <StateGridPlayer
          config={task.answerConfig as unknown as GridConfig}
          value={readAssignments(value, "cells")}
          disabled={disabled}
          onChange={(cells) => onChange({ version: 1, cells })}
        />
      )}
      {task.answerType === "image_hotspot" &&
        task.answerConfig?.version === 1 && (
          <ImageHotspotPlayer
            config={task.answerConfig as unknown as HotspotConfig}
            regionId={
              typeof response.regionId === "string" ? response.regionId : null
            }
            disabled={disabled}
            onChange={(regionId) => onChange({ version: 1, regionId })}
          />
        )}
      {task.answerType === "multiple_choice" && (
        <div
          className={cn(
            "gap-3",
            imageChoices
              ? cn(
                  "grid grid-cols-2",
                  task.answers.length === 4
                    ? "md:grid-cols-4"
                    : "md:grid-cols-3",
                )
              : horizontalChoices
                ? "grid grid-cols-2 items-stretch lg:grid-cols-4"
                : "flex flex-col",
          )}
        >
          {task.answers.map((answer, index) => {
            const isSelected = selected.includes(answer.id);
            const multi = task.multipleChoiceMode === "all";
            // La letra es la de la opción, no su puesto: la explicación
            // dice «la respuesta es B» aunque el orden se haya barajado.
            const letter = /^[A-F]$/.test(answer.id)
              ? answer.id
              : String.fromCharCode(65 + index);
            const stacked = imageChoices || horizontalChoices;
            return (
              <button
                key={answer.id}
                type="button"
                disabled={disabled}
                aria-pressed={isSelected}
                className={cn(
                  "flex w-full rounded-md border-2 bg-card transition-colors",
                  stacked
                    ? "h-full flex-col items-start gap-2 p-3"
                    : "items-center gap-3 px-4 py-3 text-left",
                  isSelected
                    ? // Con imagen no se tiñe el fondo: la imagen se mezcla con
                      // él y cambiaría de color justo al elegirla.
                      imageChoices
                      ? "border-primary ring-2 ring-primary"
                      : "border-primary bg-primary/10"
                    : imageChoices
                      ? "border-border/40 enabled:hover:border-primary/60"
                      : "border-border/40 enabled:hover:border-primary/60 enabled:hover:bg-primary/5",
                  disabled && "cursor-default opacity-90",
                )}
                onClick={() => {
                  if (disabled) {
                    return;
                  }
                  if (multi) {
                    onChange({
                      selected: isSelected
                        ? selected.filter((id) => id !== answer.id)
                        : [...selected, answer.id],
                    });
                  } else {
                    onChange({ selected: [answer.id] });
                  }
                }}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "grid size-7 shrink-0 place-items-center text-sm font-semibold transition-colors",
                    isSelected
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {letter}
                </span>
                <div
                  className={cn(
                    "min-w-0",
                    stacked ? "w-full text-center" : "flex-1",
                  )}
                >
                  <TaskContentRenderer
                    blocks={answer.blocks}
                    className={cn(
                      "gap-2 text-base",
                      // Las imágenes llegan con el ancho del cuadernillo; en
                      // una opción manda el alto, para que quepan varias.
                      imageChoices &&
                        "[&_img]:max-h-40 [&_img]:w-auto! [&_img]:max-w-full [&_img]:mix-blend-multiply [&>div]:py-0",
                    )}
                    minImageWidth="0px"
                  />
                </div>
              </button>
            );
          })}
        </div>
      )}

      {task.answerType === "multiple_choice" &&
        task.multipleChoiceMode === "all" && (
          <p className="text-xs text-muted-foreground">
            Debes marcar todas las opciones correctas.
          </p>
        )}

      {task.answerType === "short_text" && (
        // Un campo propio y no el Input del sistema: el marco global de los
        // formularios lo volvía una barra fina de lado a lado.
        <input
          type="text"
          aria-label="Tu respuesta"
          placeholder="Escribe aquí"
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          value={String(response.text ?? "")}
          onChange={(event) => onChange({ text: event.target.value })}
          className={cn(
            "mx-auto h-14 w-full max-w-xs border-2 px-4 text-center text-2xl font-semibold text-foreground outline-none transition-colors placeholder:text-base placeholder:font-normal placeholder:text-primary/70 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-90",
            String(response.text ?? "").trim()
              ? "border-primary bg-primary/10"
              : "border-dashed border-primary/50 bg-background hover:bg-primary/5 focus:border-solid focus:border-primary",
          )}
        />
      )}

      {task.answerType === "drag_drop" && !task.dragDropBackground && (
        <Alert variant="destructive">
          <AlertTitle>Esta tarea no se puede responder</AlertTitle>
          <AlertDescription>
            Le falta la imagen de fondo. Avisa a tu maestro y continúa con las
            demás tareas.
          </AlertDescription>
        </Alert>
      )}

      {task.answerType === "drag_drop" && task.dragDropBackground && (
        <DragDropPlayer
          backgroundUrl={task.dragDropBackground.url}
          widthPercent={task.dragDropBackground.widthPercent}
          disabled={disabled}
          items={task.dragDropItems}
          placements={dragDropPlacements}
          targets={task.dragDropTargets}
          onChange={(placements) => onChange({ placements })}
        />
      )}
    </>
  );
}
