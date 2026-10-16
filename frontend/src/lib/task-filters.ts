import { answerTypes, type AnswerType } from "@/lib/task-schema";
import { BEBRAS_CATEGORIES } from "@/lib/contest-schema";
import { difficultyStyles } from "@/lib/difficulty";
import { TASK_VISIBILITIES, type TaskVisibility } from "@/lib/task-visibility";
import type { HomeTaskItem } from "@/lib/tasks-api";

export type Filters = {
  type: AnswerType | "all";
  age: string;
  difficulty: string;
  visibility: TaskVisibility | "all";
  year: string;
  query: string;
};

export const NO_FILTERS: Filters = {
  type: "all",
  age: "all",
  difficulty: "all",
  visibility: "all",
  year: "all",
  query: "",
};

export const DIFFICULTIES = ["easy", "medium", "hard"] as const;

const FILTERS_STORAGE_KEY = "tareas-filtros";

export function storedFilters() {
  try {
    return window.sessionStorage.getItem(FILTERS_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function readFilters(
  search = window.location.search || storedFilters(),
): Filters {
  const params = new URLSearchParams(search);
  const type = params.get("tipo");
  const age =
    BEBRAS_CATEGORIES.find((category) => category.name === params.get("edad"))
      ?.name ?? "all";
  const difficulty = params.get("dificultad");
  return {
    type: answerTypes.find((value) => value === type) ?? "all",
    age,
    difficulty:
      age !== "all" && DIFFICULTIES.some((value) => value === difficulty)
        ? (difficulty as string)
        : "all",
    visibility:
      TASK_VISIBILITIES.find((item) => item.value === params.get("visible"))
        ?.value ?? (params.get("practica") === "1" ? "practica" : "all"),
    year: /^\d{4}$/.test(params.get("origen") ?? "")
      ? (params.get("origen") as string)
      : "all",
    query: params.get("q") ?? "",
  };
}

export function writeFilters(filters: Filters) {
  const url = new URL(window.location.href);
  for (const [key, value] of [
    ["tipo", filters.type],
    ["edad", filters.age],
    ["dificultad", filters.difficulty],
    ["visible", filters.visibility],
    ["origen", filters.year],
    ["q", filters.query.trim() || "all"],
  ] as const) {
    if (value === "all") url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  window.history.replaceState(window.history.state, "", url);
  try {
    window.sessionStorage.setItem(FILTERS_STORAGE_KEY, url.search);
  } catch {
    // sin almacenamiento los filtros solo viven en la dirección
  }
}

export function fold(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export function levelFor(task: HomeTaskItem, age: string) {
  return task.levels.find((level) => level.name === age);
}

export function matches(
  task: HomeTaskItem,
  filters: Filters,
  skip?: "type" | "age" | "difficulty" | "year",
) {
  if (skip !== "type" && filters.type !== "all") {
    if (task.answerType !== filters.type) return false;
  }
  if (
    skip !== "year" &&
    filters.year !== "all" &&
    String(task.year) !== filters.year
  ) {
    return false;
  }
  if (skip !== "age" && filters.age !== "all") {
    const level = levelFor(task, filters.age);
    if (!level) return false;
    if (skip !== "difficulty" && filters.difficulty !== "all") {
      if (level.difficulty !== filters.difficulty) return false;
    }
  }
  if (filters.visibility !== "all" && task.visibility !== filters.visibility) {
    return false;
  }
  const query = fold(filters.query.trim());
  if (query) {
    const haystack = fold(
      [task.title, task.sourceTaskCode, task.country].filter(Boolean).join(" "),
    );
    if (!haystack.includes(query)) return false;
  }
  return true;
}

export function difficultyRank(task: HomeTaskItem, age: string) {
  return difficultyStyles[levelFor(task, age)?.difficulty ?? ""]?.rank ?? 3;
}

/** Las tareas en el orden en que la lista las muestra con esos filtros. */
export function visibleTasks(tasks: HomeTaskItem[], filters: Filters) {
  const matching = tasks.filter((task) => matches(task, filters));
  return filters.age === "all"
    ? matching
    : [...matching].sort(
        (a, b) =>
          difficultyRank(a, filters.age) - difficultyRank(b, filters.age),
      );
}
