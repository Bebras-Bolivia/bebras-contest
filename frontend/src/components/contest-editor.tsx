"use client";

import { FormPageSkeleton } from "@/components/page-skeletons";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BarChart3Icon,
  CheckIcon,
  ChevronLeftIcon,
  PlayIcon,
  PlusIcon,
  RotateCcwIcon,
  SaveIcon,
  SendIcon,
  XIcon,
} from "lucide-react";

import {
  getContest,
  publishContest,
  updateContest,
  updateContestResultsWindow,
} from "@/lib/contests-api";
import { safeReturnTo } from "@/lib/site-navigation";
import {
  BEBRAS_SCORING,
  CATEGORY_NAMES,
  CONTEST_STATE_LABELS,
  DIFFICULTY_KEYS,
  defaultContestScoring,
  fromDatetimeLocalValue,
  isStandardScoring,
  toDatetimeLocalValue,
  type ContestDraftInput,
  type ContestScoring,
  type ContestState,
  type QuestionDisplayMode,
  type StoredContest,
} from "@/lib/contest-schema";
import { listTaskSummaries } from "@/lib/tasks-api";
import { PAPER_BLOCKED_INTERACTIVE } from "@/lib/interactive";
import { type StoredTask } from "@/lib/task-schema";
import { categoryStyle } from "@/components/category-logo";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DateTimeField, parseDateTimeLocal } from "@/components/datetime-field";
import { FormSection } from "@/components/form-section";
import { ContestLifecycleActions } from "@/components/contest-lifecycle-actions";
import { FieldHint } from "@/components/field-hint";
import {
  DifficultyTag,
  TaskPreviewDialog,
  difficultyOf,
} from "@/components/contest-task-parts";

type Form = {
  title: string;
  isTest: boolean;
  collectUsage: boolean;
  categories: string[];
  durationMinutes: number;
  registrationStartsAt: string;
  registrationEndsAt: string;
  startsAt: string;
  endsAt: string;
  scheduleMode: "single" | "category";
  schedules: Record<string, { startsAt: string; endsAt: string }>;
  resultsAt: string;
  resultsUntil: string;
  scoring: ContestScoring;
  questionDisplayMode: QuestionDisplayMode;
  allowPairs: boolean;
  shuffleOptions: boolean;
  showFeedback: boolean;
  showSolutions: boolean;
  showTotalScore: boolean;
  showScoreOnSubmit: boolean;
  showFeedbackOnSubmit: boolean;
  showSolutionsOnSubmit: boolean;
  /** Preguntas de cada categoría, en orden. Se conservan las de una categoría
      que se quita, por si se vuelve a poner. */
  tasks: Record<string, string[]>;
};

const EDITABLE_STATES: ContestState[] = [
  "borrador",
  "programada",
  "inscripcion",
  "detenida",
];
const RESULTS_DISPLAY_MINUTES = 7 * 24 * 60;

function localValue(value: string | null) {
  return value ? toDatetimeLocalValue(value) : "";
}

function formFromContest(contest: StoredContest): Form {
  const tasks: Record<string, string[]> = {};
  const resultsAt = localValue(contest.resultsAt ?? contest.endsAt);

  for (const task of contest.tasks
    .slice()
    .sort((left, right) => left.position - right.position)) {
    tasks[task.category] = [...(tasks[task.category] ?? []), task.taskId];
  }

  const schedules = Object.fromEntries(
    Object.entries(contest.schedules ?? {}).map(([category, window]) => [
      category,
      {
        startsAt: localValue(window.startsAt),
        endsAt: localValue(window.endsAt),
      },
    ]),
  );

  return {
    title: contest.title,
    isTest: contest.isTest,
    collectUsage: contest.collectUsage,
    categories: contest.categories,
    durationMinutes: contest.durationMinutes,
    registrationStartsAt: localValue(contest.registrationStartsAt),
    registrationEndsAt: localValue(contest.registrationEndsAt),
    startsAt: localValue(contest.startsAt),
    endsAt: localValue(contest.endsAt),
    scheduleMode: Object.keys(schedules).length > 0 ? "category" : "single",
    schedules,
    resultsAt,
    resultsUntil:
      localValue(contest.resultsUntil) ||
      plusMinutes(resultsAt, RESULTS_DISPLAY_MINUTES),
    scoring: contest.scoring ?? defaultContestScoring(),
    questionDisplayMode: contest.questionDisplayMode,
    allowPairs: contest.allowPairs,
    shuffleOptions: contest.shuffleOptions,
    showFeedback: contest.showFeedback,
    showSolutions: contest.showSolutions,
    showTotalScore: contest.showTotalScore,
    showScoreOnSubmit: contest.showScoreOnSubmit,
    showFeedbackOnSubmit: contest.showFeedbackOnSubmit,
    showSolutionsOnSubmit: contest.showSolutionsOnSubmit,
    tasks,
  };
}

function toPayload(form: Form): ContestDraftInput {
  const iso = (value: string) => (value ? fromDatetimeLocalValue(value) : "");
  const byCategory = form.scheduleMode === "category";

  return {
    title: form.title.trim(),
    isTest: form.isTest,
    collectUsage: form.isTest && form.collectUsage,
    categories: form.categories,
    durationMinutes: form.durationMinutes,
    registrationStartsAt: iso(form.registrationStartsAt),
    registrationEndsAt: iso(form.registrationEndsAt),
    startsAt: byCategory ? "" : iso(form.startsAt),
    endsAt: byCategory ? "" : iso(form.endsAt),
    schedules: byCategory
      ? Object.fromEntries(
          form.categories.flatMap((category) => {
            const window = form.schedules[category];
            return window && (window.startsAt || window.endsAt)
              ? [
                  [
                    category,
                    {
                      startsAt: iso(window.startsAt),
                      endsAt: iso(window.endsAt),
                    },
                  ],
                ]
              : [];
          }),
        )
      : {},
    resultsAt: iso(form.resultsAt),
    resultsUntil: iso(form.resultsUntil),
    scoring: form.scoring,
    questionDisplayMode: form.questionDisplayMode,
    allowPairs: form.allowPairs,
    shuffleOptions: form.shuffleOptions,
    showFeedback: form.showFeedback,
    showSolutions: form.showSolutions,
    showTotalScore: form.showTotalScore,
    showScoreOnSubmit: form.showScoreOnSubmit,
    showFeedbackOnSubmit: form.showFeedbackOnSubmit,
    showSolutionsOnSubmit: form.showSolutionsOnSubmit,
    tasks: form.categories.flatMap((category) =>
      (form.tasks[category] ?? []).map((taskId) => ({ taskId, category })),
    ),
  };
}

