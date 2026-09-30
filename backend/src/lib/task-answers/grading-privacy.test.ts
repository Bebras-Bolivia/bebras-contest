import assert from "node:assert/strict";
import { test } from "node:test";
import { answerIsCorrect } from "./grading";
import { parseMcCorrectness } from "./multiple-choice";
import { renderSafeTask } from "./public-task";
import type { PlayTask } from "./types";
import { parseDragDropAnswer, validateTaskAnswer } from "./validation";

function task(overrides: Partial<PlayTask> = {}): PlayTask {
  return {
    id: "tarea",
    title: "Tarea",
    bodyBlocks: [],
    challengeBlocks: [],
    answerType: "multiple_choice",
    answerConfig: {},
    answerKey: {},
    multipleChoiceOrderMode: "fixed",
    answers: ["A", "B", "C", "D"].map((id) => ({
      id,
      blocks: [{ id: `b-${id}`, type: "text", content: `Opción ${id}` }],
    })),
    correctAnswerId: "single:B",
    shortAnswer: "",
    dragDropBackground: null,
    dragDropItems: [],
    dragDropTargets: [],
    dragDropSolutions: [],
    dragDropVersion: 2,
    explanationBlocks: [],
    ...overrides,
  };
}

const dragTask = (version: 1 | 2) =>
  task({
    answerType: "drag_drop",
    correctAnswerId: "",
    dragDropVersion: version,
    dragDropItems: [
      { id: "rojo", label: "Rojo", image: null, widthPercent: 10, correctTargetId: "izq" },
      { id: "azul", label: "Azul", image: null, widthPercent: 10, correctTargetId: "der" },
    ],
    dragDropTargets: [
      { id: "izq", x: 20, y: 50, snapRadius: 8 },
      { id: "der", x: 80, y: 50, snapRadius: 8 },
      { id: "extra", x: 50, y: 10, snapRadius: 8 },
    ],
  });

test("el criterio de opción múltiple se lee de «modo:letras»", () => {
  assert.deepEqual(parseMcCorrectness("single:B"), { mode: "single", ids: ["B"] });
  assert.deepEqual(parseMcCorrectness("B"), { mode: "single", ids: ["B"] });
  assert.deepEqual(parseMcCorrectness("any: B, C ,B"), { mode: "any", ids: ["B", "C"] });
  assert.deepEqual(parseMcCorrectness("all:A,C"), { mode: "all", ids: ["A", "C"] });
  assert.deepEqual(parseMcCorrectness("raro:A,C"), { mode: "single", ids: ["A"] });
  assert.deepEqual(parseMcCorrectness(""), { mode: "single", ids: [] });
});

test("opción múltiple de una sola correcta", () => {
  const single = task();
  assert.equal(answerIsCorrect(single, { selected: ["B"] }), true);
  assert.equal(answerIsCorrect(single, { selected: ["A"] }), false);
  assert.equal(answerIsCorrect(single, { selected: ["B", "A"] }), false);
  assert.equal(answerIsCorrect(single, { selected: [] }), false);
  assert.equal(answerIsCorrect(single, {}), false);
});

test("«al menos una» acepta cualquiera de las correctas, de a una", () => {
  const any = task({ correctAnswerId: "any:B,C" });
  assert.equal(answerIsCorrect(any, { selected: ["B"] }), true);
  assert.equal(answerIsCorrect(any, { selected: ["C"] }), true);
  assert.equal(answerIsCorrect(any, { selected: ["A"] }), false);
  assert.equal(answerIsCorrect(any, { selected: ["B", "C"] }), false);
});

test("«todas» exige exactamente las correctas, sin repetir", () => {
  const all = task({ correctAnswerId: "all:B,C" });
  assert.equal(answerIsCorrect(all, { selected: ["C", "B"] }), true);
  assert.equal(answerIsCorrect(all, { selected: ["B"] }), false);
  assert.equal(answerIsCorrect(all, { selected: ["B", "C", "D"] }), false);
  assert.equal(answerIsCorrect(all, { selected: ["B", "B"] }), false);
});

test("la respuesta corta no distingue mayúsculas ni espacios de los bordes", () => {
  const short = task({ answerType: "short_text", correctAnswerId: "", shortAnswer: " Castor " });
  assert.equal(answerIsCorrect(short, { text: "castor" }), true);
  assert.equal(answerIsCorrect(short, { text: "  CASTOR  " }), true);
  assert.equal(answerIsCorrect(short, { text: "castores" }), false);
  assert.equal(answerIsCorrect(short, { text: "" }), false);
});

test("arrastrar: cada pieza en su lugar es correcto; cambiadas o incompletas, no", () => {
  const drag = dragTask(2);
  assert.equal(answerIsCorrect(drag, { placements: { rojo: "izq", azul: "der" } }), true);
  assert.equal(answerIsCorrect(drag, { placements: { rojo: "der", azul: "izq" } }), false);
  assert.equal(answerIsCorrect(drag, { placements: { rojo: "izq" } }), false);
  assert.equal(answerIsCorrect(drag, { placements: { rojo: "izq", azul: "extra" } }), false);
});

