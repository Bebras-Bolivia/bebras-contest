import {
  normalizeCategories,
  type AnswerType,
  type StoredTask,
} from "@/lib/task-schema";
import { BEBRAS_CATEGORIES } from "@/lib/contest-schema";
import { apiRequest as request } from "@/lib/api-client";
import type { PlayTask } from "@/lib/play-api";
import type { ContentBlock } from "@/lib/task-schema";

export type HomeTaskItem = {
  id: string;
  title: string;
  country: string | null;
  year: number | null;
  sourceTaskCode: string | null;
  categories: string[];
  levels: { name: string; ageRange: string; difficulty: string }[];
  answerType: AnswerType;
  isPractice: boolean;
};

export function listTasks() {
  return request<StoredTask[]>("/api/tasks");
}

export function getTask(taskId: string) {
  return request<StoredTask>(`/api/tasks/${taskId}`);
}

export function previewTask(taskId: string, signal?: AbortSignal) {
  return request<PlayTask>(`/api/tasks/${encodeURIComponent(taskId)}/preview`, {
    signal,
  });
}

export type TaskCheckResult = {
  correct: boolean;
  explanationBlocks: ContentBlock[];
};

export function checkTask(
  taskId: string,
  payload: unknown,
  signal?: AbortSignal,
) {
  return request<TaskCheckResult>(
    `/api/tasks/${encodeURIComponent(taskId)}/check`,
    {
      method: "POST",
      body: JSON.stringify({ payload }),
      signal,
    },
  );
}

/** Prueba lo que hay en el editor: la tarea viaja entera, sin pasar por la base. */
export function previewTaskDraft(task: unknown, signal?: AbortSignal) {
  return request<PlayTask>("/api/tasks/draft/preview", {
    method: "POST",
    body: JSON.stringify(task),
    signal,
  });
}

export function checkTaskDraft(
  task: unknown,
  payload: unknown,
  signal?: AbortSignal,
) {
  return request<TaskCheckResult>("/api/tasks/draft/check", {
    method: "POST",
    body: JSON.stringify({ task, payload }),
    signal,
  });
}

export function createTask(task: Omit<StoredTask, "id"> & { id?: string }) {
  return request<StoredTask>("/api/tasks", {
    method: "POST",
    body: JSON.stringify(task),
  });
}

export function updateTask(task: StoredTask) {
  return request<StoredTask>(`/api/tasks/${task.id}`, {
    method: "PUT",
    body: JSON.stringify(task),
  });
}

export function removeTask(taskId: string) {
  return request<null>(`/api/tasks/${taskId}`, {
    method: "DELETE",
  });
}

export function setTaskPractice(taskId: string, isPractice: boolean) {
  return request<{ id: string; isPractice: boolean }>(
    `/api/tasks/${taskId}/practice`,
    {
      method: "PATCH",
      body: JSON.stringify({ isPractice }),
    },
  );
}

export function mapTaskToHomeItem(task: StoredTask): HomeTaskItem {
  return {
    id: task.id,
    title: task.title,
    country: task.country ?? null,
    year: task.year ?? null,
    sourceTaskCode: task.sourceTaskCode ?? null,
    categories: normalizeCategories(task.categories),
    levels: BEBRAS_CATEGORIES.map((category) => ({
      name: category.name,
      ageRange: category.ageRange,
      difficulty: (task.difficulties[category.ageRange] ?? "").trim(),
    })).filter((level) => level.difficulty !== ""),
    answerType: task.answerType,
    isPractice: Boolean((task as { isPractice?: boolean }).isPractice),
  };
}
