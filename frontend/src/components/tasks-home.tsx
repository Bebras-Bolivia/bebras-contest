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
  SearchIcon,
  Trash2Icon,
  XIcon,
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
import { BEBRAS_CATEGORIES } from "@/lib/contest-schema";
import { difficultyStyles } from "@/lib/difficulty";
import { cn } from "@/lib/utils";

type Filters = {
  type: AnswerType | "all";
  age: string;
  difficulty: string;
  practice: boolean;
  query: string;
};

const NO_FILTERS: Filters = {
  type: "all",
  age: "all",
  difficulty: "all",
  practice: false,
  query: "",
};

const DIFFICULTIES = ["easy", "medium", "hard"] as const;

function readFilters(): Filters {
  const params = new URLSearchParams(window.location.search);
  const type = params.get("tipo");
  const age =
    BEBRAS_CATEGORIES.find((category) => category.name === params.get("edad"))
      ?.name ?? "all";
  const difficulty = params.get("dificultad");
  return {
    type: answerTypes.find((value) => value === type) ?? "all",
    age,
    difficulty:
      age !== "all" && DIFFICULTIES.some((value) => value === difficulty)
        ? (difficulty as string)
        : "all",
    practice: params.get("practica") === "1",
    query: params.get("q") ?? "",
  };
}

