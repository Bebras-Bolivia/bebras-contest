import { createContentBlock, type ContentBlock } from "@/lib/task-schema";

const INFORMATICS_SUFFIX = "-informatica";
const INFORMATICS =
  /^\*\*¿Qué tiene que ver con (?:la )?informática\?\*\*[ \t]*$/m;
const KEEP_LEARNING = /^\*\*Continúa aprendiendo\*\*[ \t]*$/m;

const isInformaticsBlock = (block: ContentBlock) =>
  block.id.endsWith(INFORMATICS_SUFFIX);

/**
 * Separa la solución de «¿Qué tiene que ver con informática?». La sección
 * es un bloque propio (id terminado en «-informatica») o, en las explicaciones
 * antiguas, lo que sigue a ese título dentro del texto.
 */
export function splitExplanation(blocks: ContentBlock[]) {
  const solution: ContentBlock[] = [];
  const informatics: ContentBlock[] = [];
  let inInformatics = false;

  for (const block of blocks) {
    if (isInformaticsBlock(block)) {
      informatics.push(block);
      continue;
    }
    if (block.type !== "text" || block.richText) {
      (block.type === "image" || !inInformatics ? solution : informatics).push(
        block,
      );
      continue;
    }

    let text = block.content;
    const cut = text.search(KEEP_LEARNING);
    if (cut >= 0) text = text.slice(0, cut);

    if (!inInformatics) {
      const start = text.search(INFORMATICS);
      if (start >= 0) {
        inInformatics = true;
        const before = text.slice(0, start).trim();
        const after = text.slice(start).replace(INFORMATICS, "").trim();
        if (before) solution.push({ ...block, content: before });
        if (after) {
          informatics.push({
            ...block,
            id: `${block.id}${INFORMATICS_SUFFIX}`,
            content: after,
          });
        }
        continue;
      }
    }

    text = text.trim();
    if (text)
      (inInformatics ? informatics : solution).push({
        ...block,
        content: text,
      });
  }

  return { solution, informatics };
}

export function emptyInformaticsBlock(prefix: string = crypto.randomUUID()) {
  return {
    ...createContentBlock("text"),
    id: `${prefix}${INFORMATICS_SUFFIX}`,
  };
}

/** Para el editor: la solución por un lado y un solo bloque de informática. */
export function splitExplanationForEditing(blocks: ContentBlock[]) {
  const { solution, informatics } = splitExplanation(blocks);
  const informaticsBlock =
    informatics.length === 1
      ? informatics[0]
      : informatics.length
        ? {
            ...emptyInformaticsBlock(),
            content: informatics.map((block) => block.content).join("\n\n"),
          }
        : emptyInformaticsBlock();
  return {
    solution: solution.length ? solution : [createContentBlock("text")],
    informaticsBlock,
  };
}
