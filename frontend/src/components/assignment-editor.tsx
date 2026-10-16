"use client";

import {
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { ImagePlusIcon, MinusIcon, PlusIcon, XIcon } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  CellFace,
  StateGridPlayer,
  cellBox,
  imageStageClass,
  imageStageStyle,
  slotKeyDown,
  withAssignment,
} from "@/components/assignment-player";
import {
  collectTaskBlankIds,
  type AssignmentImage,
  type AssignmentKey,
  type AssignmentOption,
  type GridCell,
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
  const onImage = grid.layout === "image";

  function showGrid() {
    const columns = grid.columns;
    const rows = Math.min(
      12,
      Math.max(1, Math.ceil(grid.cells.length / columns)),
    );
    onChange(
      {
        ...grid,
        layout: "grid",
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

  async function setBackground(background: AssignmentImage) {
    const size = await imageSize(background.url);
    const placed = grid.cells.every((cell) => cell.width !== undefined);
    onChange(
      {
        ...grid,
        layout: "image",
        background,
        cells: placed ? grid.cells : layoutCells(grid, size),
      },
      answerKey,
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div
        role="tablist"
        aria-label="Forma de las casillas"
        className="flex flex-wrap items-center gap-1"
      >
        {[
          { image: false, label: "Cuadrícula" },
          { image: true, label: "Sobre una imagen" },
        ].map((tab) => (
          <button
            key={tab.label}
            type="button"
            role="tab"
            aria-selected={onImage === tab.image}
            onClick={() =>
              tab.image
                ? grid.background
                  ? setBackground(grid.background)
                  : onChange({ ...grid, layout: "image" }, answerKey)
                : showGrid()
            }
            className={cn(
              "border-b-2 px-2 py-1 text-sm font-medium transition-colors",
              onImage === tab.image
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {!onImage && (
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
      )}

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

      {onImage ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Casillas</h3>
          {grid.background ? (
            <ImageCellsEditor
              config={grid}
              value={value}
              onCells={(cells) => onChange({ ...grid, cells }, answerKey)}
              onWidth={(widthPercent) =>
                onChange({ ...grid, widthPercent }, answerKey)
              }
              onBackground={setBackground}
              onAnswer={setAnswer}
            />
          ) : (
            <PickImage
              label="Imagen de fondo"
              className="flex h-40 flex-col items-center justify-center gap-2 border-2 border-dashed border-border/30 text-sm text-muted-foreground hover:border-primary hover:text-foreground"
              onPick={setBackground}
            >
              <ImagePlusIcon className="size-6" />
              Subir la imagen de fondo, donde van las casillas
            </PickImage>
          )}
        </section>
      ) : (
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
      )}
    </div>
  );
}

function imageSize(url: string) {
  return new Promise<{ width: number; height: number }>((resolve) => {
    const image = new Image();
    image.onload = () =>
      resolve({
        width: image.naturalWidth || 1,
        height: image.naturalHeight || 1,
      });
    image.onerror = () => resolve({ width: 1, height: 1 });
    image.src = url;
  });
}

const round = (value: number) => Math.round(value * 100) / 100;
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/** Las casillas de la cuadrícula, cuadradas y centradas sobre la imagen. */
function layoutCells(
  grid: GridConfig,
  size: { width: number; height: number },
): GridCell[] {
  const columns = Math.max(1, Math.min(grid.columns, grid.cells.length));
  const rows = Math.ceil(grid.cells.length / columns);
  const side = Math.min(
    (0.8 * size.width) / columns,
    (0.8 * size.height) / rows,
  );
  const width = (side / size.width) * 100;
  const height = (side / size.height) * 100;
  const left = (100 - width * columns) / 2;
  const top = (100 - height * rows) / 2;
  return grid.cells.map((cell, index) => ({
    ...cell,
    x: round(left + (index % columns) * width),
    y: round(top + Math.floor(index / columns) * height),
    width: round(width),
    height: round(height),
  }));
}

type CellGesture = {
  pointerId: number;
  kind: "move" | "resize";
  startX: number;
  startY: number;
  cell: Required<Pick<GridCell, "x" | "y" | "width" | "height">>;
  next: { x: number; y: number; width: number; height: number };
  moved: boolean;
};

/**
 * Las casillas se arrastran a su lugar sobre la imagen y se agrandan tirando de
 * su esquina, como las piezas de arrastrar y soltar. Un toque sin arrastrar
 * elige su estado en la respuesta.
 */
function ImageCellsEditor({
  config,
  value,
  onCells,
  onWidth,
  onBackground,
  onAnswer,
}: {
  config: GridConfig;
  value: Record<string, string>;
  onCells: (cells: GridCell[]) => void;
  onWidth: (widthPercent: number) => void;
  onBackground: (image: AssignmentImage) => void;
  onAnswer: (value: Record<string, string>) => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const gesture = useRef<CellGesture | null>(null);
  const states = config.states.filter((state) => state.limit !== 0);
  const cells = config.cells;

  const boxOf = (cell: GridCell) => ({
    x: cell.x ?? 0,
    y: cell.y ?? 0,
    width: cell.width ?? 10,
    height: cell.height ?? 10,
  });

  function update(id: string, patch: Partial<GridCell>) {
    onCells(
      cells.map((cell) => (cell.id === id ? { ...cell, ...patch } : cell)),
    );
  }

  const assign = (cellId: string, stateId: string) =>
    onAnswer(withAssignment(config.states, value, cellId, stateId));

  function cycle(cellId: string) {
    const index = states.findIndex((state) => state.id === value[cellId]);
    assign(cellId, states[index + 1]?.id ?? "");
  }

  function addCell() {
    const last = cells.at(-1);
    const box = last ? boxOf(last) : { x: 45, y: 45, width: 10, height: 10 };
    const beside = box.x + box.width * 2 <= 100;
    const below = box.y + box.height * 2 <= 100;
    const x = beside ? box.x + box.width : below ? box.x : 0;
    const y = beside ? box.y : below ? box.y + box.height : 0;
    const used = new Set(cells.map((cell) => cell.label));
    let number = cells.length + 1;
    while (used.has(`Casilla ${number}`)) number++;
    onCells([
      ...cells,
      {
        id: crypto.randomUUID(),
        label: `Casilla ${number}`,
        x: round(x),
        y: round(y),
        width: box.width,
        height: box.height,
      },
    ]);
  }

  function removeCell(id: string) {
    if (cells.length <= 1) return;
    onCells(cells.filter((cell) => cell.id !== id));
  }

  function start(
    event: ReactPointerEvent<HTMLElement>,
    cell: GridCell,
    kind: CellGesture["kind"],
  ) {
    if (!event.isPrimary || event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const box = boxOf(cell);
    gesture.current = {
      pointerId: event.pointerId,
      kind,
      startX: event.clientX,
      startY: event.clientY,
      cell: box,
      next: box,
      moved: false,
    };
  }

  function move(event: ReactPointerEvent<HTMLElement>, element: HTMLElement) {
    const state = gesture.current;
    const bounds = stage.current?.getBoundingClientRect();
    if (!state || state.pointerId !== event.pointerId || !bounds) return;
    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    if (!state.moved && Math.hypot(dx, dy) < 4) return;
    state.moved = true;
    const px = (dx / bounds.width) * 100;
    const py = (dy / bounds.height) * 100;
    const { x, y, width, height } = state.cell;
    state.next =
      state.kind === "move"
        ? {
            x: round(clamp(x + px, 0, 100 - width)),
            y: round(clamp(y + py, 0, 100 - height)),
            width,
            height,
          }
        : {
            x,
            y,
            width: round(clamp(width + px, 1, 100 - x)),
            height: round(clamp(height + py, 1, 100 - y)),
          };
    Object.assign(element.style, cellBox(state.next));
  }

  function finish(event: ReactPointerEvent<HTMLElement>, cellId: string) {
    const state = gesture.current;
    if (!state || state.pointerId !== event.pointerId) return;
    gesture.current = null;
    if (state.moved) update(cellId, state.next);
    else if (state.kind === "move") cycle(cellId);
  }

  return (
    <div className="flex flex-col gap-3" data-state-grid-editor>
      <p className="text-xs text-muted-foreground">
        Arrastra cada casilla a su lugar y tira de su esquina para cambiar el
        tamaño.{" "}
        {states.length
          ? "Toca una casilla para elegir su estado en la respuesta."
          : "Agrega un estado para poder marcar la respuesta."}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <Stepper
          label="% de ancho de la imagen"
          value={config.widthPercent ?? 100}
          min={20}
          max={100}
          step={5}
          onChange={onWidth}
        />
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={cells.length >= 144}
            onClick={addCell}
          >
            <PlusIcon data-icon="inline-start" />
            Casilla
          </Button>
          <PickImage
            label="Cambiar imagen de fondo"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
            onPick={onBackground}
          >
            <ImagePlusIcon data-icon="inline-start" />
            Cambiar fondo
          </PickImage>
        </div>
      </div>
      <div className="min-w-0 overflow-x-auto py-1">
        <div
          ref={stage}
          className={imageStageClass}
          style={imageStageStyle(config)}
        >
          <img
            src={config.background?.url}
            alt="Imagen de fondo"
            draggable={false}
            className="block h-auto w-full select-none"
          />
          {cells.map((cell) => {
            const state = config.states.find(
              (entry) => entry.id === value[cell.id],
            );
            return (
              <div
                key={cell.id}
                role="button"
                tabIndex={0}
                data-assignment-slot={cell.id}
                aria-label={`${cell.label}: ${state?.label ?? "vacío"}. Arrástrala para moverla.`}
                style={cellBox(cell)}
                onPointerDown={(event) => start(event, cell, "move")}
                onPointerMove={(event) => move(event, event.currentTarget)}
                onPointerUp={(event) => finish(event, cell.id)}
                onPointerCancel={() => (gesture.current = null)}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  const shift = {
                    ArrowLeft: [-1, 0],
                    ArrowRight: [1, 0],
                    ArrowUp: [0, -1],
                    ArrowDown: [0, 1],
                  }[event.key];
                  if (event.shiftKey && shift) {
                    event.preventDefault();
                    const box = boxOf(cell);
                    update(cell.id, {
                      x: round(clamp(box.x + shift[0], 0, 100 - box.width)),
                      y: round(clamp(box.y + shift[1], 0, 100 - box.height)),
                    });
                    return;
                  }
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    cycle(cell.id);
                    return;
                  }
                  slotKeyDown(event, states, state?.id, (id) =>
                    assign(cell.id, id),
                  );
                }}
                className={cn(
                  "group/cell absolute grid cursor-grab touch-none place-items-center outline-none select-none focus-visible:z-10 focus-visible:ring-[3px] focus-visible:ring-ring/70 active:cursor-grabbing",
                  state
                    ? "hover:z-10 hover:ring-2 hover:ring-primary/45"
                    : "border-[1.5px] border-dashed border-primary/70 bg-primary/5 hover:bg-primary/15",
                )}
              >
                {state && <CellFace state={state} />}
                {cells.length > 1 && (
                  <button
                    type="button"
                    aria-label={`Quitar ${cell.label}`}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      removeCell(cell.id);
                    }}
                    className="absolute -top-2 -right-2 z-10 grid size-4 place-items-center bg-foreground text-background opacity-0 transition-opacity group-hover/cell:opacity-100 group-focus-visible/cell:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:size-5 [@media(hover:none)]:opacity-100"
                  >
                    <XIcon className="size-3" />
                  </button>
                )}
                <span
                  aria-hidden="true"
                  title="Arrastra para cambiar el tamaño"
                  onPointerDown={(event) => start(event, cell, "resize")}
                  className="absolute -right-1 -bottom-1 z-10 size-3 cursor-nwse-resize touch-none border-2 border-background bg-primary opacity-0 transition-opacity group-hover/cell:opacity-100 group-focus-visible/cell:opacity-100 [@media(hover:none)]:size-[18px] [@media(hover:none)]:opacity-100"
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Stepper({
  label,
  value,
  onChange,
  min = 1,
  max = 12,
  step: amount = 1,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  const step =
    "grid size-8 place-items-center text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-30";
  return (
    <div role="group" aria-label={label} className="flex items-center gap-1">
      <button
        type="button"
        aria-label={`Menos ${label}`}
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - amount))}
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
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + amount))}
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
            <XIcon data-icon="inline-start" />
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
