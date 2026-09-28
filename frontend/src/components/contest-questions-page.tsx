"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeftIcon,
  CheckIcon,
  LoaderCircleIcon,
  SaveIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";

import { getContest, updateContest } from "@/lib/contests-api";
import {
  BEBRAS_SCORING,
  DIFFICULTY_KEYS,
  type ContestState,
  type StoredContest,
} from "@/lib/contest-schema";
import { difficultyStyles } from "@/lib/difficulty";
import { listTasks } from "@/lib/tasks-api";
import {
  answerTypeLabels,
  answerTypes,
  type AnswerType,
  type StoredTask,
} from "@/lib/task-schema";
import {
  TASK_VISIBILITIES,
  taskVisibility,
  visibilityInfo,
  type TaskVisibility,
} from "@/lib/task-visibility";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DifficultyTag,
  TaskPreviewDialog,
  difficultyOf,
} from "@/components/contest-task-parts";

const EDITABLE: ContestState[] = [
  "borrador",
  "programada",
  "inscripcion",
  "preparacion",
];

const chipClass =
  "flex h-7 shrink-0 items-center gap-1.5 px-2.5 text-xs whitespace-nowrap text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/60 disabled:pointer-events-none disabled:opacity-40 aria-pressed:bg-primary/10 aria-pressed:font-semibold aria-pressed:text-primary";

