import { difficultyStyles } from "@/lib/difficulty";
import { type CategoryItem, type DifficultyKey } from "@/lib/task-schema";

/**
 * Categorías oficiales de Bebras Bolivia con el rango de edad del que cada una
 * toma la dificultad de las tareas. Fuente única: todo lo demás se deriva de
 * aquí, y el tipo DifficultyKey obliga a que el rango exista en task-schema,
 * así que las categorías de tareas y de desafíos no pueden separarse.
 * (Origen del listado: el CMS, bebras-bolivia/cms/content/current/data/categories.json.)
 */
export const BEBRAS_CATEGORIES = [
  { name: "Guacamayo", ageRange: "5–8" },
  { name: "Capibara", ageRange: "8–10" },
  { name: "Titi", ageRange: "10–12" },
  { name: "Jucumari", ageRange: "12–14" },
  { name: "Yaguareté", ageRange: "14–16" },
  { name: "Kuntur", ageRange: "17–18" },
] as const satisfies ReadonlyArray<{ name: string; ageRange: DifficultyKey }>;

function ageLabel(ageRange: string) {
  return `${ageRange.replace("–", "-")} años`;
}

export const CONTEST_CATEGORIES = BEBRAS_CATEGORIES.map((category) => ({
  name: category.name,
  age: ageLabel(category.ageRange),
}));

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

export type SchoolGrade = (typeof SCHOOL_GRADES)[number];

/** Cursos que admite un desafío; sin categorías, los doce. */
export function gradesForCategories(categories: readonly string[]) {
  const grades = SCHOOL_GRADES.filter((grade) =>
    categories.includes(grade.category),
  );
  return grades.length > 0 ? grades : [...SCHOOL_GRADES];
}

export const CATEGORY_NAMES: string[] = BEBRAS_CATEGORIES.map(
  (category) => category.name,
);

export function gradeLabel(value: string | null) {
  return SCHOOL_GRADES.find((grade) => grade.value === value)?.label ?? "—";
}

/** Estado derivado del desafío (no es un campo editable). */
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

export type ContestTaskSummary = {
  id: string;
  title: string;
  country: string | null;
  year: number | null;
  sourceTaskCode: string | null;
  categories: CategoryItem[];
  difficulties: Record<DifficultyKey, string>;
  status: string;
};

export type StoredContestTask = {
  id: string;
  category: string;
  position: number;
  taskId: string;
  difficulty: TaskDifficulty;
  minScore: number;
  noAnswerScore: number;
  maxScore: number;
  task: ContestTaskSummary;
};

export type ContestTaskConfigInput = {
  taskId: string;
  category: string;
};

/** Puntajes estándar de Bebras: el punto de partida, editable por desafío. */
export const BEBRAS_SCORING = {
  easy: { label: "Fácil", correct: 6, wrong: -2 },
  medium: { label: "Medio", correct: 9, wrong: -3 },
  hard: { label: "Difícil", correct: 12, wrong: -4 },
} as const;

export const DIFFICULTY_KEYS = ["easy", "medium", "hard"] as const;

export function difficultyLabel(value: string) {
  return isTaskDifficulty(value) ? BEBRAS_SCORING[value].label : "";
}

export function difficultyBadgeClass(value: string) {
  return difficultyStyles[value]?.className ?? "";
}

export type ContestScoring = Record<
  TaskDifficulty,
  { correct: number; wrong: number }
>;

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

export function isStandardScoring(scoring: ContestScoring) {
  return DIFFICULTY_KEYS.every(
    (key) =>
      scoring[key].correct === BEBRAS_SCORING[key].correct &&
      scoring[key].wrong === BEBRAS_SCORING[key].wrong,
  );
}

export type TaskDifficulty = keyof typeof BEBRAS_SCORING;

/** Nombre de la categoría que cubre un rango de edad de las tareas. */
export function categoryForAgeRange(ageRange: string) {
  return (
    BEBRAS_CATEGORIES.find((category) => category.ageRange === ageRange)
      ?.name ?? null
  );
}

export const CATEGORY_AGE_RANGE: Record<string, DifficultyKey> =
  Object.fromEntries(
    BEBRAS_CATEGORIES.map((category) => [category.name, category.ageRange]),
  );

export function isTaskDifficulty(value: unknown): value is TaskDifficulty {
  return value === "easy" || value === "medium" || value === "hard";
}

export function taskDifficultyForCategory(
  difficulties: Record<string, string>,
  category: string,
) {
  const range = CATEGORY_AGE_RANGE[category];

  if (!range) {
    return null;
  }

  const value = difficulties[range];
  return isTaskDifficulty(value) ? value : null;
}

export type QuestionDisplayMode = "one_by_one" | "all";

export type StoredContest = {
  id: string;
  title: string;
  categories: string[];
  durationMinutes: number;
  registrationStartsAt: string | null;
  registrationEndsAt: string | null;
  /** El calendario se define cuando el organizador quiere; sin él no se publica. */
  startsAt: string | null;
  endsAt: string | null;
  /** Cuándo se publican solos los resultados; sin fecha, al cerrar la rendición. */
  resultsAt: string | null;
  initialScores: Record<string, number>;
  scoring: ContestScoring;
  questionDisplayMode: QuestionDisplayMode;
  allowPairs: boolean;
  shuffleOptions: boolean;
  showFeedback: boolean;
  showSolutions: boolean;
  showTotalScore: boolean;
  showScoreOnSubmit: boolean;
  showFeedbackOnSubmit: boolean;
  showSolutionsOnSubmit: boolean;
  publishedAt: string | null;
  suspendedAt: string | null;
  consolidatedAt: string | null;
  resultsPublishedAt: string | null;
  state: ContestState;
  isOpen: boolean;
  createdAt: string;
  updatedAt: string;
  taskCount: number;
  tasks: StoredContestTask[];
};

export type ContestDraftInput = {
  title: string;
  categories: string[];
  durationMinutes: number;
  registrationStartsAt: string;
  registrationEndsAt: string;
  startsAt: string;
  endsAt: string;
  resultsAt: string;
  scoring: ContestScoring;
  questionDisplayMode: QuestionDisplayMode;
  allowPairs: boolean;
  shuffleOptions: boolean;
  showFeedback: boolean;
  showSolutions: boolean;
  showTotalScore: boolean;
  showScoreOnSubmit: boolean;
  showFeedbackOnSubmit: boolean;
  showSolutionsOnSubmit: boolean;
  tasks: ContestTaskConfigInput[];
};

export const CONTEST_STATE_LABELS: Record<ContestState, string> = {
  borrador: "Borrador",
  programada: "Publicado",
  inscripcion: "Inscripción abierta",
  preparacion: "Inscripción cerrada",
  abierta: "En curso",
  suspendida: "Pausado",
  cerrada: "Terminado",
  consolidada: "Resultados listos",
  publicada: "Resultados publicados",
};

export function formatContestWindow(
  startsAt: string | null,
  endsAt: string | null,
) {
  if (!startsAt || !endsAt) {
    return "sin definir";
  }

  const start = new Date(startsAt);
  const end = new Date(endsAt);

  return `${start.toLocaleString("es-BO", {
    dateStyle: "short",
    timeStyle: "short",
  })} - ${end.toLocaleString("es-BO", {
    dateStyle: "short",
    timeStyle: "short",
  })}`;
}

export function toDatetimeLocalValue(value: string) {
  const date = new Date(value);
  const timezoneOffset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 16);
}

export function fromDatetimeLocalValue(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}