function isBefore(left: string, right: string) {
  return new Date(left).getTime() < new Date(right).getTime();
}

function runWindows(form: Form) {
  return form.scheduleMode === "category"
    ? form.categories.map((category) => ({
        label: category,
        startsAt: form.schedules[category]?.startsAt ?? "",
        endsAt: form.schedules[category]?.endsAt ?? "",
      }))
    : [{ label: "la rendición", startsAt: form.startsAt, endsAt: form.endsAt }];
}

function runSpan(form: Form) {
  const windows = runWindows(form).filter(
    (window) => window.startsAt && window.endsAt,
  );

  if (windows.length === 0) return { startsAt: "", endsAt: "" };

  return {
    startsAt: windows.reduce((first, window) =>
      isBefore(window.startsAt, first.startsAt) ? window : first,
    ).startsAt,
    endsAt: windows.reduce((last, window) =>
      isBefore(last.endsAt, window.endsAt) ? window : last,
    ).endsAt,
  };
}

function plusMinutes(value: string, minutes: number) {
  const date = parseDateTimeLocal(value);
  return date
    ? toDatetimeLocalValue(
        new Date(date.getTime() + minutes * 60_000).toISOString(),
      )
    : "";
}

type RunWindow = { startsAt: string; endsAt: string };

function withAutoClose(
  previous: RunWindow,
  window: RunWindow,
  previousMinutes: number,
  minutes: number,
): RunWindow {
  const startMoved = previous.startsAt !== window.startsAt;
  if (!window.startsAt || minutes <= 0) return window;
  if (!startMoved && previousMinutes === minutes) return window;
  if (window.endsAt !== previous.endsAt) return window;
  const wasAuto =
    !previous.endsAt ||
    previous.endsAt === plusMinutes(previous.startsAt, previousMinutes);
  return wasAuto
    ? { ...window, endsAt: plusMinutes(window.startsAt, minutes) }
    : window;
}

function withRun(form: Form, patch: Partial<Form>): Form {
  const next = { ...form, ...patch };
  const single = withAutoClose(
    { startsAt: form.startsAt, endsAt: form.endsAt },
    { startsAt: next.startsAt, endsAt: next.endsAt },
    form.durationMinutes,
    next.durationMinutes,
  );
  next.startsAt = single.startsAt;
  next.endsAt = single.endsAt;
  next.schedules = Object.fromEntries(
    Object.entries(next.schedules).map(([category, window]) => [
      category,
      withAutoClose(
        form.schedules[category] ?? { startsAt: "", endsAt: "" },
        window,
        form.durationMinutes,
        next.durationMinutes,
      ),
    ]),
  );
  const before = runSpan(form).endsAt;
  const after = runSpan(next).endsAt;

  if (after !== before && (!form.resultsAt || form.resultsAt === before)) {
    next.resultsAt = after;
  }

  if (
    next.resultsUntil === form.resultsUntil &&
    (!form.resultsUntil ||
      form.resultsUntil ===
        plusMinutes(form.resultsAt || before, RESULTS_DISPLAY_MINUTES))
  ) {
    next.resultsUntil = plusMinutes(
      next.resultsAt || after,
      RESULTS_DISPLAY_MINUTES,
    );
  }

  return next;
}

function windowProblems(
  label: string,
  startsAt: string,
  endsAt: string,
): string[] {
  if (startsAt && !endsAt) return [`Falta el cierre de ${label}.`];
  if (!startsAt && endsAt) return [`Falta el inicio de ${label}.`];
  if (startsAt && endsAt && !isBefore(startsAt, endsAt)) {
    return [`El cierre de ${label} tiene que ser después de su inicio.`];
  }
  return [];
}

function formatLength(startsAt: string, endsAt: string) {
  const start = parseDateTimeLocal(startsAt);
  const end = parseDateTimeLocal(endsAt);

  if (!start || !end) return null;

  const total = Math.round((end.getTime() - start.getTime()) / 60_000);

  if (total <= 0) return null;

  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const minutes = total % 60;
  const parts = [
    days && `${days} ${days === 1 ? "día" : "días"}`,
    hours && `${hours} ${hours === 1 ? "hora" : "horas"}`,
    minutes && `${minutes} ${minutes === 1 ? "minuto" : "minutos"}`,
  ].filter(Boolean) as string[];

  return parts.length === 1
    ? parts[0]
    : `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}`;
}

const pillClass =
  "flex h-8 items-center gap-1.5 border-2 border-border/20 px-3 text-sm text-muted-foreground transition-colors outline-none hover:border-primary/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/60 disabled:pointer-events-none disabled:opacity-50 aria-pressed:border-primary aria-pressed:bg-primary/5 aria-pressed:font-medium aria-pressed:text-foreground";

