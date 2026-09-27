import type { ContentBlock } from "@/lib/task-schema";
import {
  type ContestState,
  type ContestDraftInput,
  type StoredContest,
} from "@/lib/contest-schema";
import { apiRequest as request } from "@/lib/api-client";

export function listContests() {
  return request<StoredContest[]>("/api/contests");
}

export function getContest(contestId: string) {
  return request<StoredContest>(`/api/contests/${contestId}`);
}

export function createContest(contest: ContestDraftInput) {
  return request<StoredContest>("/api/contests", {
    method: "POST",
    body: JSON.stringify(contest),
  });
}

export function updateContest(contestId: string, contest: ContestDraftInput) {
  return request<StoredContest>(`/api/contests/${contestId}`, {
    method: "PUT",
    body: JSON.stringify(contest),
  });
}

export function publishContest(contestId: string) {
  return request<StoredContest>(`/api/contests/${contestId}/publish`, {
    method: "POST",
  });
}

export function suspendContest(contestId: string) {
  return request<StoredContest>(`/api/contests/${contestId}/suspend`, {
    method: "POST",
  });
}

export function resumeContest(contestId: string) {
  return request<StoredContest & { resumedAttempts: number }>(
    `/api/contests/${contestId}/resume`,
    { method: "POST" },
  );
}

export function consolidateContest(contestId: string) {
  return request<StoredContest & { closedAttempts: number }>(
    `/api/contests/${contestId}/consolidate`,
    { method: "POST" },
  );
}

export function publishContestResults(contestId: string) {
  return request<StoredContest>(`/api/contests/${contestId}/results/publish`, {
    method: "POST",
  });
}

export function unpublishContestResults(contestId: string) {
  return request<StoredContest>(
    `/api/contests/${contestId}/results/unpublish`,
    {
      method: "POST",
    },
  );
}

export function removeContest(contestId: string) {
  return request<null>(`/api/contests/${contestId}`, {
    method: "DELETE",
  });
}

export type ContestResultRow = {
  teamId: string;
  category: string | null;
  groupName: string;
  participationMode: string;
  grade: string | null;
  memberOneFirstName: string;
  memberOneLastName: string;
  memberTwoFirstName: string | null;
  memberTwoLastName: string | null;
  status: string;
  elapsedSeconds: number | null;
  totalScore: number | null;
  correctCount: number | null;
  answeredCount: number | null;
  rankPosition: number | null;
};

export type ContestResults = {
  contestTitle: string;
  categories: string[];
  taskCounts: Record<string, number>;
  state: ContestState;
  rows: ContestResultRow[];
};

export function getContestResults(contestId: string) {
  return request<ContestResults>(`/api/contests/${contestId}/results`);
}

export type ContestPreviewScore = {
  totalScore: number;
  correctCount: number;
  answeredCount: number;
  taskCount: number;
  tasks: Array<{
    taskId: string;
    position: number;
    title: string;
    answered: boolean;
    correct: boolean;
    score: number;
    explanationBlocks?: ContentBlock[];
  }>;
};

/** El desafío tal como lo recibe el estudiante, sin crear ningún intento. */
export function getContestPreview(contestId: string, category?: string | null) {
  const query = category ? `?categoria=${encodeURIComponent(category)}` : "";
  return request<unknown>(`/api/contests/${contestId}/preview${query}`);
}

export function scoreContestPreview(
  contestId: string,
  answers: Record<string, unknown>,
  category?: string | null,
) {
  return request<ContestPreviewScore>(
    `/api/contests/${contestId}/preview/score`,
    {
      method: "POST",
      body: JSON.stringify({ answers, category }),
    },
  );
}
