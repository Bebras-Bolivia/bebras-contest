"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BarChart3Icon,
  CheckIcon,
  LoaderCircleIcon,
  PlayIcon,
  PlusIcon,
  RotateCcwIcon,
  SaveIcon,
  SendIcon,
  XIcon,
} from "lucide-react";

import { getContest, publishContest, updateContest } from "@/lib/contests-api";
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
import { listTasks } from "@/lib/tasks-api";
import { type StoredTask } from "@/lib/task-schema";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DateTimeField, parseDateTimeLocal } from "@/components/datetime-field";
import { FormSection } from "@/components/form-section";
import {
  DifficultyTag,
  TaskPreviewDialog,
  difficultyOf,
} from "@/components/contest-task-parts";

type Form = {
  title: string;
  categories: string[];
  durationMinutes: number;
  registrationStartsAt: string;
  registrationEndsAt: string;
  startsAt: string;
  endsAt: string;
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
  "preparacion",
];

function localValue(value: string | null) {
  return value ? toDatetimeLocalValue(value) : "";
}

function formFromContest(contest: StoredContest): Form {
  const tasks: Record<string, string[]> = {};

  for (const task of contest.tasks
    .slice()
    .sort((left, right) => left.position - right.position)) {
    tasks[task.category] = [...(tasks[task.category] ?? []), task.taskId];
  }

  return {
    title: contest.title,
    categories: contest.categories,
    durationMinutes: contest.durationMinutes,
    registrationStartsAt: localValue(contest.registrationStartsAt),
    registrationEndsAt: localValue(contest.registrationEndsAt),
    startsAt: localValue(contest.startsAt),
    endsAt: localValue(contest.endsAt),
    resultsAt: localValue(contest.resultsAt),
    resultsUntil: localValue(contest.resultsUntil),
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

  return {
    title: form.title.trim(),
    categories: form.categories,
    durationMinutes: form.durationMinutes,
    registrationStartsAt: iso(form.registrationStartsAt),
    registrationEndsAt: iso(form.registrationEndsAt),
    startsAt: iso(form.startsAt),
    endsAt: iso(form.endsAt),
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
  startLabel = "Inicio",
  endLabel = "Cierre",
  onChange,
}: {
  id: string;
  title: string;
  help: string;
  startsAt: string;
  endsAt: string;
  minDate?: Date | null;
  maxDate?: Date | null;
  disabled: boolean;
  startLabel?: string;
  endLabel?: string;
  onChange: (startsAt: string, endsAt: string) => void;
}) {
  const length = formatLength(startsAt, endsAt);
  const start = parseDateTimeLocal(startsAt);
  const end = parseDateTimeLocal(endsAt);

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold">{title}</h3>
        {length ? (
          <span className="text-sm text-muted-foreground">Dura {length}</span>
        ) : (
          !disabled &&
          (startsAt || endsAt) && (
            <button
              type="button"
              onClick={() => onChange("", "")}
              className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Quitar fechas
            </button>
          )
        )}
      </div>
      <p className="-mt-2 text-sm text-muted-foreground">{help}</p>
      <div className="grid min-w-0 gap-3 sm:grid-cols-[4rem_minmax(0,1fr)] sm:items-center">
        <label htmlFor={id} className="text-sm">
          {startLabel}
        </label>
        <DateTimeField
          id={id}
          label={`${title}, ${startLabel.toLowerCase()}`}
          value={startsAt}
          minDate={minDate}
          maxDate={end ?? maxDate}
          disabled={disabled}
          allowClear
          onChange={(value) => onChange(value, endsAt)}
        />
        <label htmlFor={`${id}-end`} className="text-sm">
          {endLabel}
        </label>
        <DateTimeField
          id={`${id}-end`}
          label={`${title}, ${endLabel.toLowerCase()}`}
          value={endsAt}
          fallbackHour={18}
          minDate={start ?? minDate}
          maxDate={maxDate}
          disabled={disabled}
          allowClear
          onChange={(value) => onChange(startsAt, value)}
        />
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

function formatDateTime(value: string) {
  const date = parseDateTimeLocal(value);
  return date
    ? date.toLocaleString("es-BO", { dateStyle: "long", timeStyle: "short" })
    : "";
}

function SummaryRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1 border-b py-3 text-sm sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/** Lo que se rinde, tal como quedó: ya no se edita. */
function ContestSummary({
  form,
  tasksById,
  onPreview,
}: {
  form: Form;
  tasksById: Map<string, StoredTask>;
  onPreview: (task: StoredTask) => void;
}) {
  const period = (startsAt: string, endsAt: string, empty: string) =>
    startsAt && endsAt
      ? `${formatDateTime(startsAt)} a ${formatDateTime(endsAt)}`
      : empty;
  const listOf = (items: Array<[boolean, string]>, empty: string) => {
    const shown = items.filter(([on]) => on).map(([, label]) => label);
    return shown.length > 0
      ? shown.join(", ").replace(/^./, (letter) => letter.toUpperCase())
      : empty;
  };

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-6">
        <h2 className="font-heading text-base font-semibold">Preguntas</h2>
        {form.categories.map((category) => {
          const tasks = (form.tasks[category] ?? [])
            .map((id) => tasksById.get(id))
            .filter((task): task is StoredTask => task !== undefined);
          return (
            <div key={category} className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold">
                {category}{" "}
                <span className="font-normal text-muted-foreground">
                  · {tasks.length}{" "}
                  {tasks.length === 1 ? "pregunta" : "preguntas"}
                </span>
              </h3>
              <ol className="flex flex-col">
                {tasks.map((task, index) => (
                  <li
                    key={task.id}
                    className="flex min-w-0 items-center gap-3 border-b py-2 last:border-b-0"
                  >
                    <span className="w-5 shrink-0 text-right text-sm text-muted-foreground tabular-nums">
                      {index + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => onPreview(task)}
                      className="min-w-0 flex-1 truncate text-left text-sm underline-offset-4 hover:underline"
                    >
                      {task.title}
                    </button>
                    <DifficultyTag difficulty={difficultyOf(task, category)} />
                  </li>
                ))}
              </ol>
            </div>
          );
        })}
      </section>

      <section className="flex flex-col">
        <h2 className="pb-1 font-heading text-base font-semibold">
          Cómo se rinde
        </h2>
        <dl>
          <SummaryRow label="Inscripción">
            {period(
              form.registrationStartsAt,
              form.registrationEndsAt,
              "Abierta desde que se publicó hasta el inicio de la rendición",
            )}
          </SummaryRow>
          <SummaryRow label="Rendición">
            {period(form.startsAt, form.endsAt, "Sin fechas")}
          </SummaryRow>
          <SummaryRow label="Resultados">
            {form.resultsAt
              ? `Se publican solos el ${formatDateTime(form.resultsAt)}`
              : "Se publican solos al cerrar la rendición"}
            {form.resultsUntil
              ? ` y salen en la página principal hasta el ${formatDateTime(form.resultsUntil)}.`
              : " y salen en la página principal durante 7 días."}
          </SummaryRow>
          <SummaryRow label="Tiempo por equipo">
            {form.durationMinutes} minutos
          </SummaryRow>
          <SummaryRow label="Preguntas">
            {form.questionDisplayMode === "all"
              ? "Todas juntas"
              : "Una por una"}
            {form.shuffleOptions ? ", con las opciones mezcladas" : ""}
          </SummaryRow>
          <SummaryRow label="Modalidad">
            {form.allowPairs ? "Individual o en pareja" : "Solo individual"}
          </SummaryRow>
          <SummaryRow label="Al entregar ve">
            {listOf(
              [
                [form.showScoreOnSubmit, "su puntaje"],
                [form.showFeedbackOnSubmit, "si acertó cada pregunta"],
                [form.showSolutionsOnSubmit, "las soluciones"],
              ],
              "Solo que su prueba quedó entregada",
            )}
          </SummaryRow>
          <SummaryRow label="Con los resultados ve">
            {listOf(
              [
                [form.showTotalScore, "su puntaje y su posición"],
                [form.showFeedback, "si acertó cada pregunta"],
                [form.showSolutions, "las soluciones"],
              ],
              "Nada: los resultados los comparte el maestro",
            )}
          </SummaryRow>
          <SummaryRow label="Puntaje">
            {DIFFICULTY_KEYS.map(
              (key) =>
                `${BEBRAS_SCORING[key].label} +${form.scoring[key].correct} / ${form.scoring[key].wrong}`,
            ).join(" · ")}
          </SummaryRow>
        </dl>
      </section>
    </div>
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [active, setActive] = useState<string>(() =>
    typeof window === "undefined"
      ? ""
      : (new URLSearchParams(window.location.search).get("categoria") ?? ""),
  );
  const [preview, setPreview] = useState<StoredTask | null>(null);
  const [scoringOpen, setScoringOpen] = useState(false);
  const [busy, setBusy] = useState<"saving" | "publishing" | null>(null);
  const [tried, setTried] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [publishTried, setPublishTried] = useState(false);
  const savedRef = useRef<string | null>(null);
  const leavingRef = useRef(false);

  const locked = !EDITABLE_STATES.includes(contestState);

  useEffect(() => {
    if (!contestId) {
      setLoadError("No se indicó qué desafío abrir.");
      return;
    }

    let alive = true;

    void Promise.all([getContest(contestId), listTasks()])
      .then(([contest, tasks]) => {
        if (!alive) return;
        const loaded = formFromContest(contest);
        savedRef.current = JSON.stringify(toPayload(loaded));
        setForm(loaded);
        setBank(tasks);
        setContestState(contest.state);
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

  const problems = useMemo(() => {
    if (!form) return [];
    const list: string[] = [];

    if (!form.title.trim()) list.push("Falta el nombre del desafío.");
    if (form.categories.length === 0) list.push("Falta elegir una categoría.");

    list.push(
      ...windowProblems(
        "la inscripción",
        form.registrationStartsAt,
        form.registrationEndsAt,
      ),
      ...windowProblems("la rendición", form.startsAt, form.endsAt),
    );

    if (
      form.registrationEndsAt &&
      form.startsAt &&
      !isBefore(form.registrationEndsAt, form.startsAt)
    ) {
      list.push("La inscripción tiene que cerrar antes de la rendición.");
    }

    if (
      form.resultsAt &&
      form.endsAt &&
      isBefore(form.resultsAt, form.endsAt)
    ) {
      list.push("Los resultados no pueden publicarse antes del cierre.");
    }

    const resultsFrom = form.resultsAt || form.endsAt;
    if (
      form.resultsUntil &&
      resultsFrom &&
      !isBefore(resultsFrom, form.resultsUntil)
    ) {
      list.push(
        "Los resultados tienen que mostrarse hasta después de publicarse.",
      );
    }

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
  }, [form, tasksById]);

  const publishProblems = useMemo(() => {
    if (!form) return [];
    const list = [...problems];
    const empty = form.categories.filter(
      (category) => (form.tasks[category] ?? []).length === 0,
    );

    if (empty.length > 0) {
      list.push(`Faltan preguntas en ${empty.join(", ")}.`);
    }

    const start = parseDateTimeLocal(form.startsAt);
    const end = parseDateTimeLocal(form.endsAt);
    if (
      start &&
      end &&
      (end.getTime() - start.getTime()) / 60_000 < form.durationMinutes
    ) {
      list.push("La rendición dura menos que el tiempo de cada equipo.");
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
    return (
      <div className="flex min-h-72 items-center justify-center">
        <LoaderCircleIcon className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const update = (patch: Partial<Form>) =>
    setForm((current) => (current ? { ...current, ...patch } : current));

  const activeIds = form.tasks[activeCategory] ?? [];
  const activeTasks = activeIds
    .map((id) => tasksById.get(id))
    .filter((task): task is StoredTask => task !== undefined);

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
    if (!contestId || problems.length > 0) return false;
    const payload = toPayload(form);
    const snapshot = JSON.stringify(payload);
    if (snapshot === savedRef.current) return true;
    setBusy("saving");
    try {
      const saved = await updateContest(contestId, payload);
      savedRef.current = snapshot;
      setContestState(saved.state);
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
      setSaveError(null);
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "No se pudo publicar.",
      );
    } finally {
      setBusy(null);
    }
  };

  const shownProblems = !tried
    ? []
    : publishTried && contestState === "borrador"
      ? publishProblems
      : problems;
  const barMessage = locked
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
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">
            {CONTEST_STATE_LABELS[contestState]}
          </span>
          {" · "}
          {locked ? (
            <>
              Ya empezó, así que no se puede cambiar.{" "}
              <a
                href={`/desafios/resultados?id=${contestId}`}
                className="text-foreground underline underline-offset-4"
              >
                Ver resultados
              </a>
            </>
          ) : contestState === "borrador" ? (
            "Nadie lo ve hasta que lo publiques."
          ) : (
            "Los maestros ya pueden inscribir a sus estudiantes."
          )}
        </p>
      </div>

      {locked ? (
        <ContestSummary
          form={form}
          tasksById={tasksById}
          onPreview={setPreview}
        />
      ) : (
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
                    className={pillClass}
                  >
                    {selected && (
                      <CheckIcon className="size-3.5 text-primary" />
                    )}
                    {category}
                  </button>
                );
              })}
            </div>
          </section>

          {categories.length > 0 && (
            <section className="flex flex-col gap-4">
              <h2 className="font-heading text-base font-semibold">
                Preguntas
              </h2>
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
                      {!locked && (
                        <div className="flex shrink-0 items-center">
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Subir ${task.title}`}
                            disabled={index === 0}
                            onClick={() => move(index, -1)}
                          >
                            <ArrowUpIcon />
                          </Button>
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Bajar ${task.title}`}
                            disabled={index === activeTasks.length - 1}
                            onClick={() => move(index, 1)}
                          >
                            <ArrowDownIcon />
                          </Button>
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Quitar ${task.title}`}
                            onClick={() =>
                              setActiveIds(
                                activeIds.filter((id) => id !== task.id),
                              )
                            }
                          >
                            <XIcon />
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3">
                {!locked && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() =>
                      saveAndGo(
                        `/desafios/preguntas?id=${contestId}&categoria=${encodeURIComponent(activeCategory)}`,
                      )
                    }
                  >
                    <PlusIcon data-icon="inline-start" />
                    Agregar preguntas
                  </Button>
                )}
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

          <FormSection title="Fechas">
            <div className="grid gap-8 lg:grid-cols-2">
              <WindowField
                id="contest-registration"
                title="Inscripción"
                help="Sin fechas, los maestros pueden inscribir desde que publicas hasta que empieza la rendición."
                startsAt={form.registrationStartsAt}
                endsAt={form.registrationEndsAt}
                maxDate={parseDateTimeLocal(form.startsAt)}
                disabled={locked}
                onChange={(registrationStartsAt, registrationEndsAt) =>
                  update({ registrationStartsAt, registrationEndsAt })
                }
              />
              <WindowField
                id="contest-run"
                title="Rendición"
                help="Sin fechas todavía nadie puede rendir. Puedes ponerlas después de publicar."
                startsAt={form.startsAt}
                endsAt={form.endsAt}
                minDate={parseDateTimeLocal(form.registrationEndsAt)}
                disabled={locked}
                onChange={(startsAt, endsAt) => update({ startsAt, endsAt })}
              />
            </div>
            <div className="lg:w-1/2 lg:pr-4">
              <WindowField
                id="contest-results"
                title="Resultados"
                help="Desde: se publican solos y el desafío aparece con sus resultados en la página principal (sin fecha, al cerrar la rendición). Hasta: deja de salir ahí (sin fecha, 7 días después). Cada estudiante los sigue viendo con su código."
                startsAt={form.resultsAt}
                endsAt={form.resultsUntil}
                minDate={parseDateTimeLocal(form.endsAt)}
                disabled={locked}
                startLabel="Desde"
                endLabel="Hasta"
                onChange={(resultsAt, resultsUntil) =>
                  update({ resultsAt, resultsUntil })
                }
              />
            </div>
            <label className="flex flex-wrap items-center gap-3 text-sm">
              Cada equipo tiene
              <input
                type="number"
                min={1}
                value={form.durationMinutes || ""}
                disabled={locked}
                onChange={(event) =>
                  update({ durationMinutes: Number(event.target.value || 0) })
                }
                className="h-8 w-16 border-2 border-border/20 bg-transparent px-2 text-sm tabular-nums outline-none focus-visible:border-primary disabled:opacity-50"
              />
              minutos, desde que toca «Empezar».
            </label>
          </FormSection>

          <FormSection title="Cómo se rinde">
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
            ).map(([key, label]) => (
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
          </FormSection>

          <FormSection title="Qué ve el estudiante">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[26rem] text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-2 pr-4 font-normal" />
                    <th className="w-36 px-2 py-2 text-center font-normal">
                      Al entregar su prueba
                    </th>
                    <th className="w-36 px-2 py-2 text-center font-normal">
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

          <FormSection title="Puntaje">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                {isStandardScoring(form.scoring) ? "Los de Bebras: " : ""}
                {DIFFICULTY_KEYS.map(
                  (key) =>
                    `${BEBRAS_SCORING[key].label} +${form.scoring[key].correct} / ${form.scoring[key].wrong}`,
                ).join(" · ")}
                . Sin responder, 0.
              </p>
              {!locked && (
                <button
                  type="button"
                  onClick={() => setScoringOpen((open) => !open)}
                  className="text-sm underline underline-offset-4"
                >
                  {scoringOpen ? "Listo" : "Cambiar"}
                </button>
              )}
            </div>
            {scoringOpen && !locked && (
              <div className="flex flex-col gap-3">
                {DIFFICULTY_KEYS.map((key) => (
                  <div key={key} className="flex items-center gap-3 text-sm">
                    <span className="w-16">{BEBRAS_SCORING[key].label}</span>
                    acierta
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
                    falla
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
                ))}
                {!isStandardScoring(form.scoring) && (
                  <button
                    type="button"
                    onClick={() => update({ scoring: defaultContestScoring() })}
                    className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
                  >
                    <RotateCcwIcon className="size-3.5" />
                    Volver a los de Bebras
                  </button>
                )}
              </div>
            )}
          </FormSection>
        </>
      )}

      <div className="sticky bottom-0 z-10 -mx-4 flex items-center justify-end gap-3 border-t bg-background px-4 py-3 sm:mx-0 sm:px-0">
        {barMessage && (
          <p
            role={barMessage.tone === "error" ? "alert" : "status"}
            className={cn(
              "mr-auto min-w-0 truncate text-sm",
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
        {locked ? (
          <Button asChild variant="outline">
            <a href={`/desafios/resultados?id=${contestId}`}>
              <BarChart3Icon data-icon="inline-start" />
              Resultados
            </a>
          </Button>
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
