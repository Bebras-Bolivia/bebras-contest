/**
 * Las imágenes de las tareas viven como data URL dentro de la tarea. Al
 * mandarlas al estudiante se cambian por un archivo en R2 con caché permanente:
 * el navegador las guarda, la respuesta pesa menos y el Worker no serializa
 * megas en cada carga. La base de datos no cambia.
 */
export type ImageStore = { bucket: R2Bucket; baseUrl: string };

const DATA_IMAGE =
  /^data:(image\/(?:png|jpeg|jpg|gif|webp));base64,([A-Za-z0-9+/=]+)$/;
const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};
// Las chicas quedan en línea: un archivo aparte costaría más que lo que pesan.
const MIN_LENGTH = 4096;

export const TASK_IMAGE_FILE = /^[a-f0-9]{24}\.(png|jpg|gif|webp)$/;

export function taskImageKey(file: string) {
  return `task-images/${file}`;
}

const fileByData = new Map<string, string>();
const stored = new Set<string>();

async function fileFor(dataUrl: string, bucket: R2Bucket) {
  const known = fileByData.get(dataUrl);
  if (known) return known;
  const match = DATA_IMAGE.exec(dataUrl);
  if (!match) return null;
  const [, type, base64] = match;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(base64),
  );
  const hex = [...new Uint8Array(digest).slice(0, 12)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const file = `${hex}.${EXTENSIONS[type]}`;
  if (!stored.has(file)) {
    const key = taskImageKey(file);
    if (!(await bucket.head(key))) {
      await bucket.put(key, Buffer.from(base64, "base64"), {
        httpMetadata: {
          contentType: type === "image/jpg" ? "image/jpeg" : type,
          cacheControl: "public, max-age=31536000, immutable",
        },
      });
    }
    stored.add(file);
  }
  if (fileByData.size >= 2000) fileByData.clear();
  fileByData.set(dataUrl, file);
  return file;
}

/** Copia del valor con cada imagen grande cambiada por su archivo público. */
export async function externalizeTaskImages<T>(
  value: T,
  store: ImageStore | null,
): Promise<T> {
  if (!store) return value;
  const walk = async (node: unknown): Promise<unknown> => {
    if (typeof node === "string") {
      if (node.length < MIN_LENGTH || !node.startsWith("data:image/")) {
        return node;
      }
      const file = await fileFor(node, store.bucket).catch(() => null);
      return file ? `${store.baseUrl}/${file}` : node;
    }
    if (Array.isArray(node)) {
      const out: unknown[] = [];
      for (const item of node) out.push(await walk(item));
      return out;
    }
    if (node instanceof Date) return node;
    if (node && typeof node === "object") {
      // Las interactivas precargan sus recursos desde data URL: quedan igual.
      const interactive =
        (node as { answerType?: unknown }).answerType === "interactive";
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(node)) {
        out[key] =
          interactive && key === "answerConfig" ? item : await walk(item);
      }
      return out;
    }
    return node;
  };
  return (await walk(value)) as T;
}
