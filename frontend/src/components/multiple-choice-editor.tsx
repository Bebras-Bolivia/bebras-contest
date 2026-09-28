"use client";

import { useRef, type ReactNode } from "react";
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  CheckIcon,
  ImageIcon,
  ImagePlusIcon,
  PlusIcon,
  XIcon,
  TypeIcon,
} from "lucide-react";

import { ImageWidthResizer } from "@/components/image-width-resizer";
import { Button } from "@/components/ui/button";
import {
  createContentBlock,
  createContentImages,
  getNonEmptyBlocks,
  optionLabels,
  type ContentBlock,
  type MultipleChoiceCorrectnessMode,
  type MultipleChoiceLayout,
  type MultipleChoiceOrderMode,
  type OptionKey,
} from "@/lib/task-schema";
import { cn } from "@/lib/utils";

export type MultipleChoiceState = {
  options: Record<OptionKey, ContentBlock[]>;
  answerOrder: OptionKey[];
  answerCount: number;
  multipleChoiceContentType: "text" | "image";
  correctOptions: OptionKey[];
  multipleChoiceCorrectnessMode: MultipleChoiceCorrectnessMode;
  multipleChoiceOrderMode: MultipleChoiceOrderMode;
  multipleChoiceLayout: MultipleChoiceLayout;
};

type Update = (
  updater: (current: MultipleChoiceState) => Partial<MultipleChoiceState>,
) => void;

const MIN_OPTIONS = 2;

