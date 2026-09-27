"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ChevronDownIcon,
  CopyIcon,
  DownloadIcon,
  LinkIcon,
  LoaderCircleIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  UsersIcon,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { ApiError } from "@/lib/api-client";
import { getUser } from "@/lib/auth";
import { gradeLabel, gradesForCategories } from "@/lib/contest-schema";

import {
  createGroup,
  downloadRosterTemplate,
  enrollTeam,
  getGroup,
  importRoster,
  type RosterImportResult,
  type RosterIssue,
  listGroups,
  listPublishedContests,
  removeGroup,
  removeTeam,
  updateTeam,
  type GroupTeam,
  type PublishedContest,
  type StoredGroup,
} from "@/lib/groups-api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

function teamName(team: GroupTeam) {
  const one = `${team.memberOneFirstName} ${team.memberOneLastName}`.trim();
  if (team.participationMode === "pareja" && team.memberTwoFirstName) {
    return `${one} · ${team.memberTwoFirstName} ${team.memberTwoLastName ?? ""}`.trim();
  }
  return one;
}
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ROSTER_ALLOWED_EXTENSIONS = new Set([".xlsx", ".csv"]);
const ROSTER_MAX_BYTES = 2 * 1024 * 1024;

type RosterFeedback = {
  groupId: string;
  fileName: string;
  result?: RosterImportResult;
  error?: string;
  issues?: RosterIssue[];
  refreshError?: string;
};

function rosterFileError(file: File) {
  const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();

  if (!ROSTER_ALLOWED_EXTENSIONS.has(extension)) {
    return "La planilla debe ser un archivo XLSX o CSV.";
  }
  if (file.size > ROSTER_MAX_BYTES) {
    return "La planilla no debe superar los 2 MB.";
  }

  return null;
}

function rosterIssues(error: unknown) {
  if (!(error instanceof ApiError) || !Array.isArray(error.details)) {
    return [];
  }

  return error.details.filter(
    (detail): detail is RosterIssue =>
      typeof detail === "object" &&
      detail !== null &&
      typeof detail.row === "number" &&
      typeof detail.name === "string" &&
      typeof detail.reason === "string",
  );
}

type TeamField =
  | "grade"
  | "memberOneFirstName"
  | "memberOneLastName"
  | "memberTwoFirstName"
  | "memberTwoLastName";

function isTeamField(value: string | undefined): value is TeamField {
  return Boolean(
    value &&
    [
      "grade",
      "memberOneFirstName",
      "memberOneLastName",
      "memberTwoFirstName",
      "memberTwoLastName",
    ].includes(value),
  );
}

function participantNameKey(firstName: string, lastName: string) {
  const normalize = (value: string) =>
    value
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "");

  return `${normalize(firstName)} ${normalize(lastName)}`;
}

/**
 * Copia al portapapeles con plan B: la API moderna solo existe en contextos
 * seguros, así que al abrir la app por la IP de la red no está disponible y sin
 * esto el aviso de "copiado" nunca llegaba a mostrarse.
 */
async function copyToClipboard(value: string) {
  try {
    if (window.isSecureContext && navigator.clipboard) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Cae al plan B.
  }

  try {
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "0";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(area);
    return copied;
  } catch {
    return false;
  }
}

/** Categorías cuyos cursos acepta un grupo: la suya o, si no tiene, las del desafío. */
function groupGradeCategories(
  group?: { category: string | null; contestCategories: string[] } | null,
) {
  if (!group) return [];
  return group.category ? [group.category] : group.contestCategories;
}

