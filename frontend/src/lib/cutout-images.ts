import { useEffect, useState } from "react";

/**
 * Versión recortada de las imágenes con fondo blanco opaco: el blanco unido a
 * los bordes pasa a ser transparente. Así una pieza recortada del cuadernillo
 * no tapa el escenario con un rectángulo blanco, y conserva sus colores (con
 * `mix-blend-multiply` una flecha amarilla sobre una casilla azul se veía
 * verde). Devuelve `url original → data URL recortada`; las imágenes que ya
 * tienen transparencia no aparecen y se usan tal cual.
 */
export function useCutoutImages(urls: string[]) {
  const [cutouts, setCutouts] = useState<Readonly<Record<string, string>>>(
    {},
  );
  const sources = JSON.stringify([...new Set(urls)].sort());

  useEffect(() => {
    let active = true;
    const images = (JSON.parse(sources) as string[]).map((url) => {
      const image = new Image();
      image.onload = () => {
        if (!active) return;
        const cutout = cutOutWhite(image);
        if (cutout) setCutouts((current) => ({ ...current, [url]: cutout }));
      };
      image.src = url;
      return image;
    });
    return () => {
      active = false;
      for (const image of images) image.onload = null;
    };
  }, [sources]);

  return cutouts;
}

const nearWhite = (data: Uint8ClampedArray, index: number) =>
  data[index + 3] === 255 &&
  data[index] > 235 &&
  data[index + 1] > 235 &&
  data[index + 2] > 235;

function cutOutWhite(image: HTMLImageElement) {
  const { naturalWidth: width, naturalHeight: height } = image;
  if (!width || !height || width * height > 4_000_000) return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;

  let pixels: ImageData;
  try {
    context.drawImage(image, 0, 0);
    pixels = context.getImageData(0, 0, width, height);
  } catch {
    // Imagen de otro origen sin CORS: no se puede leer.
    return null;
  }
  const { data } = pixels;
  const corners = [0, width - 1, (height - 1) * width, height * width - 1];
  if (!corners.every((pixel) => nearWhite(data, pixel * 4))) return null;

  // Relleno desde los bordes: solo se borra el blanco del fondo, no el blanco
  // que queda dentro de la figura.
  const seen = new Uint8Array(width * height);
  const stack: number[] = [];
  const push = (pixel: number) => {
    if (seen[pixel] || !nearWhite(data, pixel * 4)) return;
    seen[pixel] = 1;
    stack.push(pixel);
  };
  for (let x = 0; x < width; x++) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    push(y * width);
    push(y * width + width - 1);
  }
  while (stack.length) {
    const pixel = stack.pop()!;
    data[pixel * 4 + 3] = 0;
    const x = pixel % width;
    if (x > 0) push(pixel - 1);
    if (x < width - 1) push(pixel + 1);
    if (pixel >= width) push(pixel - width);
    if (pixel < (height - 1) * width) push(pixel + width);
  }

  context.putImageData(pixels, 0, 0);
  return canvas.toDataURL("image/png");
}
