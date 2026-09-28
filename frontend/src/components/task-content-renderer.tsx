"use client";

import type { ReactNode } from "react";
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
};

/** Alto máximo de una imagen que quedó en su tamaño automático (100 %). */
export const IMAGE_MAX_HEIGHT = "24rem";

export function TaskContentRenderer({
  blocks,
  className,
  minImageWidth = "16rem",
  renderBlank,
}: TaskContentRendererProps) {
  return (
    <div
      className={["flex flex-col gap-4", className].filter(Boolean).join(" ")}
    >
      {blocks.map((block) => {
        if (block.type === "image" && block.image) {
          return (
            <div key={block.id} className="flex justify-center py-2">
              <img
                alt={block.image.name}
                className={
                  minImageWidth === "0px"
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
