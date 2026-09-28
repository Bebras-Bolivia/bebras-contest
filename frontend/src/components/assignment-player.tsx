"use client";

import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { CheckIcon, PlusIcon } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { TaskContentRenderer } from "@/components/task-content-renderer";
import type {
  AssignmentOption,
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
function withAssignment(
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
function slotKeyDown(
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

const floatingCard =
  "border-2 shadow-[0_6px_16px_-6px_rgba(0,0,0,0.2)] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

/**
 * Lista que se abre pegada a una casilla: una tarjeta por opción, con su letra,
 * y «Quitar respuesta» si ya hay una elegida.
 */
function ChoiceMenu({
  label,
  options,
  chosenId,
  onPick,
}: {
  label: string;
  options: AssignmentOption[];
  chosenId: string | undefined;
  onPick: (optionId: string) => void;
}) {
  return (
    <PopoverContent
      align="start"
      data-plain-menu=""
      className="w-auto max-w-[min(24rem,calc(100vw-2rem))] bg-transparent p-0"
      aria-label={`Opciones de ${label}`}
    >
      <ul className="flex flex-col gap-1.5">
        {options.map((option, index) => {
          const selected = option.id === chosenId;
          return (
            <li key={option.id}>
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => onPick(option.id)}
                className={cn(
                  floatingCard,
                  "flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors",
                  selected
                    ? "border-primary bg-[color-mix(in_srgb,var(--primary)_10%,var(--background))] font-medium"
                    : "border-border/40 bg-background hover:border-primary/60 hover:bg-[color-mix(in_srgb,var(--primary)_5%,var(--background))]",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "grid size-6 shrink-0 place-items-center text-xs font-semibold",
                    selected
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {String.fromCharCode(65 + index)}
                </span>
                {option.image ? (
                  <img
                    src={option.image.url}
                    alt={option.label}
                    className="size-10 shrink-0 object-contain mix-blend-multiply"
                  />
                ) : (
                  <span className="min-w-0 flex-1">{option.label}</span>
                )}
                {selected && (
                  <CheckIcon className="size-4 shrink-0 text-primary" />
                )}
              </button>
            </li>
          );
        })}
        {chosenId && (
          <li>
            <button
              type="button"
              onClick={() => onPick("")}
              className={cn(
                floatingCard,
                "flex min-h-10 w-full items-center justify-center border-border/40 bg-background px-3 py-2 text-sm text-muted-foreground hover:text-foreground",
              )}
            >
              Quitar respuesta
            </button>
          </li>
        )}
      </ul>
    </PopoverContent>
  );
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

/**
 * Cada casilla se resuelve tocándola y eligiendo su estado en la lista que se
 * abre al lado.
 */
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
  const [openId, setOpenId] = useState<string | null>(null);
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
          const expanded = openId === cell.id && !disabled;
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
              <Popover
                open={expanded}
                onOpenChange={(open) => setOpenId(open ? cell.id : null)}
              >
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    data-assignment-slot={cell.id}
                    disabled={disabled}
                    aria-label={`${cell.label}: ${state?.label ?? "vacío"}`}
                    onKeyDown={(event) =>
                      slotKeyDown(event, states, state?.id, (id) =>
                        assign(cell.id, id),
                      )
                    }
                    className={cn(
                      "grid aspect-square w-full touch-manipulation place-items-center overflow-hidden rounded-lg transition-[background-color,border-color,transform] duration-150 outline-none select-none focus-visible:ring-[3px] focus-visible:ring-ring/50 enabled:active:scale-95 disabled:cursor-default",
                      state
                        ? "bg-primary/10 shadow-[inset_0_-3px_0_var(--primary)] enabled:hover:bg-primary/15"
                        : "border-2 border-dashed border-primary/50 text-primary enabled:hover:bg-primary/5",
                      expanded && "bg-primary/15",
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
                          className="h-4/5 w-4/5 object-contain mix-blend-multiply motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-75 motion-safe:duration-200"
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
                </PopoverTrigger>
                <ChoiceMenu
                  label={cell.label}
                  options={states}
                  chosenId={state?.id}
                  onPick={(id) => {
                    assign(cell.id, id);
                    setOpenId(null);
                  }}
                />
              </Popover>
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
