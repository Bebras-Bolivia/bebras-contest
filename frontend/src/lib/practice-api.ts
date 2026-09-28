import type { ContentBlock } from "@/lib/task-schema";
import type { PlayTask } from "@/lib/play-api";
import { optionalAuthRequest } from "@/lib/api-client";

export type PracticeCategory = {
  name: string;
  age: string;
  count: number;
};

export type PracticeTaskItem = {
  id: string;
  title: string;
  answerType: string;
  difficulty: "easy" | "medium" | "hard" | null;
};

export type PracticeTaskList = {
  category: string;
  age: string;
  tasks: PracticeTaskItem[];
};

export type PracticeCheck = {
  correct: boolean;
  explanationBlocks?: ContentBlock[];
};

// Practicar es publico, pero mientras solo hay inscripcion la API queda
// restringida: si hay sesion, conviene mandarla para no chocar con un 401.
function get<T>(path: string) {
  return optionalAuthRequest<T>(path);
}

/** Lo último que se cargó: al volver a una pantalla ya vista se muestra al instante. */
let cachedCategories: PracticeCategory[] | null = null;
const cachedTaskLists = new Map<string, PracticeTaskList>();

export function cachedPracticeCategories() {
  return cachedCategories;
}

export function cachedPracticeTasks(category: string) {
  return cachedTaskLists.get(category) ?? null;
}

export async function listPracticeCategories() {
  cachedCategories = await get<PracticeCategory[]>("/api/practice/categories");
  return cachedCategories;
}

export async function listPracticeTasks(category: string) {
  const list = await get<PracticeTaskList>(
    `/api/practice/tasks?category=${encodeURIComponent(category)}`,
  );
  cachedTaskLists.set(category, list);
  return list;
}

export function getPracticeTask(id: string) {
  return get<PlayTask>(`/api/practice/tasks/${id}`);
}

export function checkPracticeAnswer(id: string, payload: unknown) {
  return optionalAuthRequest<PracticeCheck>(`/api/practice/tasks/${id}/check`, {
    method: "POST",
    body: JSON.stringify({ payload }),
  });
}
