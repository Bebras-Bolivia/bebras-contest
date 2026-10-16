"use client";

import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { PlusIcon } from "lucide-react";
import { TaskContentRenderer } from "@/components/task-content-renderer";
import type {
  AssignmentOption,
  GridCell,
  GridConfig,
  ClozeConfig,
} from "@/lib/assignment-answers";
import type { ContentBlock } from "@/lib/task-schema";
import { cn } from "@/lib/utils";

export function readAssignments(
  value: unknown,
  field: "cells" | "blanks",
): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const map = (value as Record<string, unknown>)[field];
  if (!map || typeof map !== "object" || Array.isArray(map)) return {};
  return Object.fromEntries(
    Object.entries(map).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

/**
 * Pone `optionId` en `slotId` (o lo vacía con ""). Una opción que ya llegó a su
 * límite se muda: deja libre la posición donde estaba.
 */
export function withAssignment(
  options: AssignmentOption[],
  value: Record<string, string>,
  slotId: string,
  optionId: string,
) {
  const option = options.find((entry) => entry.id === optionId);
  const next = { ...value };
  delete next[slotId];
  if (option) {
    const occupied = Object.keys(next).filter((id) => next[id] === optionId);
    if (option.limit !== null && occupied.length >= option.limit)
      delete next[occupied[0]];
    next[slotId] = optionId;
  }
  return next;
}

/** Supr vacía la posición y las flechas recorren sus opciones sin abrir menú. */
export function slotKeyDown(
  event: KeyboardEvent,
  allowed: AssignmentOption[],
  chosenId: string | undefined,
  onAssign: (optionId: string) => void,
) {
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    onAssign("");
  }
  if (
    (event.key === "ArrowRight" || event.key === "ArrowLeft") &&
    allowed.length
  ) {
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const index = allowed.findIndex((option) => option.id === chosenId);
    const next =
      index === -1
        ? direction === 1
          ? 0
          : allowed.length - 1
        : (index + direction + allowed.length) % allowed.length;
    onAssign(allowed[next].id);
  }
}

/**
 * Un rótulo que solo repite el puesto («1», «Posición 2») no dice nada que la
 * fila no muestre ya. Se ocultan únicamente si todos son así: cuando llevan
 * información, como los dígitos del código de la tarea 31, se ven todos.
 */
function positionalLabels(cells: GridConfig["cells"]) {
  return cells.every((cell, index) => {
    const label = cell.label.trim().toLowerCase();
    const position = String(index + 1);
    return (
      label === position ||
      label === `posición ${position}` ||
      label === `casilla ${position}`
    );
  });
}

export type ImageGridConfig = GridConfig & {
  layout: "image";
  background: NonNullable<GridConfig["background"]>;
};

export function gridOnImage(config: GridConfig): config is ImageGridConfig {
  return config.layout === "image" && Boolean(config.background);
}

export function cellBox(
  cell: Pick<GridCell, "x" | "y" | "width" | "height">,
): CSSProperties {
  return {
    left: `${cell.x ?? 0}%`,
    top: `${cell.y ?? 0}%`,
    width: `${cell.width ?? 10}%`,
    height: `${cell.height ?? 10}%`,
  };
}

/**
 * El fondo ocupa el ancho elegido (en el celular, todo el ancho), pero nunca
 * tan poco que la casilla más angosta mida menos de 2.25 rem: si no cabe, la
 * imagen se desliza.
 */
export function imageStageStyle(config: GridConfig): CSSProperties {
  const narrowest = Math.min(
    ...config.cells.map((cell) => cell.width ?? 10),
    100,
  );
  const minimum = Math.min(48, 2.25 / (Math.max(narrowest, 1) / 100));
  return {
    "--stage-w": `${config.widthPercent ?? 100}%`,
    "--stage-min": `${minimum.toFixed(2)}rem`,
  } as CSSProperties;
}

export const imageStageClass =
  "relative mx-auto w-[max(100%,var(--stage-min))] sm:w-[max(var(--stage-w),var(--stage-min))]";

/** Lo que muestra una casilla con estado: su imagen, de borde a borde. */
export function CellFace({ state }: { state: AssignmentOption }) {
  return state.image ? (
    <img
      key={state.id}
      src={state.image.url}
      alt=""
      draggable={false}
      className="pointer-events-none size-full object-contain motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-75 motion-safe:duration-200"
    />
  ) : (
    <span
      key={state.id}
      className="pointer-events-none max-w-full truncate bg-background/85 px-0.5 text-xs font-medium motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-150"
    >
      {state.label}
    </span>
  );
}

