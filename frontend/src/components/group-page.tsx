"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type Ref,
} from "react";
import {
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  LinkIcon,
  LoaderCircleIcon,
  PencilIcon,
  XIcon,
  UploadIcon,
  UserPlusIcon,
} from "lucide-react";
import { toast } from "sonner";

import { ApiError } from "@/lib/api-client";
import { copyToClipboard, groupJoinLink } from "@/lib/clipboard";
import {
  CONTEST_STATE_LABELS,
  gradeLabel,
  gradesForCategories,
  isTaskDifficulty,
} from "@/lib/contest-schema";
import { formatDateTime } from "@/lib/countdown";
import {
  downloadRosterTemplate,
  enrollTeam,
  getGroup,
  getGroupResults,
  importRoster,
  removeGroup,
  renameGroup,
  removeTeam,
  updateTeam,
  type GroupResultTask,
  type GroupResultTeam,
  type GroupResults,
  type GroupTeam,
  type RosterImportResult,
  type StoredGroup,
} from "@/lib/groups-api";
import { Reveal } from "@/components/reveal";
import { enter } from "@/lib/surface";
import { cn } from "@/lib/utils";
import { DifficultyTag } from "@/components/contest-task-parts";
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
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";

type View = "estudiantes" | "resultados";

const LIVE_STATES = ["abierta", "suspendida"];
const ENDED_STATES = ["cerrada", "consolidada", "publicada"];

function teamName(team: GroupTeam) {
  const one = `${team.memberOneFirstName} ${team.memberOneLastName}`.trim();
  if (team.participationMode === "pareja" && team.memberTwoFirstName) {
    return `${one} y ${team.memberTwoFirstName} ${team.memberTwoLastName ?? ""}`.trim();
  }
  return one;
}

function readParams() {
  const params = new URLSearchParams(window.location.search);
  const view = params.get("vista");
  return {
    id: params.get("id") ?? "",
    view:
      view === "resultados" || view === "estudiantes" ? (view as View) : null,
  };
}

async function copy(value: string, message: string) {
  if (await copyToClipboard(value)) {
    toast.success(message);
  } else {
    toast.error("No se pudo copiar.");
  }
}

