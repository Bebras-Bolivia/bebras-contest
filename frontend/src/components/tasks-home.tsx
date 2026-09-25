"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { flushSync } from "react-dom";
import {
  AlertCircleIcon,
  FilePenLineIcon,
  FilePlus2Icon,
  GraduationCapIcon,
  PlayCircleIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { TaskOrigin } from "@/components/task-origin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
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
import {
  listTasks,
  mapTaskToHomeItem,
  removeTask,
  setTaskPractice,
  type HomeTaskItem,
} from "@/lib/tasks-api";
import {
  answerTypeLabels,
  answerTypes,
  type AnswerType,
} from "@/lib/task-schema";

type TypeFilter = AnswerType | "all";

/** El filtro vive en `?tipo=` para sobrevivir a ir a editar y volver. */
function readTypeFilter(): TypeFilter {
  const value = new URLSearchParams(window.location.search).get("tipo");
  return answerTypes.find((type) => type === value) ?? "all";
}

function writeTypeFilter(filter: TypeFilter) {
  const url = new URL(window.location.href);
  if (filter === "all") {
    url.searchParams.delete("tipo");
  } else {
    url.searchParams.set("tipo", filter);
  }
  window.history.replaceState(window.history.state, "", url);
}

/** Nombre de transición de cada fila: solo letras, dígitos y guiones. */
function taskTransitionName(id: string) {
  return `task-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function TasksHome() {
  const [tasks, setTasks] = useState<HomeTaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  // Solo la primera aparición de la lista se anima; al filtrar ya se encarga
  // la transición de vista, y animar también aquí la doblaría.
  const [revealing, setRevealing] = useState(false);
  const [taskToDelete, setTaskToDelete] = useState<HomeTaskItem | null>(null);
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");

  useEffect(() => {
    setTypeFilter(readTypeFilter());
  }, []);

  const typeCounts = useMemo(() => {
    const counts = new Map<AnswerType, number>();
    for (const task of tasks) {
      counts.set(task.answerType, (counts.get(task.answerType) ?? 0) + 1);
    }
    return counts;
  }, [tasks]);

  const visibleTasks =
    typeFilter === "all"
      ? tasks
      : tasks.filter((task) => task.answerType === typeFilter);

  const filterTransition = useRef(0);
  const filterBar = useRef<HTMLDivElement>(null);

  // En pantallas angostas la fila se desplaza de lado: la pestaña activa no
  // debe quedar cortada en el borde, ni al entrar con `?tipo=` ni al elegirla.
  useEffect(() => {
    const bar = filterBar.current;
    const active = bar?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!bar || !active) return;
    const margin = 16;
    const start = active.offsetLeft - margin;
    const end = active.offsetLeft + active.offsetWidth + margin;
    if (start < bar.scrollLeft) {
      bar.scrollTo({ left: start, behavior: "smooth" });
    } else if (end > bar.scrollLeft + bar.clientWidth) {
      bar.scrollTo({ left: end - bar.clientWidth, behavior: "smooth" });
    }
  }, [typeFilter, tasks.length]);

  /**
   * Las filas que siguen visibles viajan a su nuevo lugar y las demás se
   * funden. `data-task-filter` activa los nombres de transición solo
   * mientras dura el filtrado, para no meterse en la navegación de Astro.
   */
  const chooseTypeFilter = (filter: TypeFilter) => {
    writeTypeFilter(filter);

    if (!document.startViewTransition || prefersReducedMotion()) {
      setTypeFilter(filter);
      return;
    }

    const root = document.documentElement;
    const current = ++filterTransition.current;
    root.dataset.taskFilter = "";
    const transition = document.startViewTransition(() => {
      flushSync(() => setTypeFilter(filter));
    });
    void transition.finished.finally(() => {
      if (filterTransition.current === current) {
        delete root.dataset.taskFilter;
      }
    });
  };

  useEffect(() => {
    let active = true;

    void listTasks()
      .then((loadedTasks) => {
        if (!active) {
          return;
        }

        setTasks(loadedTasks.map(mapTaskToHomeItem));
      })
      .catch(() => {
        toast.error("No se pudieron cargar las tareas.");
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
        setRevealing(true);
        window.setTimeout(() => {
          if (active) setRevealing(false);
        }, 900);
      });

    return () => {
      active = false;
    };
  }, []);

  const togglePractice = (task: HomeTaskItem) => {
    const next = !task.isPractice;
    void setTaskPractice(task.id, next)
      .then(() => {
        setTasks((current) =>
          current.map((item) =>
            item.id === task.id ? { ...item, isPractice: next } : item,
          ),
        );
        toast.success(
          next ? "Tarea añadida a práctica." : "Tarea quitada de práctica.",
        );
      })
      .catch(() => {
        toast.error("No se pudo actualizar la práctica.");
      });
  };

  const confirmDelete = async () => {
    if (!taskToDelete || deletingTaskId) {
      return;
    }

    setDeletingTaskId(taskToDelete.id);
    try {
      await removeTask(taskToDelete.id);
      setTasks((current) =>
        current.filter((task) => task.id !== taskToDelete.id),
      );
      setTaskToDelete(null);
      toast.success("La tarea se eliminó correctamente.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo eliminar la tarea.",
      );
    } finally {
      setDeletingTaskId(null);
    }
  };

  const deletingSelectedTask = deletingTaskId === taskToDelete?.id;

  return (
    <div className="flex w-full flex-col gap-8">
      <div className="flex flex-col gap-4 border-b pb-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h1 className="font-heading text-3xl font-semibold tracking-tight">
            Tareas
          </h1>
        </div>
        <Button asChild className="shrink-0">
          <a href="/tareas/nueva">
            <FilePlus2Icon data-icon="inline-start" />
            Registrar tarea
          </a>
        </Button>
      </div>

      {loading ? (
        <TasksSkeleton />
      ) : tasks.length === 0 ? (
        <Alert>
          <AlertCircleIcon />
          <AlertTitle>No hay tareas registradas</AlertTitle>
          <AlertDescription>
            Crea la primera tarea para empezar a probar el flujo editorial.
          </AlertDescription>
        </Alert>
      ) : (
        <div className="flex flex-col">
          <div
            ref={filterBar}
            role="group"
            aria-label="Filtrar por tipo de respuesta"
            className="sticky top-0 z-10 -mx-4 flex gap-5 overflow-x-auto overflow-y-hidden bg-background px-4 shadow-[inset_0_-1px_0_var(--border)] sm:mx-0 sm:px-0"
          >
            {(["all", ...answerTypes] as const).map((type) => {
              const active = typeFilter === type;
              const count =
                type === "all" ? tasks.length : (typeCounts.get(type) ?? 0);
              return (
                <button
                  key={type}
                  type="button"
                  aria-pressed={active}
                  disabled={count === 0 && !active}
                  onClick={() => chooseTypeFilter(type)}
                  className="relative flex shrink-0 items-baseline gap-1.5 py-2.5 text-sm whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:text-foreground disabled:pointer-events-none disabled:opacity-40 aria-pressed:font-medium aria-pressed:text-foreground"
                >
                  {type === "all" ? "Todas" : answerTypeLabels[type]}
                  <span className="text-xs tabular-nums opacity-60">
                    {count}
                  </span>
                  {active && (
                    <span
                      aria-hidden="true"
                      className="task-filter-indicator absolute inset-x-0 bottom-0 h-0.5 bg-primary"
                    />
                  )}
                </button>
              );
            })}
          </div>

          {visibleTasks.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">
              No hay tareas de este tipo.
            </p>
          ) : (
            <ul className="divide-y border-b">
              {visibleTasks.map((task, index) => (
                <li
                  key={task.id}
                  data-task-row=""
                  data-revealing={revealing && index < 12 ? "" : undefined}
                  style={
                    {
                      "--task-transition-name": taskTransitionName(task.id),
                    } as CSSProperties
                  }
                  className="flex min-w-0 flex-col gap-4 px-3 py-5 lg:flex-row lg:items-start lg:justify-between lg:gap-8"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold break-words">
                        <a
                          href={`/tareas/editar?id=${task.id}`}
                          className="outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                        >
                          {task.title}
                        </a>
                      </h2>
                      {task.isPractice && (
                        <Badge className="gap-1">
                          <GraduationCapIcon className="size-3" />
                          Práctica
                        </Badge>
                      )}
                    </div>

                    <TaskOrigin
                      country={task.country}
                      year={task.year}
                      sourceTaskCode={task.sourceTaskCode}
                    />

                    <div className="flex flex-wrap gap-2">
                      <Badge
                        variant="outline"
                        className="text-muted-foreground"
                      >
                        {answerTypeLabels[task.answerType]}
                      </Badge>
                      {task.levels.map((level) => (
                        <Badge key={level} variant="outline">
                          {level}
                        </Badge>
                      ))}
                      {task.categories.map((category) => (
                        <Badge key={category} variant="outline">
                          {category}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  <div className="grid w-full shrink-0 gap-2 lg:w-72 lg:grid-cols-2">
                    <Button
                      size="sm"
                      type="button"
                      variant={task.isPractice ? "default" : "outline"}
                      className="w-full justify-start"
                      onClick={() => togglePractice(task)}
                    >
                      <GraduationCapIcon data-icon="inline-start" />
                      {task.isPractice ? "En práctica" : "Práctica"}
                    </Button>
                    <Button
                      asChild
                      size="sm"
                      variant="outline"
                      className="w-full justify-start"
                    >
                      <a href={`/tareas/editar?id=${task.id}`}>
                        <FilePenLineIcon data-icon="inline-start" />
                        Editar
                      </a>
                    </Button>
                    <Button
                      asChild
                      size="sm"
                      variant="outline"
                      className="w-full justify-start"
                    >
                      <a href={`/tareas/probador?id=${task.id}`}>
                        <PlayCircleIcon data-icon="inline-start" />
                        Probar
                      </a>
                    </Button>
                    <Button
                      size="sm"
                      type="button"
                      variant="outline"
                      className="w-full justify-start"
                      onClick={() => setTaskToDelete(task)}
                    >
                      <Trash2Icon data-icon="inline-start" />
                      Eliminar
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <AlertDialog
        open={taskToDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deletingSelectedTask) {
            setTaskToDelete(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar esta tarea?</AlertDialogTitle>
            <AlertDialogDescription>
              {taskToDelete
                ? `Se eliminará "${taskToDelete.title}". Esta acción no se puede deshacer.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingSelectedTask}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deletingSelectedTask}
              onClick={(event) => {
                event.preventDefault();
                void confirmDelete();
              }}
            >
              {deletingSelectedTask && <Spinner data-icon="inline-start" />}
              {deletingSelectedTask ? "Eliminando..." : "Eliminar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Silueta de la lista mientras llega: la misma forma, sin saltos al cargar. */
function TasksSkeleton() {
  return (
    <div className="flex flex-col" role="status" aria-label="Cargando tareas">
      <div className="flex gap-5 overflow-hidden py-3 shadow-[inset_0_-1px_0_var(--border)]">
        {[14, 28, 30, 32, 38, 34, 32].map((width, index) => (
          <Skeleton
            key={index}
            className="h-4 shrink-0 rounded-sm"
            style={{ width: `${width * 0.25}rem` }}
          />
        ))}
      </div>
      <ul className="divide-y border-b">
        {[56, 40, 64, 48, 52].map((title, index) => (
          <li
            key={index}
            className="flex min-w-0 flex-col gap-4 px-3 py-5 lg:flex-row lg:items-start lg:justify-between lg:gap-8"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <Skeleton
                className="h-6 max-w-full rounded-sm"
                style={{ width: `${title * 0.25}rem` }}
              />
              <Skeleton className="h-4 w-48 rounded-sm" />
              <div className="flex flex-wrap gap-2">
                <Skeleton className="h-5 w-28 rounded-sm" />
                <Skeleton className="h-5 w-20 rounded-sm" />
                <Skeleton className="h-5 w-16 rounded-sm" />
                <Skeleton className="h-5 w-44 rounded-sm" />
              </div>
            </div>
            <div className="grid w-full shrink-0 gap-2 lg:w-72 lg:grid-cols-2">
              {[0, 1, 2, 3].map((button) => (
                <Skeleton key={button} className="h-9 rounded-sm" />
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