export function GroupsHome() {
  const [isMaestro] = useState(() => getUser()?.role === "maestro");
  const [groups, setGroups] = useState<StoredGroup[]>([]);
  const [publishedContests, setPublishedContests] = useState<
    PublishedContest[]
  >([]);
  const [contestId, setContestId] = useState("");
  const [category, setCategory] = useState("");
  const [name, setName] = useState("");
  const [createErrors, setCreateErrors] = useState<{
    contestId?: string;
    category?: string;
    name?: string;
    form?: string;
  }>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{
    groupId: string;
    team: GroupTeam;
  } | null>(null);
  const [editOneFirst, setEditOneFirst] = useState("");
  const [editOneLast, setEditOneLast] = useState("");
  const [editTwoFirst, setEditTwoFirst] = useState("");
  const [editTwoLast, setEditTwoLast] = useState("");
  const [editGrade, setEditGrade] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [editErrors, setEditErrors] = useState<
    Partial<Record<TeamField | "form", string>>
  >({});
  const [enrolling, setEnrolling] = useState<StoredGroup | null>(null);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [rosterFeedback, setRosterFeedback] = useState<RosterFeedback | null>(
    null,
  );
  const [enrollMode, setEnrollMode] = useState<"individual" | "pareja">(
    "individual",
  );
  const [enrollGrade, setEnrollGrade] = useState("");
  const [enrollOneFirst, setEnrollOneFirst] = useState("");
  const [enrollOneLast, setEnrollOneLast] = useState("");
  const [enrollTwoFirst, setEnrollTwoFirst] = useState("");
  const [enrollTwoLast, setEnrollTwoLast] = useState("");
  const [savingEnroll, setSavingEnroll] = useState(false);
  const [enrollErrors, setEnrollErrors] = useState<
    Partial<Record<TeamField | "form", string>>
  >({});
  const [confirming, setConfirming] = useState<
    | { type: "group"; group: StoredGroup }
    | { type: "team"; groupId: string; team: GroupTeam }
    | null
  >(null);
  const contestRef = useRef<HTMLButtonElement>(null);
  const selectedContest = publishedContests.find(
    (contest) => contest.id === contestId,
  );
  const contestCategoryOptions = selectedContest?.categories ?? [];
  const chosenCategory =
    contestCategoryOptions.length === 1
      ? contestCategoryOptions[0]
      : contestCategoryOptions.includes(category)
        ? category
        : "";
  const nameRef = useRef<HTMLInputElement>(null);
  const createErrorRef = useRef<HTMLDivElement>(null);
  const pendingCreateFocusRef = useRef<"contestId" | "name" | null>(null);
  const editGradeRef = useRef<HTMLButtonElement>(null);
  const editOneFirstRef = useRef<HTMLInputElement>(null);
  const editOneLastRef = useRef<HTMLInputElement>(null);
  const editTwoFirstRef = useRef<HTMLInputElement>(null);
  const editTwoLastRef = useRef<HTMLInputElement>(null);
  const editErrorRef = useRef<HTMLDivElement>(null);
  const pendingEditFocusRef = useRef<TeamField | "form" | null>(null);
  const rosterInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const rosterErrorRef = useRef<HTMLDivElement>(null);
  const rosterResultRef = useRef<HTMLDivElement>(null);
  const pendingRosterFocusRef = useRef<"input" | "error" | "result" | null>(
    null,
  );
  const enrollGradeRef = useRef<HTMLButtonElement>(null);
  const enrollOneFirstRef = useRef<HTMLInputElement>(null);
  const enrollOneLastRef = useRef<HTMLInputElement>(null);
  const enrollTwoFirstRef = useRef<HTMLInputElement>(null);
  const enrollTwoLastRef = useRef<HTMLInputElement>(null);
  const enrollErrorRef = useRef<HTMLDivElement>(null);
  const pendingEnrollFocusRef = useRef<TeamField | "form" | null>(null);

  useEffect(() => {
    if (importingId || !pendingRosterFocusRef.current || !rosterFeedback) {
      return;
    }

    if (pendingRosterFocusRef.current === "input") {
      rosterInputRefs.current[rosterFeedback.groupId]?.focus();
    } else if (pendingRosterFocusRef.current === "error") {
      rosterErrorRef.current?.focus();
    } else {
      rosterResultRef.current?.focus();
    }
    pendingRosterFocusRef.current = null;
  }, [importingId, rosterFeedback]);

  useEffect(() => {
    if (savingEdit || !pendingEditFocusRef.current) {
      return;
    }

    const target = pendingEditFocusRef.current;
    if (target === "grade") editGradeRef.current?.focus();
    if (target === "memberOneFirstName") editOneFirstRef.current?.focus();
    if (target === "memberOneLastName") editOneLastRef.current?.focus();
    if (target === "memberTwoFirstName") editTwoFirstRef.current?.focus();
    if (target === "memberTwoLastName") editTwoLastRef.current?.focus();
    if (target === "form") editErrorRef.current?.focus();
    pendingEditFocusRef.current = null;
  }, [savingEdit]);

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const loadedGroups = await listGroups();
        const loadedContests = await listPublishedContests();
        if (!active) {
          return;
        }
        setGroups(loadedGroups);
        setPublishedContests(loadedContests);
        if (loadedContests.length === 1) {
          setContestId((current) => current || loadedContests[0].id);
        }
      } catch (error: unknown) {
        if (!active) return;
        setLoadError(
          error instanceof Error
            ? error.message
            : "No se pudieron cargar los datos.",
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [loadAttempt]);

  useEffect(() => {
    if (createErrors.form) {
      createErrorRef.current?.focus();
    }
  }, [createErrors.form]);

  useEffect(() => {
    if (creating || !pendingCreateFocusRef.current) {
      return;
    }
    if (pendingCreateFocusRef.current === "contestId") {
      contestRef.current?.focus();
    } else if (pendingCreateFocusRef.current === "name") {
      nameRef.current?.focus();
    }
    pendingCreateFocusRef.current = null;
  }, [creating]);

  useEffect(() => {
    if (savingEnroll || !pendingEnrollFocusRef.current) {
      return;
    }

    const target = pendingEnrollFocusRef.current;
    if (target === "grade") enrollGradeRef.current?.focus();
    if (target === "memberOneFirstName") enrollOneFirstRef.current?.focus();
    if (target === "memberOneLastName") enrollOneLastRef.current?.focus();
    if (target === "memberTwoFirstName") enrollTwoFirstRef.current?.focus();
    if (target === "memberTwoLastName") enrollTwoLastRef.current?.focus();
    if (target === "form") enrollErrorRef.current?.focus();
    pendingEnrollFocusRef.current = null;
  }, [savingEnroll]);

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const nextErrors = {
      contestId: contestId ? undefined : "Elige un desafío publicado.",
      category:
        contestId && !chosenCategory
          ? "Elige la categoría de tus estudiantes."
          : undefined,
      name: name.trim() ? undefined : "Ingresa el nombre del grupo.",
    };

    if (nextErrors.contestId || nextErrors.category || nextErrors.name) {
      setCreateErrors(nextErrors);
      if (nextErrors.contestId) {
        contestRef.current?.focus();
      } else if (nextErrors.name) {
        nameRef.current?.focus();
      }
      return;
    }

    setCreateErrors({});
    setCreating(true);

    try {
      const group = await createGroup({
        contestId,
        category: chosenCategory,
        name: name.trim(),
      });
      setGroups((current) => [group, ...current]);
      setName("");
      setCreateErrors({});
      setCreateOpen(false);
      toast.success(`Grupo creado. Código: ${group.accessCode}`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "No se pudo crear el grupo.";
      toast.error(message);
      if (error instanceof ApiError && error.field === "contestId") {
        setCreateErrors({ contestId: message });
        pendingCreateFocusRef.current = "contestId";
      } else if (error instanceof ApiError && error.field === "name") {
        setCreateErrors({ name: message });
        pendingCreateFocusRef.current = "name";
      } else {
        setCreateErrors({ form: message });
      }
    } finally {
      setCreating(false);
    }
  };

  const copyCode = async (code: string) => {
    if (await copyToClipboard(code)) {
      toast.success(`Código copiado: ${code}`);
      return;
    }

    toast.error("No se pudo copiar el código.");
  };

  const copyLink = async (code: string) => {
    const url = `${window.location.origin}/entrar?code=${code}`;

    if (await copyToClipboard(url)) {
      toast.success("Enlace copiado. Compártelo con tus estudiantes.");
      return;
    }

    toast.error("No se pudo copiar el enlace.");
  };

  const handleDelete = (group: StoredGroup) => {
    void removeGroup(group.id)
      .then(() => {
        setGroups((current) => current.filter((item) => item.id !== group.id));
        toast.success("Grupo eliminado.");
      })
      .catch((error) => {
        toast.error(
          error instanceof Error
            ? error.message
            : "No se pudo eliminar el grupo.",
        );
      });
  };

  const deleteTeam = (groupId: string, team: GroupTeam) => {
    void removeTeam(team.id)
      .then(() => {
        setGroups((current) =>
          current.map((group) =>
            group.id === groupId
              ? {
                  ...group,
                  teams: group.teams.filter((item) => item.id !== team.id),
                  teamCount: Math.max(0, group.teamCount - 1),
                }
              : group,
          ),
        );
        toast.success("Participante eliminado.");
      })
      .catch((error) => {
        toast.error(
          error instanceof Error ? error.message : "No se pudo eliminar.",
        );
      });
  };

  const openEdit = (groupId: string, team: GroupTeam) => {
    setEditing({ groupId, team });
    setEditOneFirst(team.memberOneFirstName);
    setEditOneLast(team.memberOneLastName);
    setEditTwoFirst(team.memberTwoFirstName ?? "");
    setEditTwoLast(team.memberTwoLastName ?? "");
    setEditGrade(team.grade ?? "");
    setEditErrors({});
  };

  const saveEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!editing) {
      return;
    }

    const isPareja = editing.team.participationMode === "pareja";
    const nextErrors: Partial<Record<TeamField, string>> = {
      grade: editGrade ? undefined : "Elige el curso del participante.",
      memberOneFirstName: editOneFirst.trim()
        ? undefined
        : "Ingresa los nombres.",
      memberOneLastName: editOneLast.trim()
        ? undefined
        : "Ingresa los apellidos.",
      memberTwoFirstName:
        isPareja && !editTwoFirst.trim()
          ? "Ingresa los nombres del segundo integrante."
          : undefined,
      memberTwoLastName:
        isPareja && !editTwoLast.trim()
          ? "Ingresa los apellidos del segundo integrante."
          : undefined,
    };
    const firstError = (
      [
        "grade",
        "memberOneFirstName",
        "memberOneLastName",
        "memberTwoFirstName",
        "memberTwoLastName",
      ] as const
    ).find((field) => nextErrors[field]);

    if (firstError) {
      setEditErrors(nextErrors);
      if (firstError === "grade") editGradeRef.current?.focus();
      if (firstError === "memberOneFirstName") editOneFirstRef.current?.focus();
      if (firstError === "memberOneLastName") editOneLastRef.current?.focus();
      if (firstError === "memberTwoFirstName") editTwoFirstRef.current?.focus();
      if (firstError === "memberTwoLastName") editTwoLastRef.current?.focus();
      return;
    }

    if (
      isPareja &&
      participantNameKey(editOneFirst, editOneLast) ===
        participantNameKey(editTwoFirst, editTwoLast)
    ) {
      setEditErrors({
        form: "Los dos integrantes no pueden ser la misma persona.",
      });
      editTwoFirstRef.current?.focus();
      return;
    }

    setEditErrors({});
    setSavingEdit(true);

    try {
      const updated = await updateTeam(editing.team.id, {
        grade: editGrade,
        memberOneFirstName: editOneFirst.trim(),
        memberOneLastName: editOneLast.trim(),
        memberTwoFirstName: editTwoFirst.trim(),
        memberTwoLastName: editTwoLast.trim(),
      });
      setGroups((current) =>
        current.map((group) =>
          group.id === editing.groupId
            ? {
                ...group,
                teams: group.teams.map((item) =>
                  item.id === updated.id ? updated : item,
                ),
              }
            : group,
        ),
      );
      toast.success("Participante actualizado.");
      setEditErrors({});
      setEditing(null);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "No se pudo actualizar.";
      toast.error(message);

      if (
        error instanceof ApiError &&
        isTeamField(error.field) &&
        !error.fields?.length
      ) {
        setEditErrors({ [error.field]: message });
        pendingEditFocusRef.current = error.field;
      } else {
        setEditErrors({ form: message });
        pendingEditFocusRef.current =
          error instanceof ApiError && isTeamField(error.fields?.[0])
            ? error.fields[0]
            : "form";
      }
    } finally {
      setSavingEdit(false);
    }
  };

  const pickRoster = async (
    group: StoredGroup,
    file: File,
    input: HTMLInputElement,
  ) => {
    if (importingId) {
      return;
    }

    const validationError = rosterFileError(file);

    if (validationError) {
      setOpenGroupId(group.id);
      setRosterFeedback({
        groupId: group.id,
        fileName: file.name,
        error: validationError,
      });
      pendingRosterFocusRef.current = "input";
      toast.error(validationError);
      input.value = "";
      return;
    }

    setRosterFeedback({ groupId: group.id, fileName: file.name });
    setImportingId(group.id);

    try {
      const result = await importRoster(group.id, file);
      let refreshError: string | undefined;

      if (result.created.length > 0) {
        try {
          const updatedGroup = await getGroup(group.id);
          setGroups((current) =>
            current.map((item) =>
              item.id === updatedGroup.id ? updatedGroup : item,
            ),
          );
        } catch {
          refreshError =
            "La importación terminó, pero no se pudo actualizar la lista. Recarga la página para ver los cambios.";
        }
      }

      setOpenGroupId(group.id);
      setRosterFeedback({
        groupId: group.id,
        fileName: file.name,
        result,
        refreshError,
      });
      pendingRosterFocusRef.current = "result";

      if (result.created.length > 0 && result.skipped.length > 0) {
        toast.warning(
          `Se importaron ${result.created.length} y se omitieron ${result.skipped.length} fila(s).`,
        );
      } else if (result.created.length > 0) {
        toast.success(
          `Se importaron ${result.created.length} participante(s).`,
        );
      } else {
        toast.warning(
          `No se importaron participantes; se omitieron ${result.skipped.length} fila(s).`,
        );
      }
      if (refreshError) {
        toast.error(refreshError);
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "No se pudo importar la planilla.";
      const issues = rosterIssues(error);
      setOpenGroupId(group.id);
      setRosterFeedback({
        groupId: group.id,
        fileName: file.name,
        error: message,
        issues,
      });
      pendingRosterFocusRef.current = issues.length > 0 ? "error" : "input";
      toast.error(message);
    } finally {
      input.value = "";
      setImportingId(null);
    }
  };

  const getTemplate = (group: StoredGroup) => {
    void downloadRosterTemplate(group.id, group.name).catch(
      (error: unknown) => {
        toast.error(
          error instanceof Error
            ? error.message
            : "No se pudo descargar la plantilla.",
        );
      },
    );
  };

  const openEnroll = (group: StoredGroup) => {
    setEnrolling(group);
    setEnrollMode("individual");
    setEnrollGrade("");
    setEnrollOneFirst("");
    setEnrollOneLast("");
    setEnrollTwoFirst("");
    setEnrollTwoLast("");
    setEnrollErrors({});
  };

  const saveEnroll = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!enrolling) {
      return;
    }

    const nextErrors: Partial<Record<TeamField, string>> = {
      grade: enrollGrade ? undefined : "Elige el curso del participante.",
      memberOneFirstName: enrollOneFirst.trim()
        ? undefined
        : "Ingresa los nombres.",
      memberOneLastName: enrollOneLast.trim()
        ? undefined
        : "Ingresa los apellidos.",
      memberTwoFirstName:
        enrollMode === "pareja" && !enrollTwoFirst.trim()
          ? "Ingresa los nombres del segundo integrante."
          : undefined,
      memberTwoLastName:
        enrollMode === "pareja" && !enrollTwoLast.trim()
          ? "Ingresa los apellidos del segundo integrante."
          : undefined,
    };
    const firstError = (
      [
        "grade",
        "memberOneFirstName",
        "memberOneLastName",
        "memberTwoFirstName",
        "memberTwoLastName",
      ] as const
    ).find((field) => nextErrors[field]);

    if (firstError) {
      setEnrollErrors(nextErrors);
      if (firstError === "grade") enrollGradeRef.current?.focus();
      if (firstError === "memberOneFirstName")
        enrollOneFirstRef.current?.focus();
      if (firstError === "memberOneLastName") enrollOneLastRef.current?.focus();
      if (firstError === "memberTwoFirstName")
        enrollTwoFirstRef.current?.focus();
      if (firstError === "memberTwoLastName") enrollTwoLastRef.current?.focus();
      return;
    }

    if (
      enrollMode === "pareja" &&
      participantNameKey(enrollOneFirst, enrollOneLast) ===
        participantNameKey(enrollTwoFirst, enrollTwoLast)
    ) {
      setEnrollErrors({
        form: "Los dos integrantes no pueden ser la misma persona.",
      });
      enrollTwoFirstRef.current?.focus();
      return;
    }

    setEnrollErrors({});
    setSavingEnroll(true);

    try {
      const team = await enrollTeam(enrolling.id, {
        participationMode: enrollMode,
        grade: enrollGrade,
        memberOneFirstName: enrollOneFirst.trim(),
        memberOneLastName: enrollOneLast.trim(),
        memberTwoFirstName: enrollTwoFirst.trim(),
        memberTwoLastName: enrollTwoLast.trim(),
      });
      setGroups((current) =>
        current.map((group) =>
          group.id === enrolling.id
            ? {
                ...group,
                teamCount: group.teamCount + 1,
                teams: [...group.teams, team],
              }
            : group,
        ),
      );
      toast.success(
        `${team.memberOneFirstName} quedó inscrito. Entra con el código del grupo y su nombre.`,
      );
      setEnrollErrors({});
      setEnrolling(null);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "No se pudo inscribir.";
      toast.error(message);

      if (
        error instanceof ApiError &&
        isTeamField(error.field) &&
        !error.fields?.length
      ) {
        setEnrollErrors({ [error.field]: message });
        pendingEnrollFocusRef.current = error.field;
      } else {
        setEnrollErrors({ form: message });
        pendingEnrollFocusRef.current =
          error instanceof ApiError && isTeamField(error.fields?.[0])
            ? error.fields[0]
            : "form";
      }
    } finally {
      setSavingEnroll(false);
    }
  };

  const confirmDelete = () => {
    if (!confirming) {
      return;
    }
    if (confirming.type === "group") {
      handleDelete(confirming.group);
    } else {
      deleteTeam(confirming.groupId, confirming.team);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[18rem] items-center justify-center">
        <LoaderCircleIcon className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (loadError) {
    return (
      <Alert>
        <AlertTitle>No se pudieron cargar tus grupos</AlertTitle>
        <AlertDescription>
          {loadError}
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setLoadError(null);
              setLoading(true);
              setLoadAttempt((attempt) => attempt + 1);
            }}
          >
            Reintentar
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex w-full flex-col gap-8">
      {isMaestro && (
        <dl
          className="grid grid-cols-1 gap-4 sm:grid-cols-3"
          aria-label="Resumen de participación"
        >
          {[
            { label: "Grupos", value: groups.length },
            {
              label: "Estudiantes inscritos",
              value: groups.reduce(
                (count, group) =>
                  count +
                  group.teams.reduce(
                    (total, team) =>
                      total + (team.participationMode === "pareja" ? 2 : 1),
                    0,
                  ),
                0,
              ),
            },
            {
              label: "Desafíos con grupos",
              value: new Set(groups.map((group) => group.contestId)).size,
            },
          ].map(({ label, value }) => (
            <div
              key={label}
              className="flex flex-col gap-2 rounded-lg border p-4"
            >
              <dt className="text-sm text-muted-foreground">{label}</dt>
              <dd className="text-3xl font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="flex flex-col gap-4 border-b pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h1 className="font-heading text-3xl font-semibold tracking-tight">
            {isMaestro ? "Mis grupos" : "Grupos"}
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
            Cada grupo tiene un código con el que tus estudiantes entran al
            desafío.
          </p>
        </div>
        {/* Son dos campos: un modal molesta menos que una página entera y deja
            la lista a la vista al volver. */}
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="shrink-0">
              <PlusIcon data-icon="inline-start" />
              Nuevo grupo
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Crear grupo</DialogTitle>
              <DialogDescription>
                Genera un código de acceso para que tus estudiantes entren a un
                desafío publicado.
              </DialogDescription>
            </DialogHeader>
            {publishedContests.length === 0 ? (
              <Alert>
                <AlertTitle>No hay desafíos disponibles</AlertTitle>
                <AlertDescription>
                  {isMaestro
                    ? "Podrás crear un grupo cuando el organizador publique un desafío con inscripciones abiertas."
                    : "Solo se pueden crear grupos para desafíos publicados cuya ventana todavía no terminó. Si las que tienes ya cerraron, publica una nueva con fechas futuras."}
                </AlertDescription>
              </Alert>
            ) : (
              <form
                className="flex flex-col gap-4 pt-2"
                onSubmit={handleCreate}
                aria-busy={creating}
                noValidate
              >
                {createErrors.form && (
                  <Alert
                    ref={createErrorRef}
                    variant="destructive"
                    tabIndex={-1}
                  >
                    <AlertDescription>{createErrors.form}</AlertDescription>
                  </Alert>
                )}
                <div className="grid gap-4">
                  <Field
                    data-invalid={Boolean(createErrors.contestId) || undefined}
                  >
                    <FieldLabel htmlFor="group-contest">Desafío</FieldLabel>
                    <FieldContent>
                      <Select
                        value={contestId}
                        disabled={creating}
                        onValueChange={(value) => {
                          setContestId(value);
                          if (createErrors.contestId || createErrors.form) {
                            setCreateErrors((current) => ({
                              ...current,
                              contestId: undefined,
                              form: undefined,
                            }));
                          }
                        }}
                      >
                        <SelectTrigger
                          ref={contestRef}
                          id="group-contest"
                          className="w-full"
                          aria-invalid={Boolean(createErrors.contestId)}
                          aria-describedby={
                            createErrors.contestId
                              ? "group-contest-error"
                              : undefined
                          }
                        >
                          <SelectValue placeholder="Elige un desafío" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {publishedContests.map((contest) => (
                              <SelectItem key={contest.id} value={contest.id}>
                                {contest.title}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>

                      <FieldError id="group-contest-error">
                        {createErrors.contestId}
                      </FieldError>
                    </FieldContent>
                  </Field>
                  {contestCategoryOptions.length > 1 && (
                    <Field
                      data-invalid={Boolean(createErrors.category) || undefined}
                    >
                      <FieldLabel>Categoría de tus estudiantes</FieldLabel>
                      <FieldContent>
                        <div
                          role="radiogroup"
                          aria-label="Categoría del grupo"
                          className="grid grid-cols-2 gap-2 sm:grid-cols-3"
                        >
                          {contestCategoryOptions.map((item) => {
                            const selected = chosenCategory === item;
                            return (
                              <button
                                key={item}
                                type="button"
                                role="radio"
                                aria-checked={selected}
                                disabled={creating}
                                onClick={() => {
                                  setCategory(item);
                                  if (createErrors.category) {
                                    setCreateErrors((current) => ({
                                      ...current,
                                      category: undefined,
                                    }));
                                  }
                                }}
                                className={cn(
                                  "flex flex-col items-start border-2 px-3 py-2 text-left text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
                                  selected
                                    ? "border-primary bg-primary/5 font-semibold"
                                    : "border-border/30 hover:border-primary/60",
                                )}
                              >
                                {item}
                                <span className="text-xs font-normal text-muted-foreground">
                                  {gradesForCategories([item])
                                    .map(
                                      (grade) => grade.label.split(" de ")[0],
                                    )
                                    .join(" y ")}{" "}
                                  de{" "}
                                  {
                                    gradesForCategories([item])[0].label.split(
                                      " de ",
                                    )[1]
                                  }
                                </span>
                              </button>
                            );
                          })}
                        </div>
                        <FieldError>{createErrors.category}</FieldError>
                      </FieldContent>
                    </Field>
                  )}
                  <Field data-invalid={Boolean(createErrors.name) || undefined}>
                    <FieldLabel htmlFor="group-name">
                      Nombre del grupo
                    </FieldLabel>
                    <FieldContent>
                      <Input
                        ref={nameRef}
                        id="group-name"
                        value={name}
                        disabled={creating}
                        onChange={(event) => {
                          setName(event.target.value);
                          if (createErrors.name || createErrors.form) {
                            setCreateErrors((current) => ({
                              ...current,
                              name: undefined,
                              form: undefined,
                            }));
                          }
                        }}
                        placeholder="Ej. 6° A — Colegio San José"
                        aria-invalid={Boolean(createErrors.name)}
                        aria-describedby={
                          createErrors.name ? "group-name-error" : undefined
                        }
                      />
                      <FieldError id="group-name-error">
                        {createErrors.name}
                      </FieldError>
                    </FieldContent>
                  </Field>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={creating}>
                    <PlusIcon data-icon="inline-start" />
                    {creating ? "Creando..." : "Crear grupo"}
                  </Button>
                </DialogFooter>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </div>

      <section className="flex min-w-0 flex-col gap-5">
        {!isMaestro && (
          <div className="flex min-w-0 flex-col gap-1 border-b pb-3">
            <h2 className="font-heading text-base font-semibold">Tus grupos</h2>
            <p className="text-sm leading-6 text-muted-foreground">
              Reparte el código a tus estudiantes para que entren al desafío.
            </p>
          </div>
        )}
        <div className="flex flex-col gap-4">
          {groups.length === 0 ? (
            <Alert>
              <AlertTitle>No hay grupos creados</AlertTitle>
              <AlertDescription>
                Crea el primer grupo para un desafío publicado.
              </AlertDescription>
            </Alert>
          ) : (
            <ul className="divide-y border-y">
              {groups.map((group) => (
                <li key={group.id} className="flex flex-col gap-3 py-4">
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="flex min-w-0 flex-col gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            variant="secondary"
                            className="max-w-full truncate"
                          >
                            {group.contestTitle}
                          </Badge>
                          {group.category && (
                            <Badge variant="outline">{group.category}</Badge>
                          )}
                          <button
                            type="button"
                            aria-expanded={openGroupId === group.id}
                            onClick={() =>
                              setOpenGroupId(
                                openGroupId === group.id ? null : group.id,
                              )
                            }
                            className="inline-flex items-center gap-1 text-sm text-muted-foreground transition hover:text-foreground"
                          >
                            <UsersIcon className="size-4" />
                            {group.teamCount} equipo(s)
                            <ChevronDownIcon
                              className={cn(
                                "size-4 transition-transform duration-300",
                                openGroupId === group.id && "rotate-180",
                              )}
                            />
                          </button>
                        </div>
                        <h3 className="break-words text-lg font-semibold">
                          {group.name}
                        </h3>
                      </div>
                      <div className="grid w-full shrink-0 gap-2 lg:w-72 lg:grid-cols-2">
                        <div className="flex w-full items-center justify-between gap-2 rounded-md border bg-background px-3 py-2 lg:col-span-2">
                          <span className="font-mono text-lg font-semibold tracking-widest">
                            {group.accessCode}
                          </span>
                          <Button
                            size="icon-sm"
                            type="button"
                            variant="outline"
                            aria-label="Copiar código"
                            onClick={() => copyCode(group.accessCode)}
                          >
                            <CopyIcon />
                          </Button>
                        </div>
                        <Button
                          size="sm"
                          type="button"
                          variant="outline"
                          className="w-full justify-start lg:col-span-2"
                          onClick={() => openEnroll(group)}
                        >
                          <PlusIcon data-icon="inline-start" />
                          Inscribir participante
                        </Button>
                        <Button
                          size="sm"
                          type="button"
                          variant="outline"
                          className="w-full justify-start lg:col-span-2"
                          onClick={() => getTemplate(group)}
                        >
                          <DownloadIcon data-icon="inline-start" />
                          Descargar plantilla
                        </Button>
                        <Button
                          size="sm"
                          type="button"
                          variant="outline"
                          className="w-full justify-start"
                          onClick={() => copyLink(group.accessCode)}
                        >
                          <LinkIcon data-icon="inline-start" />
                          Copiar enlace
                        </Button>
                        <Button
                          size="sm"
                          type="button"
                          variant="outline"
                          className="w-full justify-start"
                          onClick={() =>
                            setConfirming({ type: "group", group })
                          }
                        >
                          <Trash2Icon data-icon="inline-start" />
                          Eliminar
                        </Button>
                      </div>
                    </div>
                  </div>
                  <div
                    className={cn(
                      "grid transition-[grid-template-rows] duration-300 ease-out",
                      openGroupId === group.id
                        ? "grid-rows-[1fr]"
                        : "grid-rows-[0fr]",
                    )}
                  >
                    <div className="overflow-hidden">
                      <div className="pb-1">
                        {group.teams.length === 0 ? (
                          <p className="text-sm text-muted-foreground">
                            Aún no hay equipos registrados en este grupo.
                          </p>
                        ) : (
                          <ul className="flex flex-col gap-2">
                            {group.teams.map((team) => (
                              <li
                                key={team.id}
                                className="flex flex-col items-stretch gap-2 rounded-md border bg-background px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                              >
                                <div className="flex min-w-0 flex-col gap-0.5">
                                  <span className="min-w-0 break-words font-medium sm:truncate">
                                    {teamName(team)}
                                  </span>
                                  {/* El codigo personal es lo unico con lo que
                                      el estudiante puede rendir, asi que el
                                      maestro tiene que poder repartirlo. */}
                                  <div className="flex items-center gap-1">
                                    <span className="font-mono text-xs tracking-widest text-muted-foreground">
                                      {team.personalCode}
                                    </span>
                                    <Button
                                      size="icon-sm"
                                      type="button"
                                      variant="ghost"
                                      aria-label={`Copiar el código de ${teamName(team)}`}
                                      onClick={() =>
                                        copyCode(team.personalCode)
                                      }
                                    >
                                      <CopyIcon />
                                    </Button>
                                  </div>
                                </div>
                                <div className="flex flex-wrap items-center gap-1.5 sm:shrink-0 sm:justify-end">
                                  {team.grade && (
                                    <Badge variant="secondary">
                                      {gradeLabel(team.grade)}
                                    </Badge>
                                  )}
                                  <Button
                                    size="icon-sm"
                                    type="button"
                                    variant="outline"
                                    aria-label="Editar participante"
                                    onClick={() => openEdit(group.id, team)}
                                  >
                                    <PencilIcon />
                                  </Button>
                                  <Button
                                    size="icon-sm"
                                    type="button"
                                    variant="outline"
                                    aria-label="Eliminar participante"
                                    onClick={() =>
                                      setConfirming({
                                        type: "team",
                                        groupId: group.id,
                                        team,
                                      })
                                    }
                                  >
                                    <Trash2Icon />
                                  </Button>
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                        <div className="mt-4 flex flex-col gap-3 pb-1.5 pl-0.5">
                          <Field
                            aria-busy={importingId === group.id}
                            data-disabled={importingId !== null || undefined}
                            data-invalid={
                              Boolean(
                                rosterFeedback?.groupId === group.id &&
                                rosterFeedback.error,
                              ) || undefined
                            }
                            className="sm:max-w-md"
                          >
                            <FieldLabel htmlFor={`roster-${group.id}`}>
                              Importar planilla
                            </FieldLabel>
                            <Input
                              ref={(node) => {
                                rosterInputRefs.current[group.id] = node;
                              }}
                              id={`roster-${group.id}`}
                              type="file"
                              accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                              disabled={importingId !== null}
                              aria-invalid={Boolean(
                                rosterFeedback?.groupId === group.id &&
                                rosterFeedback.error,
                              )}
                              aria-describedby={`roster-${group.id}-description${
                                rosterFeedback?.groupId === group.id &&
                                rosterFeedback.error
                                  ? ` roster-${group.id}-error`
                                  : ""
                              }`}
                              onChange={(event) => {
                                const input = event.currentTarget;
                                const file = input.files?.[0];
                                if (file) {
                                  void pickRoster(group, file, input);
                                }
                              }}
                            />
                            <FieldDescription
                              id={`roster-${group.id}-description`}
                              className="break-words"
                            >
                              XLSX o CSV de hasta 2 MB, con el formato de
                              «Descargar plantilla». Solo se procesa una
                              planilla a la vez en este panel.
                              {rosterFeedback?.groupId === group.id && (
                                <>
                                  {" "}
                                  Archivo: {rosterFeedback.fileName}.
                                  {importingId === group.id && " Importando..."}
                                </>
                              )}
                            </FieldDescription>
                            {rosterFeedback?.groupId === group.id &&
                              rosterFeedback.error &&
                              !rosterFeedback.issues?.length && (
                                <FieldError id={`roster-${group.id}-error`}>
                                  {rosterFeedback.error}
                                </FieldError>
                              )}
                          </Field>
                          {rosterFeedback?.groupId === group.id &&
                            rosterFeedback.error &&
                            Boolean(rosterFeedback.issues?.length) && (
                              <Alert
                                ref={rosterErrorRef}
                                id={`roster-${group.id}-error`}
                                variant="destructive"
                                tabIndex={-1}
                              >
                                <AlertTitle>{rosterFeedback.error}</AlertTitle>
                                <AlertDescription>
                                  <ul className="flex list-disc flex-col gap-1 pl-4 text-xs">
                                    {rosterFeedback.issues?.map(
                                      (issue, index) => (
                                        <li
                                          key={`${issue.row}-${index}`}
                                          className="break-words"
                                        >
                                          Fila {issue.row}: {issue.name}.{" "}
                                          {issue.reason}
                                        </li>
                                      ),
                                    )}
                                  </ul>
                                </AlertDescription>
                              </Alert>
                            )}
                          {rosterFeedback?.groupId === group.id &&
                            rosterFeedback.result && (
                              <>
                                <Alert
                                  ref={rosterResultRef}
                                  role="status"
                                  aria-live="polite"
                                  tabIndex={-1}
                                >
                                  <AlertTitle>
                                    {rosterFeedback.result.created.length > 0
                                      ? rosterFeedback.result.skipped.length > 0
                                        ? "Importación parcial"
                                        : "Importación completada"
                                      : "No se importaron participantes"}
                                  </AlertTitle>
                                  <AlertDescription className="flex flex-col gap-2">
                                    <p className="break-words">
                                      {rosterFeedback.fileName}: se importaron{" "}
                                      {rosterFeedback.result.created.length} y
                                      se omitieron{" "}
                                      {rosterFeedback.result.skipped.length}{" "}
                                      fila(s).
                                    </p>
                                    {rosterFeedback.result.skipped.length >
                                      0 && (
                                      <ul className="flex list-disc flex-col gap-1 pl-4 text-xs">
                                        {rosterFeedback.result.skipped.map(
                                          (item) => (
                                            <li
                                              key={item.row}
                                              className="break-words"
                                            >
                                              Fila {item.row}: {item.name}.{" "}
                                              {item.reason}
                                            </li>
                                          ),
                                        )}
                                      </ul>
                                    )}
                                  </AlertDescription>
                                </Alert>
                                {rosterFeedback.refreshError && (
                                  <Alert variant="destructive">
                                    <AlertTitle>
                                      La lista no se actualizó
                                    </AlertTitle>
                                    <AlertDescription>
                                      {rosterFeedback.refreshError}
                                    </AlertDescription>
                                  </Alert>
                                )}
                              </>
                            )}
                        </div>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open && !savingEdit) {
            setEditing(null);
          }
        }}
      >
        <DialogContent showCloseButton={!savingEdit}>
          <DialogHeader>
            <DialogTitle>Editar participante</DialogTitle>
            <DialogDescription>
              Corrige el curso, los nombres y apellidos del equipo.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-6"
            aria-busy={savingEdit}
            noValidate
            onSubmit={(event) => void saveEdit(event)}
          >
            {editErrors.form && (
              <Alert ref={editErrorRef} variant="destructive" tabIndex={-1}>
                <AlertDescription>{editErrors.form}</AlertDescription>
              </Alert>
            )}
            <div className="flex flex-col gap-4">
              <Field data-invalid={Boolean(editErrors.grade) || undefined}>
                <FieldLabel htmlFor="edit-grade">Curso</FieldLabel>
                <FieldContent>
                  <Select
                    value={editGrade}
                    disabled={savingEdit}
                    onValueChange={(value) => {
                      setEditGrade(value);
                      if (editErrors.grade || editErrors.form) {
                        setEditErrors((current) => ({
                          ...current,
                          grade: undefined,
                          form: undefined,
                        }));
                      }
                    }}
                  >
                    <SelectTrigger
                      ref={editGradeRef}
                      id="edit-grade"
                      className="w-full"
                      aria-invalid={Boolean(editErrors.grade)}
                      aria-describedby={
                        editErrors.grade ? "edit-grade-error" : undefined
                      }
                    >
                      <SelectValue placeholder="Elige el curso" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {gradesForCategories(
                          groupGradeCategories(
                            groups.find(
                              (group) => group.id === editing?.groupId,
                            ),
                          ),
                        ).map((grade) => (
                          <SelectItem key={grade.value} value={grade.value}>
                            {grade.label} · {grade.category}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <FieldError id="edit-grade-error">
                    {editErrors.grade}
                  </FieldError>
                </FieldContent>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  data-invalid={
                    Boolean(editErrors.memberOneFirstName) || undefined
                  }
                >
                  <FieldLabel htmlFor="edit-one-first">Nombres</FieldLabel>
                  <FieldContent>
                    <Input
                      ref={editOneFirstRef}
                      id="edit-one-first"
                      value={editOneFirst}
                      disabled={savingEdit}
                      aria-invalid={Boolean(editErrors.memberOneFirstName)}
                      aria-describedby={
                        editErrors.memberOneFirstName
                          ? "edit-one-first-error"
                          : undefined
                      }
                      onChange={(event) => {
                        setEditOneFirst(event.target.value);
                        if (editErrors.memberOneFirstName || editErrors.form) {
                          setEditErrors((current) => ({
                            ...current,
                            memberOneFirstName: undefined,
                            form: undefined,
                          }));
                        }
                      }}
                    />
                    <FieldError id="edit-one-first-error">
                      {editErrors.memberOneFirstName}
                    </FieldError>
                  </FieldContent>
                </Field>
                <Field
                  data-invalid={
                    Boolean(editErrors.memberOneLastName) || undefined
                  }
                >
                  <FieldLabel htmlFor="edit-one-last">Apellidos</FieldLabel>
                  <FieldContent>
                    <Input
                      ref={editOneLastRef}
                      id="edit-one-last"
                      value={editOneLast}
                      disabled={savingEdit}
                      aria-invalid={Boolean(editErrors.memberOneLastName)}
                      aria-describedby={
                        editErrors.memberOneLastName
                          ? "edit-one-last-error"
                          : undefined
                      }
                      onChange={(event) => {
                        setEditOneLast(event.target.value);
                        if (editErrors.memberOneLastName || editErrors.form) {
                          setEditErrors((current) => ({
                            ...current,
                            memberOneLastName: undefined,
                            form: undefined,
                          }));
                        }
                      }}
                    />
                    <FieldError id="edit-one-last-error">
                      {editErrors.memberOneLastName}
                    </FieldError>
                  </FieldContent>
                </Field>
              </div>
              {editing?.team.participationMode === "pareja" && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    data-invalid={
                      Boolean(editErrors.memberTwoFirstName) || undefined
                    }
                  >
                    <FieldLabel htmlFor="edit-two-first">
                      Nombres del 2.º integrante
                    </FieldLabel>
                    <FieldContent>
                      <Input
                        ref={editTwoFirstRef}
                        id="edit-two-first"
                        value={editTwoFirst}
                        disabled={savingEdit}
                        aria-invalid={Boolean(editErrors.memberTwoFirstName)}
                        aria-describedby={
                          editErrors.memberTwoFirstName
                            ? "edit-two-first-error"
                            : undefined
                        }
                        onChange={(event) => {
                          setEditTwoFirst(event.target.value);
                          if (
                            editErrors.memberTwoFirstName ||
                            editErrors.form
                          ) {
                            setEditErrors((current) => ({
                              ...current,
                              memberTwoFirstName: undefined,
                              form: undefined,
                            }));
                          }
                        }}
                      />
                      <FieldError id="edit-two-first-error">
                        {editErrors.memberTwoFirstName}
                      </FieldError>
                    </FieldContent>
                  </Field>
                  <Field
                    data-invalid={
                      Boolean(editErrors.memberTwoLastName) || undefined
                    }
                  >
                    <FieldLabel htmlFor="edit-two-last">
                      Apellidos del 2.º integrante
                    </FieldLabel>
                    <FieldContent>
                      <Input
                        ref={editTwoLastRef}
                        id="edit-two-last"
                        value={editTwoLast}
                        disabled={savingEdit}
                        aria-invalid={Boolean(editErrors.memberTwoLastName)}
                        aria-describedby={
                          editErrors.memberTwoLastName
                            ? "edit-two-last-error"
                            : undefined
                        }
                        onChange={(event) => {
                          setEditTwoLast(event.target.value);
                          if (editErrors.memberTwoLastName || editErrors.form) {
                            setEditErrors((current) => ({
                              ...current,
                              memberTwoLastName: undefined,
                              form: undefined,
                            }));
                          }
                        }}
                      />
                      <FieldError id="edit-two-last-error">
                        {editErrors.memberTwoLastName}
                      </FieldError>
                    </FieldContent>
                  </Field>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                disabled={savingEdit}
                onClick={() => setEditing(null)}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={savingEdit}>
                {savingEdit ? "Guardando..." : "Guardar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={enrolling !== null}
        onOpenChange={(open) => {
          if (!open && !savingEnroll) {
            setEnrolling(null);
          }
        }}
      >
        <DialogContent showCloseButton={!savingEnroll}>
          <DialogHeader>
            <DialogTitle>Inscribir participante</DialogTitle>
            <DialogDescription>
              {enrolling ? `En ${enrolling.name}.` : ""} Se generará su código
              personal automáticamente.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-6"
            aria-busy={savingEnroll}
            noValidate
            onSubmit={(event) => void saveEnroll(event)}
          >
            {enrollErrors.form && (
              <Alert ref={enrollErrorRef} variant="destructive" tabIndex={-1}>
                <AlertDescription>{enrollErrors.form}</AlertDescription>
              </Alert>
            )}
            <div className="flex flex-col gap-4">
              {enrolling?.contestAllowPairs && (
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={savingEnroll}
                    variant={
                      enrollMode === "individual" ? "default" : "outline"
                    }
                    onClick={() => {
                      setEnrollMode("individual");
                      setEnrollErrors({});
                    }}
                  >
                    Individual
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={savingEnroll}
                    variant={enrollMode === "pareja" ? "default" : "outline"}
                    onClick={() => {
                      setEnrollMode("pareja");
                      setEnrollErrors({});
                    }}
                  >
                    Pareja
                  </Button>
                </div>
              )}
              <Field data-invalid={Boolean(enrollErrors.grade) || undefined}>
                <FieldLabel htmlFor="enroll-grade">Curso</FieldLabel>
                <FieldContent>
                  <Select
                    value={enrollGrade}
                    disabled={savingEnroll}
                    onValueChange={(value) => {
                      setEnrollGrade(value);
                      if (enrollErrors.grade || enrollErrors.form) {
                        setEnrollErrors((current) => ({
                          ...current,
                          grade: undefined,
                          form: undefined,
                        }));
                      }
                    }}
                  >
                    <SelectTrigger
                      ref={enrollGradeRef}
                      id="enroll-grade"
                      className="w-full"
                      aria-invalid={Boolean(enrollErrors.grade)}
                      aria-describedby={
                        enrollErrors.grade
                          ? "enroll-grade-description enroll-grade-error"
                          : "enroll-grade-description"
                      }
                    >
                      <SelectValue placeholder="Elige el curso" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {gradesForCategories(
                          groupGradeCategories(enrolling),
                        ).map((grade) => (
                          <SelectItem key={grade.value} value={grade.value}>
                            {grade.label} · {grade.category}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <FieldDescription id="enroll-grade-description">
                    Rendirá las preguntas de la categoría de su curso.
                  </FieldDescription>
                  <FieldError id="enroll-grade-error">
                    {enrollErrors.grade}
                  </FieldError>
                </FieldContent>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  data-invalid={
                    Boolean(enrollErrors.memberOneFirstName) || undefined
                  }
                >
                  <FieldLabel htmlFor="enroll-one-first">Nombres</FieldLabel>
                  <FieldContent>
                    <Input
                      ref={enrollOneFirstRef}
                      id="enroll-one-first"
                      value={enrollOneFirst}
                      disabled={savingEnroll}
                      aria-invalid={Boolean(enrollErrors.memberOneFirstName)}
                      aria-describedby={
                        enrollErrors.memberOneFirstName
                          ? "enroll-one-first-error"
                          : undefined
                      }
                      onChange={(event) => {
                        setEnrollOneFirst(event.target.value);
                        if (
                          enrollErrors.memberOneFirstName ||
                          enrollErrors.form
                        ) {
                          setEnrollErrors((current) => ({
                            ...current,
                            memberOneFirstName: undefined,
                            form: undefined,
                          }));
                        }
                      }}
                    />
                    <FieldError id="enroll-one-first-error">
                      {enrollErrors.memberOneFirstName}
                    </FieldError>
                  </FieldContent>
                </Field>
                <Field
                  data-invalid={
                    Boolean(enrollErrors.memberOneLastName) || undefined
                  }
                >
                  <FieldLabel htmlFor="enroll-one-last">Apellidos</FieldLabel>
                  <FieldContent>
                    <Input
                      ref={enrollOneLastRef}
                      id="enroll-one-last"
                      value={enrollOneLast}
                      disabled={savingEnroll}
                      aria-invalid={Boolean(enrollErrors.memberOneLastName)}
                      aria-describedby={
                        enrollErrors.memberOneLastName
                          ? "enroll-one-last-error"
                          : undefined
                      }
                      onChange={(event) => {
                        setEnrollOneLast(event.target.value);
                        if (
                          enrollErrors.memberOneLastName ||
                          enrollErrors.form
                        ) {
                          setEnrollErrors((current) => ({
                            ...current,
                            memberOneLastName: undefined,
                            form: undefined,
                          }));
                        }
                      }}
                    />
                    <FieldError id="enroll-one-last-error">
                      {enrollErrors.memberOneLastName}
                    </FieldError>
                  </FieldContent>
                </Field>
              </div>
              {enrollMode === "pareja" && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    data-invalid={
                      Boolean(enrollErrors.memberTwoFirstName) || undefined
                    }
                  >
                    <FieldLabel htmlFor="enroll-two-first">
                      Nombres del 2.º integrante
                    </FieldLabel>
                    <FieldContent>
                      <Input
                        ref={enrollTwoFirstRef}
                        id="enroll-two-first"
                        value={enrollTwoFirst}
                        disabled={savingEnroll}
                        aria-invalid={Boolean(enrollErrors.memberTwoFirstName)}
                        aria-describedby={
                          enrollErrors.memberTwoFirstName
                            ? "enroll-two-first-error"
                            : undefined
                        }
                        onChange={(event) => {
                          setEnrollTwoFirst(event.target.value);
                          if (
                            enrollErrors.memberTwoFirstName ||
                            enrollErrors.form
                          ) {
                            setEnrollErrors((current) => ({
                              ...current,
                              memberTwoFirstName: undefined,
                              form: undefined,
                            }));
                          }
                        }}
                      />
                      <FieldError id="enroll-two-first-error">
                        {enrollErrors.memberTwoFirstName}
                      </FieldError>
                    </FieldContent>
                  </Field>
                  <Field
                    data-invalid={
                      Boolean(enrollErrors.memberTwoLastName) || undefined
                    }
                  >
                    <FieldLabel htmlFor="enroll-two-last">
                      Apellidos del 2.º integrante
                    </FieldLabel>
                    <FieldContent>
                      <Input
                        ref={enrollTwoLastRef}
                        id="enroll-two-last"
                        value={enrollTwoLast}
                        disabled={savingEnroll}
                        aria-invalid={Boolean(enrollErrors.memberTwoLastName)}
                        aria-describedby={
                          enrollErrors.memberTwoLastName
                            ? "enroll-two-last-error"
                            : undefined
                        }
                        onChange={(event) => {
                          setEnrollTwoLast(event.target.value);
                          if (
                            enrollErrors.memberTwoLastName ||
                            enrollErrors.form
                          ) {
                            setEnrollErrors((current) => ({
                              ...current,
                              memberTwoLastName: undefined,
                              form: undefined,
                            }));
                          }
                        }}
                      />
                      <FieldError id="enroll-two-last-error">
                        {enrollErrors.memberTwoLastName}
                      </FieldError>
                    </FieldContent>
                  </Field>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                disabled={savingEnroll}
                onClick={() => setEnrolling(null)}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={savingEnroll}>
                {savingEnroll ? "Inscribiendo..." : "Inscribir"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) {
            setConfirming(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirming?.type === "group"
                ? "¿Eliminar el grupo?"
                : "¿Eliminar al participante?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirming?.type === "group"
                ? `Se eliminará "${confirming.group.name}" y todos sus equipos registrados. Esta acción no se puede deshacer.`
                : confirming
                  ? `Se eliminará a ${teamName(confirming.team)}. Esta acción no se puede deshacer.`
                  : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDelete}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
