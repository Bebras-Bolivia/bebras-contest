import { API_BASE_URL, apiRequest as request } from "@/lib/api-client";
import { authorizationHeaders } from "@/lib/firebase-auth";
import type { ContestState } from "@/lib/contest-schema";

export type PracticeTask = {
  id: string;
  title: string;
  country?: string | null;
  difficulty: "easy" | "medium" | "hard";
};

export type StoredPractice = {
  id: string;
  /** El del grupo que nace con la práctica: es el que se reparte. */
  accessCode: string | null;
  title: string;
  category: string;
  durationMinutes: number;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  taskCount: number;
  groupCount: number;
  studentCount: number;
  resultCount: number;
  state: ContestState;
};

export type PracticeResults = {
  practice: {
    id: string;
    title: string;
    category: string;
    durationMinutes: number;
    startsAt: string | null;
    endsAt: string | null;
    state: ContestState;
  };
  tasks: {
    id: string;
    title: string;
    difficulty: PracticeTask["difficulty"];
    maxScore: number;
  }[];
  maxScore: number;
  results: {
    id: string;
    name: string;
    grade: string | null;
    totalScore: number;
    correctCount: number;
    answeredCount: number;
    taskCount: number;
    marks: string;
    finishedAt: string;
  }[];
  pending: { id: string; name: string; grade: string | null }[];
};

export type PracticeDraftInput = {
  title: string;
  category: string;
  durationMinutes: number;
  startsAt: string | null;
  endsAt: string | null;
  tasks: string[];
};

export function listPractices() {
  return request<StoredPractice[]>("/api/practices");
}

/** Solo las preguntas que el administrador liberó para práctica. */
export function listPracticeTasks(category: string) {
  return request<{ category: string; ageRange: string; tasks: PracticeTask[] }>(
    `/api/practices/tasks?category=${encodeURIComponent(category)}`,
  );
}

export function createPractice(practice: PracticeDraftInput) {
  return request<StoredPractice>("/api/practices", {
    method: "POST",
    body: JSON.stringify(practice),
  });
}

export function listPracticeResults(practiceId: string) {
  return request<PracticeResults>(`/api/practices/${practiceId}/results`);
}

export async function downloadPracticeResults(
  practiceId: string,
  name: string,
) {
  const response = await fetch(
    `${API_BASE_URL}/api/practices/${practiceId}/results.xlsx`,
    { headers: await authorizationHeaders() },
  );

  if (!response.ok) {
    throw new Error("No se pudieron descargar los resultados.");
  }

  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = `practica-${name}.xlsx`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function removePractice(practiceId: string) {
  return request<null>(`/api/practices/${practiceId}`, { method: "DELETE" });
}
