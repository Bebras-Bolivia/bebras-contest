"use client";

import { useState, type KeyboardEvent } from "react";
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
 * Lista que se abre pegada a una casilla o a un hueco: una tarjeta por opción,
 * con su letra, y «Quitar respuesta» si ya hay una elegida. Es la misma en los
 * dos tipos para que el estudiante resuelva todo con el mismo gesto.
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
                {option.image && (
                  <img
                    src={option.image.url}
                    alt=""
                    className="size-9 shrink-0 object-contain"
                  />
                )}
                <span className="min-w-0 flex-1">{option.label}</span>
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
 * abre al lado, igual que un hueco del texto.
 */
export function StateGridPlayer({
  config,
  value,
  onChange,
  disabled = false,
}: {
  config: GridConfig;
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
  disabled?: boolean;
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
        {config.cells.map((cell) => {
          const state = config.states.find(
            (entry) => entry.id === value[cell.id],
          );
          const expanded = openId === cell.id && !disabled;
          return (
            <div
              key={cell.id}
              className="flex min-w-0 flex-col items-center gap-1.5"
            >
              {showLabels && (
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
 * El hueco vive dentro de la oración: al tocarlo se abre, pegado a él, la lista
 * de sus opciones, y lo elegido queda escrito en el texto. Es un `span` y no un
 * `button` para que una frase larga se parta en renglones como el párrafo.
 */
function ClozeBlank({
  blank,
  label,
  options,
  chosenId,
  open,
  onOpenChange,
  onAssign,
  disabled,
}: {
  blank: ClozeConfig["blanks"][number];
  label: string;
  options: AssignmentOption[];
  chosenId: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAssign: (optionId: string) => void;
  disabled: boolean;
}) {
  const allowed = options.filter(
    (option) =>
      option.limit !== 0 && blank.allowedOptionIds.includes(option.id),
  );
  const chosen = options.find((option) => option.id === chosenId);
  const expanded = open && !disabled;

  return (
    <Popover open={expanded} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <span
          role="button"
          tabIndex={disabled ? -1 : 0}
          aria-disabled={disabled || undefined}
          aria-haspopup="dialog"
          aria-expanded={expanded}
          data-assignment-slot={blank.id}
          aria-label={`${label}: ${chosen?.label ?? "vacío"}`}
          onKeyDown={(event) => {
            if (disabled) return;
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onOpenChange(true);
            }
            slotKeyDown(event, allowed, chosen?.id, onAssign);
          }}
          className={cn(
            "mx-0.5 rounded-md px-1.5 py-0.5 [box-decoration-break:clone] outline-none transition-colors duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/50",
            disabled ? "cursor-default" : "cursor-pointer",
            chosen
              ? "bg-primary/10 font-medium text-foreground shadow-[inset_0_-2px_0_var(--primary)]"
              : "inline-block min-w-24 border-2 border-dashed border-primary/50 text-center text-primary",
            !disabled && !chosen && "hover:bg-primary/5",
            !disabled && chosen && "hover:bg-primary/15",
            expanded && "bg-primary/15",
          )}
        >
          {chosen ? (
            <span
              key={chosen.id}
              className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200"
            >
              {chosen.image && (
                <img
                  src={chosen.image.url}
                  alt=""
                  className="mr-1 inline size-5 object-contain align-text-bottom mix-blend-multiply"
                />
              )}
              {chosen.label}
            </span>
          ) : (
            "Elegir"
          )}
        </span>
      </PopoverTrigger>
      <ChoiceMenu
        label={label.toLowerCase()}
        options={allowed}
        chosenId={chosen?.id}
        onPick={(id) => {
          onAssign(id);
          onOpenChange(false);
        }}
      />
    </Popover>
  );
}

export function TextClozePlayer({
  config,
  blocks,
  value,
  onChange,
  disabled = false,
}: {
  config: ClozeConfig;
  blocks: ContentBlock[];
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
  disabled?: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  function assign(blankId: string, optionId: string, label: string) {
    if (disabled) return;
    onChange(withAssignment(config.options, value, blankId, optionId));
    const option = config.options.find((entry) => entry.id === optionId);
    setAnnouncement(`${label}: ${option?.label ?? "vacío"}`);
  }

  return (
    <div className="min-w-0" data-assignment-surface>
      <TaskContentRenderer
        blocks={blocks}
        renderBlank={(id) => {
          const index = config.blanks.findIndex((blank) => blank.id === id);
          if (index === -1) return <span>[hueco]</span>;
          const label = `Hueco ${index + 1}`;
          return (
            <ClozeBlank
              key={id}
              blank={config.blanks[index]}
              label={label}
              options={config.options}
              chosenId={value[id]}
              open={openId === id}
              onOpenChange={(open) => setOpenId(open ? id : null)}
              onAssign={(optionId) => assign(id, optionId, label)}
              disabled={disabled}
            />
          );
        }}
      />
      <span className="sr-only" role="status">
        {announcement}
      </span>
    </div>
  );
}
