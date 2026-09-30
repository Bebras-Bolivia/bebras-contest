import assert from "node:assert/strict";
import { test } from "node:test";
import { DEPARTMENTS as BACKEND_DEPARTMENTS } from "../backend/src/lib/places";
import { formatCountdown } from "../frontend/src/lib/countdown";
import { DEPARTMENTS } from "../frontend/src/lib/departments";
import { difficultyStyles } from "../frontend/src/lib/difficulty";
import {
  splitExplanation,
  splitExplanationForEditing,
} from "../frontend/src/lib/explanation";
import { displayPhone } from "../frontend/src/lib/phone-display";
import {
  practiceCategoryHref,
  practiceOrigin,
  practiceTaskHref,
} from "../frontend/src/lib/practice-navigation";
import { taskVisibility, visibilityInfo } from "../frontend/src/lib/task-visibility";

const text = (id: string, content: string) => ({
  id,
  type: "text" as const,
  content,
  image: null,
  widthPercent: 100,
});
const image = (id: string) => ({
  id,
  type: "image" as const,
  content: "",
  image: { id, name: `${id}.png`, url: `/${id}.png` },
  widthPercent: 100,
});

test("la cuenta regresiva omite los días y las horas cuando valen cero", () => {
  assert.equal(formatCountdown(0), "00 min 00 s");
  assert.equal(formatCountdown(-5000), "00 min 00 s");
  assert.equal(formatCountdown(65_000), "01 min 05 s");
  assert.equal(formatCountdown(3_600_000), "1 h 00 min 00 s");
  assert.equal(formatCountdown(2 * 86_400_000 + 3 * 3_600_000 + 5 * 60_000 + 4_000), "2 d 3 h 05 min 04 s");
  // Con días, las horas se muestran aunque sean cero.
  assert.equal(formatCountdown(86_400_000), "1 d 0 h 00 min 00 s");
  assert.equal(formatCountdown(1999), "00 min 01 s");
});

test("la explicación separa la solución de «¿Qué tiene que ver con informática?»", () => {
  const { solution, informatics } = splitExplanation([
    text("t1", "**Solución paso a paso**\nLa respuesta es B.\n\n**¿Qué tiene que ver con informática?**\nEs un grafo.\n\n**Continúa aprendiendo**\nActividades para el maestro."),
    image("sol"),
  ]);
  assert.deepEqual(solution.map((block) => block.content || block.id), [
    "**Solución paso a paso**\nLa respuesta es B.",
    "sol",
  ]);
  assert.equal(informatics.length, 1);
  assert.equal(informatics[0].content, "Es un grafo.");
  assert.equal(informatics[0].id, "t1-informatica");
  // «Continúa aprendiendo» es para el maestro y no se muestra.
  assert.equal(JSON.stringify({ solution, informatics }).includes("Actividades"), false);
});

test("la sección de informática puede ser un bloque propio o venir con «la»", () => {
  const own = splitExplanation([text("a", "Solución."), text("x-informatica", "Algoritmos.")]);
  assert.deepEqual(own.solution.map((block) => block.content), ["Solución."]);
  assert.deepEqual(own.informatics.map((block) => block.content), ["Algoritmos."]);
  const old = splitExplanation([text("a", "Solución.\n**¿Qué tiene que ver con la informática?**\nOrden.")]);
  assert.deepEqual(old.informatics.map((block) => block.content), ["Orden."]);
  const none = splitExplanation([text("a", "Solo la solución.")]);
  assert.equal(none.informatics.length, 0);
});

test("en el editor la explicación queda en la solución y un solo bloque de informática", () => {
  const edited = splitExplanationForEditing([
    text("a", "Solución.\n**¿Qué tiene que ver con informática?**\nPrimera parte."),
    text("b", "Segunda parte."),
  ]);
  assert.deepEqual(edited.solution.map((block) => block.content), ["Solución."]);
  assert.equal(edited.informaticsBlock.content, "Primera parte.\n\nSegunda parte.");
  assert.ok(edited.informaticsBlock.id.endsWith("-informatica"));
  const empty = splitExplanationForEditing([]);
  assert.equal(empty.solution.length, 1);
  assert.equal(empty.informaticsBlock.content, "");
});

test("los teléfonos de Bolivia se muestran como «7123 4567» y los demás tal cual", () => {
  assert.equal(displayPhone("+59171234567"), "7123 4567");
  assert.equal(displayPhone("+591 7123 4567"), "7123 4567");
  assert.equal(displayPhone("+5491123456789"), "+5491123456789");
  assert.equal(displayPhone(null), "");
  assert.equal(displayPhone(""), "");
});

test("la visibilidad de una tarea sale de sus dos marcas, con la práctica por encima", () => {
  assert.equal(taskVisibility({ isPractice: true, forTeachers: true }), "practica");
  assert.equal(taskVisibility({ forTeachers: true }), "maestros");
  assert.equal(taskVisibility({}), "privada");
  assert.equal(visibilityInfo("privada").label, "Solo admin");
});

test("la navegación de práctica vuelve a donde se entró y codifica la categoría", () => {
  assert.equal(practiceOrigin("/entrar"), "/entrar");
  assert.equal(practiceOrigin("/otra"), "/practica");
  assert.equal(practiceOrigin(null), "/practica");
  assert.equal(
    practiceCategoryHref("Yaguareté", "/entrar"),
    "/practica/categoria?nombre=Yaguaret%C3%A9&from=%2Fentrar",
  );
  assert.equal(
    practiceTaskHref("t 1", "Titi", "x"),
    "/practica/tarea?id=t+1&nombre=Titi&from=%2Fpractica",
  );
});

test("los departamentos del frontend coinciden con los del backend", () => {
  assert.equal(DEPARTMENTS.length, 9);
  for (const department of DEPARTMENTS) {
    const backend = BACKEND_DEPARTMENTS[department.key];
    assert.ok(backend, department.key);
    assert.equal(department.name, backend.name, department.key);
    assert.ok(department.cities.length > 0, department.key);
  }
});

test("las tres dificultades se ordenan de fácil a difícil", () => {
  assert.deepEqual(
    Object.entries(difficultyStyles)
      .sort(([, a], [, b]) => a.rank - b.rank)
      .map(([, style]) => style.label),
    ["Fácil", "Medio", "Difícil"],
  );
});
