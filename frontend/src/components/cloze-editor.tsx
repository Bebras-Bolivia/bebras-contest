"use client";

import { useRef, useState } from "react";
import {
  ImageIcon,
  ImagePlusIcon,
  PlusIcon,
  Trash2Icon,
  TypeIcon,
} from "lucide-react";

import { activeCloze } from "@/components/assignment-editor";
import { Button, buttonVariants } from "@/components/ui/button";
import type {
  AssignmentImage,
  AssignmentKey,
  AssignmentOption,
  ClozeConfig,
} from "@/lib/assignment-answers";
import { createContentImages, type ContentBlock } from "@/lib/task-schema";
import { cn } from "@/lib/utils";

const input =
  "h-9 min-w-0 flex-1 border-2 border-border/30 bg-background px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-primary";

/** Las opciones nuevas se pueden poner en cualquier hueco. */
export function withClozeOptions(
  config: ClozeConfig,
  options: AssignmentOption[],
): ClozeConfig {
  const previous = new Set(config.options.map((option) => option.id));
  const ids = options.map((option) => option.id);
  const added = ids.filter((id) => !previous.has(id));
  return {
    ...config,
    options,
    blanks: config.blanks.map((blank) => ({
      ...blank,
      allowedOptionIds: [
        ...blank.allowedOptionIds.filter((id) => ids.includes(id)),
        ...added,
      ],
    })),
  };
}

const nameFromFile = (image: AssignmentImage) =>
  image.name
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .trim() || "Imagen";

