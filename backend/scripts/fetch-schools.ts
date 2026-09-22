import { gunzipSync, gzipSync } from "node:zlib";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve, dirname } from "node:path";

const BASE =
  "https://seie.minedu.gob.bo/geoserver/minedu/ows?service=WFS&version=2.0.0&request=GetFeature&typeName=minedu:vw_unidad_geo7&outputFormat=application/json&sortBy=cod_ue";
const PAGE_SIZE = 2000;
const SNAPSHOT = resolve(
  __dirname,
  "..",
  "prisma",
  "seed",
  "schools.ndjson.gz",
);
const TEMP_SNAPSHOT = `${SNAPSHOT}.${process.pid}.tmp`;
const MIN_EXPECTED_SCHOOLS = 10_000;
const MIN_EXISTING_RATIO = 0.9;

type Feature = {
  properties: {
    cod_ue?: string;
    cod_le?: string;
    des_ue?: string;
    des_dep?: string;
    des_pro?: string;
    des_sec?: string;
    des_dis?: string;
    depend?: string;
    nivel?: number | string;
    area?: string;
    latitud?: number;
    longitud?: number;
    matricula?: number;
  };
};

type SchoolRow = {
  codUe: string;
  codLe: string | null;
  name: string;
  dep: string;
  pro: string;
  sec: string;
  dis: string;
  depend: string | null;
  nivel: string | null;
  area: string | null;
  latitud: number | null;
  longitud: number | null;
  matricula: number | null;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

async function fetchPage(startIndex: number) {
  const url = `${BASE}&count=${PAGE_SIZE}&startIndex=${startIndex}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);

  try {
    const response = await fetch(url, { signal: controller.signal });
    const body = await response.text();

    if (!response.ok) {
      throw new Error(
        `El servicio respondió ${response.status}. ${body.slice(0, 300)}`,
      );
    }

    let data: { features?: Feature[]; numberMatched?: number | string };
    try {
      data = JSON.parse(body) as {
        features?: Feature[];
        numberMatched?: number | string;
      };
    } catch {
      throw new Error(
        `Respuesta no es JSON (¿error del servidor?): ${body.slice(0, 300)}`,
      );
    }

    const parsedTotal = Number(data.numberMatched);
    return {
      features: data.features ?? [],
      total:
        Number.isSafeInteger(parsedTotal) && parsedTotal >= 0
          ? parsedTotal
          : null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function readSnapshotRows(path: string): SchoolRow[] {
  return gunzipSync(readFileSync(path))
    .toString("utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as SchoolRow);
}

function validateRows(rows: SchoolRow[]) {
  if (rows.length < MIN_EXPECTED_SCHOOLS) {
    throw new Error(
      `La descarga solo contiene ${rows.length} colegios; se esperaban al menos ${MIN_EXPECTED_SCHOOLS}.`,
    );
  }

  const codes = new Set<string>();
  for (const [index, row] of rows.entries()) {
    if (!row.codUe || !row.name || !row.dep) {
      throw new Error(
        `El colegio descargado en la posición ${index + 1} no tiene código, nombre o departamento.`,
      );
    }
    if (codes.has(row.codUe)) {
      throw new Error(
        `El código de unidad educativa ${row.codUe} está duplicado.`,
      );
    }
    codes.add(row.codUe);
  }
}

async function main() {
  console.log("Descargando unidades educativas del MINEDU (por lotes)...");

  const seen = new Set<string>();
  const rows: SchoolRow[] = [];
  let startIndex = 0;
  let fetchedFeatures = 0;
  let expectedTotal: number | null = null;

  for (;;) {
    const page = await fetchPage(startIndex);
    const { features } = page;

    if (page.total !== null) {
      if (expectedTotal !== null && page.total !== expectedTotal) {
        throw new Error(
          `El total informado por MINEDU cambió durante la descarga (${expectedTotal} a ${page.total}).`,
        );
      }
      expectedTotal = page.total;
    }

    if (features.length === 0) {
      if (expectedTotal !== null && fetchedFeatures < expectedTotal) {
        throw new Error(
          `La descarga terminó antes de tiempo: ${fetchedFeatures} de ${expectedTotal} registros.`,
        );
      }
      break;
    }

    for (const feature of features) {
      const props = feature.properties ?? {};
      const codUe = clean(props.cod_ue);
      const name = clean(props.des_ue);
      if (!codUe || !name || seen.has(codUe)) {
        continue;
      }
      seen.add(codUe);
      rows.push({
        codUe,
        codLe: clean(props.cod_le) || null,
        name,
        dep: clean(props.des_dep),
        pro: clean(props.des_pro),
        sec: clean(props.des_sec),
        dis: clean(props.des_dis),
        depend: clean(props.depend) || null,
        nivel: props.nivel != null ? String(props.nivel) : null,
        area: clean(props.area) || null,
        latitud: typeof props.latitud === "number" ? props.latitud : null,
        longitud: typeof props.longitud === "number" ? props.longitud : null,
        matricula: typeof props.matricula === "number" ? props.matricula : null,
      });
    }

    fetchedFeatures += features.length;
    console.log(`  descargados ${fetchedFeatures}...`);

    if (expectedTotal !== null && fetchedFeatures > expectedTotal) {
      throw new Error(
        `MINEDU devolvió más registros (${fetchedFeatures}) que el total informado (${expectedTotal}).`,
      );
    }

    if (
      expectedTotal !== null
        ? fetchedFeatures === expectedTotal
        : features.length < PAGE_SIZE
    ) {
      break;
    }
    startIndex += features.length;
  }

  if (expectedTotal !== null && fetchedFeatures !== expectedTotal) {
    throw new Error(
      `La descarga quedó incompleta: ${fetchedFeatures} de ${expectedTotal} registros.`,
    );
  }

  rows.sort((left, right) => left.codUe.localeCompare(right.codUe));
  validateRows(rows);

  if (existsSync(SNAPSHOT)) {
    const existingCount = readSnapshotRows(SNAPSHOT).length;
    const minimumSafeCount = Math.floor(existingCount * MIN_EXISTING_RATIO);
    if (rows.length < minimumSafeCount) {
      throw new Error(
        `La descarga bajó de ${existingCount} a ${rows.length} colegios. No se reemplaza el snapshot automáticamente.`,
      );
    }
  }

  mkdirSync(dirname(SNAPSHOT), { recursive: true });
  const ndjson = rows.map((row) => JSON.stringify(row)).join("\n");
  writeFileSync(
    TEMP_SNAPSHOT,
    gzipSync(Buffer.from(ndjson, "utf8"), { level: 9 }),
  );

  try {
    const writtenRows = readSnapshotRows(TEMP_SNAPSHOT);
    validateRows(writtenRows);
    if (writtenRows.length !== rows.length) {
      throw new Error(
        "El archivo temporal no contiene todos los colegios descargados.",
      );
    }
    renameSync(TEMP_SNAPSHOT, SNAPSHOT);
  } finally {
    rmSync(TEMP_SNAPSHOT, { force: true });
  }

  console.log(`Listo. ${rows.length} colegios guardados en ${SNAPSHOT}.`);
  console.log('Ejecuta "bun run db:seed -- --force" para cargarlos en la base.');
}

main().catch((error) => {
  console.error("Error en la descarga:", error);
  process.exit(1);
});
