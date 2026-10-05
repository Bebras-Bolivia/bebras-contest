/** Medidas de una hoja carta en píxeles CSS (96 por pulgada). */
const PAGE_WIDTH = 8.5 * 96;
const PAGE_HEIGHT = 11 * 96;
const TOP = 0.5 * 96;
const BOTTOM = 0.4 * 96;
const PIXEL_RATIO = 2;

/** Dónde se puede cortar una hoja que no cabe: entre bloques, nunca en un renglón. */
const BREAKS =
  ".pp-runninghead, .pp-task-title, .pp-content > div > *, .pp-challenge, .pp-answer, .pp-answer > *, .pp-options > *, .pp-footer";

/** Tramos [inicio, fin) de la hoja que van en cada página. */
function segments(sheet: HTMLElement) {
  const height = sheet.offsetHeight;
  if (height <= PAGE_HEIGHT + 1) return [[0, height]];
  const box = sheet.getBoundingClientRect();
  // La vista previa está achicada con transform: se vuelve a la medida real.
  const scale = box.height / height;
  const bottoms = [
    ...new Set(
      [...sheet.querySelectorAll<HTMLElement>(BREAKS)].map((element) =>
        Math.ceil((element.getBoundingClientRect().bottom - box.top) / scale),
      ),
    ),
  ].sort((left, right) => left - right);

  const result: number[][] = [];
  let start = 0;
  while (start < height) {
    const limit =
      start === 0 ? PAGE_HEIGHT - BOTTOM : start + PAGE_HEIGHT - TOP - BOTTOM;
    // El relleno de abajo de la hoja es blanco: puede caer en el margen.
    if (height - BOTTOM <= limit) {
      result.push([start, height]);
      break;
    }
    const end =
      [...bottoms].reverse().find((value) => value > start && value <= limit) ??
      limit;
    result.push([start, end]);
    start = end;
  }
  return result;
}

/**
 * Arma un PDF tamaño carta con las hojas de la vista previa. Cada hoja se
 * dibuja como imagen al doble de resolución; las que no caben siguen en la
 * página siguiente, con su margen de arriba.
 */
export async function sheetsToPdf(
  sheets: HTMLElement[],
  onProgress: (done: number, total: number) => void,
) {
  const [{ toCanvas, getFontEmbedCSS }, { PDFDocument }] = await Promise.all([
    import("html-to-image"),
    import("pdf-lib"),
  ]);
  const pdf = await PDFDocument.create();
  const fontEmbedCSS = sheets[0] ? await getFontEmbedCSS(sheets[0]) : "";

  for (const [index, sheet] of sheets.entries()) {
    onProgress(index, sheets.length);
    const canvas = await toCanvas(sheet, {
      pixelRatio: PIXEL_RATIO,
      backgroundColor: "#ffffff",
      fontEmbedCSS,
      style: { boxShadow: "none", margin: "0" },
    });
    for (const [start, end] of segments(sheet)) {
      const page = document.createElement("canvas");
      page.width = PAGE_WIDTH * PIXEL_RATIO;
      page.height = PAGE_HEIGHT * PIXEL_RATIO;
      const context = page.getContext("2d");
      if (!context) throw new Error("El navegador no pudo preparar el PDF.");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, page.width, page.height);
      const offset = start === 0 ? 0 : TOP;
      context.drawImage(
        canvas,
        0,
        start * PIXEL_RATIO,
        canvas.width,
        (end - start) * PIXEL_RATIO,
        0,
        offset * PIXEL_RATIO,
        page.width,
        (end - start) * PIXEL_RATIO,
      );
      const jpeg = await pdf.embedJpg(page.toDataURL("image/jpeg", 0.9));
      pdf
        .addPage([612, 792])
        .drawImage(jpeg, { x: 0, y: 0, width: 612, height: 792 });
    }
  }
  onProgress(sheets.length, sheets.length);
  return new Blob([(await pdf.save()) as BlobPart], {
    type: "application/pdf",
  });
}
