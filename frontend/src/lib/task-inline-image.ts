import { Node as TiptapNode, type JSONContent } from "@tiptap/core";
import type { Editor } from "@tiptap/react";

/**
 * Imagen chica dentro del texto, como los dibujos del cuadernillo («Alicia
 * quiere [chile], [champiñón] y [queso]»). Se llama `image` porque así la deja
 * pasar el backend al proyectar la tarea. Su alto va en `em`, relativo a la
 * letra, para que se vea igual en el editor y en la vista del estudiante.
 */
const SAFE_SRC = /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$/i;
const MAX_SIDE = 256;
export const INLINE_IMAGE_HEIGHT = { min: 1, max: 4, default: 1.8 };

export function isInlineImageSrc(src: unknown): src is string {
  return typeof src === "string" && SAFE_SRC.test(src);
}

export function inlineImageHeight(value: unknown) {
  if (value === null || value === undefined || value === "")
    return INLINE_IMAGE_HEIGHT.default;
  const height = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(height)) return INLINE_IMAGE_HEIGHT.default;
  return Math.min(
    INLINE_IMAGE_HEIGHT.max,
    Math.max(INLINE_IMAGE_HEIGHT.min, Math.round(height * 20) / 20),
  );
}

export const TaskInlineImage = TiptapNode.create({
  name: "image",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      src: { default: null },
      alt: { default: "" },
      height: { default: null },
    };
  },
  parseHTML() {
    return [
      {
        tag: "img[data-task-inline-image]",
        getAttrs: (element) =>
          isInlineImageSrc(element.getAttribute("src"))
            ? {
                src: element.getAttribute("src"),
                alt: element.getAttribute("alt") ?? "",
                height: element.getAttribute("data-height")
                  ? inlineImageHeight(element.getAttribute("data-height"))
                  : null,
              }
            : false,
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const height = inlineImageHeight(HTMLAttributes.height);
    return [
      "img",
      {
        src: HTMLAttributes.src,
        alt: HTMLAttributes.alt,
        "data-task-inline-image": "",
        "data-height": String(height),
        class: "task-inline-image",
        style: `height: ${height}em`,
        draggable: "false",
      },
    ];
  },
  renderText({ node }) {
    return node.attrs.alt || "imagen";
  },
  addNodeView() {
    return ({ node: initialNode, getPos, editor }) => {
      let node = initialNode;
      const wrapper = document.createElement("span");
      wrapper.className = "task-inline-image-view";
      wrapper.contentEditable = "false";
      const image = document.createElement("img");
      image.className = "task-inline-image";
      image.draggable = false;
      const handle = document.createElement("span");
      handle.className = "task-inline-image-handle";
      handle.title = "Arrastra para cambiar el tamaño";
      wrapper.append(image, handle);

      const paint = () => {
        image.src = node.attrs.src ?? "";
        image.alt = node.attrs.alt ?? "";
        image.style.height = `${inlineImageHeight(node.attrs.height)}em`;
      };
      paint();

      handle.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const fontSize = parseFloat(getComputedStyle(wrapper).fontSize) || 16;
        const ratio =
          image.naturalWidth && image.naturalHeight
            ? image.naturalWidth / image.naturalHeight
            : 1;
        const startX = event.clientX;
        const startY = event.clientY;
        const startHeight = inlineImageHeight(node.attrs.height);
        let next = startHeight;
        handle.setPointerCapture(event.pointerId);

        const move = (moveEvent: PointerEvent) => {
          // Tirar hacia la derecha o hacia abajo agranda, como en las imágenes
          // del enunciado; el ancho sigue a la proporción de la imagen.
          const byWidth = (moveEvent.clientX - startX) / ratio;
          const byHeight = moveEvent.clientY - startY;
          const delta =
            Math.abs(byWidth) > Math.abs(byHeight) ? byWidth : byHeight;
          next = inlineImageHeight(startHeight + delta / fontSize);
          image.style.height = `${next}em`;
        };
        const finish = () => {
          handle.removeEventListener("pointermove", move);
          handle.removeEventListener("pointerup", finish);
          handle.removeEventListener("pointercancel", finish);
          const position = typeof getPos === "function" ? getPos() : undefined;
          if (typeof position !== "number" || next === startHeight) {
            paint();
            return;
          }
          editor.view.dispatch(
            editor.state.tr.setNodeMarkup(position, undefined, {
              ...node.attrs,
              height: next,
            }),
          );
        };
        handle.addEventListener("pointermove", move);
        handle.addEventListener("pointerup", finish);
        handle.addEventListener("pointercancel", finish);
      });

      return {
        dom: wrapper,
        update(updated) {
          if (updated.type.name !== "image") return false;
          node = updated;
          paint();
          return true;
        },
        selectNode() {
          wrapper.classList.add("ProseMirror-selectednode");
        },
        deselectNode() {
          wrapper.classList.remove("ProseMirror-selectednode");
        },
        stopEvent(event) {
          return event.target === handle;
        },
        ignoreMutation() {
          return true;
        },
      };
    };
  },
});

export function hasInlineImages(document: JSONContent | undefined): boolean {
  function visit(node: JSONContent, depth: number): boolean {
    if (depth > 20) return false;
    if (node.type === "image") return true;
    return (node.content ?? []).some((child) => visit(child, depth + 1));
  }
  return document ? visit(document, 0) : false;
}

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("No se pudo leer la imagen."));
    reader.onerror = () =>
      reject(reader.error ?? new Error("No se pudo leer la imagen."));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("No se pudo abrir la imagen."));
    image.src = src;
  });
}

/** Achica la imagen para que el texto no pese: dentro de la línea se ve chica. */
export async function inlineImageFromFile(file: File) {
  const original = await readAsDataUrl(file);
  const image = await loadImage(original);
  const scale = Math.min(1, MAX_SIDE / Math.max(image.width, image.height));
  let src = original;
  if (scale < 1 || !isInlineImageSrc(original)) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    canvas
      .getContext("2d")
      ?.drawImage(image, 0, 0, canvas.width, canvas.height);
    src = canvas.toDataURL("image/webp", 0.92);
  }
  if (!isInlineImageSrc(src)) throw new Error("Ese archivo no es una imagen.");
  const alt = file.name
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .trim()
    .slice(0, 60);
  return { src, alt };
}

/** Pone la imagen donde está el cursor del párrafo que tuvo el foco. */
export function insertInlineImage(
  editor: Editor,
  image: { src: string; alt: string },
) {
  editor.chain().focus().insertContent({ type: "image", attrs: image }).run();
}
