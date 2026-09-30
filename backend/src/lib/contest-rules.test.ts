import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BEBRAS_CATEGORIES,
  CONTEST_CATEGORY_NAMES,
  contestCategories,
  contestHasEnded,
  contestRules,
  contestStateAt,
  defaultContestScoring,
  gradesForCategories,
  groupCategories,
  initialScoreOf,
  isDifficultyKey,
  normalizeCategories,
  parseContestScoring,
  parseGrade,
  registrationOpenAt,
  resultsWindow,
  scoresForDifficulty,
  teamCategory,
} from "./contest-rules";

const hour = 3600000;
const at = (hours: number) => new Date(Date.UTC(2026, 9, 1) + hours * hour);

// Un desafío tipo: inscripción de 0 a 10 h, rendición de 20 a 22 h.
const scheduled = {
  publishedAt: at(-1),
  registrationStartsAt: at(0),
  registrationEndsAt: at(10),
  startsAt: at(20),
  endsAt: at(22),
};

test("un desafío sin publicar es un borrador, sea la hora que sea", () => {
  for (const hours of [-5, 5, 21, 30]) {
    assert.deepEqual(
      contestStateAt(at(hours), { ...scheduled, publishedAt: null }),
      { state: "borrador", isOpen: false },
    );
  }
});

test("un desafío con fechas pasa por todas sus fases en orden", () => {
  const phases: Array<[number, string, boolean]> = [
    [-0.5, "programada", false],
    [0, "inscripcion", false],
    [9.9, "inscripcion", false],
    [10, "preparacion", false],
    [19.9, "preparacion", false],
    [20, "abierta", true],
    [22, "abierta", true],
    [22.1, "cerrada", false],
  ];
  for (const [hours, state, isOpen] of phases) {
    assert.deepEqual(
      contestStateAt(at(hours), scheduled),
      { state, isOpen },
      `a las ${hours} h`,
    );
  }
});

test("después del cierre, los resultados pasan a consolidados y luego a publicados", () => {
  const after = at(23);
  assert.equal(
    contestStateAt(after, { ...scheduled, consolidatedAt: at(22.5) }).state,
    "consolidada",
  );
  assert.equal(
    contestStateAt(after, {
      ...scheduled,
      consolidatedAt: at(22.5),
      resultsPublishedAt: at(22.6),
    }).state,
    "publicada",
  );
});

test("sin fechas de inscripción, la inscripción dura hasta que empieza la rendición", () => {
  const noWindow = {
    ...scheduled,
    registrationStartsAt: null,
    registrationEndsAt: null,
  };
  assert.equal(contestStateAt(at(5), noWindow).state, "inscripcion");
  assert.equal(contestStateAt(at(20), noWindow).state, "abierta");
  // Sin ninguna fecha, se puede publicar y queda en inscripción.
  assert.equal(
    contestStateAt(at(5), { ...noWindow, startsAt: null, endsAt: null }).state,
    "inscripcion",
  );
});

test("una pausa se mantiene aunque pase la hora de cierre", () => {
  const paused = { ...scheduled, suspendedAt: at(21) };
  assert.deepEqual(contestStateAt(at(21.5), paused), {
    state: "suspendida",
    isOpen: false,
  });
  assert.equal(contestStateAt(at(30), paused).state, "suspendida");
});

test("una práctica no tiene inscripción: espera su horario y después se abre", () => {
  const practice = {
    publishedAt: at(-1),
    startsAt: at(20),
    endsAt: at(22),
    isPractice: true,
  };
  assert.equal(contestStateAt(at(5), practice).state, "programada");
  assert.equal(
    contestStateAt(at(5), { ...practice, startsAt: null, endsAt: null }).state,
    "preparacion",
  );
  assert.equal(contestStateAt(at(21), practice).state, "abierta");
});

test("solo los estados posteriores al cierre cuentan como terminados", () => {
  for (const state of ["cerrada", "consolidada", "publicada"] as const) {
    assert.equal(contestHasEnded(state), true, state);
  }
  for (const state of [
    "borrador",
    "programada",
    "inscripcion",
    "preparacion",
    "abierta",
    "suspendida",
  ] as const) {
    assert.equal(contestHasEnded(state), false, state);
  }
});