test("arrastrar: se rechazan lugares repetidos, desconocidos y piezas que no existen", () => {
  const drag = dragTask(2);
  assert.equal(parseDragDropAnswer(drag, { placements: { rojo: "izq", azul: "izq" } }), null);
  assert.equal(parseDragDropAnswer(drag, { placements: { rojo: "nada" } }), null);
  assert.equal(parseDragDropAnswer(drag, { placements: { verde: "izq" } }), null);
  assert.equal(parseDragDropAnswer(drag, { placements: [] }), null);
  assert.equal(parseDragDropAnswer(drag, null), null);
  assert.equal(
    parseDragDropAnswer(drag, { placements: { rojo: { x: Number.NaN, y: 1 } } }),
    null,
  );
});

test("arrastrar: las respuestas viejas por coordenadas se corrigen por el lugar más cercano", () => {
  const legacy = dragTask(1);
  assert.equal(
    answerIsCorrect(legacy, {
      placements: { rojo: { x: 22, y: 51 }, azul: { x: 79, y: 47 } },
    }),
    true,
  );
  // Fuera del radio de todo lugar no cuenta.
  assert.equal(
    answerIsCorrect(legacy, {
      placements: { rojo: { x: 40, y: 51 }, azul: { x: 79, y: 47 } },
    }),
    false,
  );
  // Las tareas nuevas no aceptan coordenadas.
  assert.equal(
    answerIsCorrect(dragTask(2), {
      placements: { rojo: { x: 20, y: 50 }, azul: { x: 80, y: 50 } },
    }),
    false,
  );
});

test("una respuesta con forma inválida nunca es correcta ni se guarda", () => {
  const single = task();
  assert.ok(validateTaskAnswer(single, null));
  assert.ok(validateTaskAnswer(single, []));
  assert.ok(validateTaskAnswer(single, "B"));
  assert.equal(answerIsCorrect(single, "B"), false);
  assert.equal(answerIsCorrect(task({ answerType: "inventado" }), { selected: ["B"] }), false);
});

test("lo que recibe el estudiante nunca incluye la respuesta ni la explicación", () => {
  const privateTask = task({
    correctAnswerId: "all:B,C",
    shortAnswer: "secreto",
    answerKey: { version: 1, acceptedRegionIds: ["zona-2"] },
    explanationBlocks: [{ id: "e", type: "text", content: "La respuesta es B" }],
  });
  const safe = renderSafeTask({ position: 3 }, privateTask);
  const text = JSON.stringify(safe);
  assert.equal(safe.position, 3);
  assert.equal(safe.multipleChoiceMode, "all");
  for (const secret of ["correctAnswerId", "shortAnswer", "answerKey", "explanation", "secreto", "La respuesta es B", "B,C"]) {
    assert.equal(text.includes(secret), false, secret);
  }
  const drag = renderSafeTask({ position: 1 }, dragTask(2));
  assert.equal(JSON.stringify(drag).includes("correctTargetId"), false);
  // Los lugares van ordenados por posición, para no delatar cuál es cuál.
  assert.deepEqual(
    drag.dragDropTargets.map((target) => target.id),
    ["izq", "extra", "der"],
  );
});

test("el enunciado que se envía se limpia: sin nodos, marcas ni atributos desconocidos", () => {
  const dirty = task({
    bodyBlocks: [
      {
        id: "b1",
        type: "text",
        content: "Hola",
        secreto: "no",
        image: { id: "i", url: "/a.png", name: "a", correcto: true },
        richText: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              attrs: { indent: 99, onclick: "x" },
              content: [
                { type: "text", text: "negrita", marks: [{ type: "bold" }, { type: "script" }] },
                { type: "text", text: "enlace", marks: [{ type: "link", attrs: { href: "https://bebras.bo", onclick: "x" } }] },
                { type: "script", text: "alert(1)" },
                { type: "taskBlank", attrs: { blankId: "h1", answer: "secreto" } },
              ],
            },
          ],
        },
      },
    ],
  });
  const [block] = renderSafeTask({ position: 1 }, dirty).bodyBlocks as Array<Record<string, unknown>>;
  assert.equal("secreto" in block, false);
  assert.deepEqual(block.image, { id: "i", name: "a", url: "/a.png" });
  const paragraph = (block.richText as { content: Array<Record<string, unknown>> }).content[0];
  assert.deepEqual(paragraph.attrs, { indent: 8 });
  const nodes = paragraph.content as Array<Record<string, unknown>>;
  assert.deepEqual(nodes.map((node) => node.type), ["text", "text", "taskBlank"]);
  assert.deepEqual(nodes[0].marks, [{ type: "bold" }]);
  assert.deepEqual(nodes[1].marks, [{ type: "link", attrs: { href: "https://bebras.bo" } }]);
  assert.deepEqual(nodes[2], { type: "taskBlank", attrs: { blankId: "h1" } });
});

test("mezclar las opciones da a cada intento su propio orden, siempre el mismo, con las mismas letras", () => {
  const base = task();
  const order = (seed?: string) =>
    renderSafeTask({ position: 1 }, base, seed).answers.map((answer) => answer.id);
  assert.deepEqual(order(), ["A", "B", "C", "D"]);
  assert.deepEqual(order("intento-1"), order("intento-1"));
  assert.deepEqual([...order("intento-1")].sort(), ["A", "B", "C", "D"]);
  const seeds = Array.from({ length: 20 }, (_, index) => order(`intento-${index}`).join(""));
  assert.ok(new Set(seeds).size > 1, "todos los intentos salieron con el mismo orden");
});
