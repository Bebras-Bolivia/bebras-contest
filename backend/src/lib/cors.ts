/**
 * Origen al que se le permite llamar a la API desde otro dominio, o `null`.
 * `configured` es `FRONTEND_ORIGIN`, uno o varios separados por comas. En
 * producción el frontend y la API comparten dominio y no hace falta ninguno.
 */
export function allowedCorsOrigin(
  origin: string | undefined,
  configured: string | undefined,
) {
  if (!origin) return null;
  const allowed = new Set(
    (configured ?? "")
      .split(",")
      .map((value) => value.trim().replace(/\/+$/, ""))
      .filter(Boolean)
      .flatMap((value) => [
        value,
        value.replace("//localhost", "//127.0.0.1"),
        value.replace("//127.0.0.1", "//localhost"),
      ]),
  );
  return allowed.has(origin) ? origin : null;
}
