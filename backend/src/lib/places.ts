import { normalizeHeader } from "./text";

/** Departamentos del catálogo de colegios, con el castor que los representa. */
export const DEPARTMENTS: Record<string, { name: string; slug: string }> = {
  "LA PAZ": { name: "La Paz", slug: "la-paz" },
  COCHABAMBA: { name: "Cochabamba", slug: "cochabamba" },
  "SANTA CRUZ": { name: "Santa Cruz", slug: "santa-cruz" },
  ORURO: { name: "Oruro", slug: "oruro" },
  POTOSI: { name: "Potosí", slug: "potosi" },
  CHUQUISACA: { name: "Chuquisaca", slug: "sucre" },
  TARIJA: { name: "Tarija", slug: "tarija" },
  BENI: { name: "Beni", slug: "beni" },
  PANDO: { name: "Pando", slug: "pando" },
};

export const MINOR_WORDS = new Set([
  "de",
  "del",
  "la",
  "las",
  "los",
  "el",
  "y",
  "e",
]);

export function titleCase(value: string) {
  return value
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .map((word, index) =>
      index > 0 && MINOR_WORDS.has(word)
        ? word
        : word.replace(/\p{L}/u, (letter) => letter.toUpperCase()),
    )
    .join(" ");
}

/** «Yacuiba, Tarija»; si la ciudad es la capital, solo el departamento. */
export function placeLabel(dep: string | null | undefined, town: string) {
  const department = DEPARTMENTS[dep ?? ""];
  const city = town.trim();
  if (!department) return city || null;
  return city && normalizeHeader(city) !== normalizeHeader(department.name)
    ? `${city}, ${department.name}`
    : department.name;
}

/** «CAPITAL (COCHABAMBA)» es la ciudad de Cochabamba. */
export function townName(sec: string) {
  const capital = /^capital\s*\((.+)\)$/i.exec(sec.trim());
  return titleCase(capital ? capital[1] : sec);
}