function writeFilters(filters: Filters) {
  const url = new URL(window.location.href);
  for (const [key, value] of [
    ["tipo", filters.type],
    ["edad", filters.age],
    ["dificultad", filters.difficulty],
    ["practica", filters.practice ? "1" : "all"],
    ["q", filters.query.trim() || "all"],
  ] as const) {
    if (value === "all") url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  window.history.replaceState(window.history.state, "", url);
}

function fold(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function levelFor(task: HomeTaskItem, age: string) {
  return task.levels.find((level) => level.name === age);
}

function matches(
  task: HomeTaskItem,
  filters: Filters,
  skip?: "type" | "age" | "difficulty",
) {
  if (skip !== "type" && filters.type !== "all") {
    if (task.answerType !== filters.type) return false;
  }
  if (skip !== "age" && filters.age !== "all") {
    const level = levelFor(task, filters.age);
    if (!level) return false;
    if (skip !== "difficulty" && filters.difficulty !== "all") {
      if (level.difficulty !== filters.difficulty) return false;
    }
  }
  if (filters.practice && !task.isPractice) return false;
  const query = fold(filters.query.trim());
  if (query) {
    const haystack = fold(
      [task.title, task.sourceTaskCode, task.country].filter(Boolean).join(" "),
    );
    if (!haystack.includes(query)) return false;
  }
  return true;
}

function difficultyRank(task: HomeTaskItem, age: string) {
  return difficultyStyles[levelFor(task, age)?.difficulty ?? ""]?.rank ?? 3;
}

const chipClass =
  "flex h-7 shrink-0 items-center gap-1.5 px-2.5 text-xs whitespace-nowrap text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/60 disabled:pointer-events-none disabled:opacity-40 aria-pressed:bg-primary/10 aria-pressed:font-semibold aria-pressed:text-primary";

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
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const typeFilter = filters.type;
  const ageFilter = filters.age;
  const filtered = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);

  useEffect(() => {
    setFilters(readFilters());
  }, []);

  const counts = useMemo(() => {
    const type = new Map<string, number>();
    const age = new Map<string, number>();
    const difficulty = new Map<string, number>();
    const add = (map: Map<string, number>, key: string) =>
      map.set(key, (map.get(key) ?? 0) + 1);
    for (const task of tasks) {
      if (matches(task, filters, "type")) {
        add(type, "all");
        add(type, task.answerType);
      }
      if (matches(task, filters, "age")) {
        add(age, "all");
        for (const level of task.levels) add(age, level.name);
      }
      if (filters.age !== "all" && matches(task, filters, "difficulty")) {
        add(difficulty, "all");
        const level = levelFor(task, filters.age);
        if (level) add(difficulty, level.difficulty);
      }
    }
    return { type, age, difficulty };
  }, [tasks, filters]);

  const visibleTasks = useMemo(() => {
    const matching = tasks.filter((task) => matches(task, filters));
    return ageFilter === "all"
      ? matching
      : [...matching].sort(
          (a, b) => difficultyRank(a, ageFilter) - difficultyRank(b, ageFilter),
        );
  }, [tasks, filters, ageFilter]);

  const filterTransition = useRef(0);
  const filterBar = useRef<HTMLDivElement>(null);
  const chipBar = useRef<HTMLDivElement>(null);

  // En pantallas angostas la fila se desplaza de lado: la pestaña activa no
  // debe quedar cortada en el borde, ni al entrar con `?tipo=` ni al elegirla.
  const scrolledOnce = useRef(false);
  useEffect(() => {
    if (loading) return;
    const behavior = scrolledOnce.current ? "smooth" : "instant";
    scrolledOnce.current = true;
    const difficultyChip =
      filters.difficulty === "all"
        ? null
        : chipBar.current?.querySelector<HTMLElement>(
            '[data-difficulty-group] [aria-pressed="true"]',
          );
    for (const [bar, active] of [
      [
        filterBar.current,
        filterBar.current?.querySelector<HTMLElement>('[aria-pressed="true"]'),
      ],
      [
        chipBar.current,
        difficultyChip ??
          chipBar.current?.querySelector<HTMLElement>(
            '[data-category-group] [aria-pressed="true"]',
          ),
      ],
    ] as const) {
      if (!bar || !active) continue;
      const margin = 16;
      const start = active.offsetLeft - margin;
      const end = active.offsetLeft + active.offsetWidth + margin;
      if (start < bar.scrollLeft) {
        bar.scrollTo({ left: start, behavior });
      } else if (end > bar.scrollLeft + bar.clientWidth) {
        bar.scrollTo({ left: end - bar.clientWidth, behavior });
      }
    }
  }, [typeFilter, ageFilter, filters.difficulty, loading]);

  /**
   * Las filas que siguen visibles viajan a su nuevo lugar y las demás se
   * funden. `data-task-filter` activa los nombres de transición solo
   * mientras dura el filtrado, para no meterse en la navegación de Astro.
   */
  const chooseFilters = (change: Partial<Filters>) => {
    const next = { ...filters, ...change };
    if (change.age !== undefined && change.age !== filters.age) {
      next.difficulty = "all";
    }
    writeFilters(next);

    if (!document.startViewTransition || prefersReducedMotion()) {
      setFilters(next);
      return;
    }

    const root = document.documentElement;
    const current = ++filterTransition.current;
    root.dataset.taskFilter = "";
    const transition = document.startViewTransition(() => {
      flushSync(() => setFilters(next));
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
          <div className="flex items-center justify-between gap-2 pb-2">
            <label className="relative flex h-9 min-w-0 flex-1 items-center sm:max-w-xs">
              <SearchIcon
                aria-hidden="true"
                className="pointer-events-none absolute left-2.5 size-4 text-muted-foreground"
              />
              <input
                type="search"
                value={filters.query}
                onChange={(event) => {
                  const next = { ...filters, query: event.target.value };
                  writeFilters(next);
                  setFilters(next);
                }}
                placeholder="Buscar tarea"
                aria-label="Buscar tarea por nombre, código o país"
                className="h-full w-full bg-muted/60 pr-8 pl-8 text-sm outline-none placeholder:text-muted-foreground focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-primary/60 [&::-webkit-search-cancel-button]:hidden"
              />
              {filters.query && (
                <button
                  type="button"
                  aria-label="Borrar búsqueda"
                  onClick={() => {
                    const next = { ...filters, query: "" };
                    writeFilters(next);
                    setFilters(next);
                  }}
                  className="absolute right-1.5 grid size-6 place-items-center text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/60"
                >
                  <XIcon className="size-4" />
                </button>
              )}
            </label>
            <button
              type="button"
              aria-pressed={filters.practice}
              onClick={() => chooseFilters({ practice: !filters.practice })}
              className={chipClass}
            >
              <GraduationCapIcon className="size-3.5" aria-hidden="true" />
              Solo en práctica
            </button>
          </div>

          <div className="sticky top-0 z-10 -mx-4 flex flex-col bg-background px-4 shadow-[inset_0_-1px_0_var(--border)] sm:mx-0 sm:px-0">
            <div
              ref={filterBar}
              role="group"
              aria-label="Filtrar por tipo de respuesta"
              className="flex gap-5 overflow-x-auto overflow-y-hidden"
            >
              {(["all", ...answerTypes] as const).map((type) => {
                const active = typeFilter === type;
                const count = counts.type.get(type) ?? 0;
                return (
                  <button
                    key={type}
                    type="button"
                    aria-pressed={active}
                    disabled={count === 0 && !active}
                    onClick={() => chooseFilters({ type })}
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
            <div
              ref={chipBar}
              className="relative flex items-center gap-1 overflow-x-auto pt-1 pb-2.5"
            >
              <div
                role="group"
                aria-label="Filtrar por categoría"
                data-category-group=""
                className="flex shrink-0 gap-1"
              >
                {[{ name: "all" }, ...BEBRAS_CATEGORIES].map((category) => {
                  const active = ageFilter === category.name;
                  const count = counts.age.get(category.name) ?? 0;
                  return (
                    <button
                      key={category.name}
                      type="button"
                      aria-pressed={active}
                      disabled={count === 0 && !active}
                      onClick={() => chooseFilters({ age: category.name })}
                      className={chipClass}
                    >
                      {category.name === "all"
                        ? "Todas las categorías"
                        : category.name}
                      <span className="tabular-nums opacity-60">{count}</span>
                    </button>
                  );
                })}
              </div>
              {ageFilter !== "all" && (
                <div
                  role="group"
                  aria-label={`Filtrar por dificultad en ${ageFilter}`}
                  data-difficulty-group=""
                  className="flex shrink-0 items-center gap-1 border-l border-border/20 pl-2 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-left-2 motion-safe:duration-200"
                >
                  {(["all", ...DIFFICULTIES] as const).map((difficulty) => {
                    const active = filters.difficulty === difficulty;
                    const count = counts.difficulty.get(difficulty) ?? 0;
                    const style = difficultyStyles[difficulty];
                    return (
                      <button
                        key={difficulty}
                        type="button"
                        aria-pressed={active}
                        disabled={count === 0 && !active}
                        onClick={() => chooseFilters({ difficulty })}
                        className={chipClass}
                      >
                        {style && (
                          <span
                            aria-hidden="true"
                            className={cn(
                              "size-2.5 border border-foreground/40",
                              style.className,
                            )}
                          />
                        )}
                        {style?.label ?? "Todas"}
                        <span className="tabular-nums opacity-60">{count}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {visibleTasks.length === 0 ? (
            <div className="flex flex-col items-start gap-2 py-8 text-sm text-muted-foreground">
              <p>No hay tareas con estos filtros.</p>
              {filtered && (
                <button
                  type="button"
                  onClick={() => chooseFilters(NO_FILTERS)}
                  className="font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:underline"
                >
                  Quitar filtros
                </button>
              )}
            </div>
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
                      {task.levels.map((level) => {
                        const style = difficultyStyles[level.difficulty];
                        return (
                          <Badge
                            key={level.name}
                            variant={style ? "secondary" : "outline"}
                            title={style?.label ?? level.difficulty}
                            aria-label={`${level.name}: ${style?.label ?? level.difficulty}`}
                            className={cn(
                              "px-2 font-semibold",
                              style?.className ??
                                "border-dashed text-muted-foreground",
                            )}
                          >
                            {level.name}
                          </Badge>
                        );
                      })}
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
      <div className="pb-2">
        <Skeleton className="h-9 w-full rounded-sm sm:max-w-xs" />
      </div>
      <div className="flex gap-5 overflow-hidden py-3">
        {[14, 28, 30, 32, 38, 34, 32].map((width, index) => (
          <Skeleton
            key={index}
            className="h-4 shrink-0 rounded-sm"
            style={{ width: `${width * 0.25}rem` }}
          />
        ))}
      </div>
      <div className="flex gap-1 overflow-hidden pt-1 pb-2.5 shadow-[inset_0_-1px_0_var(--border)]">
        {[34, 22, 20, 12, 20, 22, 16].map((width, index) => (
          <Skeleton
            key={index}
            className="h-7 shrink-0 rounded-sm"
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
