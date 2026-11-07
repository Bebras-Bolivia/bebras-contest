import { publicRequest } from "@/lib/api-client";
import type { PlayTask } from "@/lib/play-api";
import type { PracticeCheck } from "@/lib/practice-api";

const CODE_KEY = "bebras_practice_code";

export type StudentPracticeItem = {
  id: string;
  title: string;
  taskCount: number;
  endsAt: string | null;
};

export type StudentTestItem = {
  id: string;
  title: string;
  taskCount: number;
  durationMinutes: number;
  endsAt: string | null;
};

export type StudentPractice = {
  title: string;
  category: string;
  tasks: PlayTask[];
};

export type StudentPracticeSummary = {
  totalScore: number;
  correctCount: number;
  answeredCount: number;
  taskCount: number;
};

export function rememberPracticeCode(code: string) {
  try {
    window.sessionStorage.setItem(CODE_KEY, code);
  } catch {
    return;
  }
}

export function readPracticeCode() {
  try {
    return window.sessionStorage.getItem(CODE_KEY) ?? "";
  } catch {
    return "";
  }
}

function post<T>(path: string, body: Record<string, unknown>) {
  return publicRequest<T>(path, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function listStudentPractices(personalCode: string) {
  return post<{
    name?: string;
    practices: StudentPracticeItem[];
    tests?: StudentTestItem[];
  }>(
    "/api/play/practices",
    { personalCode },
  );
}

export function getStudentPractice(id: string, personalCode: string) {
  return post<StudentPractice>(`/api/play/practices/${id}/tasks`, {
    personalCode,
  });
}

export function checkStudentPractice(
  id: string,
  personalCode: string,
  taskId: string,
  payload: unknown,
) {
  return post<PracticeCheck>(`/api/play/practices/${id}/check`, {
    personalCode,
    taskId,
    payload,
  });
}

export function finishStudentPractice(
  id: string,
  personalCode: string,
  answers: Record<string, unknown>,
) {
  return post<StudentPracticeSummary>(`/api/play/practices/${id}/finish`, {
    personalCode,
    answers,
  });
}