function WindowField({
  id,
  title,
  help,
  startsAt,
  endsAt,
  minDate = null,
  maxDate = null,
  disabled,
  startDisabled = false,
  minEndDate = null,
  startLabel = "Inicio",
  endLabel = "Cierre",
  category,
  onChange,
}: {
  id: string;
  title: string;
  category?: string;
  help?: string;
  startsAt: string;
  endsAt: string;
  minDate?: Date | null;
  maxDate?: Date | null;
  disabled: boolean;
  startDisabled?: boolean;
  minEndDate?: Date | null;
  startLabel?: string;
  endLabel?: string;
  onChange: (startsAt: string, endsAt: string) => void;
}) {
  const length = formatLength(startsAt, endsAt);
  const start = parseDateTimeLocal(startsAt);

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="flex items-center gap-1.5">
          {category ? (
            <h3
              aria-label={title}
              style={categoryStyle(category)}
              className="px-2.5 py-1 text-sm font-semibold"
            >
              {category}
            </h3>
          ) : (
            <h3 className="text-sm font-semibold">{title}</h3>
          )}
          {help && <FieldHint>{help}</FieldHint>}
        </div>
        <div className="flex items-baseline gap-3 text-sm text-muted-foreground">
          {length && <span>Dura {length}</span>}
          {!disabled && !startDisabled && (startsAt || endsAt) && (
            <button
              type="button"
              onClick={() => onChange("", "")}
              className="underline-offset-4 hover:text-foreground hover:underline"
            >
              Quitar fechas
            </button>
          )}
        </div>
      </div>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={id} className="text-sm text-muted-foreground">
            {startLabel}
          </label>
          <DateTimeField
            id={id}
            label={`${title}, ${startLabel.toLowerCase()}`}
            value={startsAt}
            minDate={minDate}
            maxDate={maxDate}
            disabled={disabled || startDisabled}
            onChange={(value) => onChange(value, endsAt)}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <label
            htmlFor={`${id}-end`}
            className="text-sm text-muted-foreground"
          >
            {endLabel}
          </label>
          <DateTimeField
            id={`${id}-end`}
            label={`${title}, ${endLabel.toLowerCase()}`}
            value={endsAt}
            fallbackHour={18}
            minDate={minEndDate ?? start ?? minDate}
            maxDate={maxDate}
            disabled={disabled}
            onChange={(value) => onChange(startsAt, value)}
          />
        </div>
      </div>
    </div>
  );
}