export function MultipleChoiceEditor({
  state,
  update,
  showErrors,
}: {
  state: MultipleChoiceState;
  update: Update;
  showErrors: boolean;
}) {
  const active = state.answerOrder.slice(0, state.answerCount);
  const images = state.multipleChoiceContentType === "image";
  const multi = state.multipleChoiceCorrectnessMode !== "single";
  const cache = useRef<
    Partial<Record<"text" | "image", Record<OptionKey, ContentBlock[]>>>
  >({});

  const setBlock = (key: OptionKey, block: ContentBlock) =>
    update((current) => ({
      options: { ...current.options, [key]: [block] },
    }));

  const toggleCorrect = (key: OptionKey) =>
    update((current) => {
      const marked = current.correctOptions.includes(key);
      if (current.multipleChoiceCorrectnessMode === "single") {
        return { correctOptions: marked ? [] : [key] };
      }
      return {
        correctOptions: marked
          ? current.correctOptions.filter((option) => option !== key)
          : [...current.correctOptions, key],
      };
    });

  const setMulti = (next: boolean) =>
    update((current) => ({
      multipleChoiceCorrectnessMode: next ? "all" : "single",
      correctOptions: next
        ? current.correctOptions
        : current.correctOptions.slice(0, 1),
    }));

  // Mover o quitar cambia el contenido de lugar y deja las letras en orden:
  // la primera opción siempre es la A, como la ve el estudiante.
  const move = (index: number, offset: -1 | 1) =>
    update((current) => {
      const keys = current.answerOrder.slice(0, current.answerCount);
      const a = keys[index];
      const b = keys[index + offset];
      if (!a || !b) return {};
      const swap = (key: OptionKey) => (key === a ? b : key === b ? a : key);
      return {
        options: {
          ...current.options,
          [a]: current.options[b],
          [b]: current.options[a],
        },
        correctOptions: current.correctOptions.map(swap),
      };
    });

  const remove = (index: number) =>
    update((current) => {
      if (current.answerCount <= MIN_OPTIONS) return {};
      const keys = current.answerOrder.slice(0, current.answerCount);
      const options = { ...current.options };
      const correct = new Set<OptionKey>();
      keys.forEach((key, position) => {
        if (position < index) {
          if (current.correctOptions.includes(key)) correct.add(key);
          return;
        }
        const next = keys[position + 1];
        if (next) {
          options[key] = current.options[next];
          if (current.correctOptions.includes(next)) correct.add(key);
        } else {
          options[key] = [
            createContentBlock(current.multipleChoiceContentType),
          ];
        }
      });
      return {
        options,
        answerCount: current.answerCount - 1,
        correctOptions: [...correct],
      };
    });

  const add = () =>
    update((current) => ({
      answerCount: Math.min(current.answerCount + 1, optionLabels.length),
    }));

  const switchContent = (type: "text" | "image") =>
    update((current) => {
      if (current.multipleChoiceContentType === type) return {};
      cache.current[current.multipleChoiceContentType] = current.options;
      const restored = cache.current[type];
      const options = { ...current.options };
      for (const key of optionLabels) {
        options[key] = restored?.[key] ?? [createContentBlock(type)];
      }
      return { multipleChoiceContentType: type, options };
    });

  const uploadImage = async (
    key: OptionKey,
    block: ContentBlock,
    files: FileList | null,
  ) => {
    const image = (await createContentImages(files))[0];
    if (image)
      setBlock(key, {
        ...block,
        image,
        widthPercent: block.widthPercent || 100,
      });
  };

  const noCorrect = showErrors && state.correctOptions.length === 0;

  const controls = (key: OptionKey, index: number, block: ContentBlock) => (
    <>
      <IconButton
        label={`Subir la opción ${key}`}
        disabled={index === 0}
        onClick={() => move(index, -1)}
      >
        {images ? <ArrowLeftIcon /> : <ArrowUpIcon />}
      </IconButton>
      <IconButton
        label={`Bajar la opción ${key}`}
        disabled={index === active.length - 1}
        onClick={() => move(index, 1)}
      >
        {images ? <ArrowRightIcon /> : <ArrowDownIcon />}
      </IconButton>
      {images && block.image && (
        <PickImage
          label={`Cambiar la imagen de la opción ${key}`}
          onPick={(files) => void uploadImage(key, block, files)}
        >
          <ImagePlusIcon />
        </PickImage>
      )}
      {active.length > MIN_OPTIONS && (
        <IconButton
          label={`Quitar la opción ${key}`}
          onClick={() => remove(index)}
        >
          <XIcon />
        </IconButton>
      )}
    </>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Toca la letra de la respuesta correcta.
        </p>
        <div
          role="group"
          aria-label="Las opciones son"
          className="flex bg-muted/60 p-0.5"
        >
          {(
            [
              ["text", "Texto", <TypeIcon key="t" />],
              ["image", "Imágenes", <ImageIcon key="i" />],
            ] as const
          ).map(([type, label, icon]) => (
            <button
              key={type}
              type="button"
              aria-pressed={state.multipleChoiceContentType === type}
              onClick={() => switchContent(type)}
              className="flex h-7 items-center gap-1.5 px-2.5 text-xs text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/60 aria-pressed:bg-background aria-pressed:font-medium aria-pressed:text-foreground [&_svg]:size-3.5"
            >
              {icon}
              {label}
            </button>
          ))}
        </div>
      </div>

      <div
        className={cn(
          images
            ? "grid grid-cols-2 gap-3 md:grid-cols-3"
            : "flex flex-col gap-2",
        )}
      >
        {active.map((key, index) => {
          const block =
            state.options[key][0] ??
            createContentBlock(state.multipleChoiceContentType);
          const correct = state.correctOptions.includes(key);
          const empty = getNonEmptyBlocks(state.options[key]).length === 0;
          const letter = (
            <button
              type="button"
              aria-pressed={correct}
              aria-label={`Opción ${key}${correct ? ", correcta" : ""}. Marcar como correcta`}
              title={correct ? "Es la correcta" : "Marcar como correcta"}
              onClick={() => toggleCorrect(key)}
              className={cn(
                "flex h-9 min-w-9 shrink-0 items-center justify-center gap-0.5 border-2 px-1.5 text-sm font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
                correct
                  ? "border-difficulty-easy bg-difficulty-easy text-difficulty-easy-foreground"
                  : "border-border/30 bg-muted/60 text-muted-foreground hover:border-difficulty-easy",
                noCorrect && "border-destructive/60",
              )}
            >
              {key}
              {correct && <CheckIcon className="size-3.5" strokeWidth={3} />}
            </button>
          );

          if (!images) {
            return (
              <div key={key} className="flex items-center gap-2">
                {letter}
                <input
                  value={block.content}
                  placeholder={`Opción ${key}`}
                  aria-label={`Texto de la opción ${key}`}
                  aria-invalid={showErrors && empty && index < MIN_OPTIONS}
                  onChange={(event) =>
                    setBlock(key, { ...block, content: event.target.value })
                  }
                  className={cn(
                    "h-9 min-w-0 flex-1 border-2 bg-background px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-primary aria-invalid:border-destructive/60",
                    correct ? "border-difficulty-easy" : "border-border/30",
                  )}
                />
                <div className="flex shrink-0 items-center">
                  {controls(key, index, block)}
                </div>
              </div>
            );
          }

          return (
            <div
              key={key}
              className={cn(
                "flex flex-col gap-2 border-2 p-2 transition-colors",
                correct ? "border-difficulty-easy" : "border-border/30",
              )}
            >
              <div className="flex items-center gap-1">
                {letter}
                <div className="ml-auto flex items-center">
                  {controls(key, index, block)}
                </div>
              </div>
              {block.image ? (
                <ImageWidthResizer
                  alt={block.image.name}
                  src={block.image.url}
                  widthPercent={block.widthPercent}
                  minPercent={10}
                  onChange={(widthPercent) =>
                    setBlock(key, { ...block, widthPercent })
                  }
                />
              ) : (
                <PickImage
                  label={`Subir la imagen de la opción ${key}`}
                  onPick={(files) => void uploadImage(key, block, files)}
                  className={cn(
                    "flex aspect-[4/3] size-auto w-full flex-col items-center justify-center gap-1.5 border-2 border-dashed text-xs text-muted-foreground hover:border-primary hover:text-foreground",
                    showErrors && index < MIN_OPTIONS
                      ? "border-destructive/60"
                      : "border-border/30",
                  )}
                >
                  <ImagePlusIcon className="size-5" />
                  Subir imagen
                </PickImage>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        {active.length < optionLabels.length && (
          <Button type="button" size="sm" variant="ghost" onClick={add}>
            <PlusIcon data-icon="inline-start" />
            Otra opción
          </Button>
        )}
        {!images && (
          <Toggle
            checked={state.multipleChoiceLayout === "horizontal"}
            onChange={(checked) =>
              update(() => ({
                multipleChoiceLayout: checked ? "horizontal" : "vertical",
              }))
            }
          >
            Opciones en fila
          </Toggle>
        )}
        <Toggle checked={multi} onChange={setMulti}>
          Hay varias correctas
        </Toggle>
      </div>

      {multi && (
        <div className="flex flex-wrap items-center gap-2 text-sm motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200">
          <span className="text-muted-foreground">
            El estudiante debe marcar
          </span>
          {(
            [
              ["all", "todas las correctas"],
              ["any", "al menos una"],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              aria-pressed={state.multipleChoiceCorrectnessMode === mode}
              onClick={() =>
                update(() => ({ multipleChoiceCorrectnessMode: mode }))
              }
              className="h-7 px-2.5 text-xs text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/60 aria-pressed:bg-primary/10 aria-pressed:font-semibold aria-pressed:text-primary"
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-8 place-items-center text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/60 disabled:pointer-events-none disabled:opacity-30 [&_svg]:size-4"
    >
      {children}
    </button>
  );
}

function PickImage({
  label,
  onPick,
  className,
  children,
}: {
  label: string;
  onPick: (files: FileList | null) => void;
  className?: string;
  children: ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          onPick(event.target.files);
          event.target.value = "";
        }}
      />
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={() => input.current?.click()}
        className={cn(
          "grid size-8 place-items-center text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/60 [&_svg]:size-4",
          className,
        )}
      >
        {children}
      </button>
    </>
  );
}

function Toggle({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-4 accent-primary"
      />
      {children}
    </label>
  );
}