export function ClozeEditor({
  config,
  answerKey,
  blocks,
  onChange,
}: {
  config: ClozeConfig;
  answerKey: AssignmentKey;
  blocks: ContentBlock[];
  onChange: (config: ClozeConfig, key: AssignmentKey) => void;
}) {
  const [images, setImages] = useState(() =>
    config.options.some((option) => option.image),
  );
  const savedImages = useRef(new Map<string, AssignmentImage>());
  const blanks = activeCloze(config, blocks).blanks;
  const solutions = answerKey.acceptedAssignments;
  const primary = solutions[0] ?? {};
  const correctIds = new Set(blanks.map((blank) => primary[blank.id]));
  const wrong = config.options.filter((option) => !correctIds.has(option.id));

  const update = (id: string, change: Partial<AssignmentOption>) =>
    onChange(
      {
        ...config,
        options: config.options.map((option) =>
          option.id === id ? { ...option, ...change } : option,
        ),
      },
      answerKey,
    );

  const newOption = (
    label: string,
    image: AssignmentImage | null = null,
  ): AssignmentOption => ({
    id: crypto.randomUUID(),
    label,
    image,
    limit: 1,
  });

  const setBlankAnswer = (blankId: string, option: AssignmentOption) => {
    const next = withClozeOptions(config, [...config.options, option]);
    const known = next.blanks.some((blank) => blank.id === blankId);
    onChange(
      known
        ? next
        : {
            ...next,
            blanks: [
              ...next.blanks,
              {
                id: blankId,
                allowedOptionIds: next.options.map((entry) => entry.id),
              },
            ],
          },
      {
        version: 1,
        acceptedAssignments: [
          { ...primary, [blankId]: option.id },
          ...solutions.slice(1),
        ],
      },
    );
  };

  const setImage = (option: AssignmentOption, image: AssignmentImage) =>
    update(option.id, {
      image,
      label: option.label.trim() ? option.label : nameFromFile(image),
    });

  const remove = (id: string) =>
    onChange(
      withClozeOptions(
        config,
        config.options.filter((option) => option.id !== id),
      ),
      {
        version: 1,
        acceptedAssignments: solutions.map((map) =>
          Object.fromEntries(
            Object.entries(map).filter(([, value]) => value !== id),
          ),
        ),
      },
    );

  const switchTo = (toImages: boolean) => {
    if (toImages === images) return;
    setImages(toImages);
    onChange(
      {
        ...config,
        options: config.options.map((option) => {
          if (!toImages && option.image)
            savedImages.current.set(option.id, option.image);
          return {
            ...option,
            image: toImages
              ? (savedImages.current.get(option.id) ?? null)
              : null,
          };
        }),
      },
      answerKey,
    );
  };

  if (blanks.length === 0) {
    return (
      <ol className="flex flex-col gap-3 text-sm">
        {[
          <>
            Escribe la frase completa en la <strong>Pregunta</strong>, arriba.
          </>,
          <>
            Selecciona las palabras que el estudiante debe completar y toca{" "}
            <strong>Hueco</strong>.
          </>,
          <>Vuelve aquí para agregar opciones incorrectas.</>,
        ].map((step, i) => (
          <li key={i} className="flex items-start gap-3">
            <span className="grid size-6 shrink-0 place-items-center bg-primary/10 text-xs font-semibold text-primary">
              {i + 1}
            </span>
            <span className="pt-0.5">{step}</span>
          </li>
        ))}
      </ol>
    );
  }

  const field = (
    option: AssignmentOption | undefined,
    props: {
      label: string;
      placeholder: string;
      correct?: boolean;
      onText: (text: string) => void;
      onImage: (image: AssignmentImage) => void;
    },
  ) =>
    images ? (
      <ImageField
        image={option?.image ?? null}
        label={props.label}
        correct={props.correct}
        onPick={props.onImage}
      />
    ) : (
      <input
        aria-label={props.label}
        placeholder={props.placeholder}
        value={option?.label ?? ""}
        onChange={(event) => props.onText(event.target.value)}
        className={cn(input, props.correct && "border-difficulty-easy/60")}
      />
    );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Las opciones para los huecos son
        </p>
        <div
          role="group"
          aria-label="Las opciones son"
          className="flex bg-muted/60 p-0.5"
        >
          {(
            [
              [false, "Texto", <TypeIcon key="t" />],
              [true, "Imágenes", <ImageIcon key="i" />],
            ] as const
          ).map(([value, label, icon]) => (
            <button
              key={label}
              type="button"
              aria-pressed={images === value}
              onClick={() => switchTo(value)}
              className="flex h-7 items-center gap-1.5 px-2.5 text-xs text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/60 aria-pressed:bg-background aria-pressed:font-medium aria-pressed:text-foreground [&_svg]:size-3.5"
            >
              {icon}
              {label}
            </button>
          ))}
        </div>
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Respuesta de cada hueco</h3>
        {blanks.map((blank, index) => {
          const option = config.options.find(
            (entry) => entry.id === primary[blank.id],
          );
          return (
            <div key={blank.id} className="flex items-center gap-2">
              <span className="w-20 shrink-0 border-b-2 border-primary bg-primary/10 px-2 py-1 text-center text-sm font-medium text-primary">
                Hueco {index + 1}
              </span>
              {field(option, {
                label: `Respuesta del hueco ${index + 1}`,
                placeholder: "Qué va en este hueco",
                correct: true,
                onText: (text) =>
                  option
                    ? update(option.id, { label: text })
                    : setBlankAnswer(blank.id, newOption(text)),
                onImage: (image) =>
                  option
                    ? setImage(option, image)
                    : setBlankAnswer(
                        blank.id,
                        newOption(nameFromFile(image), image),
                      ),
              })}
            </div>
          );
        })}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Opciones incorrectas</h3>
        <div
          className={cn(
            images ? "flex flex-wrap gap-2" : "flex flex-col gap-2",
          )}
        >
          {wrong.map((option) => (
            <div key={option.id} className="flex items-center gap-1">
              {field(option, {
                label: "Opción incorrecta",
                placeholder: "Una opción que no es la respuesta",
                onText: (text) => update(option.id, { label: text }),
                onImage: (image) => setImage(option, image),
              })}
              <button
                type="button"
                aria-label={`Quitar ${option.label || "opción"}`}
                title="Quitar"
                onClick={() => remove(option.id)}
                className="grid size-8 shrink-0 place-items-center text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/60"
              >
                <Trash2Icon className="size-4" />
              </button>
            </div>
          ))}
        </div>
        {images ? (
          <PickImage
            label="Subir la imagen de una opción incorrecta"
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              "self-start",
            )}
            onPick={(image) =>
              onChange(
                withClozeOptions(config, [
                  ...config.options,
                  newOption(nameFromFile(image), image),
                ]),
                answerKey,
              )
            }
          >
            <PlusIcon data-icon="inline-start" />
            Opción incorrecta
          </PickImage>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={() =>
              onChange(
                withClozeOptions(config, [...config.options, newOption("")]),
                answerKey,
              )
            }
          >
            <PlusIcon data-icon="inline-start" />
            Opción incorrecta
          </Button>
        )}
      </section>
    </div>
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
  children: React.ReactNode;
}) {
  return (
    <label
      title={title}
      className={cn(
        "cursor-pointer has-focus-visible:ring-2 has-focus-visible:ring-primary/60",
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

function ImageField({
  image,
  label,
  correct,
  onPick,
}: {
  image: AssignmentImage | null;
  label: string;
  correct?: boolean;
  onPick: (image: AssignmentImage) => void;
}) {
  return (
    <PickImage
      onPick={onPick}
      label={image ? `${label}: cambiar imagen` : `${label}: subir imagen`}
      title={image ? "Cambiar imagen" : undefined}
      className={cn(
        "grid h-16 w-24 shrink-0 place-items-center overflow-hidden border-2 bg-background text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground",
        image ? "p-1" : "border-dashed",
        correct ? "border-difficulty-easy/60" : "border-border/30",
      )}
    >
      {image ? (
        <img
          src={image.url}
          alt=""
          className="size-full object-contain mix-blend-multiply"
        />
      ) : (
        <span className="flex flex-col items-center gap-1">
          <ImagePlusIcon className="size-4" />
          Subir imagen
        </span>
      )}
    </PickImage>
  );
}