function Reveal({
  open,
  className,
  children,
}: {
  open: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      inert={!open}
      aria-hidden={!open}
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none",
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
      )}
    >
      <div className="min-h-0 overflow-hidden">
        <div
          className={cn(
            "transition-transform duration-300 ease-out motion-reduce:transition-none",
            open ? "translate-y-0" : "-translate-y-2",
            className,
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

function ScoreInput({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  return (
    <input
      type="number"
      aria-label={label}
      value={draft}
      disabled={disabled}
      onChange={(event) => {
        setDraft(event.target.value);
        const parsed = Number(event.target.value);
        if (event.target.value.trim() !== "" && Number.isInteger(parsed)) {
          onChange(parsed);
        }
      }}
      className="h-8 w-16 border-2 border-border/20 bg-transparent px-2 text-sm tabular-nums outline-none focus-visible:border-primary disabled:opacity-50"
    />
  );
}

export function ContestEditor() {
  const [contestId] = useState(() =>
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("id"),
  );
  const [form, setForm] = useState<Form | null>(null);
  const [bank, setBank] = useState<StoredTask[]>([]);
  const [contestState, setContestState] = useState<ContestState>("borrador");
  const [contestMeta, setContestMeta] = useState<StoredContest | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [active, setActive] = useState<string>(() =>
    typeof window === "undefined"
      ? ""
      : (new URLSearchParams(window.location.search).get("categoria") ?? ""),
  );
  const [preview, setPreview] = useState<StoredTask | null>(null);
  const [backHref] = useState(() =>
    typeof window === "undefined"
      ? "/desafios"
      : (safeReturnTo(
          new URLSearchParams(window.location.search).get("volver"),
        ) ?? "/desafios"),
  );
  const [scoringOpen, setScoringOpen] = useState(false);
  const [busy, setBusy] = useState<"saving" | "publishing" | null>(null);
  const [tried, setTried] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [publishTried, setPublishTried] = useState(false);
  const savedRef = useRef<string | null>(null);
  const leavingRef = useRef(false);

  const locked = !EDITABLE_STATES.includes(contestState);
  const resultsEditable =
    locked &&
    !form?.isTest &&
    ["inscripcion", "preparacion", "abierta", "publicada"].includes(
      contestState,
    );
  const resultsPublished = contestState === "publicada";

  useEffect(() => {
    if (!contestId) {
      setLoadError("No se indicó qué desafío abrir.");
      return;
    }

    let alive = true;

    void Promise.all([getContest(contestId), listTaskSummaries()])
      .then(([contest, tasks]) => {
        if (!alive) return;
        const loaded = formFromContest(contest);
        savedRef.current = JSON.stringify(toPayload(loaded));
        setForm(loaded);
        setBank(tasks);
        setContestState(contest.state);
        setContestMeta(contest);
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

  const categories = form?.categories ?? [];
  const activeCategory = categories.includes(active)
    ? active
    : (categories[0] ?? "");

  useEffect(() => {
    if (!contestId || !activeCategory) return;
    const url = new URL(window.location.href);
    url.searchParams.set("categoria", activeCategory);
    window.history.replaceState(null, "", url);
  }, [contestId, activeCategory]);

  const tasksById = useMemo(
    () => new Map(bank.map((task) => [task.id, task])),
    [bank],
  );

  const dateProblems = useMemo(() => {
    if (!form) return [];
    const list: string[] = [];
    const windows = runWindows(form);
    const span = runSpan(form);
    const byCategory = form.scheduleMode === "category";

    list.push(
      ...windowProblems(
        "la inscripción",
        form.registrationStartsAt,
        form.registrationEndsAt,
      ),
      ...windows.flatMap((window) =>
        windowProblems(window.label, window.startsAt, window.endsAt),
      ),
    );

    const clash = form.registrationEndsAt
      ? windows.find(
          (window) =>
            window.startsAt &&
            isBefore(window.startsAt, form.registrationEndsAt),
        )
      : undefined;
    if (clash) {
      list.push(
        byCategory
          ? `La inscripción tiene que cerrar antes de que empiece ${clash.label}.`
          : "La inscripción tiene que cerrar antes de la rendición.",
      );
    }

    if (
      form.resultsAt &&
      span.endsAt &&
      isBefore(form.resultsAt, span.endsAt)
    ) {
      list.push(
        byCategory
          ? "Los resultados no pueden publicarse antes de que cierre la última categoría."
          : "Los resultados no pueden publicarse antes del cierre.",
      );
    }

    const resultsFrom = form.resultsAt || span.endsAt;
    if (
      form.resultsUntil &&
      resultsFrom &&
      !isBefore(resultsFrom, form.resultsUntil)
    ) {
      list.push(
        "Los resultados tienen que mostrarse hasta después de publicarse.",
      );
    }

    return list;
  }, [form]);

  const restartPast = Boolean(
    contestMeta?.stoppedAt &&
    form &&
    runWindows(form).some(
      (window) =>
        window.endsAt && new Date(window.endsAt).getTime() <= Date.now(),
    ),
  );

  const [shownDateProblems, setShownDateProblems] = useState<string[]>([]);
  if (dateProblems.length > 0 && shownDateProblems !== dateProblems) {
    setShownDateProblems(dateProblems);
  }

  const problems = useMemo(() => {
    if (!form) return [];
    const list: string[] = [];

    if (!form.title.trim()) list.push("Falta el nombre del desafío.");

    list.push(...dateProblems);

    if (!Number.isInteger(form.durationMinutes) || form.durationMinutes <= 0) {
      list.push("Falta la duración por equipo.");
    }

    for (const key of DIFFICULTY_KEYS) {
      const { correct, wrong } = form.scoring[key];
      if (correct <= 0 || wrong > 0) {
        list.push(
          `En ${BEBRAS_SCORING[key].label.toLowerCase()}, acertar tiene que sumar y fallar restar o dar 0.`,
        );
        break;
      }
    }

    for (const category of form.categories) {
      const broken = (form.tasks[category] ?? [])
        .map((id) => tasksById.get(id))
        .find((task) => task && !difficultyOf(task, category));
      if (broken) {
        list.push(`«${broken.title}» no tiene dificultad para ${category}.`);
        break;
      }
    }

    return list;
  }, [form, tasksById, dateProblems]);

  const publishProblems = useMemo(() => {
    if (!form) return [];
    const list = [...problems];
    if (form.categories.length === 0) list.push("Falta elegir una categoría.");
    const empty = form.categories.filter(
      (category) => (form.tasks[category] ?? []).length === 0,
    );

    if (empty.length > 0) {
      list.push(`Faltan preguntas en ${empty.join(", ")}.`);
    }

    const short = runWindows(form).find((window) => {
      const start = parseDateTimeLocal(window.startsAt);
      const end = parseDateTimeLocal(window.endsAt);
      return (
        start &&
        end &&
        (end.getTime() - start.getTime()) / 60_000 < form.durationMinutes
      );
    });
    if (short) {
      list.push(
        form.scheduleMode === "category"
          ? `La rendición de ${short.label} dura menos que el tiempo de cada equipo.`
          : "La rendición dura menos que el tiempo de cada equipo.",
      );
    }

    return list;
  }, [form, problems]);

  const dirty = form
    ? JSON.stringify(toPayload(form)) !== savedRef.current
    : false;

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (!leavingRef.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

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

  if (!form) {
    return <FormPageSkeleton label="Cargando desafío..." />;
  }

  const update = (patch: Partial<Form>) =>
    setForm((current) => (current ? { ...current, ...patch } : current));

  const updateRun = (patch: Partial<Form>) =>
    setForm((current) => (current ? withRun(current, patch) : current));

  const byCategory = form.scheduleMode === "category";
  const span = runSpan(form);
  const minimumResultsUntil =
    resultsPublished && contestMeta
      ? localValue(contestMeta.resultsUntil) ||
        plusMinutes(
          localValue(contestMeta.resultsAt ?? contestMeta.endsAt),
          RESULTS_DISPLAY_MINUTES,
        )
      : "";

  const setScheduleMode = (mode: Form["scheduleMode"]) => {
    if (mode === form.scheduleMode) return;
    if (mode === "category") {
      const schedules = { ...form.schedules };
      for (const category of form.categories) {
        if (!schedules[category]?.startsAt && !schedules[category]?.endsAt) {
          schedules[category] = {
            startsAt: form.startsAt,
            endsAt: form.endsAt,
          };
        }
      }
      updateRun({ scheduleMode: mode, schedules });
    } else {
      updateRun({
        scheduleMode: mode,
        startsAt: span.startsAt,
        endsAt: span.endsAt,
      });
    }
  };

  const activeIds = form.tasks[activeCategory] ?? [];
  const activeTasks = activeIds
    .map((id) => tasksById.get(id))
    .filter((task): task is StoredTask => task !== undefined);

  const hasInteractive = form.categories.some((category) =>
    (form.tasks[category] ?? []).some(
      (id) => tasksById.get(id)?.answerType === "interactive",
    ),
  );

  const setActiveIds = (ids: string[]) =>
    update({ tasks: { ...form.tasks, [activeCategory]: ids } });

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= activeIds.length) return;
    const next = activeIds.slice();
    [next[index], next[target]] = [next[target], next[index]];
    setActiveIds(next);
  };

  const summary = (() => {
    const counts = { easy: 0, medium: 0, hard: 0 };
    let max = 0;
    for (const task of activeTasks) {
      const difficulty = difficultyOf(task, activeCategory);
      if (!difficulty) continue;
      counts[difficulty] += 1;
      max += form.scoring[difficulty].correct - form.scoring[difficulty].wrong;
    }
    return { counts, max };
  })();

  const editHref = (taskId: string) =>
    `/tareas/editar?id=${encodeURIComponent(taskId)}&volver=${encodeURIComponent(
      `/desafios/editar?id=${contestId}&categoria=${activeCategory}`,
    )}`;

  const save = async () => {
    setTried(true);
    if (!contestId || (resultsEditable ? dateProblems : problems).length > 0)
      return false;
    const payload = toPayload(form);
    const snapshot = JSON.stringify(payload);
    if (snapshot === savedRef.current) return true;
    setBusy("saving");
    try {
      const saved = resultsEditable
        ? await updateContestResultsWindow(contestId, {
            ...(contestMeta &&
            form.resultsAt === formFromContest(contestMeta).resultsAt
              ? {}
              : { resultsAt: payload.resultsAt }),
            resultsUntil: payload.resultsUntil,
          })
        : await updateContest(contestId, payload);
      savedRef.current = snapshot;
      if (resultsEditable) {
        const next = formFromContest(saved);
        setForm(next);
        savedRef.current = JSON.stringify(toPayload(next));
      }
      setContestState(saved.state);
      setContestMeta(saved);
      setSaveError(null);
      return true;
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "No se pudo guardar.",
      );
      return false;
    } finally {
      setBusy(null);
    }
  };

  const saveAndGo = async (href: string) => {
    if (await save()) {
      leavingRef.current = true;
      window.location.href = href;
    }
  };

  const handlePublish = async () => {
    setPublishTried(true);
    if (!contestId || publishProblems.length > 0) {
      setTried(true);
      return;
    }
    if (!(await save())) return;
    setBusy("publishing");
    try {
      const published = await publishContest(contestId);
      setContestState(published.state);
      setContestMeta(published);
      setSaveError(null);
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "No se pudo publicar.",
      );
    } finally {
      setBusy(null);
    }
  };

  const lockedHint =
    contestState === "abierta"
      ? "La rendición está en curso. Puedes ampliar su cierre desde «Ampliar rendición» y cambiar las fechas de resultados. El inicio, las preguntas y las demás opciones están bloqueados para conservar las respuestas."
      : resultsPublished
        ? "Los resultados ya están publicados. Puedes ampliar «Hasta» para que sigan visibles. La fecha «Desde», la rendición y las preguntas se conservan."
        : ["inscripcion", "preparacion"].includes(contestState)
          ? "Puedes ampliar el cierre desde «Ampliar inscripción» y cambiar las fechas de resultados. El inicio, las preguntas y las demás opciones están bloqueados."
          : "Las fechas, las preguntas y la configuración de este desafío están bloqueadas para conservar las respuestas y los resultados.";

  const shownProblems = !tried
    ? []
    : resultsEditable
      ? dateProblems
      : publishTried && contestState === "borrador"
        ? publishProblems
        : problems;
  const barMessage =
    locked && !resultsEditable
      ? null
      : shownProblems[0]
        ? {
            tone: "error",
            text: shownProblems[0],
            more: shownProblems.length - 1,
          }
        : saveError
          ? { tone: "error", text: saveError, more: 0 }
          : null;

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-2">
        <input
          aria-label="Nombre del desafío"
          placeholder="Nombre del desafío"
          value={form.title}
          readOnly={locked}
          onChange={(event) => update({ title: event.target.value })}
          className="w-full border-b-2 border-border/20 bg-transparent py-2 font-heading text-2xl font-semibold transition-colors outline-none placeholder:text-muted-foreground/60 focus-visible:border-primary disabled:opacity-100"
        />
        <div className="flex items-center gap-1.5 text-sm">
          <span className="font-medium">
            {CONTEST_STATE_LABELS[contestState]}
          </span>
          <FieldHint>
            {locked
              ? lockedHint
              : contestState === "borrador"
                ? "Nadie lo ve hasta que lo publiques."
                : "Los maestros ya pueden inscribir a sus estudiantes."}
          </FieldHint>
          {locked && (
            <a
              href={`/desafios/resultados?id=${contestId}`}
              className="ml-2 underline underline-offset-4"
            >
              Ver resultados
            </a>
          )}
        </div>
      </div>

      {contestMeta && ["abierta", "preparacion"].includes(contestState) && (
        <ContestLifecycleActions
          placement="closing"
          contest={contestMeta}
          beforeRestart={save}
          onChanged={(contest) => {
            const next = formFromContest(contest);
            setForm(next);
            setContestState(contest.state);
            setContestMeta(contest);
            savedRef.current = JSON.stringify(toPayload(next));
            setSaveError(null);
          }}
        />
      )}

      <>
        <section className="flex flex-col gap-3">
          <h2 className="font-heading text-base font-semibold">Categorías</h2>
          <p className="-mt-1 text-sm text-muted-foreground">
            Cada estudiante rinde las preguntas de la categoría de su curso.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORY_NAMES.map((category) => {
              const selected = form.categories.includes(category);
              return (
                <button
                  key={category}
                  type="button"
                  aria-pressed={selected}
                  disabled={locked}
                  onClick={() =>
                    update({
                      categories: selected
                        ? form.categories.filter((item) => item !== category)
                        : CATEGORY_NAMES.filter(
                            (item) =>
                              item === category ||
                              form.categories.includes(item),
                          ),
                    })
                  }
                  style={selected ? categoryStyle(category) : undefined}
                  className={pillClass}
                >
                  {selected && <CheckIcon className="size-3.5" />}
                  {category}
                </button>
              );
            })}
          </div>
        </section>

        {categories.length > 0 && (
          <section className="flex flex-col gap-4">
            <h2 className="font-heading text-base font-semibold">Preguntas</h2>
            <div
              role="tablist"
              aria-label="Categoría"
              className="-mx-4 flex gap-5 overflow-x-auto px-4 shadow-[inset_0_-1px_0_var(--border)] sm:mx-0 sm:px-0"
            >
              {categories.map((category) => {
                const selected = category === activeCategory;
                const count = (form.tasks[category] ?? []).length;
                return (
                  <button
                    key={category}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => setActive(category)}
                    className="relative flex shrink-0 items-baseline gap-1.5 py-2.5 text-sm whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:text-foreground aria-selected:font-medium aria-selected:text-foreground"
                  >
                    {category}
                    <span
                      className={cn(
                        "text-xs tabular-nums",
                        count === 0 ? "text-destructive" : "opacity-60",
                      )}
                    >
                      {count}
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

            {activeTasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {activeCategory} todavía no tiene preguntas.
              </p>
            ) : (
              <ol className="flex flex-col">
                {activeTasks.map((task, index) => (
                  <li
                    key={task.id}
                    className="flex min-w-0 items-center gap-3 border-b py-2 last:border-b-0"
                  >
                    <span className="w-5 shrink-0 text-right text-sm text-muted-foreground tabular-nums">
                      {index + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => setPreview(task)}
                      className="min-w-0 flex-1 truncate text-left text-sm font-medium underline-offset-4 hover:underline"
                    >
                      {task.title}
                    </button>
                    <DifficultyTag
                      difficulty={difficultyOf(task, activeCategory)}
                    />
                    <div className="flex shrink-0 items-center">
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Subir ${task.title}`}
                        disabled={locked || index === 0}
                        onClick={() => move(index, -1)}
                      >
                        <ArrowUpIcon />
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Bajar ${task.title}`}
                        disabled={locked || index === activeTasks.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        <ArrowDownIcon />
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Quitar ${task.title}`}
                        disabled={locked}
                        onClick={() =>
                          setActiveIds(activeIds.filter((id) => id !== task.id))
                        }
                      >
                        <XIcon />
                      </Button>
                    </div>
                  </li>
                ))}
              </ol>
            )}

            {hasInteractive && (
              <p className="bg-secondary/20 px-4 py-3 text-sm">
                {PAPER_BLOCKED_INTERACTIVE}
              </p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <Button
                type="button"
                variant="outline"
                disabled={locked || busy !== null}
                onClick={() =>
                  saveAndGo(
                    `/desafios/preguntas?id=${contestId}&categoria=${encodeURIComponent(activeCategory)}`,
                  )
                }
              >
                <PlusIcon data-icon="inline-start" />
                Agregar preguntas
              </Button>
              {activeTasks.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  {DIFFICULTY_KEYS.filter((key) => summary.counts[key] > 0)
                    .map(
                      (key) =>
                        `${BEBRAS_SCORING[key].label} ${summary.counts[key]}`,
                    )
                    .join(" · ")}
                  {" · "}puntaje de 0 a {summary.max}
                </p>
              )}
            </div>
          </section>
        )}

        <FormSection title="Fechas" hint={locked ? lockedHint : undefined}>
          <div className="flex max-w-3xl min-w-0 flex-col gap-8">
            {!form.isTest && (
              <WindowField
                id="contest-registration"
                title="Inscripción"
                help="Sin fechas, los maestros pueden inscribir desde que publicas hasta que empieza la rendición."
                startsAt={form.registrationStartsAt}
                endsAt={form.registrationEndsAt}
                maxDate={parseDateTimeLocal(span.startsAt)}
                disabled={locked}
                onChange={(registrationStartsAt, registrationEndsAt) =>
                  update({ registrationStartsAt, registrationEndsAt })
                }
              />
            )}
            <div className="flex min-w-0 flex-col">
              {(form.categories.length > 1 || byCategory) && (
                <div className="flex items-center gap-1.5 pb-4">
                  <div
                    role="group"
                    aria-label="Horario de la rendición"
                    className="flex flex-wrap gap-1.5"
                  >
                    <button
                      type="button"
                      aria-pressed={!byCategory}
                      disabled={locked}
                      onClick={() => setScheduleMode("single")}
                      className={pillClass}
                    >
                      Todas a la vez
                    </button>
                    <button
                      type="button"
                      aria-pressed={byCategory}
                      disabled={locked}
                      onClick={() => setScheduleMode("category")}
                      className={pillClass}
                    >
                      Por categoría
                    </button>
                  </div>
                  <FieldHint>
                    Por categoría, cada una rinde en su horario y pueden
                    pisarse. Una categoría sin fechas todavía no puede rendir.
                  </FieldHint>
                </div>
              )}
              <Reveal open={!byCategory}>
                <WindowField
                  id="contest-run"
                  title="Rendición"
                  help={
                    locked
                      ? lockedHint
                      : form.startsAt && form.endsAt
                        ? "Este horario define cuándo pueden rendir los estudiantes. Cada equipo tiene el tiempo indicado abajo."
                        : form.startsAt || form.endsAt
                          ? "Completa el inicio y el cierre para habilitar la rendición."
                          : "Sin fechas todavía nadie puede rendir. Puedes ponerlas después de publicar."
                  }
                  startsAt={form.startsAt}
                  endsAt={form.endsAt}
                  minDate={parseDateTimeLocal(form.registrationEndsAt)}
                  disabled={locked}
                  onChange={(startsAt, endsAt) =>
                    updateRun({ startsAt, endsAt })
                  }
                />
              </Reveal>
              <Reveal open={byCategory} className="flex flex-col gap-6">
                {form.categories.map((category) => (
                  <WindowField
                    key={category}
                    id={`contest-run-${category}`}
                    title={`Rendición de ${category}`}
                    category={category}
                    startsAt={form.schedules[category]?.startsAt ?? ""}
                    endsAt={form.schedules[category]?.endsAt ?? ""}
                    minDate={parseDateTimeLocal(form.registrationEndsAt)}
                    disabled={locked}
                    onChange={(startsAt, endsAt) =>
                      updateRun({
                        schedules: {
                          ...form.schedules,
                          [category]: { startsAt, endsAt },
                        },
                      })
                    }
                  />
                ))}
              </Reveal>
            </div>
            {!form.isTest && (
              <WindowField
                id="contest-results"
                title="Resultados"
                help={
                  resultsPublished
                    ? lockedHint
                    : locked && !resultsEditable
                      ? lockedHint
                      : `Desde: se publican solos y el desafío aparece con sus resultados en la página principal. Se pone sola al cierre de ${byCategory ? "la última categoría" : "la rendición"} y la puedes cambiar. Hasta: deja de salir ahí. Se pone sola 7 días después de «Desde» y la puedes cambiar. Cada estudiante los sigue viendo con su código.`
                }
                startsAt={form.resultsAt}
                endsAt={form.resultsUntil}
                minDate={parseDateTimeLocal(span.endsAt)}
                disabled={(locked && !resultsEditable) || busy !== null}
                startDisabled={resultsPublished}
                minEndDate={parseDateTimeLocal(minimumResultsUntil)}
                startLabel="Desde"
                endLabel="Hasta"
                onChange={(resultsAt, resultsUntil) =>
                  updateRun({ resultsAt, resultsUntil })
                }
              />
            )}
          </div>
          <label className="flex flex-wrap items-center gap-3 text-sm">
            Cada equipo tiene
            <input
              type="number"
              min={1}
              value={form.durationMinutes || ""}
              disabled={locked}
              onChange={(event) =>
                updateRun({
                  durationMinutes: Number(event.target.value || 0),
                })
              }
              className="h-8 w-16 border-2 border-border/20 bg-transparent px-2 text-sm tabular-nums outline-none focus-visible:border-primary disabled:opacity-50"
            />
            minutos, desde que toca «Empezar».
          </label>
          <Reveal open={dateProblems.length > 0 || restartPast}>
            <ul className="flex flex-col gap-1 text-sm text-destructive">
              {restartPast && (
                <li>
                  Las fechas ya pasaron: pon un cierre que esté en el futuro.
                </li>
              )}
              {shownDateProblems.map((problem) => (
                <li
                  key={problem}
                  className="duration-300 animate-in fade-in slide-in-from-top-1 motion-reduce:animate-none"
                >
                  {problem}
                </li>
              ))}
            </ul>
          </Reveal>
        </FormSection>

        <FormSection
          title="Cómo se rinde"
          hint={locked ? lockedHint : undefined}
        >
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">Preguntas</h3>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ["one_by_one", "Una por una"],
                  ["all", "Todas juntas"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={form.questionDisplayMode === value}
                  disabled={locked}
                  onClick={() => update({ questionDisplayMode: value })}
                  className={pillClass}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {(
            [
              ["allowPairs", "Se puede rendir en pareja"],
              ["shuffleOptions", "Mezclar el orden de las opciones"],
            ] as const
          )
            .filter(([key]) => !(form.isTest && key === "allowPairs"))
            .map(([key, label]) => (
              <label key={key} className="flex items-center gap-3 text-sm">
                <Checkbox
                  checked={form[key]}
                  disabled={locked}
                  onCheckedChange={(checked) =>
                    update({ [key]: checked === true })
                  }
                />
                {label}
              </label>
            ))}
          <label className="flex items-start gap-3 text-sm">
            <Checkbox
              className="mt-0.5"
              checked={form.isTest}
              disabled={locked || contestState !== "borrador"}
              onCheckedChange={(checked) =>
                update({ isTest: checked === true })
              }
            />
            <span className="flex flex-col gap-0.5">
              Es un desafío de prueba
              <span className="text-muted-foreground">
                Sin inscripción ni resultados: se entra con el nombre y el
                curso, y cada uno ve su puntaje al entregar.
              </span>
            </span>
          </label>
          {form.isTest && (
            <label className="flex items-start gap-3 text-sm">
              <Checkbox
                className="mt-0.5"
                checked={form.collectUsage}
                disabled={locked}
                onCheckedChange={(checked) =>
                  update({ collectUsage: checked === true })
                }
              />
              <span className="flex flex-col gap-0.5">
                Recoger uso y opiniones
                <span className="text-muted-foreground">
                  Al entregar, el estudiante deja una reseña corta y se guarda
                  desde qué dispositivo rindió.
                </span>
              </span>
            </label>
          )}
        </FormSection>

        {!form.isTest && (
          <FormSection
            title="Qué ve el estudiante"
            hint={locked ? lockedHint : undefined}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-2 pr-2 font-normal sm:pr-4" />
                    <th className="w-24 px-1 py-2 text-center text-xs font-normal sm:w-36 sm:px-2 sm:text-sm">
                      Al entregar su prueba
                    </th>
                    <th className="w-24 px-1 py-2 text-center text-xs font-normal sm:w-36 sm:px-2 sm:text-sm">
                      Al publicar los resultados
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      ["showScoreOnSubmit", "showTotalScore", "Su puntaje"],
                      [
                        "showFeedbackOnSubmit",
                        "showFeedback",
                        "Si acertó cada pregunta",
                      ],
                      [
                        "showSolutionsOnSubmit",
                        "showSolutions",
                        "La solución de cada pregunta",
                      ],
                    ] as const
                  ).map(([onSubmit, onResults, label]) => (
                    <tr key={onSubmit} className="border-t">
                      <td className="py-3 pr-4">{label}</td>
                      <td className="px-2 py-3 text-center">
                        <Checkbox
                          className="mx-auto"
                          aria-label={`${label}, al entregar su prueba`}
                          checked={form[onSubmit]}
                          disabled={locked}
                          onCheckedChange={(checked) =>
                            update(
                              checked === true
                                ? { [onSubmit]: true, [onResults]: true }
                                : { [onSubmit]: false },
                            )
                          }
                        />
                      </td>
                      <td className="px-2 py-3 text-center">
                        <Checkbox
                          className="mx-auto"
                          aria-label={`${label}, al publicar los resultados`}
                          checked={form[onResults] || form[onSubmit]}
                          disabled={locked || form[onSubmit]}
                          onCheckedChange={(checked) =>
                            update({ [onResults]: checked === true })
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-sm text-muted-foreground">
              Lo que ve al entregar lo sigue viendo con los resultados. La
              posición en el ranking solo aparece al publicarlos.
            </p>
          </FormSection>
        )}

        <FormSection title="Puntaje" hint={locked ? lockedHint : undefined}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              {DIFFICULTY_KEYS.map((key) => (
                <span key={key} className="flex items-center gap-2">
                  <DifficultyTag difficulty={key} />
                  <span className="tabular-nums">
                    +{form.scoring[key].correct} / {form.scoring[key].wrong}
                  </span>
                </span>
              ))}
              <span className="text-muted-foreground">Sin responder, 0</span>
            </div>
            <button
              type="button"
              disabled={locked}
              onClick={() => setScoringOpen((open) => !open)}
              className="text-sm underline underline-offset-4 disabled:pointer-events-none disabled:opacity-50"
            >
              {scoringOpen ? "Listo" : "Cambiar"}
            </button>
          </div>
          <Reveal open={scoringOpen && !locked}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[22rem] text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-2 pr-4 font-normal" />
                    <th className="w-28 px-2 py-2 text-center font-normal">
                      Acierta
                    </th>
                    <th className="w-28 px-2 py-2 text-center font-normal">
                      Falla
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {DIFFICULTY_KEYS.map((key) => (
                    <tr key={key} className="border-t">
                      <td className="py-3 pr-4">
                        <DifficultyTag difficulty={key} />
                      </td>
                      <td className="px-2 py-3">
                        <div className="flex justify-center">
                          <ScoreInput
                            label={`Puntaje si acierta en ${BEBRAS_SCORING[key].label.toLowerCase()}`}
                            value={form.scoring[key].correct}
                            disabled={locked}
                            onChange={(correct) =>
                              update({
                                scoring: {
                                  ...form.scoring,
                                  [key]: { ...form.scoring[key], correct },
                                },
                              })
                            }
                          />
                        </div>
                      </td>
                      <td className="px-2 py-3">
                        <div className="flex justify-center">
                          <ScoreInput
                            label={`Puntaje si falla en ${BEBRAS_SCORING[key].label.toLowerCase()}`}
                            value={form.scoring[key].wrong}
                            disabled={locked}
                            onChange={(wrong) =>
                              update({
                                scoring: {
                                  ...form.scoring,
                                  [key]: { ...form.scoring[key], wrong },
                                },
                              })
                            }
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!isStandardScoring(form.scoring) && (
              <button
                type="button"
                onClick={() => update({ scoring: defaultContestScoring() })}
                className="mt-2 flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
              >
                <RotateCcwIcon className="size-3.5" />
                Volver a los de Bebras
              </button>
            )}
          </Reveal>
        </FormSection>
      </>

      {contestMeta && contestState !== "abierta" && (
        <div className="border-t pt-6">
          <ContestLifecycleActions
            placement="deletion"
            contest={contestMeta}
            beforeRestart={save}
            onChanged={setContestMeta}
          />
        </div>
      )}

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t bg-background px-4 py-3 sm:mx-0 sm:gap-3 sm:px-0">
        {barMessage && (
          <p
            key={barMessage.text}
            role={barMessage.tone === "error" ? "alert" : "status"}
            className={cn(
              "mr-auto min-w-0 truncate text-sm duration-300 animate-in fade-in slide-in-from-bottom-1 motion-reduce:animate-none",
              barMessage.tone === "error"
                ? "font-medium text-destructive"
                : "text-muted-foreground",
            )}
          >
            {barMessage.text}
            {barMessage.more > 0 && (
              <span className="font-normal text-destructive/70">
                {" "}
                y {barMessage.more} más
              </span>
            )}
          </p>
        )}
        <Button asChild variant="outline">
          <a href={backHref}>
            <ChevronLeftIcon data-icon="inline-start" />
            Volver
          </a>
        </Button>
        {contestMeta && (
          <ContestLifecycleActions
            placement="actions"
            contest={contestMeta}
            beforeRestart={async () => !restartPast && (await save())}
            onChanged={(contest) => {
              const next = formFromContest(contest);
              setForm(next);
              setContestState(contest.state);
              setContestMeta(contest);
              savedRef.current = JSON.stringify(toPayload(next));
              setSaveError(null);
            }}
          />
        )}
        {locked ? (
          <>
            {form.isTest && (
              <Button asChild variant="outline">
                <a href={`/desafios/uso?id=${contestId}`}>
                  <BarChart3Icon data-icon="inline-start" />
                  Uso y opiniones
                </a>
              </Button>
            )}
            {!form.isTest && (
              <Button asChild variant="outline">
                <a href={`/desafios/resultados?id=${contestId}`}>
                  <BarChart3Icon data-icon="inline-start" />
                  Resultados
                </a>
              </Button>
            )}
            <Button
              type="button"
              disabled={!resultsEditable || busy !== null}
              onClick={() => void saveAndGo("/desafios")}
            >
              <SaveIcon data-icon="inline-start" />
              {busy === "saving" ? "Guardando…" : "Guardar"}
            </Button>
          </>
        ) : (
          <>
            {activeTasks.length > 0 && (
              <Button
                type="button"
                variant="outline"
                disabled={busy !== null}
                onClick={() =>
                  saveAndGo(
                    `/desafios/probar?id=${contestId}&categoria=${encodeURIComponent(activeCategory)}`,
                  )
                }
              >
                <PlayIcon data-icon="inline-start" />
                Probar
              </Button>
            )}
            {contestState === "borrador" && (
              <Button
                type="button"
                variant="outline"
                disabled={busy !== null}
                onClick={handlePublish}
              >
                <SendIcon data-icon="inline-start" />
                {busy === "publishing" ? "Publicando…" : "Publicar"}
              </Button>
            )}
            <Button
              type="button"
              disabled={busy !== null}
              onClick={() => saveAndGo("/desafios")}
            >
              <SaveIcon data-icon="inline-start" />
              {busy === "saving" ? "Guardando…" : "Guardar"}
            </Button>
          </>
        )}
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
