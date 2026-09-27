"use client";

import {
  Fragment,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { Editor, JSONContent } from "@tiptap/react";
import {
  TaskRichTextEditor,
  insertTaskBlank,
} from "@/components/task-rich-text-editor";
import { cn } from "@/lib/utils";
import { getTaskBlankIds, hasTaskBlanks } from "@/lib/task-blank";
import { AuthoringDeleteDialog } from "@/components/authoring-delete-dialog";
import { type ContentBlock, type ContentBlockType } from "@/lib/task-schema";
import { Button } from "@/components/ui/button";
import { ImageUploadButton } from "@/components/image-upload-button";
import { ImageWidthResizer } from "@/components/image-width-resizer";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Field, FieldContent, FieldGroup } from "@/components/ui/field";
import {
  BracketsIcon,
  HelpCircleIcon,
  GripVerticalIcon,
  ImageIcon,
  MessageSquareTextIcon,
  TypeIcon,
  XIcon,
} from "lucide-react";

type TaskContentBuilderProps = {
  blocks: ContentBlock[];
  allowedBlockTypes: ContentBlockType[];
  textPlaceholder: string;
  onAddBlock: (type?: ContentBlockType) => string | null;
  onRemoveBlock: (blockId: string) => void;
  onMoveBlock: (
    fromBlockId: string,
    toBlockId: string,
    position: "before" | "after",
  ) => void;
  onUpdateBlockContent: (
    blockId: string,
    content: string,
    richText?: JSONContent,
  ) => void;
  onUpdateBlockImage: (blockId: string, files: FileList | null) => void;
  onUpdateBlockWidth: (blockId: string, widthPercent: number) => void;
  showChallengeErrors: boolean;
  allowAddingBlocks?: boolean;
  allowRemovingBlocks?: boolean;
  allowReorderingBlocks?: boolean;
  allowCrossSectionDrag?: boolean;
  allowBlanks?: boolean;
  onSelectBlank?: (blankId: string) => void;
  onBlankFromText?: (blankId: string, text: string) => void;
  blankNumbers?: Record<string, number>;
  blankRemovalDescription?: (ids: string[]) => string | null;
  /** Identifica esta lista, para saber si un bloque cambió de sección. */
  sectionId?: string;
  /** Soltar sobre otra sección: mover el bloque de una lista a la otra. */
  onMoveBlockToSection?: (
    blockId: string,
    toSectionId: string,
    toBlockId: string,
    position: "before" | "after",
  ) => void;
};

