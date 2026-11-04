import { API_BASE_URL, apiRequest } from "@/lib/api-client";
import { authorizationHeaders } from "@/lib/firebase-auth";

export type TrialResult = "alone" | "help" | "failed";
export type TrialRole = "maestro" | "admin";

export type TrialRun = {
  taskCode: string;
  result: TrialResult;
  seconds: number;
  comment: string | null;
};

export type TrialState = {
  role: TrialRole;
  tasks: string[];
  runs: TrialRun[];
  susDone: boolean;
  person: { firstName: string; lastName: string };
  teacher: { id: number; email: string; name: string } | null;
};

const session = (sessionId: string) => `/api/admin/trial/sessions/${sessionId}`;

export function createTrialSession(
  role: TrialRole,
  firstName: string,
  lastName: string,
) {
  return apiRequest<{ id: string }>("/api/admin/trial/sessions", {
    method: "POST",
    body: JSON.stringify({ role, firstName, lastName }),
  });
}

export function getTrialState(sessionId: string) {
  return apiRequest<TrialState>(session(sessionId));
}

export function saveTrialRun(
  sessionId: string,
  taskCode: string,
  result: TrialResult,
  seconds: number,
  comment: string,
) {
  return apiRequest<null>(`${session(sessionId)}/runs/${taskCode}`, {
    method: "PUT",
    body: JSON.stringify({ result, seconds, comment }),
  });
}

export function saveTrialSus(sessionId: string, answers: number[]) {
  return apiRequest<null>(`${session(sessionId)}/sus`, {
    method: "PUT",
    body: JSON.stringify({ answers }),
  });
}

export function prepareTrialTask(sessionId: string, taskCode: string) {
  return apiRequest<{
    note: string | null;
    planilla?: boolean;
    path?: string;
  }>(`${session(sessionId)}/prepare/${taskCode}`, { method: "POST" });
}

export function checkTrialTask(
  sessionId: string,
  taskCode: string,
  since: number,
) {
  return apiRequest<{ done: boolean; at: string | null }>(
    `${session(sessionId)}/check/${taskCode}?since=${since}`,
  );
}

export function deleteTrialSession(sessionId: string) {
  return apiRequest<null>(session(sessionId), { method: "DELETE" });
}

export async function downloadTrialPlanilla() {
  const response = await fetch(
    `${API_BASE_URL}/api/admin/trial/planilla.xlsx`,
    { headers: await authorizationHeaders() },
  );

  if (!response.ok) {
    throw new Error("No se pudo descargar la planilla.");
  }

  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = "planilla-de-ejemplo.xlsx";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function clearTrialScenarios() {
  return apiRequest<{ contests: number; users: number }>(
    "/api/admin/trial-scenarios",
    { method: "DELETE" },
  );
}

export type TrialParticipant = {
  id: string;
  code: string;
  name: string;
  role: TrialRole;
  tasks: Record<
    string,
    { result: TrialResult; seconds: number; comment: string | null }
  >;
  sus: number | null;
  criticalDone: boolean;
};

export type TrialRoleSummary = {
  participants: number;
  alone: number;
  help: number;
  failed: number;
  averageSus: number | null;
};

export type TrialReport = {
  participants: TrialParticipant[];
  summary: { maestro: TrialRoleSummary; admin: TrialRoleSummary };
};

export function getTrialReport() {
  return apiRequest<TrialReport>("/api/admin/trial");
}