export function GroupPage() {
  const [{ id, view: initialView }] = useState(readParams);
  const [group, setGroup] = useState<StoredGroup | null>(null);
  const [results, setResults] = useState<GroupResults | null>(null);
  const [loadError, setLoadError] = useState<string | null>(
    id ? null : "Falta el grupo.",
  );
  const [view, setView] = useState<View | null>(initialView);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setResults(await getGroupResults(id));
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setLoadError("Este grupo no existe o no es tuyo.");
      }
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let active = true;
    void Promise.all([getGroup(id), getGroupResults(id)])
      .then(([loadedGroup, loadedResults]) => {
        if (!active) return;
        setGroup(loadedGroup);
        setResults(loadedResults);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setLoadError(
          error instanceof Error
            ? error.message
            : "No se pudo cargar el grupo.",
        );
      });
    return () => {
      active = false;
    };
  }, [id]);

  const state = results?.contest.state;
  const live = Boolean(state && LIVE_STATES.includes(state));

  // Mientras se rinde, el avance se actualiza solo.
  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [live, refresh]);

  const changeView = (next: View) => {
    setView(next);
    const url = new URL(window.location.href);
    url.searchParams.set("vista", next);
    window.history.replaceState(window.history.state, "", url);
  };

  if (loadError) {
    return (
      <div className="flex flex-col items-start gap-3 py-10">
        <p className="text-muted-foreground">{loadError}</p>
        <Button asChild variant="outline">
          <a href="/grupos">Volver a mis grupos</a>
        </Button>
      </div>
    );
  }

  if (!group || !results) {
    return <GroupSkeleton />;
  }

  const teams = results.teams;
  const started = Boolean(
    state && (LIVE_STATES.includes(state) || ENDED_STATES.includes(state)),
  );
  const activeView: View =
    view ?? (started && teams.length > 0 ? "resultados" : "estudiantes");
  const categories = results.categories;

  return (
    <div className="flex w-full flex-col gap-6">
      <div
        className={cn(
          enter,
          "flex flex-col gap-5 border-b pb-6 lg:flex-row lg:items-end lg:justify-between",
        )}
      >
        <div className="flex min-w-0 flex-col gap-1.5">
          <GroupName group={group} onRenamed={setGroup} />
          <p className="text-sm text-muted-foreground">
            {group.contestTitle}
            {categories.length > 0 && <> · {categories.join(", ")}</>}
            {state && (
              <>
                {" · "}
                <span
                  className={cn(
                    "font-medium",
                    live ? "text-primary" : "text-foreground",
                  )}
                >
                  {CONTEST_STATE_LABELS[state]}
                </span>
              </>
            )}
          </p>
          {results.contest.startsAt && !started && (
            <p className="text-sm text-muted-foreground">
              La prueba empieza el {formatDateTime(results.contest.startsAt)}.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2 lg:items-end">
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Código del grupo
          </span>
          <div className="flex items-center gap-2">
            <span className="font-mono text-3xl font-bold tracking-[0.2em]">
              {group.accessCode}
            </span>
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              aria-label="Copiar código"
              onClick={() => copy(group.accessCode, "Código copiado.")}
            >
              <CopyIcon />
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                copy(
                  groupJoinLink(group.accessCode),
                  "Enlace copiado. Compártelo con tus estudiantes.",
                )
              }
            >
              <LinkIcon data-icon="inline-start" />
              Copiar enlace
            </Button>
          </div>
        </div>
      </div>

      <div
        role="tablist"
        aria-label="Secciones del grupo"
        className="-mx-4 flex gap-6 overflow-x-auto px-4 shadow-[inset_0_-1px_0_var(--border)] sm:mx-0 sm:px-0"
      >
        {(
          [
            ["estudiantes", "Estudiantes", teams.length],
            ["resultados", "Resultados", null],
          ] as const
        ).map(([key, label, count]) => {
          const selected = activeView === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => changeView(key)}
              className="relative flex shrink-0 items-baseline gap-1.5 py-2.5 text-sm whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground aria-selected:font-medium aria-selected:text-foreground"
            >
              {label}
              {count !== null && (
                <span className="text-xs tabular-nums opacity-60">{count}</span>
              )}
              {key === "resultados" && live && (
                <span
                  aria-label="En vivo"
                  className="size-2 self-center bg-primary"
                />
              )}
              {selected && (
                <span
                  aria-hidden="true"
                  className="grow-x absolute inset-x-0 bottom-0 h-0.5 bg-primary"
                />
              )}
            </button>
          );
        })}
      </div>

      <div
        key={activeView}
        className="flex flex-col motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-300"
      >
        {activeView === "estudiantes" ? (
          <StudentsTab group={group} results={results} onChanged={refresh} />
        ) : (
          <ResultsTab results={results} />
        )}
      </div>

      {results.contest.registrationOpen && (
        <div className="mt-6 border-t pt-5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => setConfirmDelete(true)}
          >
            <XIcon data-icon="inline-start" />
            Eliminar grupo
          </Button>
        </div>
      )}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar «{group.name}»?</AlertDialogTitle>
            <AlertDialogDescription>
              Se borran el grupo y sus estudiantes inscritos. Si alguno ya
              rindió el desafío, no se podrá eliminar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void removeGroup(group.id)
                  .then(() => {
                    toast.success("Grupo eliminado.");
                    window.location.assign("/grupos");
                  })
                  .catch((error: unknown) =>
                    toast.error(
                      error instanceof Error
                        ? error.message
                        : "No se pudo eliminar el grupo.",
                    ),
                  );
              }}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function GroupName({
  group,
  onRenamed,
}: {
  group: StoredGroup;
  onRenamed: (group: StoredGroup) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (draft === null) {
    return (
      <div className="flex items-start gap-1">
        <h1 className="font-heading text-3xl font-semibold tracking-tight break-words">
          {group.name}
        </h1>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="Cambiar el nombre del grupo"
          className="mt-1 shrink-0 text-muted-foreground"
          onClick={() => {
            setDraft(group.name);
            setError(null);
          }}
        >
          <PencilIcon />
        </Button>
      </div>
    );
  }

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = draft.trim();
    if (!name) {
      setError("Ponle un nombre al grupo.");
      return;
    }
    if (name === group.name) {
      setDraft(null);
      return;
    }
    setSaving(true);
    try {
      onRenamed(await renameGroup(group.id, name));
      setDraft(null);
      toast.success("Nombre guardado.");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "No se pudo guardar.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <form noValidate onSubmit={save} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          autoFocus
          value={draft}
          maxLength={80}
          disabled={saving}
          aria-label="Nombre del grupo"
          aria-invalid={Boolean(error)}
          className="h-11 w-full max-w-md text-xl font-semibold sm:w-96"
          onChange={(event) => {
            setDraft(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setDraft(null);
          }}
        />
        <Button type="submit" disabled={saving}>
          {saving ? (
            <LoaderCircleIcon
              data-icon="inline-start"
              className="animate-spin"
            />
          ) : (
            <CheckIcon data-icon="inline-start" />
          )}
          Guardar
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={saving}
          onClick={() => setDraft(null)}
        >
          Cancelar
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}

// ---- Estudiantes ----

type StudentValues = {
  participationMode: "individual" | "pareja";
  grade: string;
  memberOneFirstName: string;
  memberOneLastName: string;
  memberTwoFirstName: string;
  memberTwoLastName: string;
};

type StudentErrors = Partial<Record<keyof StudentValues | "form", string>>;

const EMPTY_STUDENT: StudentValues = {
  participationMode: "individual",
  grade: "",
  memberOneFirstName: "",
  memberOneLastName: "",
  memberTwoFirstName: "",
  memberTwoLastName: "",
};

function studentErrors(values: StudentValues): StudentErrors {
  const pair = values.participationMode === "pareja";
  const errors: StudentErrors = {};
  if (!values.memberOneFirstName.trim())
    errors.memberOneFirstName = "Faltan los nombres.";
  if (!values.memberOneLastName.trim())
    errors.memberOneLastName = "Faltan los apellidos.";
  if (pair && !values.memberTwoFirstName.trim())
    errors.memberTwoFirstName = "Faltan los nombres.";
  if (pair && !values.memberTwoLastName.trim())
    errors.memberTwoLastName = "Faltan los apellidos.";
  if (!values.grade) errors.grade = "Elige el curso.";
  return errors;
}

function apiErrors(error: unknown, fallback: string): StudentErrors {
  const message = error instanceof Error ? error.message : fallback;
  if (
    error instanceof ApiError &&
    error.field &&
    error.field in EMPTY_STUDENT
  ) {
    return { [error.field]: message };
  }
  return { form: message };
}

function StudentForm({
  grades,
  allowPairs,
  initial,
  submitLabel,
  compact,
  onSubmit,
  onCancel,
}: {
  grades: ReadonlyArray<{ value: string; label: string }>;
  allowPairs: boolean;
  initial: StudentValues;
  submitLabel: string;
  compact?: boolean;
  onSubmit: (values: StudentValues) => Promise<StudentErrors | null>;
  onCancel?: () => void;
}) {
  const [values, setValues] = useState(() =>
    grades.length === 1 && !initial.grade
      ? { ...initial, grade: grades[0].value }
      : initial,
  );
  const [errors, setErrors] = useState<StudentErrors>({});
  const [saving, setSaving] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);
  const pair = values.participationMode === "pareja";

  const set = (key: keyof StudentValues, value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    if (errors[key] || errors.form) {
      setErrors((current) => ({
        ...current,
        [key]: undefined,
        form: undefined,
      }));
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found = studentErrors(values);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    setSaving(true);
    const failed = await onSubmit(values);
    setSaving(false);
    if (failed) {
      setErrors(failed);
      return;
    }
    // Queda listo para el siguiente: mismo curso y modalidad, nombres vacíos.
    setValues((current) => ({
      ...EMPTY_STUDENT,
      participationMode: current.participationMode,
      grade: current.grade,
    }));
    setErrors({});
    firstRef.current?.focus();
  };

  const nameField = (
    key: keyof StudentValues,
    placeholder: string,
    ref?: Ref<HTMLInputElement>,
  ) => (
    <label className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="sr-only">{placeholder}</span>
      <Input
        ref={ref}
        value={values[key]}
        placeholder={placeholder}
        autoComplete="off"
        disabled={saving}
        aria-invalid={Boolean(errors[key])}
        onChange={(event) => set(key, event.target.value)}
      />
    </label>
  );

  const firstError = (
    [
      "memberOneFirstName",
      "memberOneLastName",
      "memberTwoFirstName",
      "memberTwoLastName",
      "grade",
      "form",
    ] as const
  )
    .map((key) => errors[key])
    .find(Boolean);

  return (
    <form
      noValidate
      onSubmit={submit}
      className={cn(
        "flex flex-col gap-3",
        !compact && "border-2 border-dashed border-border/60 p-4",
      )}
    >
      {allowPairs && (
        <div role="radiogroup" aria-label="Modalidad" className="flex gap-1.5">
          {(
            [
              ["individual", "Solo"],
              ["pareja", "En pareja"],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={values.participationMode === mode}
              onClick={() => set("participationMode", mode)}
              className="px-2.5 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground aria-checked:bg-primary/10 aria-checked:font-medium aria-checked:text-foreground"
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        {nameField(
          "memberOneFirstName",
          pair ? "Nombres del primero" : "Nombres",
          firstRef,
        )}
        {nameField("memberOneLastName", "Apellidos")}
      </div>
      {pair && (
        <div className="flex flex-col gap-2 sm:flex-row">
          {nameField("memberTwoFirstName", "Nombres del segundo")}
          {nameField("memberTwoLastName", "Apellidos")}
        </div>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          role="radiogroup"
          aria-label="Curso"
          className="flex flex-wrap gap-1.5"
        >
          {grades.map((grade) => {
            const selected = values.grade === grade.value;
            return (
              <button
                key={grade.value}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={saving}
                onClick={() => set("grade", grade.value)}
                className={cn(
                  "border-2 px-3 py-1.5 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
                  selected
                    ? "border-primary bg-primary/10 font-semibold"
                    : "border-border/30 hover:border-primary/60",
                  errors.grade && !selected && "border-destructive/60",
                )}
              >
                {grade.label}
              </button>
            );
          })}
        </div>
        <div className="flex gap-2 sm:shrink-0">
          {onCancel && (
            <Button
              type="button"
              variant="ghost"
              onClick={onCancel}
              disabled={saving}
            >
              Cancelar
            </Button>
          )}
          <Button type="submit" disabled={saving} className="max-sm:flex-1">
            {saving ? (
              <LoaderCircleIcon
                data-icon="inline-start"
                className="animate-spin"
              />
            ) : compact ? (
              <CheckIcon data-icon="inline-start" />
            ) : (
              <UserPlusIcon data-icon="inline-start" />
            )}
            {submitLabel}
          </Button>
        </div>
      </div>
      {firstError && (
        <p role="alert" className="text-sm text-destructive">
          {firstError}
        </p>
      )}
    </form>
  );
}

function toValues(team: GroupTeam): StudentValues {
  return {
    participationMode:
      team.participationMode === "pareja" ? "pareja" : "individual",
    grade: team.grade ?? "",
    memberOneFirstName: team.memberOneFirstName,
    memberOneLastName: team.memberOneLastName,
    memberTwoFirstName: team.memberTwoFirstName ?? "",
    memberTwoLastName: team.memberTwoLastName ?? "",
  };
}

function progressLabel(team: GroupResultTeam) {
  if (team.progress === "finished") return "Terminó";
  if (team.progress === "in_progress") {
    return `Rindiendo · ${team.answeredCount} de ${team.taskCount}`;
  }
  return null;
}

function StudentsTab({
  group,
  results,
  onChanged,
}: {
  group: StoredGroup;
  results: GroupResults;
  onChanged: () => Promise<void>;
}) {
  const grades = gradesForCategories(results.categories);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [removing, setRemoving] = useState<GroupResultTeam | null>(null);
  const [importing, setImporting] = useState(false);
  const [roster, setRoster] = useState<{
    result?: RosterImportResult;
    error?: string;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const registrationOpen = results.contest.registrationOpen;
  const [initialIds] = useState(
    () => new Set(results.teams.map((team) => team.id)),
  );

  const add = async (values: StudentValues) => {
    try {
      const team = await enrollTeam(group.id, values);
      toast.success(`${teamName(team)} quedó inscrito.`);
      await onChanged();
      return null;
    } catch (error) {
      return apiErrors(error, "No se pudo inscribir.");
    }
  };

  const save = (teamId: string) => async (values: StudentValues) => {
    try {
      await updateTeam(teamId, values);
      await onChanged();
      setEditingId(null);
      toast.success("Datos guardados.");
      return null;
    } catch (error) {
      return apiErrors(error, "No se pudo guardar.");
    }
  };

  const pickRoster = async (file: File) => {
    const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    if (![".xlsx", ".csv"].includes(extension)) {
      setRoster({ error: "La planilla debe ser un archivo XLSX o CSV." });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setRoster({ error: "La planilla no debe superar los 2 MB." });
      return;
    }
    setImporting(true);
    try {
      const result = await importRoster(group.id, file);
      setRoster({ result });
      await onChanged();
    } catch (error) {
      const issues =
        error instanceof ApiError && Array.isArray(error.details)
          ? (error.details as Array<{ row: number; reason: string }>)
          : [];
      setRoster({
        error:
          (error instanceof Error
            ? error.message
            : "No se pudo importar la planilla.") +
          (issues.length
            ? " " +
              issues
                .map((issue) => `Fila ${issue.row}: ${issue.reason}`)
                .join(" ")
            : ""),
      });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {registrationOpen ? (
        <section className={cn(enter, "flex flex-col gap-3")}>
          <div className="flex flex-col gap-1">
            <h2 className="font-heading text-lg font-semibold">
              Inscribir estudiantes
            </h2>
            <p className="text-sm text-muted-foreground">
              Escribe su nombre y elige su curso. Cada uno recibe un código
              personal para entrar a la prueba. También pueden inscribirse solos
              entrando con el código del grupo.
            </p>
          </div>
          <StudentForm
            grades={grades}
            allowPairs={group.contestAllowPairs}
            initial={EMPTY_STUDENT}
            submitLabel="Inscribir"
            onSubmit={add}
          />
          <div className="flex flex-wrap items-center gap-x-1 gap-y-1 text-sm text-muted-foreground">
            <span>¿Tienes la lista en Excel?</span>
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto px-1"
              onClick={() =>
                void downloadRosterTemplate(group.id, group.name).catch(
                  (error: unknown) =>
                    toast.error(
                      error instanceof Error
                        ? error.message
                        : "No se pudo descargar la plantilla.",
                    ),
                )
              }
            >
              <DownloadIcon data-icon="inline-start" />
              Descarga la plantilla
            </Button>
            <span>y</span>
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto px-1"
              disabled={importing}
              onClick={() => fileRef.current?.click()}
            >
              {importing ? (
                <LoaderCircleIcon
                  data-icon="inline-start"
                  className="animate-spin"
                />
              ) : (
                <UploadIcon data-icon="inline-start" />
              )}
              súbela llena
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.csv"
              className="sr-only"
              tabIndex={-1}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void pickRoster(file);
              }}
            />
          </div>
          <Reveal className="-mt-3" message={roster?.error}>
            {(message) => (
              <p role="alert" className="text-sm text-destructive">
                {message}
              </p>
            )}
          </Reveal>
          {roster?.result && (
            <div
              role="status"
              className="flex flex-col gap-1 text-sm motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 motion-safe:duration-300"
            >
              <p>
                {roster.result.created.length === 0
                  ? "No se inscribió a nadie."
                  : `Se inscribieron ${roster.result.created.length} estudiante${roster.result.created.length === 1 ? "" : "s"}.`}
              </p>
              {roster.result.skipped.length > 0 && (
                <ul className="text-muted-foreground">
                  {roster.result.skipped.map((issue) => (
                    <li key={`${issue.row}-${issue.name}`}>
                      Fila {issue.row} ({issue.name || "sin nombre"}):{" "}
                      {issue.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">
          La inscripción está cerrada: ya no se puede agregar ni quitar
          estudiantes. Sí puedes corregir sus nombres.
        </p>
      )}

      <section
        className={cn(enter, "flex flex-col gap-3")}
        style={{ animationDelay: "80ms" }}
      >
        <h2 className="font-heading text-lg font-semibold">
          Inscritos{" "}
          <span className="font-normal text-muted-foreground tabular-nums">
            {results.teams.length}
          </span>
        </h2>
        {results.teams.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Todavía no hay nadie. Los que inscribas aparecen aquí con su código
            personal.
          </p>
        ) : (
          <ul className="divide-y border-y">
            {results.teams.map((team, index) =>
              editingId === team.id ? (
                <li
                  key={`${team.id}-editar`}
                  className="py-3 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200"
                >
                  <StudentForm
                    compact
                    grades={grades}
                    allowPairs={team.participationMode === "pareja"}
                    initial={toValues(team)}
                    submitLabel="Guardar"
                    onSubmit={save(team.id)}
                    onCancel={() => setEditingId(null)}
                  />
                </li>
              ) : (
                <li
                  key={team.id}
                  style={
                    initialIds.has(team.id)
                      ? { animationDelay: `${Math.min(index, 12) * 35}ms` }
                      : undefined
                  }
                  className={cn(
                    initialIds.has(team.id) ? enter : "row-flash",
                    "flex flex-wrap items-center gap-x-4 gap-y-1 py-3",
                  )}
                >
                  <div className="flex min-w-0 flex-1 basis-56 flex-col">
                    <span className="font-medium break-words">
                      {teamName(team)}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {gradeLabel(team.grade)}
                      {progressLabel(team) && (
                        <>
                          {" · "}
                          <span
                            className={cn(
                              team.progress === "in_progress" &&
                                "font-medium text-primary",
                              team.progress === "finished" &&
                                "font-medium text-foreground",
                            )}
                          >
                            {progressLabel(team)}
                          </span>
                        </>
                      )}
                    </span>
                  </div>
                  <button
                    type="button"
                    title="Copiar código personal"
                    aria-label={`Copiar el código de ${teamName(team)}`}
                    onClick={() =>
                      copy(
                        team.personalCode,
                        `Código de ${team.memberOneFirstName} copiado.`,
                      )
                    }
                    className="group/code flex items-center gap-1.5 px-1.5 py-1 font-mono text-lg font-bold tracking-[0.15em] text-foreground transition-colors hover:bg-muted"
                  >
                    {team.personalCode}
                    <CopyIcon className="size-3.5 text-muted-foreground group-hover/code:text-foreground" />
                  </button>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Editar a ${teamName(team)}`}
                      onClick={() => setEditingId(team.id)}
                    >
                      <PencilIcon />
                    </Button>
                    {registrationOpen && team.progress === "not_started" && (
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Quitar a ${teamName(team)}`}
                        onClick={() => setRemoving(team)}
                      >
                        <XIcon />
                      </Button>
                    )}
                  </div>
                </li>
              ),
            )}
          </ul>
        )}
      </section>

      <AlertDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              ¿Quitar a {removing ? teamName(removing) : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Su código personal deja de funcionar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!removing) return;
                void removeTeam(removing.id)
                  .then(() => {
                    toast.success("Estudiante quitado.");
                    return onChanged();
                  })
                  .catch((error: unknown) =>
                    toast.error(
                      error instanceof Error
                        ? error.message
                        : "No se pudo quitar.",
                    ),
                  );
              }}
            >
              Quitar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---- Resultados ----

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className={cn(enter, "flex flex-col gap-0.5")}>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-3xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

const ANSWER_STYLES = {
  correct: "bg-difficulty-easy",
  wrong: "bg-destructive",
  blank: "bg-foreground/15",
} as const;

const ANSWER_LABELS = {
  correct: "correcta",
  wrong: "incorrecta",
  blank: "sin responder",
} as const;

function downloadCsv(results: GroupResults, rows: GroupResultTeam[]) {
  const header = [
    "Estudiante",
    "Curso",
    "Categoría",
    "Estado",
    "Puntaje",
    "Correctas",
    "Respondidas",
    "Lugar",
  ];
  const status = {
    not_started: "No empezó",
    in_progress: "Rindiendo",
    finished: "Terminó",
  };
  const lines = rows.map((team) => [
    teamName(team),
    gradeLabel(team.grade),
    team.category ?? "",
    status[team.progress],
    team.score ?? "",
    team.correctCount ?? "",
    team.answeredCount,
    team.rank ?? "",
  ]);
  const csv = [header, ...lines]
    .map((line) =>
      line.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","),
    )
    .join("\n");
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `resultados-${results.group.name}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function ResultsTab({ results }: { results: GroupResults }) {
  const { teams, contest, showScores } = results;
  const [category, setCategory] = useState(results.categories[0] ?? "");
  const state = contest.state;
  const live = LIVE_STATES.includes(state);
  const ended = ENDED_STATES.includes(state);

  if (teams.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Todavía no hay estudiantes inscritos. Cuando rindan el desafío, aquí
        verás cómo les fue.
      </p>
    );
  }

  if (!live && !ended && !contest.isPractice) {
    return (
      <p className="text-sm text-muted-foreground">
        {contest.startsAt
          ? `La prueba empieza el ${formatDateTime(contest.startsAt)}. Desde ese momento verás aquí quién está rindiendo y, cuando termine, sus puntajes y qué preguntas costaron más.`
          : "La prueba todavía no tiene fecha. Cuando empiece, verás aquí quién está rindiendo y, al terminar, sus puntajes."}
      </p>
    );
  }

  const categories = results.categories.filter((item) =>
    teams.some((team) => team.category === item),
  );
  const activeCategory = categories.includes(category)
    ? category
    : categories[0];
  const inCategory =
    categories.length > 1
      ? teams.filter((team) => team.category === activeCategory)
      : teams;
  const finished = inCategory.filter((team) => team.progress === "finished");
  const scored = finished.filter((team) => team.score !== null);
  const average =
    scored.length > 0
      ? Math.round(
          scored.reduce((total, team) => total + (team.score ?? 0), 0) /
            scored.length,
        )
      : null;
  const rows = [...inCategory].sort((a, b) => {
    if (showScores) {
      return (b.score ?? -Infinity) - (a.score ?? -Infinity);
    }
    const order = { in_progress: 0, finished: 1, not_started: 2 };
    return order[a.progress] - order[b.progress];
  });
  const tasks = results.tasks.filter(
    (task) => categories.length <= 1 || task.category === activeCategory,
  );

  return (
    <div className="flex flex-col gap-8">
      {categories.length > 1 && (
        <div
          role="tablist"
          aria-label="Categoría"
          className="flex flex-wrap gap-1.5"
        >
          {categories.map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={item === activeCategory}
              onClick={() => setCategory(item)}
              className="px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground aria-selected:bg-primary/10 aria-selected:font-medium aria-selected:text-foreground"
            >
              {item}
            </button>
          ))}
        </div>
      )}

      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        <Stat label="Inscritos" value={inCategory.length} />
        <Stat
          label="Rindiendo"
          value={
            inCategory.filter((team) => team.progress === "in_progress").length
          }
        />
        <Stat label="Terminaron" value={finished.length} />
        <Stat label="Puntaje promedio" value={average ?? "—"} />
      </dl>

      {!showScores && (
        <p className="text-sm text-muted-foreground">
          {live
            ? "Se actualiza solo. Los puntajes y qué preguntas costaron más aparecen cuando termine la rendición"
            : "Los puntajes aparecen cuando termine la rendición"}
          {contest.endsAt ? ` (${formatDateTime(contest.endsAt)}).` : "."}
        </p>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-heading text-lg font-semibold">
            {showScores ? "Puntajes" : "Avance"}
          </h2>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => downloadCsv(results, rows)}
          >
            <DownloadIcon data-icon="inline-start" />
            Descargar
          </Button>
        </div>
        <ol className="divide-y border-y">
          {rows.map((team, index) => (
            <li
              key={team.id}
              style={{ animationDelay: `${Math.min(index, 12) * 35}ms` }}
              className={cn(
                enter,
                "flex flex-wrap items-center gap-x-4 gap-y-2 py-3",
              )}
            >
              {showScores && (
                <span className="w-6 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
                  {team.score !== null ? index + 1 : ""}
                </span>
              )}
              <div className="flex min-w-0 flex-1 basis-48 flex-col">
                <span className="font-medium break-words">
                  {teamName(team)}
                </span>
                <span className="text-sm text-muted-foreground">
                  {gradeLabel(team.grade)}
                  {team.rank !== null && (
                    <>
                      {" "}
                      · Lugar {team.rank} en {team.category}
                    </>
                  )}
                </span>
              </div>
              {showScores && team.answers ? (
                <>
                  <div
                    className="flex flex-wrap gap-1"
                    aria-label={team.answers
                      .map(
                        (answer, position) =>
                          `Pregunta ${position + 1}: ${ANSWER_LABELS[answer]}`,
                      )
                      .join(", ")}
                  >
                    {team.answers.map((answer, position) => (
                      <span
                        key={position}
                        title={`${position + 1}. ${tasks[position]?.title ?? ""}: ${ANSWER_LABELS[answer]}`}
                        style={{
                          animationDelay: `${200 + position * 40}ms`,
                        }}
                        className={cn(
                          "size-3.5 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-50 motion-safe:duration-300 motion-safe:fill-mode-both",
                          ANSWER_STYLES[answer],
                        )}
                      />
                    ))}
                  </div>
                  <div className="flex w-28 shrink-0 flex-col items-end">
                    <span className="text-xl font-semibold tabular-nums">
                      {team.score}
                      <span className="text-sm font-normal text-muted-foreground">
                        {" "}
                        / {team.maxScore}
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {team.correctCount} de {team.taskCount} correctas
                    </span>
                  </div>
                </>
              ) : (
                <ProgressCell team={team} />
              )}
            </li>
          ))}
        </ol>
        {showScores && (
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {(["correct", "wrong", "blank"] as const).map((answer) => (
              <span key={answer} className="flex items-center gap-1.5">
                <span className={cn("size-3", ANSWER_STYLES[answer])} />
                {ANSWER_LABELS[answer][0].toUpperCase() +
                  ANSWER_LABELS[answer].slice(1)}
              </span>
            ))}
          </p>
        )}
      </section>

      {showScores && tasks.length > 0 && finished.length > 0 && (
        <TaskStats tasks={tasks} />
      )}
    </div>
  );
}

function ProgressCell({ team }: { team: GroupResultTeam }) {
  if (team.progress === "not_started") {
    return <span className="text-sm text-muted-foreground">No empezó</span>;
  }
  if (team.progress === "finished") {
    return <span className="text-sm font-medium">Terminó</span>;
  }
  const share = team.taskCount ? team.answeredCount / team.taskCount : 0;
  return (
    <div className="flex w-40 shrink-0 flex-col gap-1">
      <span className="text-right text-sm font-medium text-primary tabular-nums">
        {team.answeredCount} de {team.taskCount}
      </span>
      <span className="h-1.5 w-full bg-muted">
        <span
          className="block h-full bg-primary transition-[width] duration-500"
          style={{ width: `${Math.round(share * 100)}%` }}
        />
      </span>
    </div>
  );
}

function TaskStats({ tasks }: { tasks: GroupResultTask[] }) {
  const hardest = tasks.reduce<GroupResultTask | null>((worst, task) => {
    if (!task.takers) return worst;
    const rate = task.correct / task.takers;
    return !worst || rate < worst.correct / worst.takers ? task : worst;
  }, null);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="font-heading text-lg font-semibold">Preguntas</h2>
        <p className="text-sm text-muted-foreground">
          Cuántos de los que terminaron la respondieron bien.
        </p>
      </div>
      <ol className="divide-y border-y">
        {tasks.map((task, index) => {
          const blank = task.takers - task.correct - task.wrong;
          const share = (value: number) =>
            task.takers ? `${(value / task.takers) * 100}%` : "0%";
          return (
            <li
              key={`${task.category}-${task.id}`}
              style={{ animationDelay: `${Math.min(index, 12) * 40}ms` }}
              className={cn(enter, "py-3")}
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="w-6 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 font-medium break-words">
                  {task.title}
                </span>
                {task === hardest && task.correct < task.takers && (
                  <span className="text-xs font-semibold text-destructive">
                    La que más costó
                  </span>
                )}
                <DifficultyTag
                  difficulty={
                    isTaskDifficulty(task.difficulty) ? task.difficulty : null
                  }
                />
                <span className="w-24 shrink-0 text-right text-sm tabular-nums">
                  <span className="font-semibold">{task.correct}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    de {task.takers}
                  </span>
                </span>
              </div>
              <div
                className="grow-x mt-2 ml-9 flex h-1 origin-left overflow-hidden bg-foreground/10"
                style={{
                  animationDelay: `${150 + Math.min(index, 12) * 40}ms`,
                }}
                aria-label={`${task.correct} correctas, ${task.wrong} incorrectas, ${blank} sin responder`}
              >
                <span
                  className="bg-difficulty-easy transition-[width] duration-500"
                  style={{ width: share(task.correct) }}
                />
                <span
                  className="bg-destructive transition-[width] duration-500"
                  style={{ width: share(task.wrong) }}
                />
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** La silueta de la pantalla del grupo: nombre, código, pestañas y lista. */
function GroupSkeleton() {
  return (
    <div aria-busy className="flex w-full flex-col gap-6">
      <span className="sr-only">Cargando grupo...</span>
      <div className="flex flex-col gap-5 border-b pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-col gap-2.5">
          <Skeleton className="h-8 w-56 rounded-none" />
          <Skeleton className="h-4 w-72 max-w-full rounded-none" />
        </div>
        <div className="flex flex-col gap-2 lg:items-end">
          <Skeleton className="h-3 w-28 rounded-none" />
          <Skeleton className="h-9 w-64 rounded-none" />
        </div>
      </div>
      <div className="flex gap-6">
        <Skeleton className="h-6 w-28 rounded-none" />
        <Skeleton className="h-6 w-24 rounded-none" />
      </div>
      <div className="flex flex-col divide-y border-y">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="flex items-center gap-4 py-3">
            <Skeleton className="h-5 flex-1 rounded-none" />
            <Skeleton className="h-5 w-24 rounded-none" />
            <Skeleton className="h-5 w-20 rounded-none" />
          </div>
        ))}
      </div>
    </div>
  );
}
