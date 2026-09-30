export function normalizeHeader(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

export function cleanName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function nameKey(first: string, last: string) {
  const norm = (value: string) =>
    cleanName(value)
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "");
  return `${norm(first)} ${norm(last)}`;
}
