"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  EyeIcon,
  LoaderCircleIcon,
  PencilIcon,
  PlusIcon,
  SaveIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import { getContest, updateContest } from "@/lib/contests-api";
import {
  CATEGORY_AGE_RANGE,
  difficultyBadgeClass,
  difficultyLabel,
  type ContestDraftInput,
  type StoredContest,
} from "@/lib/contest-schema";
import { listTasks } from "@/lib/tasks-api";
import {
  parseMultipleChoiceCorrectness,
  type StoredTask,
} from "@/lib/task-schema";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { TaskContentRenderer } from "@/components/task-content-renderer";
import { TaskExplanation } from "@/components/task-explanation";
import { TaskOrigin } from "@/components/task-origin";
import { cn } from "@/lib/utils";

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

/** Dificultad de la tarea en la categoría del desafío, que es la que puntúa. */
function difficultyFor(task: StoredTask, category: string) {
  const ageRange = CATEGORY_AGE_RANGE[category];
  return ageRange ? (task.difficulties[ageRange] ?? "") : "";
}

/** El desafío se guarda entero; aquí solo cambian sus tareas. */
function toPayload(
  contest: StoredContest,
  taskIds: string[],
): ContestDraftInput {
  return {
    title: contest.title,
    category: contest.category,
    durationMinutes: contest.durationMinutes,
    registrationStartsAt: contest.registrationStartsAt ?? "",
    registrationEndsAt: contest.registrationEndsAt ?? "",
    startsAt: contest.startsAt ?? "",
    endsAt: contest.endsAt ?? "",
    scoring: contest.scoring,
    questionDisplayMode: contest.questionDisplayMode,
    allowPairs: contest.allowPairs,
    showFeedback: contest.showFeedback,
    showSolutions: contest.showSolutions,
    showTotalScore: contest.showTotalScore,
    tasks: taskIds.map((taskId) => ({ taskId })),
  };
}

