import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  interactiveEngineKey,
  parseInteractiveConfig,
  parseInteractiveKey,
  type InteractiveElement,
} from "../backend/src/lib/task-answers/interactive";
import { ROOT, isScriptMain, prismaDate } from "./cloudflare-seed";
import type { LocalD1 } from "./cloudflare-local-d1";

const SOURCE = join(ROOT, "tareas-2026-ville/interactivas-nuevas");
const ENGINE_FILES = [
  join(SOURCE, "_motor/combined.js"),
  join(ROOT, "tareas-2026-ville/interactivas/_motor/combined.js"),
];
const ENGINE_NAME = "bebraslodge";
const ROW_MAX_BYTES = 1_900_000;
const VILLE_ORIGIN = "https://ville.utu.fi";
const CUSTOM_VALIDATORS = new Set(["2026-MX-02b", "2026-CH-08"]);
const COUNTRIES: Record<string, string | null> = {
  AT: "Austria",
  AU: "Australia",
  CH: "Suiza",
  DE: "Alemania",
  LT: "Lituania",
  ME: "Montenegro",
  MX: "México",
  NL: "Países Bajos",
  NO: null,
  SA: "Arabia Saudita",
  SP: "España",
  TR: "Turquía",
  US: "EE.UU.",
  UY: "Uruguay",
};
const EMPTY_DIFFICULTIES = JSON.stringify({
  "5–8": "",
  "8–10": "",
  "10–12": "",
  "12–14": "",
  "14–16": "",
  "17–18": "",
});
const HELP = `bun x tsx scripts/cargar-interactivas-ville.ts --target local [--config wrangler.jsonc] [--actualizar] [--enunciados] [--check]

Lee tareas-2026-ville/interactivas-nuevas/<CÓDIGO>/tarea.json, sube el motor de
Bebras Lodge a R2 (interactive/engines/bebraslodge-<sha12>.js) y carga cada
tarea en TaskDraft como answerType "interactive": privada, sin dificultad ni
explicación, área «Algoritmos y programación».

  --actualizar  En las filas interactivas que ya existen reemplaza el código y
                las respuestas (answerConfig y answerKey). Sin esto solo inserta
                las que faltan. Nunca toca dificultad, áreas, explicación ni
                visibilidad.
  --enunciados  Con --actualizar, también rehace título y enunciado desde ViLLE.
  --check       Arma las filas e informa tamaños, sin escribir nada.

Si el id ville-<código> ya lo usa una tarea de otro tipo, la interactiva se
carga como ville-<código>-interactiva y la otra no se toca.

Remoto (no se ejecuta desde aquí): 1) subir el motor con
  wrangler r2 object put bebras-uploads-<env>/interactive/engines/bebraslodge-<sha12>.js --file <combined.js> --content-type text/javascript --remote
y 2) mandar cada fila por la API REST de D1 con parámetros, como
../scripts/cargar-tareas-remoto.ts (las filas pasan el tope de 100 KB del SQL en línea).`;

type Options = {
  config: string;
  update: boolean;
  statements: boolean;
  check: boolean;
};

type VilleTask = {
  code: string;
  titleEs?: string;
  descriptionHtml?: string[];
  ville: {
    title?: string;
    acceptedAnswers?: string[];
    task: Array<{ type: string; content: string }>;
  };
  files?: Record<string, { file: string; type: string }>;
};

type Block = {
  id: string;
  type: "text" | "image" | "challenge";
  content: string;
  image: { id: string; name: string; url: string } | null;
  widthPercent: number;
  richText?: unknown;
};

type Sharp = (
  input: Buffer,
  options?: { density?: number },
) => {
  metadata(): Promise<{ width?: number; height?: number }>;
  resize(options: { width?: number; height?: number }): {
    png(): { toBuffer(): Promise<Buffer> };
  };
};

function parseArgs(args: string[]): Options {
  let target = "";
  let config = resolve(ROOT, "wrangler.jsonc");
  const flags = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--target") target = args[++i] ?? "";
    else if (arg === "--config") config = resolve(ROOT, args[++i] ?? "");
    else if (["--actualizar", "--enunciados", "--check"].includes(arg))
      flags.add(arg);
    else throw new Error(`Parámetro desconocido: ${arg}. Consulta --help.`);
  }
  if (target !== "local") {
    throw new Error(
      "Solo se carga en local (--target local). El remoto está descrito en --help.",
    );
  }
  if (flags.has("--enunciados") && !flags.has("--actualizar")) {
    throw new Error("--enunciados va junto con --actualizar.");
  }
  return {
    config,
    update: flags.has("--actualizar"),
    statements: flags.has("--enunciados"),
    check: flags.has("--check"),
  };
}

