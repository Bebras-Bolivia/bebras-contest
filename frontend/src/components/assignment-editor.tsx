"use client";

import type { ReactNode } from "react";
import { ImagePlusIcon, MinusIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { StateGridPlayer } from "@/components/assignment-player";
import {
  collectTaskBlankIds,
  type AssignmentImage,
  type AssignmentKey,
  type AssignmentOption,
  type GridConfig,
  type ClozeConfig,
} from "@/lib/assignment-answers";
import { createContentImages, type ContentBlock } from "@/lib/task-schema";
import { cn } from "@/lib/utils";

export function initialGrid(): GridConfig {
  return {
    version: 1,
    rows: 1,
    columns: 3,
    cells: Array.from({ length: 3 }, (_, i) => ({
      id: crypto.randomUUID(),
      label: String(i + 1),
    })),
    states: [],
  };
}
export function initialCloze(): ClozeConfig {
  return {
    version: 1,
    blanks: [],
    options: [],
  };
}
/** Keep inactive metadata in the draft so deleting a blank and undoing restores it. */
export function activeCloze(
  config: ClozeConfig,
  blocks: ContentBlock[],
): ClozeConfig {
  const ids = collectTaskBlankIds(blocks);
  return {
    ...config,
    blanks: ids.map(
      (id) =>
        config.blanks.find((blank) => blank.id === id) ?? {
          id,
          allowedOptionIds: config.options.map((option) => option.id),
        },
    ),
  };
}
export function activeKey(key: AssignmentKey, ids: string[]): AssignmentKey {
  return {
    version: 1,
    acceptedAssignments: key.acceptedAssignments.map((map) =>
      Object.fromEntries(
        Object.entries(map).filter(([id]) => ids.includes(id)),
      ),
    ),
  };
}

const nameFromFile = (name: string) =>
  name
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .trim() || "Estado";

export function StateGridEditor({
  config: grid,
  answerKey,
  onChange,
}: {
  config: GridConfig;
  answerKey: AssignmentKey;
  onChange: (config: GridConfig, key: AssignmentKey) => void;
}) {
  const states = grid.states;
  const setStates = (next: AssignmentOption[]) =>
    onChange({ ...grid, states: next }, answerKey);
  const setCellLabel = (id: string, label: string) =>
    onChange(
      {
        ...grid,
        cells: grid.cells.map((cell) =>
          cell.id === id ? { ...cell, label } : cell,
        ),
      },
      answerKey,
    );
  function resize(rows: number, columns: number) {
    if (rows < 1 || columns < 1 || rows > 12 || columns > 12) return;
    onChange(
      {
        ...grid,
        rows,
        columns,
        cells: Array.from(
          { length: rows * columns },
          (_, i) =>
            grid.cells[i] ?? { id: crypto.randomUUID(), label: String(i + 1) },
        ),
      },
      answerKey,
    );
  }
  function setAnswer(value: Record<string, string>) {
    const solutions = [...answerKey.acceptedAssignments];
    // Merge inactive answers back for undo; only current positions are serialized.
    const ids = grid.cells.map((cell) => cell.id);
    const inactive = Object.fromEntries(
      Object.entries(solutions[0] ?? {}).filter(([id]) => !ids.includes(id)),
    );
    solutions[0] = { ...inactive, ...value };
    onChange(grid, { version: 1, acceptedAssignments: solutions });
  }
  const value =
    activeKey(
      answerKey,
      grid.cells.map((cell) => cell.id),
    ).acceptedAssignments[0] ?? {};

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <Stepper
          label="filas"
          value={grid.rows}
          onChange={(rows) => resize(rows, grid.columns)}
        />
        <Stepper
          label="columnas"
          value={grid.columns}
          onChange={(columns) => resize(grid.rows, columns)}
        />
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Estados</h3>
        <p className="text-xs text-muted-foreground">
          Cada imagen es un estado que puede tener una casilla.
        </p>
        <div className="flex flex-wrap gap-2">
          {states.map((state) => (
            <StateButton
              key={state.id}
              state={state}
              canRemove={states.length > 1}
              onReplace={(image) =>
                setStates(
                  states.map((entry) =>
                    entry.id === state.id ? { ...entry, image } : entry,
                  ),
                )
              }
              onRemove={() =>
                setStates(states.filter((entry) => entry.id !== state.id))
              }
            />
          ))}
          {states.length < 64 && (
            <PickImage
              label="Agregar un estado"
              className="flex size-16 flex-col items-center justify-center gap-1 bg-muted/60 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              onPick={(image) =>
                setStates([
                  ...states,
                  {
                    id: crypto.randomUUID(),
                    label: nameFromFile(image.name),
                    image,
                    limit: null,
                  },
                ])
              }
            >
              <PlusIcon className="size-4" />
              Estado
            </PickImage>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Casillas</h3>
        <p className="text-xs text-muted-foreground">
          {states.length
            ? "Toca cada casilla y elige su estado. Encima puedes escribir un rótulo que vea el estudiante (opcional)."
            : "Agrega un estado para poder marcar las casillas."}
        </p>
        <StateGridPlayer
          config={grid}
          value={value}
          disabled={!states.length}
          onChange={setAnswer}
          renderLabel={(cell, index) => (
            <input
              aria-label={`Rótulo de la casilla ${index + 1}`}
              value={cell.label === String(index + 1) ? "" : cell.label}
              placeholder={String(index + 1)}
              onChange={(event) =>
                setCellLabel(cell.id, event.target.value || String(index + 1))
              }
              className="h-7 w-full min-w-0 border-b-2 border-border/30 bg-transparent px-1 text-center text-xs outline-none transition-colors placeholder:text-muted-foreground/50 focus-visible:border-primary"
            />
          )}
        />
      </section>
    </div>
  );
}

function Stepper({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const step =
    "grid size-8 place-items-center text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-30";
  return (
    <div role="group" aria-label={label} className="flex items-center gap-1">
      <button
        type="button"
        aria-label={`Menos ${label}`}
        disabled={value <= 1}
        onClick={() => onChange(value - 1)}
        className={step}
      >
        <MinusIcon className="size-4" />
      </button>
      <span className="min-w-6 text-center font-semibold tabular-nums">
        {value}
      </span>
      <button
        type="button"
        aria-label={`Más ${label}`}
        disabled={value >= 12}
        onClick={() => onChange(value + 1)}
        className={step}
      >
        <PlusIcon className="size-4" />
      </button>
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}

function StateButton({
  state,
  canRemove,
  onReplace,
  onRemove,
}: {
  state: AssignmentOption;
  canRemove: boolean;
  onReplace: (image: AssignmentImage) => void;
  onRemove: () => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Editar ${state.label}`}
          className="flex size-16 items-center justify-center bg-muted/60 p-1.5 outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:ring-2 data-[state=open]:ring-primary"
        >
          {state.image ? (
            <img
              src={state.image.url}
              alt=""
              className="max-h-full max-w-full object-contain mix-blend-multiply"
            />
          ) : (
            <span className="line-clamp-2 text-xs">{state.label}</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-auto items-center gap-2">
        <PickImage
          label={`Nueva imagen para ${state.label}`}
          className={buttonVariants({ variant: "outline", size: "sm" })}
          onPick={onReplace}
        >
          <ImagePlusIcon data-icon="inline-start" />
          Cambiar imagen
        </PickImage>
        {canRemove && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-destructive"
            onClick={onRemove}
          >
            <Trash2Icon data-icon="inline-start" />
            Quitar
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

function PickImage({
  onPick,
  label,
  title,
  className,
  children,
}: {
  onPick: (image: AssignmentImage) => void;
  label: string;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label
      title={title}
      className={cn(
        "cursor-pointer transition-colors has-focus-visible:ring-2 has-focus-visible:ring-primary/60",
        className,
      )}
    >
      <input
        type="file"
        accept="image/*"
        aria-label={label}
        className="sr-only"
        onChange={async (event) => {
          const picked = await createContentImages(event.target.files);
          event.target.value = "";
          if (picked[0]) onPick(picked[0]);
        }}
      />
      {children}
    </label>
  );
}
