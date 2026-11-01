import { API_BASE_URL, apiRequest as request } from "@/lib/api-client";
import { authorizationHeaders } from "@/lib/firebase-auth";
import type { ContestState } from "@/lib/contest-schema";

export type GroupTeam = {
  id: string;
  participationMode: string;
  grade: string | null;
  memberOneFirstName: string;
  memberOneLastName: string;
  memberTwoFirstName: string | null;
  memberTwoLastName: string | null;
  personalCode: string;
  status: string;
  createdAt: string;
};

export type EnrollTeamInput = {
  participationMode: "individual" | "pareja";
  grade: string;
  memberOneFirstName: string;
  memberOneLastName: string;
  memberTwoFirstName?: string;
  memberTwoLastName?: string;
};

export type StoredGroup = {
  id: string;
  name: string;
  grade: string | null;
  schoolId?: string | null;
  isDefault: boolean;
  ownerId: number | null;
  accessCode: string;
  contestId: string;
  contestTitle: string;
  contestState: ContestState;
  ownerName: string | null;
  ownerEmail: string | null;
  ownerSchool: string | null;
  ownerDepartment: string | null;
  contestCreatedAt: string;
  isFavorite: boolean;
  category: string | null;
  contestCategories: string[];
  contestAllowPairs: boolean;
  firstUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  teamCount: number;
  studentCount: number;
  teams: GroupTeam[];
};

export type GroupContestSummary = {
  id: string;
  title: string;
  state: ContestState;
  createdAt: string;
  isFavorite: boolean;
  groups: number;
  students: number;
};

export type GroupDraftInput = {
  contestId: string;
  category?: string;
  grade?: string;
  name: string;
};

export type PublishedContest = {
  id: string;
  title: string;
  state: ContestState;
  createdAt: string;
  isFavorite: boolean;
  canEnroll: boolean;
  categories: string[];
  registrationStartsAt: string | null;
  registrationEndsAt: string | null;
  startsAt: string | null;
  endsAt: string | null;
};

export function listPublishedContests() {
  return request<PublishedContest[]>("/api/published-contests");
}

export function listGroups(
  filters: { contestId?: string; ownerId?: number | null } = {},
) {
  const params = new URLSearchParams();
  if (filters.contestId) params.set("contestId", filters.contestId);
  if (filters.ownerId) params.set("ownerId", String(filters.ownerId));
  const query = params.toString();
  return request<StoredGroup[]>(`/api/groups${query ? `?${query}` : ""}`);
}

export function listGroupContests() {
  return request<GroupContestSummary[]>("/api/groups/contests");
}

export function getGroup(groupId: string) {
  return request<StoredGroup>(`/api/groups/${groupId}`);
}

export function createGroup(group: GroupDraftInput) {
  return request<StoredGroup>("/api/groups", {
    method: "POST",
    body: JSON.stringify(group),
  });
}

export function openCourseGroup(contestId: string, grade: string) {
  return request<StoredGroup>("/api/groups/course", {
    method: "POST",
    body: JSON.stringify({ contestId, grade }),
  });
}

export function prepareCourseGroups(
  contestId: string,
  schoolId: string | null = null,
) {
  return request<StoredGroup[]>("/api/groups/courses", {
    method: "POST",
    body: JSON.stringify({ contestId, schoolId }),
  });
}

export type MySchool = { id: string | null; name: string };

export async function listMySchools(): Promise<MySchool[]> {
  const me = await request<{
    schoolName: string | null;
    schools: { id: string; schoolName: string; status: string }[];
  }>("/api/auth/me");
  return [
    { id: null, name: me.schoolName || "Mi colegio" },
    ...me.schools
      .filter((school) => school.status === "approved")
      .map((school) => ({ id: school.id, name: school.schoolName })),
  ];
}

export function removeGroup(groupId: string) {
  return request<null>(`/api/groups/${groupId}`, {
    method: "DELETE",
  });
}

