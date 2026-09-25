import type { PlayTask } from "./types";
import { parseHotspotConfig } from "./image-hotspot";
import { readMultipleChoiceLayout } from "./config";
import { parseMcCorrectness } from "./multiple-choice";
import { parseAssignmentConfig } from "./assignment-answers";

/** Inline blanks contain only a location ID, never a stored or correct answer. */
function publicDocument(value: unknown, depth = 0): unknown {
  if (depth > 20 || !value || typeof value !== "object" || Array.isArray(value))
    return null;
  const node = value as Record<string, unknown>;
  const attributes: Record<string, string[]> = {
    doc: [],
    text: [],
    hardBreak: [],
    taskBlank: ["blankId"],
    paragraph: ["indent"],
    bulletList: [],
    orderedList: ["start"],
    listItem: [],
    image: ["src", "alt", "title", "width", "height"],
    table: [],
    tableRow: [],
    tableCell: ["colspan", "rowspan", "colwidth"],
    tableHeader: ["colspan", "rowspan", "colwidth"],
  };
  if (typeof node.type !== "string" || !Object.hasOwn(attributes, node.type))
    return null;
  const attrs =
    node.attrs && typeof node.attrs === "object" && !Array.isArray(node.attrs)
      ? (node.attrs as Record<string, unknown>)
      : {};
  if (node.type === "taskBlank")
    return {
      type: "taskBlank",
      attrs: {
        blankId: typeof attrs.blankId === "string" ? attrs.blankId : "",
      },
    };
  const safeAttrs = Object.fromEntries(
    attributes[node.type].flatMap((key) => {
      const value = attrs[key];
      if (
        (["src", "alt", "title"].includes(key) && typeof value === "string") ||
        (["indent", "start", "width", "height", "colspan", "rowspan"].includes(
          key,
        ) &&
          typeof value === "number" &&
          Number.isFinite(value)) ||
        (key === "colwidth" &&
          Array.isArray(value) &&
          value.every(
            (width) => typeof width === "number" && Number.isFinite(width),
          ))
      )
        return [[key, value]];
      return [];
    }),
  );
  return {
    type: node.type,
    ...(node.type === "text" && typeof node.text === "string"
      ? { text: node.text }
      : {}),
    ...(Object.keys(safeAttrs).length ? { attrs: safeAttrs } : {}),
    ...(node.type === "text" && Array.isArray(node.marks)
      ? {
          marks: node.marks.flatMap((mark: unknown) => {
            if (!mark || typeof mark !== "object" || Array.isArray(mark))
              return [];
            const { type, attrs } = mark as Record<string, unknown>;
            if (
              ["bold", "italic", "underline", "strike", "code"].includes(
                type as string,
              )
            )
              return [{ type }];
            if (type !== "link") return [];
            const link =
              attrs && typeof attrs === "object" && !Array.isArray(attrs)
                ? (attrs as Record<string, unknown>)
                : {};
            return [
              {
                type,
                attrs: Object.fromEntries(
                  ["href", "target", "rel", "title"].flatMap((key) =>
                    typeof link[key] === "string" ? [[key, link[key]]] : [],
                  ),
                ),
              },
            ];
          }),
        }
      : {}),
    ...(node.type === "paragraph" && Object.hasOwn(attrs, "indent")
      ? {
          attrs: {
            ...safeAttrs,
            indent:
              typeof attrs.indent === "number" && Number.isFinite(attrs.indent)
                ? Math.min(8, Math.max(0, Math.trunc(attrs.indent)))
                : 0,
          },
        }
      : {}),
    ...(!["text", "hardBreak", "image"].includes(node.type) &&
    Array.isArray(node.content)
      ? {
          content: node.content
            .map((child) => publicDocument(child, depth + 1))
            .filter((child) => child !== null),
        }
      : {}),
  };
}

function publicImage(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const image = value as Record<string, unknown>;
  return Object.fromEntries(
    ["id", "name", "url"].flatMap((key) =>
      typeof image[key] === "string" ? [[key, image[key]]] : [],
    ),
  );
}

/** El fondo del arrastre lleva además el ancho con que se muestra (20-100 %). */
function publicBackground(value: unknown): unknown {
  const image = publicImage(value);
  if (!image) return null;
  const widthPercent = (value as Record<string, unknown>).widthPercent;
  return typeof widthPercent === "number" && Number.isFinite(widthPercent)
    ? { ...(image as object), widthPercent }
    : image;
}

function publicBlocks(value: unknown): unknown {
  if (!Array.isArray(value)) return [];
  return value.flatMap((value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const block = value as Record<string, unknown>;
    return [
      {
        ...Object.fromEntries(
          ["id", "type", "content"].flatMap((key) =>
            typeof block[key] === "string" ? [[key, block[key]]] : [],
          ),
        ),
        ...(typeof block.widthPercent === "number" &&
        Number.isFinite(block.widthPercent)
          ? { widthPercent: block.widthPercent }
          : {}),
        ...(Object.hasOwn(block, "image")
          ? { image: publicImage(block.image) }
          : {}),
        ...(Object.hasOwn(block, "richText")
          ? { richText: publicDocument(block.richText) }
          : {}),
      },
    ];
  });
}

function seedFromText(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash || 1;
}

function shuffleWithSeed<T>(input: T[], seed: number) {
  const result = [...input];
  let state = seed;
  for (let i = result.length - 1; i > 0; i -= 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const j = state % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function renderSafeTask(
  contestTask: { position: number },
  task: PlayTask,
) {
  let answers = task.answers.map((answer) => ({
    id: answer.id,
    blocks: publicBlocks(answer.blocks),
  }));
  if (task.multipleChoiceOrderMode === "random") {
    answers = shuffleWithSeed(answers, seedFromText(task.id));
  }

  return {
    taskId: task.id,
    position: contestTask.position,
    title: task.title,
    bodyBlocks: publicBlocks(task.bodyBlocks),
    challengeBlocks: publicBlocks(task.challengeBlocks),
    answerType: task.answerType,
    // The current types use their existing fields. Future types must explicitly
    // project their validated configuration here, never the private answerKey.
    answerConfig:
      task.answerType === "image_hotspot"
        ? parseHotspotConfig(task.answerConfig)
        : task.answerType === "state_grid" || task.answerType === "text_cloze"
          ? parseAssignmentConfig(task.answerType, task.answerConfig)
          : task.answerType === "multiple_choice"
            ? {
                multipleChoiceLayout: readMultipleChoiceLayout(
                  task.answerConfig,
                ),
              }
            : {},
    multipleChoiceOrderMode: task.multipleChoiceOrderMode,
    multipleChoiceMode: parseMcCorrectness(task.correctAnswerId).mode,
    answers,
    dragDropBackground: publicBackground(task.dragDropBackground),
    dragDropItems: task.dragDropItems.map((item) => ({
      id: item.id,
      label: item.label,
      image: publicImage(item.image),
      widthPercent: item.widthPercent,
    })),
    dragDropTargets: [...task.dragDropTargets]
      .sort(
        (left, right) =>
          left.x - right.x ||
          left.y - right.y ||
          left.id.localeCompare(right.id),
      )
      .map((target) => ({
        id: target.id,
        x: target.x,
        y: target.y,
        snapRadius: target.snapRadius,
      })),
  };
}