/** Cada toque en una casilla pasa al estado siguiente; tras el último, la vacía. */
export function StateGridPlayer({
  config,
  value,
  onChange,
  disabled = false,
  renderLabel,
}: {
  config: GridConfig;
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
  disabled?: boolean;
  renderLabel?: (cell: GridConfig["cells"][number], index: number) => ReactNode;
}) {
  const [announcement, setAnnouncement] = useState("");
  const states = config.states.filter((state) => state.limit !== 0);
  const showLabels = !positionalLabels(config.cells);

  function assign(cellId: string, stateId: string) {
    if (disabled) return;
    const cell = config.cells.find((entry) => entry.id === cellId);
    if (!cell) return;
    onChange(withAssignment(config.states, value, cellId, stateId));
    const state = config.states.find((entry) => entry.id === stateId);
    setAnnouncement(`${cell.label}: ${state?.label ?? "vacío"}`);
  }

  const advance = (cellId: string, currentId: string | undefined) => {
    const index = states.findIndex((entry) => entry.id === currentId);
    assign(cellId, states[index + 1]?.id ?? "");
  };

  if (gridOnImage(config))
    return (
      <div className="min-w-0 overflow-x-auto" data-assignment-surface>
        <div className={imageStageClass} style={imageStageStyle(config)}>
          <img
            src={config.background.url}
            alt=""
            draggable={false}
            className="block h-auto w-full select-none"
          />
          {config.cells.map((cell, index) => {
            const state = config.states.find(
              (entry) => entry.id === value[cell.id],
            );
            return (
              <button
                key={cell.id}
                type="button"
                data-assignment-slot={cell.id}
                disabled={disabled}
                aria-label={`${cell.label}: ${state?.label ?? "vacío"}`}
                onClick={() => advance(cell.id, state?.id)}
                onKeyDown={(event) =>
                  slotKeyDown(event, states, state?.id, (id) =>
                    assign(cell.id, id),
                  )
                }
                style={cellBox(cell)}
                className={cn(
                  "absolute grid cursor-pointer touch-manipulation place-items-center overflow-hidden outline-none select-none transition-[background-color,box-shadow,transform] duration-150 focus-visible:z-10 focus-visible:ring-[3px] focus-visible:ring-ring/70 enabled:hover:z-10 enabled:hover:shadow-[inset_0_0_0_2px_var(--primary)] enabled:active:scale-90 disabled:cursor-default",
                  !state &&
                    "bg-primary/10 text-primary/60 shadow-[inset_0_0_0_1.5px_color-mix(in_srgb,var(--primary)_40%,transparent)] enabled:hover:bg-primary/20",
                )}
              >
                {state ? (
                  <CellFace state={state} />
                ) : (
                  !disabled && (
                    <PlusIcon
                      aria-hidden="true"
                      className="pointer-events-none size-[45%] max-h-6 max-w-6"
                    />
                  )
                )}
                {renderLabel && (
                  <span className="pointer-events-none absolute top-0 left-0 bg-background/85 px-0.5 leading-none">
                    {renderLabel(cell, index)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <span className="sr-only" role="status">
          {announcement}
        </span>
      </div>
    );

  return (
    <div className="min-w-0 overflow-x-auto" data-assignment-surface>
      <div
        className="mx-auto grid w-max max-w-full gap-2 py-1 sm:gap-3"
        style={{
          gridTemplateColumns: `repeat(${config.columns}, minmax(2.25rem, 4.5rem))`,
        }}
      >
        {config.cells.map((cell, index) => {
          const state = config.states.find(
            (entry) => entry.id === value[cell.id],
          );
          return (
            <div
              key={cell.id}
              className="flex min-w-0 flex-col items-center gap-1.5"
            >
              {renderLabel
                ? renderLabel(cell, index)
                : showLabels && (
                    <span className="max-w-full truncate text-xs text-muted-foreground">
                      {cell.label}
                    </span>
                  )}
              <button
                type="button"
                data-assignment-slot={cell.id}
                disabled={disabled}
                aria-label={`${cell.label}: ${state?.label ?? "vacío"}`}
                onClick={() => advance(cell.id, state?.id)}
                onKeyDown={(event) =>
                  slotKeyDown(event, states, state?.id, (id) =>
                    assign(cell.id, id),
                  )
                }
                className={cn(
                  "grid aspect-square w-full touch-manipulation place-items-center overflow-hidden rounded-lg transition-[background-color,border-color,transform] duration-150 outline-none select-none focus-visible:ring-[3px] focus-visible:ring-ring/50 enabled:active:scale-95 disabled:cursor-default",
                  state
                    ? "enabled:hover:bg-muted/60"
                    : "border-2 border-dashed border-primary/50 text-primary enabled:hover:bg-primary/5",
                )}
              >
                {state ? (
                  state.image ? (
                    <img
                      // La clave nueva reinicia la animación en cada cambio.
                      key={state.id}
                      src={state.image.url}
                      alt=""
                      draggable={false}
                      className="size-full object-contain mix-blend-multiply motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-75 motion-safe:duration-200"
                    />
                  ) : (
                    <span
                      key={state.id}
                      className="truncate px-1 text-xs font-medium motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200"
                    >
                      {state.label}
                    </span>
                  )
                ) : (
                  !disabled && <PlusIcon className="size-5" />
                )}
              </button>
            </div>
          );
        })}
      </div>

      <span className="sr-only" role="status">
        {announcement}
      </span>
    </div>
  );
}

/**
 * Las opciones quedan debajo del texto: tocar una la pone en el hueco marcado y
 * pasa al siguiente vacío. Tocar un hueco lleno lo vacía. El hueco es un `span`
 * y no un `button` para que una frase larga se parta en renglones.
 */
export function TextClozePlayer({
  config,
  blocks,
  value,
  onChange,
  disabled = false,
  className,
}: {
  config: ClozeConfig;
  blocks: ContentBlock[];
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const known = picked && config.blanks.some((blank) => blank.id === picked);
  const activeId =
    (known && !value[picked] ? picked : null) ??
    config.blanks.find((blank) => !value[blank.id])?.id ??
    (known ? picked : null);
  const active = config.blanks.find((blank) => blank.id === activeId);
  const used = (optionId: string) =>
    Object.values(value).filter((id) => id === optionId).length;

  const surface = useRef<HTMLDivElement>(null);
  // La palabra sale de donde estaba y viaja a su lugar nuevo: se mide antes
  // del cambio y, ya dibujado, se anima desde ahí.
  const flight = useRef<{ target: string; from: DOMRect } | null>(null);

  const find = (selector: string) =>
    surface.current?.querySelector<HTMLElement>(selector) ?? null;
  const inSlot = (blankId: string) =>
    `[data-assignment-slot="${CSS.escape(blankId)}"] [data-slot-word]`;
  const inBank = (optionId: string) =>
    `[data-bank-option="${CSS.escape(optionId)}"] > *`;

  useLayoutEffect(() => {
    const move = flight.current;
    flight.current = null;
    if (
      !move ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    const element = find(move.target);
    if (!element) return;
    const to = element.getBoundingClientRect();
    const dx = move.from.left - to.left;
    const dy = move.from.top - to.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    element.style.position = "relative";
    element.style.zIndex = "10";
    const animation = element.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(1.04)` },
        { transform: "translate(0, 0) scale(1)" },
      ],
      { duration: 460, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
    const settle = () => {
      element.style.position = "";
      element.style.zIndex = "";
    };
    animation.onfinish = settle;
    animation.oncancel = settle;
  }, [value]);

  function place(optionId: string) {
    if (disabled || !activeId) return;
    const next = withAssignment(config.options, value, activeId, optionId);
    const index = config.blanks.findIndex((blank) => blank.id === activeId);
    const option = config.options.find((entry) => entry.id === optionId);
    const following = [
      ...config.blanks.slice(index + 1),
      ...config.blanks.slice(0, index),
    ].find((blank) => !next[blank.id]);
    const from = find(inBank(optionId))?.getBoundingClientRect();
    flight.current = from ? { target: inSlot(activeId), from } : null;
    onChange(next);
    setAnnouncement(`Hueco ${index + 1}: ${option?.label ?? ""}`);
    setPicked(following?.id ?? activeId);
  }

  function clear(blankId: string) {
    if (disabled) return;
    const index = config.blanks.findIndex((blank) => blank.id === blankId);
    const optionId = value[blankId];
    const from = find(inSlot(blankId))?.getBoundingClientRect();
    flight.current =
      from && optionId ? { target: inBank(optionId), from } : null;
    onChange(withAssignment(config.options, value, blankId, ""));
    setAnnouncement(`Hueco ${index + 1}: vacío`);
    setPicked(blankId);
  }

  return (
    <div
      ref={surface}
      className="flex min-w-0 flex-col gap-6"
      data-assignment-surface
    >
      <TaskContentRenderer
        blocks={blocks}
        className={className}
        renderBlank={(id) => {
          const index = config.blanks.findIndex((blank) => blank.id === id);
          if (index === -1) return <span>[hueco]</span>;
          const chosen = config.options.find(
            (option) => option.id === value[id],
          );
          const isActive = !disabled && id === activeId;
          const tap = () => (chosen ? clear(id) : setPicked(id));
          return (
            <span
              key={id}
              role="button"
              tabIndex={disabled ? -1 : 0}
              aria-disabled={disabled || undefined}
              aria-pressed={isActive}
              data-assignment-slot={id}
              aria-label={`Hueco ${index + 1}: ${chosen?.label ?? "vacío"}${chosen && !disabled ? ". Tocar para quitar" : ""}`}
              onClick={disabled ? undefined : tap}
              onKeyDown={(event) => {
                if (disabled) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  tap();
                }
                if (event.key === "Delete" || event.key === "Backspace") {
                  event.preventDefault();
                  clear(id);
                }
              }}
              className={cn(
                "mx-0.5 px-1.5 py-0.5 [box-decoration-break:clone] outline-none transition-colors duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/50",
                disabled ? "cursor-default" : "cursor-pointer",
                chosen
                  ? cn(
                      "bg-primary/10 font-medium text-foreground shadow-[inset_0_-2px_0_var(--primary)]",
                      !disabled && "hover:bg-primary/15",
                    )
                  : cn(
                      "inline-block min-h-[1.75em] min-w-20 border-2 border-dashed align-middle",
                      isActive
                        ? "border-primary bg-primary/10"
                        : "border-primary/40",
                      !disabled && !isActive && "hover:bg-primary/5",
                    ),
              )}
            >
              {chosen && (
                <span
                  key={chosen.id}
                  data-slot-word=""
                  className="inline-block"
                >
                  {chosen.image ? (
                    <img
                      src={chosen.image.url}
                      alt={chosen.label}
                      className="inline h-10 max-w-24 object-contain align-middle mix-blend-multiply"
                    />
                  ) : (
                    chosen.label
                  )}
                </span>
              )}
            </span>
          );
        }}
      />
      {!disabled && (
        <div
          role="group"
          aria-label="Opciones para los huecos"
          className="flex flex-wrap justify-center gap-2"
        >
          {config.options
            .filter((option) => option.limit !== 0)
            .map((option) => {
              const spent =
                option.limit !== null && used(option.id) >= option.limit;
              const allowed =
                !active || active.allowedOptionIds.includes(option.id);
              return (
                <button
                  key={option.id}
                  type="button"
                  data-bank-option={option.id}
                  disabled={spent || !allowed || !activeId}
                  onClick={() => place(option.id)}
                  className={cn(
                    "flex min-h-10 touch-manipulation items-center gap-2 border-2 px-3 py-1.5 text-left text-sm transition-[opacity,background-color,border-color,transform] duration-200 outline-none select-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    spent
                      ? "border-dashed border-border/30 bg-muted/40 [&>*]:invisible"
                      : "border-border/40 bg-background shadow-[0_2px_0_rgba(0,0,0,0.12)] enabled:hover:border-primary enabled:hover:bg-primary/5 enabled:active:translate-y-px enabled:active:shadow-none disabled:opacity-40",
                  )}
                >
                  {option.image ? (
                    <img
                      src={option.image.url}
                      alt={option.label}
                      className="h-12 max-w-28 object-contain mix-blend-multiply"
                    />
                  ) : (
                    <span>{option.label}</span>
                  )}
                </button>
              );
            })}
        </div>
      )}
      <span className="sr-only" role="status">
        {announcement}
      </span>
    </div>
  );
}
