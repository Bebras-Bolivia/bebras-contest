import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

/**
 * El frontend y el backend no comparten paquete: la lógica que tiene que dar
 * lo mismo en los dos lados está copiada. Las pruebas del backend valen para
 * las dos copias solo si son iguales (sin contar comentarios ni fines de línea).
 */
const pairs: Array<[string, string]> = [
  ["backend/src/lib/drag-drop-grading.ts", "frontend/src/lib/drag-drop-grading.ts"],
  ["backend/src/lib/task-answers/assignment-answers.ts", "frontend/src/lib/assignment-answers.ts"],
  ["backend/src/lib/task-answers/image-hotspot.ts", "frontend/src/lib/image-hotspot.ts"],
  ["backend/src/lib/phone.ts", "frontend/src/lib/phone.ts"],
  ["backend/src/lib/person-name.ts", "frontend/src/lib/person-name.ts"],
  ["backend/src/lib/email.ts", "frontend/src/lib/email.ts"],
  ["backend/src/lib/registration-password.ts", "frontend/src/lib/registration-password.ts"],
  ["backend/src/lib/registration-text.ts", "frontend/src/lib/registration-text.ts"],
];

const root = resolve(import.meta.dirname, "..");
const code = (path: string) =>
  readFileSync(resolve(root, path), "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\n\s*\n/g, "\n")
    .trim();

for (const [backend, frontend] of pairs) {
  test(`la copia del frontend es igual a la del backend: ${frontend.split("/").pop()}`, () => {
    assert.equal(code(frontend), code(backend));
  });
}
