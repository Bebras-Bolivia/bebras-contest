"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlertCircleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PencilIcon,
  RotateCcwIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import { AnswerResult } from "@/components/answer-result";
import { TaskPlayContent } from "@/components/task-play-content";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  getTask,
  listTaskSummaries,
  mapTaskToHomeItem,
  previewTask,
  previewTaskDraft,
  checkTask,
  checkTaskDraft,
  type TaskCheckResult,
} from "@/lib/tasks-api";
import { readTaskDraftForTest } from "@/lib/task-draft-test";
import { answerHasResponse, type PlayTask } from "@/lib/play-api";
import { BEBRAS_CATEGORIES } from "@/lib/contest-schema";
import { cn } from "@/lib/utils";
import { difficultyStyles } from "@/lib/difficulty";
import { smoothReset } from "@/lib/smooth-reset";
import {
  NO_FILTERS,
  readFilters,
  storedFilters,
  visibleTasks,
} from "@/lib/task-filters";

/** Ancla de la fila de dificultad de un rango en el editor («10–12» → «10-12»). */
export function difficultyAnchor(ageRange: string) {
  return `dificultad-${ageRange.replace("–", "-")}`;
}
import type { StoredTask } from "@/lib/task-schema";

export function TaskTester() {
  const [selectedTask, setSelectedTask] = useState<StoredTask | null>(null);
  const [playTask, setPlayTask] = useState<PlayTask | null>(null);
  const [answer, setAnswer] = useState<unknown>({});
  const [result, setResult] = useState<TaskCheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [justChecked, setJustChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [backHref, setBackHref] = useState<string | null>(null);
  const [order, setOrder] = useState<string[] | null>(null);
  const [direction, setDirection] = useState<-1 | 0 | 1>(0);
  const [switching, setSwitching] = useState(false);
  const cache = useRef(
    new Map<string, Promise<{ task: StoredTask; preview: PlayTask }>>(),
  );
  const initialId = useRef<string | null>(null);
  // Cuando se prueba lo que hay en el editor, la tarea no está en la base y
  // hay que mandarla entera en cada llamada.
  const [draft, setDraft] = useState<unknown>(null);
  const revision = useRef(0);
  const checkController = useRef<AbortController | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const taskId = params.get("id");
    const back = params.get("volver");
    const stored = params.get("borrador") ? readTaskDraftForTest() : null;
    const editedDraft = stored?.task ?? null;
    const controller = new AbortController();
    let active = true;

    if (back?.startsWith("/")) {
      // Volver con el borrador puesto: el editor lo recupera de sessionStorage.
      setBackHref(
        editedDraft
          ? `${back}${back.includes("?") ? "&" : "?"}borrador=1`
          : back,
      );
    }

    void (async () => {
      try {
        if (editedDraft) {
          const preview = await previewTaskDraft(
            editedDraft,
            controller.signal,
          );
          if (!active) return;
          setDraft(editedDraft);
          setSelectedTask(editedDraft as StoredTask);
          setPlayTask(preview);
          return;
        }

        const firstId = taskId || (await listTaskSummaries())[0]?.id;
        const task = firstId ? await getTask(firstId) : undefined;
        if (!task || !active) return;
        const preview = await previewTask(task.id, controller.signal);
        if (!active) return;
        setSelectedTask(task);
        setPlayTask(preview);
      } catch (error) {
        if (!active) return;
        const message =
          error instanceof Error && editedDraft
            ? error.message
            : "No se pudo cargar la tarea.";
        setLoadError(message);
        toast.error(message);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      controller.abort();
      checkController.current?.abort();
      revision.current += 1;
    };
  }, []);

  const currentId = selectedTask && !draft ? selectedTask.id : null;
  if (currentId && !initialId.current) initialId.current = currentId;
  const hasCurrent = currentId !== null;
  useEffect(() => {
    if (!hasCurrent) return;
    let active = true;
    void listTaskSummaries()
      .then((tasks) => {
        if (!active) return;
        const items = tasks.map(mapTaskToHomeItem);
        const filtered = visibleTasks(items, readFilters(storedFilters())).map(
          (task) => task.id,
        );
        setOrder(
          filtered.includes(initialId.current ?? "")
            ? filtered
            : visibleTasks(items, NO_FILTERS).map((task) => task.id),
        );
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [hasCurrent]);

  const navOrder = order;
  const index = navOrder && currentId ? navOrder.indexOf(currentId) : -1;
  const neighbors =
    navOrder && index !== -1
      ? {
          previous: navOrder[index - 1] ?? null,
          next: navOrder[index + 1] ?? null,
          position: index + 1,
          total: navOrder.length,
        }
      : null;

  const fetchTask = (taskId: string) => {
    let entry = cache.current.get(taskId);
    if (!entry) {
      entry = getTask(taskId).then(async (task) => ({
        task,
        preview: await previewTask(task.id),
      }));
      entry.catch(() => cache.current.delete(taskId));
      cache.current.set(taskId, entry);
    }
    return entry;
  };

  useEffect(() => {
    for (const taskId of [neighbors?.previous, neighbors?.next]) {
      if (taskId) void fetchTask(taskId).catch(() => {});
    }
  });

  const testerHref = (taskId: string | null | undefined) =>
    taskId
      ? `/tareas/probador?id=${encodeURIComponent(taskId)}${backHref?.startsWith("/") && !draft ? `&volver=${encodeURIComponent(backHref)}` : ""}`
      : null;
  const goTo = async (taskId: string, step: -1 | 1, push = true) => {
    setSwitching(true);
    revision.current += 1;
    checkController.current?.abort();
    try {
      const { task, preview } = await fetchTask(taskId);
      setDirection(step);
      setSelectedTask(task);
      setPlayTask(preview);
      setAnswer({});
      setResult(null);
      setJustChecked(false);
      setChecking(false);
      const href = testerHref(taskId);
      if (push && href) window.history.pushState(null, "", href);
      window.scrollTo({
        top: 0,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
      });
    } catch {
      toast.error("No se pudo cargar la tarea.");
    } finally {
      setSwitching(false);
    }
  };

  const goToRef = useRef(goTo);
  const orderRef = useRef(navOrder);
  const currentRef = useRef(currentId);
  useEffect(() => {
    goToRef.current = goTo;
    orderRef.current = navOrder;
    currentRef.current = currentId;
  });
  useEffect(() => {
    const onPop = () => {
      const taskId = new URLSearchParams(window.location.search).get("id");
      if (!taskId || taskId === currentRef.current) return;
      const list = orderRef.current ?? [];
      const step =
        list.indexOf(taskId) < list.indexOf(currentRef.current ?? "") ? -1 : 1;
      void goToRef.current(taskId, step, false);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const stepButton = (
    taskId: string | null,
    step: -1 | 1,
    label: string,
    icon: ReactNode,
  ) =>
    taskId ? (
      <Button
        asChild
        variant="outline"
        size="icon-sm"
        aria-label={label}
        title={label}
      >
        <a
          href={testerHref(taskId) ?? undefined}
          onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey) return;
            event.preventDefault();
            if (!switching) void goTo(taskId, step);
          }}
        >
          {icon}
        </a>
      </Button>
    ) : (
      <Button
        variant="outline"
        size="icon-sm"
        aria-label={label}
        title={label}
        disabled
      >
        {icon}
      </Button>
    );

  const handleAnswerChange = (payload: unknown) => {
    revision.current += 1;
    checkController.current?.abort();
    setChecking(false);
    setResult(null);
    setAnswer(payload);
  };

  const handleReset = () => smoothReset(() => handleAnswerChange({}));

  const handleCheckAnswer = async () => {
    if (!playTask || checking) return;
    if (!answerHasResponse(playTask.answerType, answer)) {
      toast.error("Completa una respuesta antes de probar la tarea.");
      return;
    }
    const checkedRevision = ++revision.current;
    const controller = new AbortController();
    checkController.current?.abort();
    checkController.current = controller;
    setResult(null);
    setChecking(true);
    try {
      const checked = draft
        ? await checkTaskDraft(draft, answer, controller.signal)
        : await checkTask(playTask.taskId, answer, controller.signal);
      // A result belongs only to the exact answer that initiated this request.
      if (checkedRevision !== revision.current) return;
      setJustChecked(true);
      setResult(checked);
    } catch (error) {
      if (checkedRevision === revision.current) {
        toast.error(
          error instanceof Error
            ? error.message
            : "No se pudo comprobar la respuesta.",
        );
      }
    } finally {
      if (checkedRevision === revision.current) setChecking(false);
    }
  };

  // Con un borrador se vuelve a ese borrador, no a lo guardado.
  const editHref =
    backHref && (draft !== null || currentId === initialId.current)
      ? backHref
      : selectedTask && draft === null
        ? `/tareas/editar?id=${encodeURIComponent(selectedTask.id)}`
        : null;

  const exitButton = (
    <Button
      asChild
      variant="ghost"
      size="icon-sm"
      aria-label="Salir del probador"
      title="Salir"
    >
      <a href={backHref ?? "/tareas"}>
        <XIcon />
      </a>
    </Button>
  );

  return (
    <div className="flex w-full flex-col gap-6">
      {!selectedTask && <div className="-mb-3">{exitButton}</div>}
      {loading && !selectedTask && <TesterSkeleton />}

      {!loading && !selectedTask && (
        <Alert>
          <AlertCircleIcon />
          <AlertTitle>No se pudo abrir la tarea</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3">
            <span>
              {loadError ??
                "Abre el probador desde una tarea específica para verla en esta vista."}
            </span>
            {backHref && (
              <Button asChild type="button" variant="outline">
                <a href={backHref}>
                  <PencilIcon data-icon="inline-start" />
                  Volver a la edición
                </a>
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      {selectedTask && (
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-300 sm:gap-7">
          <div className="sticky top-0 z-20 -mx-4 -mt-3 flex flex-wrap items-center gap-2 border-b bg-background px-4 pt-3 pb-3 text-sm text-muted-foreground sm:mx-0 sm:px-0">
            {exitButton}
            <span>Probando:</span>
            <h1 className="font-medium text-foreground">
              {selectedTask.title}
            </h1>
            {draft !== null && <Badge>Cambios sin guardar</Badge>}
            {selectedTask.categories.map((category) => (
              <Badge key={category} variant="secondary">
                {category}
              </Badge>
            ))}
            {neighbors && (
              <nav
                aria-label="Moverse entre tareas"
                className="ml-auto flex items-center gap-1.5"
              >
                {stepButton(
                  neighbors.previous,
                  -1,
                  "Tarea anterior",
                  <ChevronLeftIcon />,
                )}
                <span className="min-w-12 text-center text-xs tabular-nums">
                  {neighbors.position} / {neighbors.total}
                </span>
                {stepButton(
                  neighbors.next,
                  1,
                  "Tarea siguiente",
                  <ChevronRightIcon />,
                )}
              </nav>
            )}
          </div>
          <div
            key={selectedTask.id}
            className={cn(
              "flex flex-col gap-6 transition-opacity duration-150 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-300 sm:gap-7",
              direction === 1 && "motion-safe:slide-in-from-right-8",
              direction === -1 && "motion-safe:slide-in-from-left-8",
              switching && "opacity-60",
            )}
          >
            <nav
              aria-label="Dificultad por categoría"
              className="-mt-3 flex flex-wrap gap-1.5 sm:-mt-4"
            >
              {BEBRAS_CATEGORIES.map((category) => {
                const level =
                  difficultyStyles[
                    (selectedTask.difficulties[category.ageRange] ?? "").trim()
                  ];
                return (
                  <Badge
                    key={category.name}
                    asChild
                    // Con dificultad, sin borde: el color ya marca la etiqueta.
                    variant={level ? "secondary" : "outline"}
                    className={cn(
                      "h-6 gap-1.5 px-2 font-semibold hover:brightness-95",
                      level?.className ?? "border-dashed text-muted-foreground",
                    )}
                  >
                    <a
                      href={
                        editHref
                          ? `${editHref}#${difficultyAnchor(category.ageRange)}`
                          : undefined
                      }
                      aria-label={`${category.name}: ${level?.label ?? "sin dificultad"}. Cambiar en el editor.`}
                      title={level?.label ?? "Sin dificultad"}
                    >
                      {category.name}
                    </a>
                  </Badge>
                );
              })}
            </nav>

            {playTask && (
              <TaskPlayContent
                task={playTask}
                value={answer}
                onChange={handleAnswerChange}
              />
            )}

            {result && (
              <AnswerResult
                correct={result.correct}
                explanationBlocks={result.explanationBlocks}
                reveal={justChecked}
              />
            )}

            <div className="flex justify-end border-t pt-5">
              <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:justify-end sm:gap-3 [&>*]:min-w-0 [&>*:last-child:nth-child(odd)]:col-span-2">
                {editHref && (
                  <Button asChild type="button" variant="outline">
                    <a href={editHref}>
                      <PencilIcon data-icon="inline-start" />
                      Editar
                    </a>
                  </Button>
                )}
                <Button type="button" variant="outline" onClick={handleReset}>
                  <RotateCcwIcon data-icon="inline-start" />
                  Reiniciar
                </Button>
                <Button
                  type="button"
                  onClick={handleCheckAnswer}
                  disabled={
                    !playTask ||
                    checking ||
                    !answerHasResponse(playTask.answerType, answer)
                  }
                >
                  {checking ? "Comprobando…" : "Comprobar"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Silueta del probador mientras llega la tarea: la misma forma, sin saltos. */
function TesterSkeleton() {
  return (
    <div
      role="status"
      aria-label="Cargando tarea"
      className="mx-auto flex w-full max-w-4xl flex-col gap-6 sm:gap-7"
    >
      <div className="flex flex-wrap items-center gap-2 border-b pb-3">
        <Skeleton className="h-4 w-16 rounded-none" />
        <Skeleton className="h-5 w-40 rounded-none" />
        <Skeleton className="h-5 w-48 rounded-none" />
      </div>
      <div className="-mt-3 flex flex-wrap gap-1.5 sm:-mt-4">
        {[28, 24, 20, 26, 28, 22].map((width, index) => (
          <Skeleton
            key={index}
            className="h-6 rounded-none"
            style={{ width: `${width * 0.25}rem` }}
          />
        ))}
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-full rounded-none" />
        <Skeleton className="h-4 w-11/12 rounded-none" />
        <Skeleton className="h-4 w-2/3 rounded-none" />
      </div>
      <Skeleton className="mx-auto h-64 w-full max-w-xl rounded-none" />
      <Skeleton className="h-4 w-3/4 rounded-none" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((option) => (
          <Skeleton key={option} className="h-28 rounded-none" />
        ))}
      </div>
      <div className="flex justify-end gap-3 border-t pt-4">
        <Skeleton className="h-9 w-28 rounded-none" />
        <Skeleton className="h-9 w-24 rounded-none" />
      </div>
    </div>
  );
}
