export function parseJsonValue<T>(value: unknown, fallback: T) {
  try {
    return JSON.parse(String(value ?? JSON.stringify(fallback))) as T;
  } catch {
    return fallback;
  }
}