function fold(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function tasksByCategory(contest: StoredContest) {
  const result: Record<string, string[]> = {};
  for (const task of contest.tasks
    .slice()
    .sort((left, right) => left.position - right.position)) {
    result[task.category] = [...(result[task.category] ?? []), task.taskId];
  }
  return result;
}

export function ContestQuestionsPage() {
  const [params] = useState(() =>
    typeof window === "undefined"
      ? new URLSearchParams()
      : new URLSearchParams(window.location.search),
  );
  const contestId = params.get("id");
  const [contest, setContest] = useState<StoredContest | null>(null);
  const [bank, setBank] = useState<StoredTask[]>([]);
  const [chosen, setChosen] = useState<Record<string, string[]>>({});
  const [category, setCategory] = useState(params.get("categoria") ?? "");
  const [loadError, setLoadError] = useState<string | null>(
    contestId ? null : "No se indicó el desafío.",
  );
  const [query, setQuery] = useState("");
  const [type, setType] = useState<AnswerType | "all">("all");
  const [difficulty, setDifficulty] = useState<string>("all");
  const [visibility, setVisibility] = useState<TaskVisibility | "all">("all");
  const [onlyChosen, setOnlyChosen] = useState(false);
  const [preview, setPreview] = useState<StoredTask | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState("");
  const leavingRef = useRef(false);

  useEffect(() => {
    if (!contestId) return;
    let alive = true;
    void Promise.all([getContest(contestId), listTasks()])
      .then(([loaded, tasks]) => {
        if (!alive) return;
        const initial = tasksByCategory(loaded);
        setSavedSnapshot(JSON.stringify(initial));
        setContest(loaded);
        setBank(tasks);
        setChosen(initial);
      })
      .catch((error: unknown) => {
        if (alive) {
          setLoadError(
            error instanceof Error ? error.message : "No se pudo abrir.",
          );
        }
      });
    return () => {
      alive = false;
    };
  }, [contestId]);

  const activeCategory =
    contest && contest.categories.includes(category)
      ? category
      : (contest?.categories[0] ?? "");
  const activeIds = chosen[activeCategory] ?? [];
  const dirty = JSON.stringify(chosen) !== savedSnapshot;

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (!leavingRef.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const usable = useMemo(
    () => bank.filter((task) => difficultyOf(task, activeCategory)),
    [bank, activeCategory],
  );

  const matches = (
    task: StoredTask,
    skip?: "type" | "difficulty" | "visibility",
  ) => {
    if (onlyChosen && !activeIds.includes(task.id)) return false;
    if (skip !== "type" && type !== "all" && task.answerType !== type) {
      return false;
    }
    if (
      skip !== "difficulty" &&
      difficulty !== "all" &&
      difficultyOf(task, activeCategory) !== difficulty
    ) {
      return false;
    }
    if (
      skip !== "visibility" &&
      visibility !== "all" &&
      taskVisibility(task) !== visibility
    ) {
      return false;
    }
    const term = fold(query.trim());
    return (
      !term ||
      fold(
        [task.title, task.sourceTaskCode, task.country]
          .filter(Boolean)
          .join(" "),
      ).includes(term)
    );
  };

  const visible = usable
    .filter((task) => matches(task))
    .sort(
      (left, right) =>
        (difficultyStyles[difficultyOf(left, activeCategory) ?? ""]?.rank ??
          3) -
          (difficultyStyles[difficultyOf(right, activeCategory) ?? ""]?.rank ??
            3) || left.title.localeCompare(right.title),
    );

  const count = (skip: "type" | "difficulty" | "visibility", value: string) =>
    usable.filter(
      (task) =>
        matches(task, skip) &&
        (skip === "type"
          ? value === "all" || task.answerType === value
          : skip === "difficulty"
            ? value === "all" || difficultyOf(task, activeCategory) === value
            : value === "all" || taskVisibility(task) === value),
    ).length;

  const backHref = `/desafios/editar?id=${contestId}&categoria=${encodeURIComponent(activeCategory)}`;
  const editHref = (taskId: string) =>
    `/tareas/editar?id=${encodeURIComponent(taskId)}&volver=${encodeURIComponent(
      `/desafios/preguntas?id=${contestId}&categoria=${activeCategory}`,
    )}`;

  const toggle = (taskId: string) =>
    setChosen((current) => {
      const ids = current[activeCategory] ?? [];
      return {
        ...current,
        [activeCategory]: ids.includes(taskId)
          ? ids.filter((id) => id !== taskId)
          : [...ids, taskId],
      };
    });

  const save = async () => {
    if (!contest || !contestId) return;
    setSaving(true);
    setSaveError(null);
    try {
      await updateContest(contestId, {
        title: contest.title,
        categories: contest.categories,
        durationMinutes: contest.durationMinutes,
        registrationStartsAt: contest.registrationStartsAt ?? "",
        registrationEndsAt: contest.registrationEndsAt ?? "",
        startsAt: contest.startsAt ?? "",
        endsAt: contest.endsAt ?? "",
        resultsAt: contest.resultsAt ?? "",
        resultsUntil: contest.resultsUntil ?? "",
        scoring: contest.scoring,
        questionDisplayMode: contest.questionDisplayMode,
        allowPairs: contest.allowPairs,
        shuffleOptions: contest.shuffleOptions,
        showFeedback: contest.showFeedback,
        showSolutions: contest.showSolutions,
        showTotalScore: contest.showTotalScore,
        showScoreOnSubmit: contest.showScoreOnSubmit,
        showFeedbackOnSubmit: contest.showFeedbackOnSubmit,
        showSolutionsOnSubmit: contest.showSolutionsOnSubmit,
        tasks: contest.categories.flatMap((item) =>
          (chosen[item] ?? []).map((taskId) => ({ taskId, category: item })),
        ),
      });
      leavingRef.current = true;
      window.location.href = backHref;
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "No se pudo guardar.",
      );
      setSaving(false);
    }
  };

  if (loadError) {
    return (
      <p className="text-sm text-muted-foreground">
        {loadError}{" "}
        <a href="/desafios" className="underline underline-offset-4">
          Volver a Desafíos
        </a>
      </p>
    );
  }

  if (!contest) {
    return (
      <div className="flex min-h-72 items-center justify-center">
        <LoaderCircleIcon className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!EDITABLE.includes(contest.state)) {
    return (
      <p className="text-sm text-muted-foreground">
        Este desafío ya empezó y sus preguntas no se pueden cambiar.{" "}
        <a href={backHref} className="underline underline-offset-4">
          Volver al desafío
        </a>
      </p>
    );
  }

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex flex-col gap-1 border-b pb-4">
        <a
          href={backHref}
          className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" />
          {contest.title}
        </a>
        <h1 className="font-heading text-3xl font-semibold tracking-tight">
          Preguntas
        </h1>
      </div>

      <div
        role="tablist"
        aria-label="Categoría"
        className="-mx-4 flex gap-5 overflow-x-auto px-4 shadow-[inset_0_-1px_0_var(--border)] sm:mx-0 sm:px-0"
      >
        {contest.categories.map((item) => {
          const selected = item === activeCategory;
          const total = (chosen[item] ?? []).length;
          return (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => {
                setCategory(item);
                setDifficulty("all");
              }}
              className="relative flex shrink-0 items-baseline gap-1.5 py-2.5 text-sm whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:text-foreground aria-selected:font-medium aria-selected:text-foreground"
            >
              {item}
              <span
                className={cn(
                  "text-xs tabular-nums",
                  total === 0 ? "text-destructive" : "opacity-60",
                )}
              >
                {total}
              </span>
              {selected && (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 bottom-0 h-0.5 bg-primary"
                />
              )}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex h-9 min-w-0 flex-1 items-center sm:max-w-xs">
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 size-4 text-muted-foreground"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar pregunta"
            aria-label="Buscar pregunta por nombre, código o país"
            className="h-full w-full bg-muted/60 pr-8 pl-8 text-sm outline-none placeholder:text-muted-foreground focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-primary/60 [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              aria-label="Borrar búsqueda"
              onClick={() => setQuery("")}
              className="absolute right-1.5 grid size-6 place-items-center text-muted-foreground outline-none hover:text-foreground"
            >
              <XIcon className="size-4" />
            </button>
          )}
        </label>
        <div
          role="group"
          aria-label="Filtrar por quién la ve"
          className="flex gap-1"
        >
          {TASK_VISIBILITIES.map((item) => (
            <button
              key={item.value}
              type="button"
              aria-pressed={visibility === item.value}
              title={item.description}
              disabled={
                count("visibility", item.value) === 0 &&
                visibility !== item.value
              }
              onClick={() =>
                setVisibility(visibility === item.value ? "all" : item.value)
              }
              className={chipClass}
            >
              <item.icon className="size-3.5" aria-hidden="true" />
              <span className="max-sm:sr-only">{item.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <div
          role="group"
          aria-label="Filtrar por tipo de respuesta"
          className="-mx-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0"
        >
          {(["all", ...answerTypes] as const).map((value) => {
            const total = count("type", value);
            return (
              <button
                key={value}
                type="button"
                aria-pressed={type === value}
                disabled={total === 0 && type !== value}
                onClick={() => setType(value)}
                className={chipClass}
              >
                {value === "all" ? "Todas" : answerTypeLabels[value]}
                <span className="tabular-nums opacity-60">{total}</span>
              </button>
            );
          })}
        </div>
        <div
          role="group"
          aria-label="Filtrar por dificultad"
          className="-mx-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0"
        >
          {DIFFICULTY_KEYS.map((value) => {
            const total = count("difficulty", value);
            return (
              <button
                key={value}
                type="button"
                aria-pressed={difficulty === value}
                disabled={total === 0 && difficulty !== value}
                onClick={() =>
                  setDifficulty(difficulty === value ? "all" : value)
                }
                className={chipClass}
              >
                <span
                  aria-hidden="true"
                  className={cn("size-2.5", difficultyStyles[value].className)}
                />
                {BEBRAS_SCORING[value].label}
                <span className="tabular-nums opacity-60">{total}</span>
              </button>
            );
          })}
          <button
            type="button"
            aria-pressed={onlyChosen}
            onClick={() => setOnlyChosen((current) => !current)}
            className={chipClass}
          >
            <CheckIcon className="size-3.5" aria-hidden="true" />
            Elegidas
            <span className="tabular-nums opacity-60">{activeIds.length}</span>
          </button>
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {usable.length === 0
            ? `Ninguna pregunta tiene dificultad para ${activeCategory}.`
            : "Ninguna pregunta coincide con los filtros."}
        </p>
      ) : (
        <ul className="flex flex-col border-t">
          {visible.map((task) => {
            const picked = activeIds.includes(task.id);
            const position = activeIds.indexOf(task.id);
            const seen = visibilityInfo(taskVisibility(task));
            return (
              <li
                key={task.id}
                className={cn(
                  "flex min-w-0 items-center gap-3 border-b px-2 py-2.5 transition-colors",
                  picked && "bg-primary/5",
                )}
              >
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={picked}
                  aria-label={`${picked ? "Quitar" : "Poner"} ${task.title} en ${activeCategory}`}
                  onClick={() => toggle(task.id)}
                  className={cn(
                    "grid size-6 shrink-0 place-items-center border-2 text-xs font-semibold tabular-nums transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
                    picked
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border/40 hover:border-primary/60",
                  )}
                >
                  {picked ? position + 1 : ""}
                </button>
                <div className="flex min-w-0 flex-1 flex-col">
                  <button
                    type="button"
                    onClick={() => setPreview(task)}
                    className="min-w-0 truncate text-left text-sm font-medium underline-offset-4 hover:underline"
                  >
                    {task.title}
                  </button>
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <seen.icon className="size-3" aria-hidden="true" />
                    {seen.label} · {answerTypeLabels[task.answerType]}
                  </span>
                </div>
                <DifficultyTag
                  difficulty={difficultyOf(task, activeCategory)}
                />
              </li>
            );
          })}
        </ul>
      )}

      <div className="sticky bottom-0 z-10 -mx-4 flex items-center justify-end gap-3 border-t bg-background px-4 py-3 sm:mx-0 sm:px-0">
        <p
          role={saveError ? "alert" : "status"}
          className={cn(
            "mr-auto min-w-0 truncate text-sm",
            saveError
              ? "font-medium text-destructive"
              : "text-muted-foreground",
          )}
        >
          {saveError ??
            `${activeIds.length} ${activeIds.length === 1 ? "pregunta" : "preguntas"} en ${activeCategory}`}
        </p>
        <Button asChild variant="outline">
          <a href={backHref}>Cancelar</a>
        </Button>
        <Button type="button" disabled={saving} onClick={save}>
          <SaveIcon data-icon="inline-start" />
          {saving ? "Guardando…" : "Guardar"}
        </Button>
      </div>

      <TaskPreviewDialog
        task={preview}
        category={activeCategory}
        editHref={editHref}
        onClose={() => setPreview(null)}
      />
    </div>
  );
}
