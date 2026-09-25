import type {
  ContentBlock,
  ContentImage,
  StoredTaskDragDropItem,
  StoredTaskDragDropTarget,
} from "@/lib/task-schema";

import { publicRequest as request } from "@/lib/api-client";

export type PlayAnswerOption = {
  id: string;
  blocks: ContentBlock[];
};

export type PlayTask = {
  taskId: string;
  position: number;
  title: string;
  bodyBlocks: ContentBlock[];
  challengeBlocks: ContentBlock[];
  answerType: string;
  answerConfig?: Record<string, unknown>;
  multipleChoiceOrderMode: string;
  multipleChoiceMode: "single" | "any" | "all";
  answers: PlayAnswerOption[];
  dragDropBackground: (ContentImage & { widthPercent?: number }) | null;
  dragDropItems: Pick<
    StoredTaskDragDropItem,
    "id" | "label" | "image" | "widthPercent"
  >[];
  dragDropTargets: StoredTaskDragDropTarget[];
  explanation?: string;
  explanationBlocks?: ContentBlock[];
  correct?: boolean | null;
};

export type AttemptResult = {
  totalScore: number;
  correctCount: number;
  answeredCount: number;
  rankPosition: number | null;
};

export type AttemptState = {
  contestTitle: string;
  durationMinutes: number;
  questionDisplayMode: "one_by_one" | "all";
  contestStartsAt: string | null;
  contestEndsAt: string | null;
  state: string;
  status: "pending" | "in_progress" | "finished";
  startedAt: string | null;
  endsAt: string | null;
  /** Coincide con `endsAt` cuando el intento se cerró porque se acabó el tiempo. */
  finishedAt: string | null;
  suspendedAt: string | null;
  resultsPublished: boolean;
  showFeedback: boolean;
  showSolutions: boolean;
  showTotalScore: boolean;
  tasks: PlayTask[];
  answers: Record<string, unknown>;
  result: AttemptResult | null;
};

export { answerHasResponse } from "./answer-presence";

const PLAY_SESSION_KEY = "bebras_play_session";

export function readPlaySession() {
  if (typeof window === "undefined") {
    return "";
  }

  try {
    return window.localStorage.getItem(PLAY_SESSION_KEY) ?? "";
  } catch {
    return "";
  }
}

export function storePlaySession(sessionToken: string) {
  try {
    window.localStorage.setItem(PLAY_SESSION_KEY, sessionToken);
  } catch {
    return;
  }
}

export function forgetPlaySession() {
  try {
    window.localStorage.removeItem(PLAY_SESSION_KEY);
  } catch {
    return;
  }
}

function playRequest<T>(path: string, options: RequestInit = {}) {
  const sessionToken = readPlaySession();

  return request<T>(path, {
    ...options,
    headers: sessionToken ? { "x-play-session": sessionToken } : undefined,
  });
}

export type PlaySession = {
  sessionToken: string;
  groupName: string;
  contestTitle: string;
  participationMode: string;
  memberOneFirstName: string;
  memberOneLastName: string;
  memberTwoFirstName: string | null;
  memberTwoLastName: string | null;
};

/** Una practica no se inscribe: el codigo mas un nombre abren la sesion. */
export function enterPractice(accessCode: string, name: string) {
  return request<PlaySession>(
    `/api/play/practice/${encodeURIComponent(accessCode)}/enter`,
    { method: "POST", body: JSON.stringify({ name }) },
  );
}

/** El codigo personal se entrega al inscribirse y es lo unico que abre la
 *  sesion: el codigo del grupo solo sirve para inscribirse. */
export function openPlaySession(personalCode: string) {
  return request<PlaySession>("/api/play/session", {
    method: "POST",
    body: JSON.stringify({ personalCode }),
  });
}

export function closePlaySession() {
  return playRequest<null>("/api/play/session/close", { method: "POST" });
}

export function sendPlayHeartbeat() {
  return playRequest<{ ok: boolean }>("/api/play/heartbeat", {
    method: "POST",
  });
}

export function getAttempt() {
  return playRequest<AttemptState>("/api/play/attempt");
}

export function startAttempt() {
  return playRequest<{ ok: boolean }>("/api/play/start", { method: "POST" });
}

export function saveAnswer(taskId: string, payload: unknown) {
  return playRequest<null>("/api/play/answer", {
    method: "POST",
    body: JSON.stringify({ taskId, payload }),
  });
}

export function submitAttempt() {
  return playRequest<{ ok: boolean }>("/api/play/submit", { method: "POST" });
}