test("la inscripción respeta su propia ventana", () => {
  assert.equal(registrationOpenAt(at(-0.5), scheduled), false);
  assert.equal(registrationOpenAt(at(0), scheduled), true);
  assert.equal(registrationOpenAt(at(9.9), scheduled), true);
  assert.equal(registrationOpenAt(at(10), scheduled), false);
  assert.equal(
    registrationOpenAt(at(5), { ...scheduled, publishedAt: null }),
    false,
  );
});

test("sin ventana propia, la inscripción cierra al empezar la rendición", () => {
  const noWindow = {
    ...scheduled,
    registrationStartsAt: null,
    registrationEndsAt: null,
  };
  assert.equal(registrationOpenAt(at(19.9), noWindow), true);
  assert.equal(registrationOpenAt(at(20), noWindow), false);
  assert.equal(registrationOpenAt(at(23), noWindow), false);
});

test("una práctica admite grupos mientras no haya terminado", () => {
  const practice = {
    publishedAt: at(-1),
    startsAt: at(20),
    endsAt: at(22),
    isPractice: true,
  };
  assert.equal(registrationOpenAt(at(5), practice), true);
  assert.equal(registrationOpenAt(at(21), practice), true);
  assert.equal(registrationOpenAt(at(23), practice), false);
});

test("los resultados se ven desde el cierre, o desde su fecha si es posterior, durante 7 días", () => {
  assert.deepEqual(
    resultsWindow({ endsAt: null, resultsAt: null, resultsUntil: null }),
    { from: null, until: null },
  );
  const closed = resultsWindow({
    endsAt: at(22),
    resultsAt: null,
    resultsUntil: null,
  });
  assert.deepEqual(closed, { from: at(22), until: at(22 + 7 * 24) });
  // Una fecha de resultados anterior al cierre no los adelanta.
  assert.deepEqual(
    resultsWindow({ endsAt: at(22), resultsAt: at(21), resultsUntil: null })
      .from,
    at(22),
  );
  assert.deepEqual(
    resultsWindow({ endsAt: at(22), resultsAt: at(30), resultsUntil: at(40) }),
    { from: at(30), until: at(40) },
  );
});

test("el puntaje estándar de Bebras es 6/−2, 9/−3 y 12/−4", () => {
  assert.deepEqual(defaultContestScoring(), {
    easy: { correct: 6, wrong: -2 },
    medium: { correct: 9, wrong: -3 },
    hard: { correct: 12, wrong: -4 },
  });
  assert.deepEqual(scoresForDifficulty("hard", defaultContestScoring()), {
    difficulty: "hard",
    minScore: -4,
    noAnswerScore: 0,
    maxScore: 12,
  });
  assert.equal(isDifficultyKey("medium"), true);
  assert.equal(isDifficultyKey("Medio"), false);
});

test("los puntajes editados completan lo que falta con el estándar y rechazan valores inválidos", () => {
  assert.deepEqual(parseContestScoring(null), defaultContestScoring());
  assert.deepEqual(
    parseContestScoring({ easy: { correct: 5, wrong: 0 }, medium: "x" }),
    {
      ...defaultContestScoring(),
      easy: { correct: 5, wrong: 0 },
    },
  );
  assert.throws(
    () => parseContestScoring({ easy: { correct: 0, wrong: -1 } }),
    /correcta debe ser un entero mayor que cero/,
  );
  assert.throws(
    () => parseContestScoring({ hard: { correct: 12, wrong: 1 } }),
    /incorrecta debe ser un entero menor o igual que cero/,
  );
  assert.throws(
    () => parseContestScoring({ hard: { correct: 2.5, wrong: -1 } }),
    /entero/,
  );
});

