/**
 * Reglas de la imagen chica dentro del texto, sin dependencias del editor: las
 * usa también la vista del estudiante, que no debe cargar Tiptap.
 */
export const SAFE_SRC =
  /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$/i;
export const MAX_SIDE = 256;
export const INLINE_IMAGE_HEIGHT = { min: 1, max: 4, default: 1.8 };

export function isInlineImageSrc(src: unknown): src is string {
  return typeof src === "string" && SAFE_SRC.test(src);
}

// El servidor cambia las imágenes grandes por su archivo público (en el
// dominio de imágenes o en /api/task-images) al mandar la tarea.
const PUBLISHED_SRC =
  /^https?:\/\/[^/\s]+\/(?:api\/)?task-images\/[a-f0-9]{24}\.(png|jpg|gif|webp)$/;

/** Lo que se puede mostrar: la imagen en línea o su archivo publicado. */
export function isRenderableInlineImageSrc(src: unknown): src is string {
  return (
    isInlineImageSrc(src) ||
    (typeof src === "string" && PUBLISHED_SRC.test(src))
  );
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