export function TaskContentBuilder({
  blocks,
  allowedBlockTypes,
  textPlaceholder,
  onAddBlock,
  onRemoveBlock,
  onMoveBlock,
  onUpdateBlockContent,
  onUpdateBlockImage,
  onUpdateBlockWidth,
  showChallengeErrors,
  allowAddingBlocks = true,
  allowRemovingBlocks = true,
  allowReorderingBlocks = true,
  allowCrossSectionDrag = false,
  allowBlanks = false,
  onSelectBlank,
  onBlankFromText,
  blankNumbers,
  blankRemovalDescription,
  sectionId,
  onMoveBlockToSection,
}: TaskContentBuilderProps) {
  const builderRef = useRef<HTMLDivElement | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{
    description: string;
    confirm: () => void;
  } | null>(null);
  const imageInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const editorRefs = useRef<Record<string, Editor | null>>({});
  const pendingFocusRef = useRef<{
    blockId: string;
    atEnd: boolean;
  } | null>(null);
  const pendingImageBlockIdRef = useRef<string | null>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    blockId: string;
  } | null>(null);
  const [dropIndicator, setDropIndicator] = useState<{
    left: number;
    top: number;
    width: number;
  } | null>(null);
  const [dragPreview, setDragPreview] = useState<{
    blockId: string;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    if (!pendingImageBlockIdRef.current) {
      return;
    }

    const input = imageInputRefs.current[pendingImageBlockIdRef.current];
    if (input) {
      input.click();
    }

    pendingImageBlockIdRef.current = null;
  }, [blocks]);

  useEffect(() => {
    const pending = pendingFocusRef.current;
    const editor = pending && editorRefs.current[pending.blockId];
    if (editor && pending) {
      editor.commands.focus(pending.atEnd ? "end" : "start");
      pendingFocusRef.current = null;
    }
  }, [blocks]);

  const previousTextBlock = (blockId: string) => {
    const index = blocks.findIndex((block) => block.id === blockId);
    return blocks
      .slice(0, Math.max(0, index))
      .findLast((block) => block.type !== "image");
  };

  const removeBlock = (blockId: string) => {
    const block = blocks.find((item) => item.id === blockId);
    const description = blankRemovalDescription?.(
      getTaskBlankIds(block?.richText),
    );
    if (description) {
      setPendingDelete({
        description: `${description} Eliminar el bloque completo no se puede deshacer.`,
        confirm: () => onRemoveBlock(blockId),
      });
      return;
    }
    const previous = previousTextBlock(blockId);
    if (block && !block.content.trim() && !block.image && previous) {
      pendingFocusRef.current = { blockId: previous.id, atEnd: true };
    }
    onRemoveBlock(blockId);
  };

  const addTextAfter = (blockId: string) => {
    const newBlockId = onAddBlock("text");
    if (!newBlockId) return;
    onMoveBlock(newBlockId, blockId, "after");
    pendingFocusRef.current = { blockId: newBlockId, atEnd: false };
  };

  const lastTextBlockRef = useRef<string | null>(null);
  const textEditor = () => {
    const id =
      lastTextBlockRef.current ??
      blocks.findLast((block) => block.type !== "image")?.id;
    return id ? editorRefs.current[id] : null;
  };

  const handleAddImage = () => {
    const blockId = onAddBlock("image");
    if (blockId) {
      pendingImageBlockIdRef.current = blockId;
    }
  };

  const findDropTarget = (clientX: number, clientY: number) => {
    const element = document.elementFromPoint(clientX, clientY);
    const container = element?.closest<HTMLElement>("[data-block-builder]");
    if (
      !container ||
      (container !== builderRef.current &&
        (!allowCrossSectionDrag ||
          container.dataset.crossSectionDrag !== "true" ||
          container.closest("form") !== builderRef.current?.closest("form")))
    ) {
      return null;
    }

    const rows = Array.from(
      container.querySelectorAll<HTMLElement>("[data-content-block-id]"),
    );
    const row =
      rows.find((item) => {
        const rect = item.getBoundingClientRect();
        return clientY < rect.top + rect.height / 2;
      }) ?? rows.at(-1);
    if (!row?.dataset.contentBlockId) return null;

    const rect = row.getBoundingClientRect();
    const position = clientY < rect.top + rect.height / 2 ? "before" : "after";
    return {
      blockId: row.dataset.contentBlockId,
      toSectionId: container.dataset.blockSection,
      position,
      left: rect.left + 8,
      top: position === "before" ? rect.top - 6 : rect.bottom + 2,
      width: rect.width - 16,
    } as const;
  };

  const handleBlockPointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    blockId: string,
  ) => {
    if (!event.isPrimary || event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStateRef.current = { pointerId: event.pointerId, blockId };
    setDragPreview({ blockId, x: event.clientX, y: event.clientY });
  };

  const handleBlockPointerMove = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (dragStateRef.current?.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    const target = findDropTarget(event.clientX, event.clientY);
    setDropIndicator(
      target
        ? { left: target.left, top: target.top, width: target.width }
        : null,
    );
    setDragPreview((current) =>
      current ? { ...current, x: event.clientX, y: event.clientY } : current,
    );
  };

  const finishBlockDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
    commit: boolean,
  ) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    const target = commit ? findDropTarget(event.clientX, event.clientY) : null;
    dragStateRef.current = null;
    setDropIndicator(null);
    setDragPreview(null);

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (!target || target.blockId === dragState.blockId) {
      return;
    }

    // Cambió de sección: el padre es quien puede tocar las dos listas.
    if (target.toSectionId && target.toSectionId !== sectionId) {
      onMoveBlockToSection?.(
        dragState.blockId,
        target.toSectionId,
        target.blockId,
        target.position,
      );
      return;
    }

    onMoveBlock(dragState.blockId, target.blockId, target.position);
  };

  return (
    <FieldGroup
      className="gap-2"
      ref={builderRef}
      data-block-builder
      data-block-section={sectionId}
      data-cross-section-drag={allowCrossSectionDrag}
    >
      <AuthoringDeleteDialog
        pending={pendingDelete}
        onClose={() => setPendingDelete(null)}
      />
      {blocks.map((block) => (
        <div
          key={block.id}
          className={cn(
            "group/block relative flex items-center gap-3 transition-opacity",
            dragPreview?.blockId === block.id && "opacity-40",
          )}
          data-content-block-id={block.id}
          onFocusCapture={() => {
            if (block.type !== "image") lastTextBlockRef.current = block.id;
          }}
        >
          {allowReorderingBlocks ? (
            <Button
              aria-label="Arrastrar para mover bloque"
              className="cursor-grab touch-none opacity-0 transition-opacity select-none group-focus-within/block:opacity-100 group-hover/block:opacity-100 focus-visible:opacity-100 active:cursor-grabbing [@media(hover:none)]:opacity-100"
              size="icon-sm"
              type="button"
              variant="ghost"
              onPointerCancel={(event) => finishBlockDrag(event, false)}
              onPointerDown={(event) => handleBlockPointerDown(event, block.id)}
              onPointerMove={handleBlockPointerMove}
              onPointerUp={(event) => finishBlockDrag(event, true)}
            >
              <GripVerticalIcon />
            </Button>
          ) : (
            <div className="size-8 shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            {block.type === "image" ? (
              <Field>
                <FieldContent>
                  {!block.image && (
                    <>
                      <ImageUploadButton
                        id={`block-image-${block.id}`}
                        inputRef={(node) => {
                          imageInputRefs.current[block.id] = node;
                        }}
                        onChange={(event) => {
                          onUpdateBlockImage(block.id, event.target.files);
                          event.target.value = "";
                        }}
                      />
                    </>
                  )}
                  {block.image && (
                    <ImageWidthResizer
                      alt={block.image.name}
                      src={block.image.url}
                      widthPercent={block.widthPercent}
                      onChange={(widthPercent) =>
                        onUpdateBlockWidth(block.id, widthPercent)
                      }
                    />
                  )}
                </FieldContent>
              </Field>
            ) : (
              <Field
                data-invalid={
                  showChallengeErrors &&
                  block.type === "challenge" &&
                  block.content.trim().length === 0 &&
                  !hasTaskBlanks(block.richText)
                }
              >
                <FieldContent>
                  <TaskRichTextEditor
                    allowBlanks={allowBlanks}
                    onSelectBlank={onSelectBlank}
                    blankNumbers={blankNumbers}
                    blankRemovalDescription={blankRemovalDescription}
                    id={`block-content-${block.id}`}
                    content={block.content}
                    richText={block.richText}
                    placeholder={
                      block.type === "challenge"
                        ? "Escribe la pregunta o desafío."
                        : textPlaceholder
                    }
                    invalid={
                      showChallengeErrors &&
                      block.type === "challenge" &&
                      !block.content.trim() &&
                      !hasTaskBlanks(block.richText)
                    }
                    onReady={(editor) => {
                      editorRefs.current[block.id] = editor;
                      const pending = pendingFocusRef.current;
                      if (editor && pending?.blockId === block.id) {
                        editor.commands.focus(pending.atEnd ? "end" : "start");
                        pendingFocusRef.current = null;
                      }
                    }}
                    onChange={(content, richText) =>
                      onUpdateBlockContent(block.id, content, richText)
                    }
                    onEnter={
                      allowAddingBlocks && allowedBlockTypes.includes("text")
                        ? () => addTextAfter(block.id)
                        : undefined
                    }
                    onRemoveEmpty={() => {
                      if (!allowRemovingBlocks || !previousTextBlock(block.id))
                        return false;
                      removeBlock(block.id);
                      return true;
                    }}
                  />
                </FieldContent>
              </Field>
            )}
          </div>
          {allowRemovingBlocks ? (
            <Button
              size="icon-sm"
              type="button"
              variant="ghost"
              aria-label="Quitar bloque"
              className="opacity-0 transition-opacity group-focus-within/block:opacity-100 group-hover/block:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
              onClick={() => removeBlock(block.id)}
            >
              <XIcon />
            </Button>
          ) : (
            <div className="size-8 shrink-0" />
          )}
        </div>
      ))}
      {dropIndicator &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="pointer-events-none fixed z-50 h-1 rounded-full bg-primary/35"
            style={dropIndicator}
          />,
          document.body,
        )}
      {dragPreview &&
        typeof document !== "undefined" &&
        createPortal(
          <DragPreview
            block={blocks.find((item) => item.id === dragPreview.blockId)}
            x={dragPreview.x}
            y={dragPreview.y}
          />,
          document.body,
        )}
      {allowAddingBlocks && (
        <div className="flex flex-wrap items-center gap-1 pl-11 text-muted-foreground">
          {allowedBlockTypes.includes("image") && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="font-normal"
              onClick={handleAddImage}
            >
              <ImageIcon data-icon="inline-start" />
              Subir imagen
            </Button>
          )}
          {allowedBlockTypes.includes("text") && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="font-normal"
              onClick={() => onAddBlock("text")}
            >
              <TypeIcon data-icon="inline-start" />
              Agregar texto
            </Button>
          )}
          {allowBlanks && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="font-normal"
              title="Selecciona palabras y toca aquí para volverlas un hueco. Sin selección, pone un hueco vacío en el cursor."
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                const editor = textEditor();
                if (editor) insertTaskBlank(editor, onBlankFromText);
              }}
            >
              <BracketsIcon data-icon="inline-start" />
              Hueco
            </Button>
          )}
          {allowedBlockTypes.includes("challenge") && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="font-normal"
              onClick={() => onAddBlock("challenge")}
            >
              <MessageSquareTextIcon data-icon="inline-start" />
              Agregar pregunta o desafío
            </Button>
          )}
          <ShortcutsHelp />
        </div>
      )}
    </FieldGroup>
  );
}