test("el puntaje inicial compensa lo que se puede perder: 15 preguntas estándar dan 45", () => {
  const tasks = [
    ...Array(5).fill({ difficulty: "easy", minScore: -2, maxScore: 6 }),
    ...Array(5).fill({ difficulty: "medium", minScore: -3, maxScore: 9 }),
    ...Array(5).fill({ difficulty: "hard", minScore: -4, maxScore: 12 }),
  ];
  assert.equal(initialScoreOf(tasks), 45);
  assert.equal(initialScoreOf([]), 0);
  assert.deepEqual(contestRules(tasks), {
    initialScore: 45,
    scoring: [
      { difficulty: "easy", count: 5, correct: 6, wrong: -2 },
      { difficulty: "medium", count: 5, correct: 9, wrong: -3 },
      { difficulty: "hard", count: 5, correct: 12, wrong: -4 },
    ],
  });
  // Una dificultad sin preguntas no aparece en las reglas.
  assert.deepEqual(
    contestRules(tasks.slice(0, 5)).scoring.map((rule) => rule.difficulty),
    ["easy"],
  );
});

test("las categorías se limpian, sin repetir y en el orden oficial", () => {
  assert.deepEqual(
    CONTEST_CATEGORY_NAMES,
    BEBRAS_CATEGORIES.map((category) => category.name),
  );
  assert.deepEqual(
    normalizeCategories(["Kuntur", "Titi", "Titi", "Inventada", 3]),
    ["Titi", "Kuntur"],
  );
  assert.deepEqual(normalizeCategories("Titi"), []);
  assert.deepEqual(
    contestCategories({ categories: '["Jucumari","Capibara"]' }),
    ["Capibara", "Jucumari"],
  );
  assert.deepEqual(contestCategories({ categories: "no es JSON" }), []);
});

test("un grupo con categoría solo admite la suya; sin categoría, las del desafío", () => {
  const contest = { categories: '["Capibara","Titi"]' };
  assert.deepEqual(groupCategories({ category: "Titi", contest }), ["Titi"]);
  assert.deepEqual(groupCategories({ category: null, contest }), [
    "Capibara",
    "Titi",
  ]);
  // Una categoría que el desafío ya no tiene no se respeta.
  assert.deepEqual(groupCategories({ category: "Kuntur", contest }), [
    "Capibara",
    "Titi",
  ]);
});

test("cada curso pertenece a su categoría, y Kuntur es quinto y sexto de secundaria", () => {
  assert.deepEqual(
    gradesForCategories(["Kuntur"]).map((grade) => grade.value),
    ["S5", "S6"],
  );
  assert.deepEqual(
    gradesForCategories(["Guacamayo", "Titi"]).map((grade) => grade.value),
    ["P1", "P2", "P5", "P6"],
  );
  assert.equal(gradesForCategories([]).length, 12);
  assert.equal(gradesForCategories(["Inventada"]).length, 12);
});

test("el curso se valida contra las categorías del desafío", () => {
  assert.equal(parseGrade(" P3 ", ["Capibara"]), "P3");
  assert.equal(parseGrade("S6", []), "S6");
  assert.throws(() => parseGrade("", ["Titi"]), /Debes indicar el curso/);
  assert.throws(() => parseGrade(undefined, ["Titi"]), /Debes indicar el curso/);
  assert.throws(() => parseGrade("P9", ["Titi"]), /no es válido/);
  assert.throws(
    () => parseGrade("P1", ["Titi", "Kuntur"]),
    /1\.º de primaria es de la categoría Guacamayo, que no participa en este desafío \(Titi, Kuntur\)/,
  );
});

test("el equipo rinde la categoría de su curso, o la única del desafío si no tiene curso", () => {
  assert.equal(teamCategory("P5", ["Capibara", "Titi"]), "Titi");
  assert.equal(teamCategory("P5", ["Capibara"]), "Capibara");
  assert.equal(teamCategory(null, ["Jucumari"]), "Jucumari");
  assert.equal(teamCategory(null, ["Capibara", "Titi"]), null);
  assert.equal(teamCategory("S5", ["Capibara", "Titi"]), null);
});
