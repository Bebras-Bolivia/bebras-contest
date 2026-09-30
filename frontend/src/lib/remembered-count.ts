/**
 * Cuántas cosas mostró una lista la última vez, para que su esqueleto tenga
 * el mismo tamaño que lo que va a llegar.
 */
export function rememberedCount(key: string, fallback: number) {
  try {
    const saved = window.localStorage.getItem(key);
    if (saved === null) return fallback;
    const value = Number(saved);
    return Number.isInteger(value) && value >= 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

export function rememberCount(key: string, value: number) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Sin almacenamiento, el esqueleto usa su tamaño por defecto.
  }
}
