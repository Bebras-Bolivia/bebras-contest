import { parseJsonValue } from "./json";

/**
 * Categorías oficiales de Bebras con su rango de edad. Fuente única del
 * backend: los rangos de las tareas, los nombres válidos de un desafío y las
 * categorías de práctica salen todos de aquí.
 */
export const BEBRAS_CATEGORIES = [
  { name: "Guacamayo", ageRange: "5–8" },
  { name: "Capibara", ageRange: "8–10" },
  { name: "Titi", ageRange: "10–12" },
  { name: "Jucumari", ageRange: "12–14" },
  { name: "Yaguareté", ageRange: "14–16" },
  { name: "Kuntur", ageRange: "17–18" },
] as const;

export const BEBRAS_SCORING = {
  easy: { correct: 6, wrong: -2 },
  medium: { correct: 9, wrong: -3 },
  hard: { correct: 12, wrong: -4 },
} as const;

export type DifficultyKey = keyof typeof BEBRAS_SCORING;

export function isDifficultyKey(value: unknown): value is DifficultyKey {
  return value === "easy" || value === "medium" || value === "hard";
}

export type ContestScoring = Record<
  DifficultyKey,
  { correct: number; wrong: number }
>;

export const DIFFICULTY_KEYS: DifficultyKey[] = ["easy", "medium", "hard"];

/** Puntajes estándar de Bebras, el punto de partida de todo desafío. */
export function defaultContestScoring(): ContestScoring {
  return {
    easy: {
      correct: BEBRAS_SCORING.easy.correct,
      wrong: BEBRAS_SCORING.easy.wrong,
    },
    medium: {
      correct: BEBRAS_SCORING.medium.correct,
      wrong: BEBRAS_SCORING.medium.wrong,
    },
    hard: {
      correct: BEBRAS_SCORING.hard.correct,
      wrong: BEBRAS_SCORING.hard.wrong,
    },
  };
}

/**
 * Lee los puntajes editados a mano. Cada dificultad que falte o venga mal
 * cae en el estándar, así que el resultado siempre está completo.
 */
export function parseContestScoring(value: unknown): ContestScoring {
  const scoring = defaultContestScoring();

  if (!value || typeof value !== "object") {
    return scoring;
  }

  const raw = value as Record<string, unknown>;

  for (const key of DIFFICULTY_KEYS) {
    const entry = raw[key];

    if (!entry || typeof entry !== "object") {
      continue;
    }

    const { correct, wrong } = entry as Record<string, unknown>;
    const correctScore = Number(correct);
    const wrongScore = Number(wrong);

    if (!Number.isInteger(correctScore) || correctScore <= 0) {
      throw new Error(
        "El puntaje de una respuesta correcta debe ser un entero mayor que cero.",
      );
    }

    if (!Number.isInteger(wrongScore) || wrongScore > 0) {
      throw new Error(
        "El puntaje de una respuesta incorrecta debe ser un entero menor o igual que cero.",
      );
    }

    scoring[key] = { correct: correctScore, wrong: wrongScore };
  }

  return scoring;
}

export function scoresForDifficulty(
  difficulty: DifficultyKey,
  scoring: ContestScoring,
) {
  return {
    difficulty,
    minScore: scoring[difficulty].wrong,
    noAnswerScore: 0,
    maxScore: scoring[difficulty].correct,
  };
}

export function initialScoreOf(tasks: Array<{ minScore: number }>) {
  return tasks.reduce((total, task) => total - task.minScore, 0);
}

/** Lo que el estudiante lee antes de empezar: cuánto vale cada pregunta. */
export function contestRules(
  tasks: Array<{ difficulty: string; minScore: number; maxScore: number }>,
) {
  return {
    initialScore: initialScoreOf(tasks),
    scoring: DIFFICULTY_KEYS.flatMap((difficulty) => {
      const ofDifficulty = tasks.filter(
        (task) => task.difficulty === difficulty,
      );
      return ofDifficulty.length > 0
        ? [
            {
              difficulty,
              count: ofDifficulty.length,
              correct: ofDifficulty[0].maxScore,
              wrong: ofDifficulty[0].minScore,
            },
          ]
        : [];
    }),
  };
}

export const CONTEST_CATEGORY_NAMES: string[] = BEBRAS_CATEGORIES.map(
  (category) => category.name,
);

/** Categorías válidas, sin repetir y en el orden oficial. */
export function normalizeCategories(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [];
  return CONTEST_CATEGORY_NAMES.filter((name) => list.includes(name));
}

export function contestCategories(contest: { categories: string }) {
  return normalizeCategories(parseJsonValue<unknown>(contest.categories, []));
}

/** Categorías en las que se puede inscribir un grupo: la suya o, si no tiene, las del desafío. */
export function groupCategories(group: {
  category: string | null;
  contest: { categories: string };
}) {
  const categories = contestCategories(group.contest);
  return group.category && categories.includes(group.category)
    ? [group.category]
    : categories;
}

export const SCHOOL_GRADES = [
  { value: "P1", label: "1.º de primaria", category: "Guacamayo" },
  { value: "P2", label: "2.º de primaria", category: "Guacamayo" },
  { value: "P3", label: "3.º de primaria", category: "Capibara" },
  { value: "P4", label: "4.º de primaria", category: "Capibara" },
  { value: "P5", label: "5.º de primaria", category: "Titi" },
  { value: "P6", label: "6.º de primaria", category: "Titi" },
  { value: "S1", label: "1.º de secundaria", category: "Jucumari" },
  { value: "S2", label: "2.º de secundaria", category: "Jucumari" },
  { value: "S3", label: "3.º de secundaria", category: "Yaguareté" },
  { value: "S4", label: "4.º de secundaria", category: "Yaguareté" },
  { value: "S5", label: "5.º de secundaria", category: "Kuntur" },
  { value: "S6", label: "6.º de secundaria", category: "Kuntur" },
] as const;