const sharp = createRequire(join(ROOT, "frontend/package.json"))(
  "sharp",
) as Sharp;

function fileFor(task: VilleTask, dir: string, path: string) {
  const files = task.files ?? {};
  const key = path.startsWith(VILLE_ORIGIN)
    ? path.slice(VILLE_ORIGIN.length)
    : path;
  const entry = files[key];
  if (!entry) return null;
  const file = join(dir, "files", entry.file);
  return existsSync(file)
    ? { name: entry.file, type: entry.type, data: readFileSync(file) }
    : null;
}

function extensionOf(type: string, name: string) {
  if (type === "image/svg+xml") return "svg";
  if (type === "image/png") return "png";
  if (type === "image/jpeg") return "jpg";
  if (type === "image/gif") return "gif";
  return name.split(".").pop()?.toLowerCase() ?? "bin";
}

async function rasterize(
  file: { type: string; data: Buffer },
  size: { width?: number; height?: number },
) {
  if (file.type !== "image/svg+xml") {
    return `data:${file.type};base64,${file.data.toString("base64")}`;
  }
  const meta = await sharp(file.data).metadata();
  const scale = size.width
    ? size.width / (meta.width || size.width)
    : (size.height ?? 100) / (meta.height || size.height || 100);
  const density = Math.min(2400, Math.max(72, 72 * scale));
  const png = await sharp(file.data, { density })
    .resize(size.width ? { width: size.width } : { height: size.height })
    .png()
    .toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

function buildElements(task: VilleTask, dir: string) {
  const warnings: string[] = [];
  const files = Object.entries(task.files ?? {}).sort(
    ([left], [right]) => right.length - left.length,
  );
  const embed = (content: string) => {
    let result = content;
    for (const [path, entry] of files) {
      const file = join(dir, "files", entry.file);
      if (!existsSync(file) || entry.type.includes("javascript")) continue;
      const url = `data:${entry.type};base64,${readFileSync(file).toString("base64")}#.${extensionOf(entry.type, entry.file)}`;
      result = result.split(`${VILLE_ORIGIN}${path}`).join(url).split(path).join(url);
    }
    return result.replace(/"(\/[^"\\]+\.(js|css))"/g, (whole, path: string, ext: string) => {
      const asset = fileFor(task, dir, `/static_resources/${path}`);
      if (asset) {
        return `"data:text/${ext === "js" ? "javascript" : "css"};base64,${asset.data.toString("base64")}#.${ext}"`;
      }
      warnings.push(`recurso ${path} sin archivo; va vacío`);
      return `"data:text/${ext === "js" ? "javascript" : "css"};base64,#.${ext}"`;
    });
  };
  const elements: InteractiveElement[] = [];
  for (const element of task.ville.task) {
    if (element.type === "image") continue;
    if (element.type === "javascript" && /^\s*var grader\s*=/.test(element.content))
      continue;
    if (element.type === "library") {
      const library = fileFor(task, dir, element.content);
      if (!library) {
        warnings.push(`librería sin archivo, se omite: ${element.content}`);
        continue;
      }
      if (!/\.js$/i.test(library.name)) {
        warnings.push(`librería que no es JavaScript, se omite: ${library.name}`);
        continue;
      }
      elements.push({
        type: "library",
        content: `data:text/javascript;base64,${library.data.toString("base64")}`,
      });
      continue;
    }
    if (element.type !== "html" && element.type !== "javascript") {
      warnings.push(`elemento ${element.type} sin soporte, se omite`);
      continue;
    }
    elements.push({ type: element.type, content: embed(element.content) });
  }
  return { elements, warnings };
}

function dimension(task: VilleTask, name: "width" | "height") {
  for (const element of task.ville.task) {
    if (element.type !== "javascript") continue;
    const match = new RegExp(`"${name}":\\["number","(\\d+)"\\]`).exec(
      element.content,
    );
    if (match) return Number(match[1]);
  }
  return 500;
}

const ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decode(text: string) {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity[0] === "#") {
      const code =
        entity[1].toLowerCase() === "x"
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[entity.toLowerCase()] ?? whole;
  });
}

type Piece =
  | { kind: "text"; text: string; bold: boolean; italic: boolean }
  | { kind: "break" }
  | { kind: "image"; src: string; width: number; height: number };

type Paragraph = { prefix: string; pieces: Piece[] };