export function enrollTeam(groupId: string, data: EnrollTeamInput) {
  return request<GroupTeam>(`/api/groups/${groupId}/teams`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export type RosterIssue = { row: number; name: string; reason: string };

export type RosterImportResult = {
  created: Array<{ row: number; name: string; personalCode: string }>;
  skipped: RosterIssue[];
  groups: Array<{ id: string; grade: string; count: number }>;
};

export async function downloadRosterTemplate(groupId: string, name: string) {
  const response = await fetch(
    `${API_BASE_URL}/api/groups/${groupId}/roster-template`,
    { headers: await authorizationHeaders() },
  );

  if (!response.ok) {
    throw new Error("No se pudo descargar la plantilla.");
  }

  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = `participantes-${name}.xlsx`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function downloadGroupResults(groupId: string, name: string) {
  const response = await fetch(
    `${API_BASE_URL}/api/groups/${groupId}/results.xlsx`,
    { headers: await authorizationHeaders() },
  );

  if (!response.ok) {
    throw new Error("No se pudieron descargar los resultados.");
  }

  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = `resultados-${name}.xlsx`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function downloadStudentCodes(
  contestId: string,
  schoolId?: string | null,
) {
  const school =
    schoolId === undefined
      ? ""
      : `&schoolId=${encodeURIComponent(schoolId ?? "principal")}`;
  const response = await fetch(
    `${API_BASE_URL}/api/groups/students.xlsx?contestId=${encodeURIComponent(contestId)}${school}`,
    { headers: await authorizationHeaders() },
  );

  if (!response.ok) {
    throw new Error("No se pudo descargar la lista de estudiantes.");
  }

  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download =
    response.headers
      .get("Content-Disposition")
      ?.match(/filename="([^"]+)"/)?.[1] ?? "codigos.xlsx";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function importRoster(groupId: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  form.append("distributeByGrade", "true");

  return request<RosterImportResult>(`/api/groups/${groupId}/roster`, {
    method: "POST",
    body: form,
    fallbackMessage: "No se pudo importar la planilla.",
  });
}

export type TeamUpdateInput = {
  grade: string;
  memberOneFirstName: string;
  memberOneLastName: string;
  memberTwoFirstName?: string;
  memberTwoLastName?: string;
};

export function updateTeam(teamId: string, data: TeamUpdateInput) {
  return request<GroupTeam>(`/api/teams/${teamId}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export function removeTeam(teamId: string) {
  return request<null>(`/api/teams/${teamId}`, {
    method: "DELETE",
  });
}

export type GroupResultTeam = GroupTeam & {
  category: string | null;
  progress: "not_started" | "in_progress" | "finished";
  /** Rindió en papel: el maestro cargó su hoja de respuestas. */
  paper: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  taskCount: number;
  answeredCount: number;
  score: number | null;
  maxScore: number | null;
  correctCount: number | null;
  rank: number | null;
  answers: Array<"correct" | "wrong" | "blank"> | null;
};

export type GroupResultTask = {
  id: string;
  title: string;
  category: string;
  difficulty: string;
  takers: number;
  correct: number;
  wrong: number;
};

export type GroupResults = {
  group: {
    id: string;
    name: string;
    accessCode: string;
    category: string | null;
    grade: string | null;
  };
  contest: {
    id: string;
    title: string;
    state: ContestState;
    isPractice: boolean;
    startsAt: string | null;
    endsAt: string | null;
    resultsPublished: boolean;
    registrationOpen: boolean;
    canEnroll: boolean;
    paperEntryOpen: boolean;
    paperEntryUntil: string | null;
    printFrom: string | null;
    canPrint: boolean;
    paperBlocked?: string | null;
  };
  categories: string[];
  showScores: boolean;
  teams: GroupResultTeam[];
  tasks: GroupResultTask[];
};

export function getGroupResults(groupId: string) {
  return request<GroupResults>(`/api/groups/${groupId}/results`);
}

export function renameGroup(groupId: string, name: string) {
  return request<StoredGroup>(`/api/groups/${groupId}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}
