import type { ContentBlock } from "@/lib/task-schema";
import type { PlayTask } from "@/lib/play-api";
import { ApiError, optionalAuthRequest } from "@/lib/api-client";

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
async function get<T>(path: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await optionalAuthRequest<T>(path, {
        signal: AbortSignal.timeout(12000),
      });
    } catch (error) {
      const transient =
        !(error instanceof ApiError) ||
        error.status >= 500 ||
        error.status === 408 ||
        error.status === 429;
      if (!transient || attempt === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
    }
  }
}

// La práctica también está publicada como archivos estáticos: se lee de ahí
// sin gastar el Worker, y si falta o falla se pide a la API como siempre.
const CDN_URL = (import.meta.env.PUBLIC_CDN_URL ?? "").replace(/\/$/, "");

/** Igual que en el backend: sin tildes, para que la dirección no cambie. */
function practiceFileName(name: string) {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

async function published<T>(file: string, fallback: string) {
  if (CDN_URL) {
    try {
      const response = await fetch(`${CDN_URL}/practice/${file}`, {
        signal: AbortSignal.timeout(8000),
      });
      if (response.ok) return (await response.json()) as T;
    } catch {
      // Sigue con la API.
    }
  }
  return get<T>(fallback);
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
  cachedCategories = await published<PracticeCategory[]>(
    "categories.json",
    "/api/practice/categories",
  );
  return cachedCategories;
}

export async function listPracticeTasks(category: string) {
  const list = await published<PracticeTaskList>(
    `tasks/${practiceFileName(category)}.json`,
    `/api/practice/tasks?category=${encodeURIComponent(category)}`,
  );
  cachedTaskLists.set(category, list);
  return list;
}

export function getPracticeTask(id: string) {
  return published<PlayTask>(
    `task/${encodeURIComponent(id)}.json`,
    `/api/practice/tasks/${id}`,
  );
}

export function checkPracticeAnswer(id: string, payload: unknown) {
  return optionalAuthRequest<PracticeCheck>(`/api/practice/tasks/${id}/check`, {
    method: "POST",
    body: JSON.stringify({ payload }),
  });
}
