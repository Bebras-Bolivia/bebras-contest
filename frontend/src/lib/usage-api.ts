import { apiRequest, publicRequest } from "@/lib/api-client";
import { readPlaySession } from "@/lib/play-api";

export type UsageRow = {
  code: string;
  name: string;
  grade: string | null;
  category: string | null;
  status: "pending" | "in_progress" | "finished";
  seconds: number | null;
  closedBy: "student" | "timeout" | null;
  totalScore: number | null;
  correctCount: number | null;
  answeredCount: number | null;
  device: { kind: "mobile" | "desktop"; width: number; height: number } | null;
  stars: number | null;
  comment: string | null;
};

export type ContestUsage = {
  contestTitle: string;
  collectUsage: boolean;
  rows: UsageRow[];
  summary: {
    students: number;
    finished: number;
    reviewed: number;
    averageStars: number | null;
  };
};

export function getContestUsage(contestId: string) {
  return apiRequest<ContestUsage>(`/api/contests/${contestId}/usage`);
}

export function setContestUsage(contestId: string, enabled: boolean) {
  return apiRequest<{ collectUsage: boolean }>(
    `/api/contests/${contestId}/usage-setting`,
    { method: "PUT", body: JSON.stringify({ enabled }) },
  );
}

function usageDevice() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  return {
    kind: coarse && Math.min(width, height) < 820 ? "mobile" : "desktop",
    width,
    height,
  };
}

export function sendUsageReview(stars: number | null, comment: string) {
  return publicRequest<null>("/api/play/review", {
    method: "POST",
    headers: { "x-play-session": readPlaySession() },
    body: JSON.stringify({ stars, comment, device: usageDevice() }),
  });
}
