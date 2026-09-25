"use client";
import { useMemo, useRef, useState } from "react";
import {
  ImagePlusIcon,
  MapPinPlusIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { DragDropPlayer } from "@/components/drag-drop-player";
import { AuthoringDeleteDialog } from "@/components/authoring-delete-dialog";
import { dragRemovalImpact, editingSolutions } from "@/lib/authoring";
import { useAuthoringImageSizes } from "@/lib/authoring-image-sizes";
import { useCutoutImages } from "@/lib/cutout-images";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import type {
  StoredTaskDragDropItem,
  StoredTaskDragDropSolution,
  StoredTaskDragDropTarget,
} from "@/lib/task-schema";
import { cn } from "@/lib/utils";

type Props = {
  backgroundUrl: string | null;
  /** Ancho del fondo en % de la columna; sin valor, el de siempre. */
  backgroundWidthPercent?: number;
  onResizeBackground: (widthPercent: number) => void;
  items: StoredTaskDragDropItem[];
  targets: StoredTaskDragDropTarget[];
  solutions: StoredTaskDragDropSolution[];
  onUploadBackground: (files: FileList | null) => void;
  onReplaceItemImage: (id: string, files: FileList | null) => void;
  /** Crea una pieza vacía y devuelve su id, para ponerle la imagen elegida. */
  onAddItem: () => string;
  onRemoveItem: (id: string) => void;
  onUpdateItem: (
    id: string,
    patch: Partial<
      Pick<StoredTaskDragDropItem, "label" | "widthPercent" | "equivalenceKey">
    >,
  ) => void;
  onAddTarget: () => string;
  onRemoveTarget: (id: string) => void;
  onUpdateTarget: (
    id: string,
    patch: Partial<Pick<StoredTaskDragDropTarget, "x" | "y" | "snapRadius">>,
  ) => void;
  onAddSolution: (placements: Record<string, string>) => string;
  onRemoveSolution: (id: string) => void;
  onUpdateSolution: (id: string, placements: Record<string, string>) => void;
};

/** Botón que abre el selector de imágenes; `onPick` recibe los archivos. */
function PickImage({
  onPick,
  children,
  className,
  variant = "outline",
  size = "sm",
  label,
}: {
  onPick: (files: FileList | null) => void;
  children: React.ReactNode;
  className?: string;
  variant?: "outline" | "ghost";
  size?: "sm" | "default";
  label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        aria-label={label}
        onChange={(event) => {
          if (event.target.files?.length) onPick(event.target.files);
          event.target.value = "";
        }}
      />
      <Button
        type="button"
        variant={variant}
        size={size}
        className={className}
        onClick={() => input.current?.click()}
      >
        {children}
      </Button>
    </>
  );
}

/**
 * Editor de arrastrar y soltar en un solo paso: se suben el fondo y las piezas,
 * y se arrastra cada pieza a su lugar sobre la imagen. Donde se suelta queda su
 * destino; no hay coordenadas ni radios que escribir. Los «lugares extra» son
 * sitios donde el estudiante también puede soltar una pieza sin que sea la
 * respuesta.
 */
export function DragDropEditor(p: Props) {
  const { backgroundUrl, items, targets, solutions } = p;
  const [solutionId, setSolutionId] = useState("primary");
  const [addingSpots, setAddingSpots] = useState(false);
  // Tamaño que se está eligiendo con la barra: se ve en el escenario al
  // instante y llega al formulario una vez, al soltar (guardarlo en cada
  // movimiento redibujaba todo el formulario y se sentía lento).
  const [sizeDraft, setSizeDraft] = useState<{
    itemId: string;
    widthPercent: number;
  } | null>(null);
  const shownItems = useMemo(
    () =>
      sizeDraft
        ? items.map((item) =>
            item.id === sizeDraft.itemId
              ? { ...item, widthPercent: sizeDraft.widthPercent }
              : item,
          )
        : items,
    [items, sizeDraft],
  );
  const [pendingDelete, setPendingDelete] = useState<{
    description: string;
    confirm: () => void;
  } | null>(null);
  const allSolutions = editingSolutions(items, solutions);
  const current =
    allSolutions.find((s) => s.id === solutionId) ?? allSolutions[0];
  const placements = current.placements;
  const targetIds = new Set(targets.map((t) => t.id));
  // Lugares creados al soltar una pieza en esta sesión: si la pieza se va de
  // ahí, el lugar sobra y se borra. Los que ya estaban (por ejemplo, la
  // cuadrícula de la tarea 14) se quedan aunque queden vacíos.
  const [autoSpots, setAutoSpots] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const imageSizes = useAuthoringImageSizes(
    backgroundUrl ? [backgroundUrl] : [],
  );
  const background = backgroundUrl ? imageSizes[backgroundUrl] : undefined;
  const cutouts = useCutoutImages(
    items.flatMap((item) => (item.image ? [item.image.url] : [])),
  );

  /** Radio (en % del lado menor) para que el círculo mida lo que la pieza. */
  const radiusFor = (widthPercent: number) => {
    const ratio = background
      ? background.width / Math.min(background.width, background.height)
      : 1;
    return Math.max(0.5, Math.round((widthPercent / 2) * ratio * 100) / 100);
  };

  /**
   * Guarda un acomodo y borra los destinos que quedaron sin uso (la pieza se
   * movió o volvió a la bandeja), salvo los lugares extra.
   */
  const commit = (next: Record<string, string>) => {
    p.onUpdateSolution(current.id, next);
    const used = new Set([
      ...Object.values(next),
      ...allSolutions
        .filter((s) => s.id !== current.id)
        .flatMap((s) => Object.values(s.placements)),
    ]);
    for (const id of new Set(Object.values(placements))) {
      if (targetIds.has(id) && !used.has(id) && autoSpots.has(id)) {
        p.onRemoveTarget(id);
      }
    }
  };

  const addTarget = (x: number, y: number, widthPercent: number) => {
    const id = p.onAddTarget();
    p.onUpdateTarget(id, { x, y, snapRadius: radiusFor(widthPercent) });
    return id;
  };

  const removeItem = (item: StoredTaskDragDropItem) => {
    const confirm = () => {
      const used = new Set(
        allSolutions.flatMap((s) =>
          Object.entries(s.placements)
            .filter(([itemId]) => itemId !== item.id)
            .map(([, targetId]) => targetId),
        ),
      );
      p.onRemoveItem(item.id);
      for (const s of allSolutions) {
        const targetId = s.placements[item.id];
        if (targetId && !used.has(targetId) && autoSpots.has(targetId)) {
          p.onRemoveTarget(targetId);
        }
      }
    };
    const impacted = dragRemovalImpact(allSolutions, "pieza", item.id);
    if (!impacted.length) return confirm();
    setPendingDelete({
      description: `Se quitará «${item.label}» y su lugar en la respuesta.`,
      confirm,
    });
  };

  const removeSpot = (targetId: string) => {
    const confirm = () => p.onRemoveTarget(targetId);
    const impacted = dragRemovalImpact(allSolutions, "destino", targetId);
    if (!impacted.length) return confirm();
    setPendingDelete({
      description:
        "Ese lugar lo usa otra respuesta correcta; la pieza que estaba ahí quedará sin colocar.",
      confirm,
    });
  };

  const averageWidth = items.length
    ? items.reduce((sum, item) => sum + item.widthPercent, 0) / items.length
    : 10;
  const solutionName = (index: number) =>
    index === 0 ? "Respuesta" : `Otra respuesta ${index}`;

  if (!backgroundUrl) {
    return (
      <div className="flex flex-col items-center gap-3 border-2 border-dashed border-border px-4 py-10 text-center">
        <ImagePlusIcon className="size-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Empieza por la imagen de fondo, donde se sueltan las piezas.
        </p>
        <PickImage onPick={p.onUploadBackground} label="Imagen de fondo">
          <ImagePlusIcon data-icon="inline-start" />
          Subir imagen de fondo
        </PickImage>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6" data-drag-drop-editor>
      <AuthoringDeleteDialog
        pending={pendingDelete}
        onClose={() => setPendingDelete(null)}
      />

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Piezas para arrastrar</h3>
        <div className="flex flex-wrap items-end gap-3">
          {items.map((item) => (
            <PieceButton
              key={item.id}
              item={item}
              src={item.image && (cutouts[item.image.url] ?? item.image.url)}
              widthPercent={
                sizeDraft?.itemId === item.id
                  ? sizeDraft.widthPercent
                  : item.widthPercent
              }
              onPreviewWidth={(widthPercent) =>
                setSizeDraft({ itemId: item.id, widthPercent })
              }
              onCommitWidth={(widthPercent) => {
                p.onUpdateItem(item.id, { widthPercent });
                setSizeDraft(null);
              }}
              onReplaceImage={(files) => p.onReplaceItemImage(item.id, files)}
              onRemove={() => removeItem(item)}
            />
          ))}
          <PickImage
            onPick={(files) => p.onReplaceItemImage(p.onAddItem(), files)}
            label="Imagen de la nueva pieza"
            variant="ghost"
            className="size-16 flex-col gap-1 bg-muted/60 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <PlusIcon />
            Pieza
          </PickImage>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div
            role="tablist"
            aria-label="Respuestas correctas"
            className="flex flex-wrap items-center gap-1"
          >
            {allSolutions.map((s, index) => (
              <span key={s.id} className="flex items-center">
                <button
                  type="button"
                  role="tab"
                  aria-selected={s.id === current.id}
                  onClick={() => setSolutionId(s.id)}
                  className={cn(
                    "border-b-2 px-2 py-1 text-sm font-medium transition-colors",
                    s.id === current.id
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {solutionName(index)}
                </button>
                {index > 0 && s.id === current.id && (
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Quitar ${solutionName(index)}`}
                    onClick={() => {
                      p.onRemoveSolution(s.id);
                      setSolutionId("primary");
                    }}
                  >
                    <XIcon />
                  </Button>
                )}
              </span>
            ))}
            {items.length > 0 && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-muted-foreground"
                onClick={() => setSolutionId(p.onAddSolution(placements))}
              >
                <PlusIcon data-icon="inline-start" />
                Otra respuesta correcta
              </Button>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant={addingSpots ? "default" : "ghost"}
              aria-pressed={addingSpots}
              onClick={() => setAddingSpots((on) => !on)}
            >
              <MapPinPlusIcon data-icon="inline-start" />
              {addingSpots ? "Listo" : "Lugares extra"}
            </Button>
            <PickImage
              variant="ghost"
              onPick={p.onUploadBackground}
              label="Cambiar imagen de fondo"
            >
              <ImagePlusIcon data-icon="inline-start" />
              Cambiar fondo
            </PickImage>
          </div>
        </div>

        {addingSpots && (
          <p className="text-sm text-muted-foreground" aria-live="polite">
            Toca la imagen para marcar un lugar extra. Toca un círculo para
            quitarlo.
          </p>
        )}

        <DragDropPlayer
          key={current.id}
          backgroundUrl={backgroundUrl}
          items={shownItems}
          targets={targets}
          placements={placements}
          onChange={commit}
          widthPercent={p.backgroundWidthPercent}
          authoring={{
            onResize: p.onResizeBackground,
            onPlaceAt: (itemId, x, y) => {
              const item = items.find((candidate) => candidate.id === itemId);
              const id = addTarget(x, y, item?.widthPercent ?? averageWidth);
              setAutoSpots((spots) => new Set(spots).add(id));
              commit({ ...placements, [itemId]: id });
            },
            onMoveTarget: (targetId, x, y) =>
              p.onUpdateTarget(targetId, { x, y }),
            onStageTap: addingSpots
              ? (x, y, targetId) => {
                  if (targetId) {
                    removeSpot(targetId);
                    return;
                  }
                  addTarget(x, y, averageWidth);
                }
              : undefined,
          }}
        />
      </section>
    </div>
  );
}

/** Miniatura de una pieza; al tocarla se ajustan su tamaño e imagen. */
function PieceButton({
  item,
  src,
  widthPercent,
  onPreviewWidth,
  onCommitWidth,
  onReplaceImage,
  onRemove,
}: {
  item: StoredTaskDragDropItem;
  /** Imagen de la pieza sin su fondo blanco, si lo tenía. */
  src: string | null;
  widthPercent: number;
  onPreviewWidth: (widthPercent: number) => void;
  onCommitWidth: (widthPercent: number) => void;
  onReplaceImage: (files: FileList | null) => void;
  onRemove: () => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Editar ${item.label || "pieza"}`}
          className="flex size-16 items-center justify-center bg-muted/60 p-1.5 outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:ring-2 data-[state=open]:ring-primary"
        >
          {src ? (
            <img
              src={src}
              alt=""
              className="max-h-full max-w-full object-contain"
              draggable={false}
            />
          ) : (
            <span className="line-clamp-2 text-xs">{item.label}</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-72 flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`drag-width-${item.id}`}>Tamaño</Label>
          <Slider
            id={`drag-width-${item.id}`}
            value={[widthPercent]}
            min={3}
            max={50}
            step={0.5}
            onValueChange={([next]) => onPreviewWidth(next)}
            onValueCommit={([next]) => onCommitWidth(next)}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <PickImage onPick={onReplaceImage} label="Nueva imagen de la pieza">
            <ImagePlusIcon data-icon="inline-start" />
            Cambiar imagen
          </PickImage>
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
        </div>
      </PopoverContent>
    </Popover>
  );
}