/** Cursos que admite un desafío; sin categorías, los doce. */
export function gradesForCategories(categories: string[]) {
  const grades = SCHOOL_GRADES.filter((grade) =>
    categories.includes(grade.category),
  );
  return grades.length > 0 ? grades : SCHOOL_GRADES.slice();
}

export function parseGrade(value: unknown, categories: string[]) {
  const grade = typeof value === "string" ? value.trim() : "";

  if (!grade) {
    throw new Error("Debes indicar el curso del participante.");
  }

  const known = SCHOOL_GRADES.find((item) => item.value === grade);

  if (!known) {
    throw new Error("El curso indicado no es válido.");
  }

  if (categories.length > 0 && !categories.includes(known.category)) {
    throw new Error(
      `${known.label} es de la categoría ${known.category}, que no participa en este desafío (${categories.join(", ")}).`,
    );
  }

  return grade;
}

/**
 * Categoría en la que rinde un equipo: la de su curso. Los equipos sin curso
 * (las prácticas) rinden la única categoría del desafío.
 */
export function teamCategory(grade: string | null, categories: string[]) {
  const fromGrade = SCHOOL_GRADES.find(
    (item) => item.value === grade,
  )?.category;

  if (fromGrade && categories.includes(fromGrade)) {
    return fromGrade;
  }

  return categories.length === 1 ? categories[0] : null;
}

export type ContestState =
  | "borrador"
  | "programada"
  | "inscripcion"
  | "preparacion"
  | "abierta"
  | "suspendida"
  | "cerrada"
  | "consolidada"
  | "publicada";

export const ENDED_CONTEST_STATES: ContestState[] = [
  "cerrada",
  "consolidada",
  "publicada",
];

export function contestHasEnded(state: ContestState) {
  return ENDED_CONTEST_STATES.includes(state);
}

export function registrationOpenAt(
  now: Date,
  contest: {
    registrationStartsAt?: Date | null;
    registrationEndsAt?: Date | null;
    publishedAt: Date | null;
    startsAt: Date | null;
    endsAt: Date | null;
    isPractice?: boolean;
  },
) {
  if (!contest.publishedAt) {
    return false;
  }

  // Una práctica no tiene fase de inscripción: admite grupos mientras dure.
  if (contest.isPractice) {
    return !contestHasEnded(contestStateAt(now, contest).state);
  }

  // Sin ventana propia, la inscripción dura hasta que empieza la rendición.
  if (!contest.registrationStartsAt || !contest.registrationEndsAt) {
    return contestStateAt(now, contest).state === "inscripcion";
  }

  return (
    now >= contest.registrationStartsAt && now < contest.registrationEndsAt
  );
}

export function contestStateAt(
  now: Date,
  contest: {
    publishedAt: Date | null;
    suspendedAt?: Date | null;
    consolidatedAt?: Date | null;
    resultsPublishedAt?: Date | null;
    registrationStartsAt?: Date | null;
    registrationEndsAt?: Date | null;
    startsAt: Date | null;
    endsAt: Date | null;
    isPractice?: boolean;
  },
): { state: ContestState; isOpen: boolean } {
  if (!contest.publishedAt) {
    return { state: "borrador", isOpen: false };
  }

  if (!contest.startsAt || !contest.endsAt || now < contest.startsAt) {
    // Una práctica no tiene inscripción: solo espera su horario.
    if (contest.isPractice) {
      return {
        state: contest.startsAt ? "programada" : "preparacion",
        isOpen: false,
      };
    }

    // Las fechas son opcionales al publicar: sin ventana de inscripción, la
    // inscripción queda abierta hasta que empiece la rendición.
    if (!contest.registrationStartsAt || !contest.registrationEndsAt) {
      return { state: "inscripcion", isOpen: false };
    }

    if (now < contest.registrationStartsAt) {
      return { state: "programada", isOpen: false };
    }

    if (now < contest.registrationEndsAt) {
      return { state: "inscripcion", isOpen: false };
    }

    return { state: "preparacion", isOpen: false };
  }

  // Una pausa se mantiene aunque pase la hora de cierre: al reanudar, el
  // cierre se corre lo que duró la pausa.
  if (contest.suspendedAt) {
    return { state: "suspendida", isOpen: false };
  }

  if (now > contest.endsAt) {
    if (contest.resultsPublishedAt) {
      return { state: "publicada", isOpen: false };
    }

    if (contest.consolidatedAt) {
      return { state: "consolidada", isOpen: false };
    }

    return { state: "cerrada", isOpen: false };
  }

  return { state: "abierta", isOpen: true };
}

/** Desde cuándo y hasta cuándo un desafío muestra sus resultados. */
export function resultsWindow(contest: {
  endsAt: Date | null;
  resultsAt: Date | null;
  resultsUntil: Date | null;
}) {
  if (!contest.endsAt) {
    return { from: null, until: null };
  }
  const from =
    contest.resultsAt && contest.resultsAt > contest.endsAt
      ? contest.resultsAt
      : contest.endsAt;
  const until =
    contest.resultsUntil ?? new Date(from.getTime() + 7 * 24 * 3600000);
  return { from, until };
}