export function ContestTasksPage() {
  const contestId = useMemo(
    () =>
      typeof window === "undefined"
        ? null
        : new URLSearchParams(window.location.search).get("id"),
    [],
  );

  const [contest, setContest] = useState<StoredContest | null>(null);
  const [tasks, setTasks] = useState<StoredTask[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [saved, setSaved] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState<StoredTask | null>(null);
  const previewCorrectIds = preview
    ? parseMultipleChoiceCorrectness(preview.correctAnswerId).correctOptionIds
    : [];

  useEffect(() => {
    if (!contestId) {
      setLoadError("No se indicó qué desafío editar.");
      setLoading(false);
      return;
    }

    let active = true;

    void Promise.all([getContest(contestId), listTasks()])
      .then(([loadedContest, loadedTasks]) => {
        if (!active) return;
        const order = loadedContest.tasks
          .slice()
          .sort((left, right) => left.position - right.position)
          .map((task) => task.taskId);
        setContest(loadedContest);
        setTasks(loadedTasks);
        setPicked(order);
        setSaved(order);
      })
      .catch((error: unknown) => {
        if (active) {
          setLoadError(
            error instanceof Error
              ? error.message
              : "No se pudo cargar el desafío.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [contestId]);

  const category = contest?.category ?? "";

  // Editar una pregunta lleva al editor y de vuelta a esta misma pantalla.
  const editHref = (taskId: string) =>
    `/tareas/editar?id=${encodeURIComponent(taskId)}&volver=${encodeURIComponent(
      `/desafios/preguntas?id=${contestId ?? ""}`,
    )}`;
  const tasksById = useMemo(
    () => new Map(tasks.map((task) => [task.id, task])),
    [tasks],
  );

  const selected = useMemo(
    () =>
      picked
        .map((id) => tasksById.get(id))
        .filter((task): task is StoredTask => task !== undefined),
    [picked, tasksById],
  );

  // Una tarea sin dificultad para el rango de la categoría no puntuaría.
  const available = useMemo(() => {
    const term = normalize(search.trim());

    return tasks.filter((task) => {
      if (picked.includes(task.id)) return false;
      if (!difficultyFor(task, category)) return false;
      if (!term) return true;
      return normalize(`${task.title} ${task.categories.join(" ")}`).includes(
        term,
      );
    });
  }, [tasks, picked, category, search]);

  const dirty =
    picked.length !== saved.length ||
    picked.some((id, index) => saved[index] !== id);

  useEffect(() => {
    if (!dirty) {
      return;
    }

    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const move = (taskId: string, direction: "up" | "down") => {
    setPicked((current) => {
      const index = current.indexOf(taskId);
      const target = direction === "up" ? index - 1 : index + 1;
      if (index === -1 || target < 0 || target >= current.length) {
        return current;
      }
      const next = current.slice();
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const save = async () => {
    if (!contest || !contestId) return;
    setSaving(true);

    try {
      await updateContest(contestId, toPayload(contest, picked));
      setSaved(picked);
      toast.success("Preguntas guardadas.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "No se pudo guardar.",
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-72 items-center justify-center">
        <LoaderCircleIcon className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (loadError || !contest) {
    return (
      <Alert variant="destructive">
        <AlertTitle>No se pudo abrir</AlertTitle>
        <AlertDescription>
          {loadError ?? "Desafío no encontrado."}{" "}
          <a href="/desafios" className="underline underline-offset-4">
            Volver a Desafíos
          </a>
        </AlertDescription>
      </Alert>
    );
  }

  const row = (task: StoredTask, actions: React.ReactNode, index?: number) => (
    <li
      key={task.id}
      className="flex min-w-0 flex-col gap-3 bg-background px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
    >
      <div className="flex min-w-0 items-start gap-3">
        {index !== undefined && (
          <Badge variant="secondary" className="mt-0.5">
            {index + 1}
          </Badge>
        )}
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="break-words font-medium">{task.title}</span>
          {difficultyFor(task, category) && (
            <Badge
              variant="outline"
              className={difficultyBadgeClass(difficultyFor(task, category))}
            >
              {difficultyLabel(difficultyFor(task, category))}
            </Badge>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 self-end sm:self-auto">
        <Button
          size="icon-sm"
          type="button"
          variant="ghost"
          aria-label={`Ver ${task.title}`}
          onClick={() => setPreview(task)}
        >
          <EyeIcon />
        </Button>
        <Button asChild size="icon-sm" variant="ghost">
          <a href={editHref(task.id)} aria-label={`Editar ${task.title}`}>
            <PencilIcon />
          </a>
        </Button>
        {actions}
      </div>
    </li>
  );

  return (
    <div className="flex w-full flex-col gap-8">
      <div className="flex flex-col gap-4 border-b pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h1 className="font-heading text-3xl font-semibold tracking-tight">
            Preguntas del desafío
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
            {contest.title} · {contest.category || "sin categoría"}. Solo
            aparecen las preguntas con dificultad definida para esta categoría.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button asChild variant="outline">
            <a href={`/desafios/editar?id=${contest.id}`}>
              Ajustes del desafío
            </a>
          </Button>
          <Button type="button" disabled={!dirty || saving} onClick={save}>
            <SaveIcon data-icon="inline-start" />
            {saving ? "Guardando..." : "Guardar"}
          </Button>
        </div>
      </div>

      <div className="grid min-w-0 gap-8 *:min-w-0 xl:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-3">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            En el desafío
            <Badge variant="secondary">{selected.length}</Badge>
          </h2>
          {selected.length === 0 ? (
            <p className="rounded-sm border border-dashed px-4 py-6 text-sm text-muted-foreground">
              Todavía no elegiste ninguna. Para publicar el desafío necesitas al
              menos una.
            </p>
          ) : (
            <ul className="divide-y rounded-sm border">
              {selected.map((task, index) =>
                row(
                  task,
                  <>
                    <Button
                      size="icon-sm"
                      type="button"
                      variant="outline"
                      aria-label="Subir"
                      disabled={index === 0}
                      onClick={() => move(task.id, "up")}
                    >
                      <ArrowUpIcon />
                    </Button>
                    <Button
                      size="icon-sm"
                      type="button"
                      variant="outline"
                      aria-label="Bajar"
                      disabled={index === selected.length - 1}
                      onClick={() => move(task.id, "down")}
                    >
                      <ArrowDownIcon />
                    </Button>
                    <Button
                      size="icon-sm"
                      type="button"
                      variant="outline"
                      aria-label={`Quitar ${task.title}`}
                      onClick={() =>
                        setPicked((current) =>
                          current.filter((id) => id !== task.id),
                        )
                      }
                    >
                      <XIcon />
                    </Button>
                  </>,
                  index,
                ),
              )}
            </ul>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            Disponibles
            <Badge variant="secondary">{available.length}</Badge>
          </h2>
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por título o área"
              className="pl-9"
              aria-label="Buscar preguntas"
            />
          </div>
          {available.length === 0 ? (
            <p className="rounded-sm border border-dashed px-4 py-6 text-sm text-muted-foreground">
              {search.trim()
                ? "Ninguna pregunta coincide con esa búsqueda."
                : `No queda ninguna pregunta de ${contest.category || "esta categoría"} sin usar.`}
            </p>
          ) : (
            <ul className="divide-y rounded-sm border">
              {available.map((task) =>
                row(
                  task,
                  <Button
                    size="icon-sm"
                    type="button"
                    variant="outline"
                    aria-label={`Agregar ${task.title}`}
                    onClick={() =>
                      setPicked((current) => [...current, task.id])
                    }
                  >
                    <PlusIcon />
                  </Button>,
                ),
              )}
            </ul>
          )}
        </div>
      </div>

      {/* Los enunciados ya vienen con listTasks: mirar una no cuesta una
          petición. */}
      <Dialog
        open={preview !== null}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
      >
        <DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="break-words">
              {preview?.title ?? ""}
            </DialogTitle>
            {preview && (
              <TaskOrigin
                country={preview.country}
                year={preview.year}
                sourceTaskCode={preview.sourceTaskCode}
              />
            )}
            <DialogDescription>
              {preview
                ? [
                    preview.categories.join(", ") || "Sin área",
                    difficultyLabel(difficultyFor(preview, category)) ||
                      "Sin dificultad para esta categoría",
                    "así la verá el estudiante",
                  ].join(" · ")
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
            {preview && (
              <>
                <TaskContentRenderer
                  blocks={preview.bodyBlocks}
                  className="gap-4"
                />
                {preview.challengeBlocks.length > 0 && (
                  <TaskContentRenderer
                    blocks={preview.challengeBlocks}
                    className="gap-4"
                  />
                )}
                {preview.answerType === "multiple_choice" &&
                  preview.answers.length > 0 && (
                    <ul className="flex flex-col gap-2">
                      {preview.answers.map((answer) => {
                        const right = previewCorrectIds.includes(answer.id);
                        return (
                          <li
                            key={answer.id}
                            className={cn(
                              "flex items-start gap-2 rounded-sm border px-3 py-2 text-sm",
                              right && "border-primary bg-primary/5",
                            )}
                          >
                            <span className="font-mono font-semibold uppercase">
                              {answer.id}
                            </span>
                            <div className="min-w-0 flex-1">
                              <TaskContentRenderer blocks={answer.blocks} />
                            </div>
                            {right && (
                              <Badge variant="secondary">Correcta</Badge>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                {preview.explanationBlocks?.length && (
                  <div className="rounded-sm border bg-muted/40 px-3 py-2 text-sm">
                    <span className="font-semibold">Explicación: </span>
                    <TaskExplanation blocks={preview.explanationBlocks} />
                  </div>
                )}
              </>
            )}
          </div>
          <DialogFooter>
            {preview && (
              <Button asChild variant="outline">
                <a href={editHref(preview.id)}>
                  <PencilIcon data-icon="inline-start" />
                  Editarla
                </a>
              </Button>
            )}
            <Button type="button" onClick={() => setPreview(null)}>
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