/**
 * Lo que se ve viajando con el puntero: el contenido del bloque, no una caja
 * vacía. Va en un portal y sin eventos, para no estorbar a la detección de
 * dónde soltarlo.
 */
function DragPreview({
  block,
  x,
  y,
}: {
  block: ContentBlock | undefined;
  x: number;
  y: number;
}) {
  if (!block) {
    return null;
  }

  return (
    <div
      className="pointer-events-none fixed z-50 max-w-sm text-sm opacity-50"
      style={{ left: x + 14, top: y + 10 }}
    >
      {block.type === "image" && block.image ? (
        <img
          alt={block.image.name}
          className="block h-auto max-h-32 w-auto max-w-full"
          src={block.image.url}
        />
      ) : (
        <span className="line-clamp-3 whitespace-pre-wrap">
          {block.content.trim() || "Bloque vacío"}
        </span>
      )}
    </div>
  );
}

const shortcuts = [
  ["Enter", "Párrafo nuevo"],
  ["Shift + Enter", "Salto de línea"],
  ["Ctrl + B", "Negrita"],
  ["Ctrl + I", "Cursiva"],
  ["Ctrl + U", "Subrayado"],
  ["Ctrl + Shift + 8", "Lista con viñetas"],
  ["Ctrl + Shift + 7", "Lista numerada"],
] as const;

function ShortcutsHelp() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="Atajos de teclado"
          title="Atajos de teclado"
        >
          <HelpCircleIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-3 text-sm">
        <p className="mb-2 text-xs text-muted-foreground">
          Selecciona texto para ver el menú de formato.
        </p>
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5">
          {shortcuts.map(([keys, action]) => (
            <Fragment key={keys}>
              <dt>
                <kbd className="bg-muted px-1.5 py-0.5 font-sans text-xs whitespace-nowrap">
                  {keys}
                </kbd>
              </dt>
              <dd className="whitespace-nowrap">{action}</dd>
            </Fragment>
          ))}
        </dl>
      </PopoverContent>
    </Popover>
  );
}
