"use client";

import { useState, type ReactNode } from "react";
import { XIcon } from "lucide-react";
import { type ContentBlock } from "@/lib/task-schema";
import { renderInlineText } from "@/lib/rich-text";
import { renderRichTextDocument } from "@/lib/rich-text-document";
import { hasTaskBlanks } from "@/lib/task-blank";

type TaskContentRendererProps = {
  blocks: ContentBlock[];
  className?: string;
  /** Piso de ancho de las imágenes. Las opciones de respuesta lo bajan a cero. */
  minImageWidth?: string;
  renderBlank?: (blankId: string) => ReactNode;
  /** En papel no hay celular: las imágenes no cambian con el ancho de la pantalla. */
  fixed?: boolean;
};

/** Alto máximo de una imagen que quedó en su tamaño automático (100 %). */
export const IMAGE_MAX_HEIGHT = "24rem";

function EnlargeableImage({
  src,
  alt,
  className,
  style,
}: {
  src: string;
  alt: string;
  className: string;
  style: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label="Ver la imagen más grande"
        onClick={() => setOpen(true)}
        className="flex w-full cursor-zoom-in justify-center outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <img alt={alt} className={className} src={src} style={style} />
      </button>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={alt}
          className="fixed inset-0 z-50 overflow-auto bg-background p-3"
          onClick={() => setOpen(false)}
        >
          <button
            type="button"
            aria-label="Cerrar"
            onClick={() => setOpen(false)}
            className="fixed top-3 right-3 z-10 grid size-10 place-items-center border-2 bg-background shadow-[3px_3px_0_0_var(--foreground)]"
          >
            <XIcon className="size-5" />
          </button>
          <img
            alt={alt}
            src={src}
            className="mx-auto block h-auto w-[220%] max-w-none sm:w-auto sm:max-w-full"
          />
        </div>
      )}
    </>
  );
}

function ImageView({
  enlargeable,
  ...image
}: {
  enlargeable: boolean;
  src: string;
  alt: string;
  className: string;
  style: React.CSSProperties;
}) {
  return enlargeable ? <EnlargeableImage {...image} /> : <img {...image} />;
}

export function TaskContentRenderer({
  blocks,
  className,
  minImageWidth = "6rem",
  renderBlank,
  fixed = false,
}: TaskContentRendererProps) {
  return (
    <div
      className={["flex flex-col gap-4", className].filter(Boolean).join(" ")}
    >
      {blocks.map((block) => {
        if (block.type === "image" && block.image) {
          return (
            <div key={block.id} className="flex justify-center py-2">
              <ImageView
                enlargeable={minImageWidth !== "0px" && !fixed}
                alt={block.image.name}
                className={
                  minImageWidth === "0px" || fixed
                    ? "block h-auto max-w-full"
                    : // En celular, a lo ancho de la pantalla con el mismo tope de alto.
                      "block h-auto max-w-full max-sm:!w-full max-sm:!max-h-[24rem] max-sm:object-contain"
                }
                src={block.image.url}
                style={
                  block.widthPercent >= 100
                    ? {
                        width: "100%",
                        maxHeight: IMAGE_MAX_HEIGHT,
                        objectFit: "contain",
                      }
                    : {
                        width: `min(100%, max(${block.widthPercent}%, ${minImageWidth}))`,
                      }
                }
              />
            </div>
          );
        }

        if (
          block.content.trim().length === 0 &&
          !hasTaskBlanks(block.richText)
        ) {
          return null;
        }

        return (
          <div
            key={block.id}
            className="whitespace-pre-wrap leading-7 [&_code]:rounded-sm [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.9em]"
          >
            {block.richText
              ? renderRichTextDocument(block.richText, { renderBlank })
              : renderInlineText(block.content)}
          </div>
        );
      })}
    </div>
  );
}