function parseDescription(html: string): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  const lists: Array<{ ordered: boolean; count: number }> = [];
  const state: { current: Paragraph | null } = { current: null };
  let bold = 0;
  let italic = 0;
  const open = (prefix = "") => {
    if (state.current?.pieces.length) paragraphs.push(state.current);
    state.current = { prefix, pieces: [] };
  };
  const close = () => {
    if (state.current?.pieces.length) paragraphs.push(state.current);
    state.current = null;
  };
  const push = (piece: Piece) => {
    state.current ??= { prefix: "", pieces: [] };
    state.current.pieces.push(piece);
  };
  for (const token of html.matchAll(/<(\/?)([a-z0-9]+)([^>]*)>|([^<]+)/gi)) {
    if (token[4] !== undefined) {
      const text = decode(token[4]);
      if (text.trim() || state.current?.pieces.length)
        push({ kind: "text", text, bold: bold > 0, italic: italic > 0 });
      continue;
    }
    const closing = token[1] === "/";
    const tag = token[2].toLowerCase();
    const attrs = token[3];
    if (tag === "p" || tag === "div") closing ? close() : open();
    else if (tag === "ul" || tag === "ol") {
      if (closing) lists.pop();
      else lists.push({ ordered: tag === "ol", count: 0 });
      close();
    } else if (tag === "li") {
      if (closing) close();
      else {
        const list = lists.at(-1);
        if (list) list.count += 1;
        open(list?.ordered ? `${list.count}. ` : "• ");
      }
    } else if (tag === "strong" || tag === "b") bold += closing ? -1 : 1;
    else if (tag === "em" || tag === "i") italic += closing ? -1 : 1;
    else if (tag === "br") push({ kind: "break" });
    else if (tag === "img") {
      const src = /src="([^"]+)"/.exec(attrs)?.[1] ?? "";
      const style = /style="([^"]+)"/.exec(attrs)?.[1] ?? "";
      const width = Number(/width:\s*(\d+)px/.exec(style)?.[1] ?? 0);
      const height = Number(/height:\s*(\d+)px/.exec(style)?.[1] ?? 0);
      push({ kind: "image", src, width, height });
    }
  }
  close();
  return paragraphs;
}

function inlineHeight(px: number) {
  return Math.min(4, Math.max(2.4, Math.floor((px / 8.8) * 10) / 10));
}

function markdown(text: string, bold: boolean, italic: boolean) {
  const inner = text.trim();
  if (!inner || !/[\p{L}\p{N}]/u.test(inner)) return text;
  const lead = text.slice(0, text.length - text.trimStart().length);
  const tail = text.slice(text.trimEnd().length);
  let marked = inner;
  if (italic) marked = `_${marked}_`;
  if (bold) marked = `**${marked}**`;
  return `${lead}${marked}${tail}`;
}

function tidy(text: string) {
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function buildStatement(task: VilleTask, dir: string) {
  const warnings: string[] = [];
  const blocks: Block[] = [];
  const html = (task.descriptionHtml ?? []).join("\n");
  for (const paragraph of parseDescription(html)) {
    const images = paragraph.pieces.filter(
      (piece): piece is Extract<Piece, { kind: "image" }> =>
        piece.kind === "image",
    );
    const hasText = paragraph.pieces.some(
      (piece) => piece.kind === "text" && piece.text.trim(),
    );
    const onlyBigImages =
      !hasText &&
      images.length > 0 &&
      (images.length > 1 || images[0].height > 50);

    if (onlyBigImages) {
      for (const image of images) {
        const file = fileFor(task, dir, image.src);
        if (!file) {
          warnings.push(`imagen del enunciado sin archivo: ${image.src}`);
          continue;
        }
        const width = image.width || 300;
        blocks.push({
          id: randomUUID(),
          type: "image",
          content: "",
          image: {
            id: randomUUID(),
            name: file.name.replace(/\.svg$/i, ".png"),
            url: await rasterize(file, { width: width * 2 }),
          },
          widthPercent: Math.min(100, Math.max(10, Math.round(width / 7.2))),
        });
      }
      continue;
    }

    let content = paragraph.prefix;
    const inline: unknown[] = paragraph.prefix
      ? [{ type: "text", text: paragraph.prefix }]
      : [];
    let usesRichText = false;
    for (const piece of paragraph.pieces) {
      if (piece.kind === "text") {
        content += markdown(piece.text, piece.bold, piece.italic);
        const text = piece.text.replace(/ /g, " ");
        if (text) {
          const marks = [
            ...(piece.bold && text.trim() ? [{ type: "bold" }] : []),
            ...(piece.italic && text.trim() ? [{ type: "italic" }] : []),
          ];
          inline.push({ type: "text", text, ...(marks.length ? { marks } : {}) });
        }
      } else if (piece.kind === "break") {
        content += "\n";
        inline.push({ type: "hardBreak" });
      } else {
        const file = fileFor(task, dir, piece.src);
        if (!file) {
          warnings.push(`imagen del enunciado sin archivo: ${piece.src}`);
          continue;
        }
        const height = inlineHeight(piece.height || 30);
        usesRichText = true;
        inline.push({
          type: "image",
          attrs: {
            src: await rasterize(file, { height: Math.round(height * 16 * 3) }),
            alt: "",
            height,
          },
        });
      }
    }
    const text = tidy(content);
    if (!text && !usesRichText) continue;
    blocks.push({
      id: randomUUID(),
      type: "text",
      content: text || "imagen",
      image: null,
      widthPercent: 100,
      ...(usesRichText
        ? {
            richText: {
              type: "doc",
              content: [{ type: "paragraph", content: compactInline(inline) }],
            },
          }
        : {}),
    });
  }
  if (blocks.length === 0) {
    blocks.push({
      id: randomUUID(),
      type: "text",
      content: "Lee las instrucciones en la actividad interactiva.",
      image: null,
      widthPercent: 100,
    });
  }
  return { blocks, warnings };
}

function compactInline(nodes: unknown[]) {
  const result: Array<Record<string, unknown>> = [];
  for (const node of nodes as Array<Record<string, unknown>>) {
    const previous = result.at(-1);
    if (node.type === "text") {
      const text = String(node.text).replace(/\s+/g, " ");
      if (
        previous?.type === "text" &&
        JSON.stringify(previous.marks ?? []) === JSON.stringify(node.marks ?? [])
      ) {
        previous.text = String(previous.text) + text;
        continue;
      }
      result.push({ ...node, text });
    } else result.push(node);
  }
  const first = result[0];
  if (first?.type === "text") first.text = String(first.text).trimStart();
  const last = result.at(-1);
  if (last?.type === "text") last.text = String(last.text).trimEnd();
  return result.filter((node) => node.type !== "text" || node.text !== "");
}

function rowBytes(row: Record<string, unknown>) {
  return Object.values(row).reduce<number>(
    (size, value) =>
      size + (typeof value === "string" ? Buffer.byteLength(value) : 8) + 9,
    16,
  );
}

async function buildTask(dir: string, engineVersion: string) {
  const task = JSON.parse(
    readFileSync(join(dir, "tarea.json"), "utf8"),
  ) as VilleTask;
  const code = task.code;
  const { elements, warnings } = buildElements(task, dir);
  const answerConfig = parseInteractiveConfig({
    version: 1,
    engine: { name: ENGINE_NAME, version: engineVersion },
    width: dimension(task, "width"),
    height: dimension(task, "height"),
    elements,
  });
  const answerKey = parseInteractiveKey({
    version: 1,
    validator: CUSTOM_VALIDATORS.has(code) ? code : "accepted-answers",
    acceptedAnswers: task.ville.acceptedAnswers ?? [],
  });
  const statement = await buildStatement(task, dir);
  const country = code.split("-")[1] ?? "";
  return {
    code,
    warnings: [...warnings, ...statement.warnings],
    fields: {
      title: (task.titleEs || task.ville.title || code).trim(),
      country: COUNTRIES[country] ?? null,
      year: Number(code.slice(0, 4)) || null,
      sourceTaskCode: code,
      bodyBlocks: JSON.stringify(statement.blocks),
      answerConfig: JSON.stringify(answerConfig),
      answerKey: JSON.stringify(answerKey),
    },
  };
}

async function main(args = process.argv.slice(2)) {
  if (args.includes("--help")) {
    console.log(HELP);
    return;
  }
  const options = parseArgs(args);
  const engineFile = ENGINE_FILES.find((file) => existsSync(file));
  if (!engineFile) throw new Error("No está el motor combined.js de Lodge.");
  const engine = readFileSync(engineFile);
  const engineVersion = createHash("sha256")
    .update(engine)
    .digest("hex")
    .slice(0, 12);
  const engineKey = interactiveEngineKey({
    name: ENGINE_NAME,
    version: engineVersion,
  });

  const codes = readdirSync(SOURCE, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        existsSync(join(SOURCE, entry.name, "tarea.json")),
    )
    .map((entry) => entry.name)
    .sort();
  const tasks = [];
  for (const code of codes) tasks.push(await buildTask(join(SOURCE, code), engineVersion));

  console.log(
    `Motor ${engineKey} (${engine.length} bytes); ${tasks.length} tareas en ${SOURCE}.`,
  );

  process.env.WRANGLER_SEND_METRICS = "false";
  process.env.WRANGLER_WRITE_LOGS = "false";
  const { getPlatformProxy } = await import("wrangler");
  const platform = await getPlatformProxy<{
    DB: LocalD1;
    UPLOADS: {
      head(key: string): Promise<unknown>;
      put(
        key: string,
        value: Uint8Array,
        options: { httpMetadata: { contentType: string } },
      ): Promise<unknown>;
    };
  }>({
    configPath: options.config,
    persist: { path: resolve(dirname(options.config), ".wrangler/state/v3") },
    remoteBindings: false,
  });

  try {
    const { DB: db, UPLOADS: bucket } = platform.env;
    if (!options.check && !(await bucket.head(engineKey))) {
      await bucket.put(engineKey, new Uint8Array(engine), {
        httpMetadata: { contentType: "text/javascript" },
      });
      console.log("Motor subido a R2 local.");
    }

    const date = prismaDate();
    let inserted = 0;
    let updated = 0;
    for (const task of tasks) {
      const { results } = await db
        .prepare(
          'SELECT "id", "answerType" FROM "TaskDraft" WHERE "sourceTaskCode" = ? OR "id" IN (?, ?)',
        )
        .bind(
          task.code,
          `ville-${task.code.toLowerCase()}`,
          `ville-${task.code.toLowerCase()}-interactiva`,
        )
        .all<{ id: string; answerType: string }>();
      const existing = results.find((row) => row.answerType === "interactive");
      const taken = new Set(results.map((row) => row.id));
      const id =
        existing?.id ??
        (taken.has(`ville-${task.code.toLowerCase()}`)
          ? `ville-${task.code.toLowerCase()}-interactiva`
          : `ville-${task.code.toLowerCase()}`);
      const row = {
        id,
        ...task.fields,
        category: JSON.stringify(["Algoritmos y programación"]),
        difficulties: EMPTY_DIFFICULTIES,
        challengeBlocks: JSON.stringify([
          {
            id: randomUUID(),
            type: "challenge",
            content: "Resuelve la actividad interactiva.",
            image: null,
            widthPercent: 100,
          },
        ]),
        answerType: "interactive",
        multipleChoiceOrderMode: "fixed",
        answers: "[]",
        correctAnswerId: "",
        shortAnswer: "",
        dragDropBackground: "null",
        dragDropItems: "[]",
        explanationBlocks: "[]",
        isPractice: 0,
        forTeachers: 0,
        createdAt: date,
        updatedAt: date,
      };
      const bytes = rowBytes(row);
      const notes = [
        ...task.warnings,
        ...(id.endsWith("-interactiva")
          ? [
              `ville-${task.code.toLowerCase()} es de otro tipo; esta va como ${id}`,
            ]
          : []),
      ];
      const label = `${task.code.padEnd(12)} ${(bytes / 1000).toFixed(0).padStart(5)} KB`;

      if (bytes > ROW_MAX_BYTES) {
        console.log(`${label}  NO: pasa de 1,9 MB.`);
        continue;
      }
      if (options.check) {
        console.log(`${label}  ${existing ? "existe" : "nueva"} ${id}${notes.length ? `  (${notes.join("; ")})` : ""}`);
        continue;
      }
      if (!existing) {
        const columns = Object.keys(row);
        await db
          .prepare(
            `INSERT INTO "TaskDraft" (${columns.map((c) => `"${c}"`).join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
          )
          .bind(...columns.map((c) => row[c as keyof typeof row] as string | number | null))
          .run();
        inserted += 1;
        console.log(`${label}  insertada ${id}${notes.length ? `  (${notes.join("; ")})` : ""}`);
      } else if (options.update) {
        const columns = [
          "answerType",
          "answerConfig",
          "answerKey",
          ...(options.statements ? ["title", "bodyBlocks", "challengeBlocks"] : []),
          "updatedAt",
        ];
        await db
          .prepare(
            `UPDATE "TaskDraft" SET ${columns.map((c) => `"${c}" = ?`).join(", ")} WHERE "id" = ?`,
          )
          .bind(...columns.map((c) => row[c as keyof typeof row] as string), id)
          .run();
        updated += 1;
        console.log(`${label}  actualizada ${id}${notes.length ? `  (${notes.join("; ")})` : ""}`);
      } else {
        console.log(`${label}  ya está ${id}`);
      }
    }
    console.log(
      options.check
        ? "Revisión terminada; no se escribió nada."
        : `Listo: ${inserted} insertadas, ${updated} actualizadas.`,
    );
  } finally {
    await platform.dispose();
  }
}

if (isScriptMain("scripts/cargar-interactivas-ville.ts")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
