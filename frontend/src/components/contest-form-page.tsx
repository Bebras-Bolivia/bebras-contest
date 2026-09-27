"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ClockIcon,
  LoaderCircleIcon,
  PlayIcon,
  RotateCcwIcon,
  SaveIcon,
} from "lucide-react";
import { toast } from "sonner";

import {
  createContest,
  getContest,
  publishContest,
  updateContest,
} from "@/lib/contests-api";
import {
  BEBRAS_SCORING,
  CONTEST_CATEGORIES,
  DIFFICULTY_KEYS,
  defaultContestScoring,
  isStandardScoring,
  taskDifficultyForCategory,
  fromDatetimeLocalValue,
  toDatetimeLocalValue,
  type ContestState,
  type ContestDraftInput,
  type ContestScoring,
} from "@/lib/contest-schema";
import { listTasks } from "@/lib/tasks-api";
import type { StoredTask } from "@/lib/task-schema";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DateTimeField } from "@/components/datetime-field";
import {
  Field,
  FieldContent,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { LabelWithHint } from "@/components/field-hint";
import { FormSection } from "@/components/form-section";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type ContestFormPageProps = {
  contestId?: string | null;
};

type FormState = ContestDraftInput;

function defaultContestTitle(category: string) {
  const year = new Date().getFullYear();
  return category
    ? `Desafío Bebras ${year} - ${category}`
    : `Desafío Bebras ${year}`;
}

function isGeneratedTitle(title: string, category: string) {
  return !title.trim() || title === defaultContestTitle(category);
}

function createInitialState(): FormState {
  return {
    title: defaultContestTitle(""),
    category: "",
    durationMinutes: 45,
    registrationStartsAt: "",
    registrationEndsAt: "",
    startsAt: "",
    endsAt: "",
    scoring: defaultContestScoring(),
    questionDisplayMode: "one_by_one",
    allowPairs: false,
    shuffleOptions: false,
    showFeedback: false,
    showSolutions: false,
    showTotalScore: false,
    tasks: [],
  };
}

function createStateFromContest(
  contest: Awaited<ReturnType<typeof getContest>>,
): FormState {
  return {
    title: contest.title,
    category: contest.category,
    durationMinutes: contest.durationMinutes,
    registrationStartsAt: contest.registrationStartsAt
      ? toDatetimeLocalValue(contest.registrationStartsAt)
      : "",
    registrationEndsAt: contest.registrationEndsAt
      ? toDatetimeLocalValue(contest.registrationEndsAt)
      : "",
    startsAt: contest.startsAt ? toDatetimeLocalValue(contest.startsAt) : "",
    endsAt: contest.endsAt ? toDatetimeLocalValue(contest.endsAt) : "",
    scoring: contest.scoring ?? defaultContestScoring(),
    questionDisplayMode: contest.questionDisplayMode,
    allowPairs: contest.allowPairs,
    shuffleOptions: contest.shuffleOptions,
    showFeedback: contest.showFeedback,
    showSolutions: contest.showSolutions,
    showTotalScore: contest.showTotalScore,
    tasks: contest.tasks
      .slice()
      .sort((left, right) => left.position - right.position)
      .map((task) => ({ taskId: task.taskId })),
  };
}

function toContestPayload(
  form: FormState,
  { keepTasks = false }: { keepTasks?: boolean } = {},
): ContestDraftInput {
  const payload = {
    ...form,
    title: form.title.trim(),
    registrationStartsAt: form.registrationStartsAt
      ? fromDatetimeLocalValue(form.registrationStartsAt)
      : "",
    registrationEndsAt: form.registrationEndsAt
      ? fromDatetimeLocalValue(form.registrationEndsAt)
      : "",
    startsAt: form.startsAt ? fromDatetimeLocalValue(form.startsAt) : "",
    endsAt: form.endsAt ? fromDatetimeLocalValue(form.endsAt) : "",
  };

  if (keepTasks) {
    // Sin la clave, el backend deja intactas las preguntas que ya tiene.
    delete (payload as Partial<ContestDraftInput>).tasks;
  }

  return payload;
}

function parseDateTimeLocal(value: string) {
  if (!value) {
    return null;
  }

  const parsedDate = new Date(value);
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
}

/** Cuánto dura la ventana, en palabras. Devuelve null si todavía no es válida. */
function formatWindowLength(startsAt: string, endsAt: string) {
  const start = parseDateTimeLocal(startsAt);
  const end = parseDateTimeLocal(endsAt);

  if (!start || !end) {
    return null;
  }

  const totalMinutes = Math.round((end.getTime() - start.getTime()) / 60_000);

  if (totalMinutes <= 0) {
    return null;
  }

  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];

  if (days > 0) {
    parts.push(`${days} ${days === 1 ? "día" : "días"}`);
  }
  if (hours > 0) {
    parts.push(`${hours} ${hours === 1 ? "hora" : "horas"}`);
  }
  if (minutes > 0) {
    parts.push(`${minutes} ${minutes === 1 ? "minuto" : "minutos"}`);
  }

  if (parts.length === 1) {
    return parts[0];
  }

  return `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}`;
}

/**
 * Ventana con su inicio y su cierre. Cada extremo lleva su propio día y su
 * hora, así que una ventana puede abarcar un día o varios sin cambiar de modo.
 * El estimado se recalcula en cada cambio porque sale del estado del formulario.
 */
function WindowField({
  id,
  label,
  hint,
  startsAt,
  endsAt,
  minDate = null,
  maxDate = null,
  invalid = false,
  disabled = false,
  onChange,
}: {
  id: string;
  label: string;
  hint: ReactNode;
  startsAt: string;
  endsAt: string;
  minDate?: Date | null;
  maxDate?: Date | null;
  invalid?: boolean;
  disabled?: boolean;
  onChange: (nextStartsAt: string, nextEndsAt: string) => void;
}) {
  const startDate = parseDateTimeLocal(startsAt);
  const endDate = parseDateTimeLocal(endsAt);
  const windowLength = formatWindowLength(startsAt, endsAt);

  return (
    <Field data-invalid={invalid || undefined}>
      {/* El «durará» va arriba a la derecha, en la misma línea del nombre de la
          ventana: es el dato que se mira al ajustar las fechas. */}
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <LabelWithHint htmlFor={id} required hint={hint}>
          {label}
        </LabelWithHint>
        <Badge variant={windowLength ? "secondary" : "outline"}>
          <ClockIcon data-icon="inline-start" />
          {windowLength ? `Durará ${windowLength}` : "Sin definir"}
        </Badge>
      </div>
      <FieldContent className="gap-3">
        <div className="grid min-w-0 gap-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
          <FieldLabel htmlFor={id} className="sm:w-16">
            Inicio
          </FieldLabel>
          <DateTimeField
            id={id}
            disabled={disabled}
            invalid={invalid}
            label={`${label}, inicio`}
            maxDate={endDate ?? maxDate}
            minDate={minDate}
            value={startsAt}
            onChange={(nextValue) => onChange(nextValue, endsAt)}
          />
          <FieldLabel htmlFor={`${id}-end`} className="sm:w-16">
            Cierre
          </FieldLabel>
          <DateTimeField
            fallbackHour={18}
            id={`${id}-end`}
            disabled={disabled}
            invalid={invalid}
            label={`${label}, cierre`}
            maxDate={maxDate}
            minDate={startDate ?? minDate}
            value={endsAt}
            onChange={(nextValue) => onChange(startsAt, nextValue)}
          />
        </div>
      </FieldContent>
    </Field>
  );
}

const RESULT_TOGGLES = [
  {
    key: "showTotalScore",
    label: "Su puntaje total",
    hint: "El número final, sin el detalle de cada tarea.",
  },
  {
    key: "showFeedback",
    label: "El feedback de cada tarea",
    hint: "Si acertó o falló, tarea por tarea.",
  },
  {
    key: "showSolutions",
    label: "Las soluciones",
    hint: "La explicación de cada tarea, para aprender de ella.",
  },
] as const;

/** Puntaje editable de una dificultad. Solo emite enteros válidos. */
function ScoreInput({
  id,
  label,
  difficulty,
  value,
  disabled = false,
  onChange,
}: {
  id: string;
  label: string;
  difficulty: string;
  value: number;
  disabled?: boolean;
  onChange: (nextValue: number) => void;
}) {
  const [draftValue, setDraftValue] = useState(String(value));

  useEffect(() => {
    setDraftValue(String(value));
  }, [value]);

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <FieldLabel
        htmlFor={id}
        className="text-xs font-normal text-muted-foreground"
      >
        {label}
      </FieldLabel>
      <Input
        id={id}
        type="number"
        className="h-8"
        aria-label={`Puntaje de respuesta ${label.toLowerCase()} en ${difficulty.toLowerCase()}`}
        disabled={disabled}
        value={draftValue}
        onChange={(event) => {
          const nextValue = event.target.value;
          setDraftValue(nextValue);

          const parsed = Number(nextValue);

          if (nextValue.trim() !== "" && Number.isInteger(parsed)) {
            onChange(parsed);
          }
        }}
      />
    </div>
  );
}

/** Dificultad de la tarea en la categoría del desafío, que es la que puntúa. */

export function ContestFormPage({ contestId = null }: ContestFormPageProps) {
  const resolvedContestId =
    contestId ??
    (typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("id")
      : null);
  const [form, setForm] = useState<FormState>(createInitialState);
  const [tasks, setTasks] = useState<StoredTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [publishAttempted, setPublishAttempted] = useState(false);
  const [contestState, setContestState] = useState<ContestState>("borrador");
  // Última versión que el servidor ya tiene, para no reenviar lo mismo ni
  // guardar en bucle con la respuesta del propio guardado.
  const savedSnapshotRef = useRef<string | null>(null);
  const locked = ![
    "borrador",
    "programada",
    "inscripcion",
    "preparacion",
  ].includes(contestState);
  const isCreation = !resolvedContestId;

  useEffect(() => {
    let active = true;

    void Promise.all([
      listTasks(),
      resolvedContestId ? getContest(resolvedContestId) : Promise.resolve(null),
    ])
      .then(([loadedTasks, loadedContest]) => {
        if (!active) {
          return;
        }

        setTasks(loadedTasks);

        if (loadedContest) {
          const loadedForm = createStateFromContest(loadedContest);
          setForm(loadedForm);
          setContestState(loadedContest.state);
          savedSnapshotRef.current = JSON.stringify(
            toContestPayload(loadedForm, { keepTasks: true }),
          );
        }
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }

        if (resolvedContestId) {
          setNotFound(true);
        } else {
          toast.error(
            error instanceof Error
              ? error.message
              : "No se pudieron cargar los datos.",
          );
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [resolvedContestId]);

  const selectedTasks = useMemo(() => {
    const tasksById = new Map(tasks.map((task) => [task.id, task]));
    return form.tasks
      .map((taskConfig) => tasksById.get(taskConfig.taskId))
      .filter((task): task is StoredTask => task !== undefined);
  }, [form.tasks, tasks]);

  const validationErrors = useMemo(() => {
    const errors: string[] = [];

    if (!form.title.trim()) {
      errors.push("El nombre del desafío es obligatorio.");
    }

    if (!form.category) {
      errors.push("Debes elegir la categoría del desafío.");
    }

    // Al crear solo se piden los datos generales; el calendario llega con la edición.
    if (isCreation) {
      return errors;
    }

    if (!Number.isFinite(form.durationMinutes) || form.durationMinutes <= 0) {
      errors.push("La duración debe ser mayor que cero.");
    }

    // El calendario puede quedar a medias mientras es borrador: solo lo que ya
    // está escrito tiene que ser coherente. Publicar sí lo exige completo.
    if (
      form.startsAt &&
      form.endsAt &&
      new Date(form.endsAt) <= new Date(form.startsAt)
    ) {
      errors.push("La fecha de fin debe ser posterior a la de inicio.");
    }

    if (
      form.registrationStartsAt &&
      form.registrationEndsAt &&
      new Date(form.registrationEndsAt) <= new Date(form.registrationStartsAt)
    ) {
      errors.push("El cierre de inscripción debe ser posterior a su inicio.");
    } else if (
      form.registrationEndsAt &&
      form.startsAt &&
      new Date(form.registrationEndsAt) >= new Date(form.startsAt)
    ) {
      errors.push(
        "La inscripción debe cerrar antes de la rendición para dejar tiempo de preparación.",
      );
    }

    for (const key of DIFFICULTY_KEYS) {
      const { correct, wrong } = form.scoring[key];

      if (!Number.isInteger(correct) || correct <= 0) {
        errors.push(
          `El puntaje de una respuesta correcta en ${BEBRAS_SCORING[key].label.toLowerCase()} debe ser un entero mayor que cero.`,
        );
        break;
      }

      if (!Number.isInteger(wrong) || wrong > 0) {
        errors.push(
          `El puntaje de una respuesta incorrecta en ${BEBRAS_SCORING[key].label.toLowerCase()} debe ser un entero menor o igual que cero.`,
        );
        break;
      }
    }

    for (const selected of selectedTasks) {
      if (!taskDifficultyForCategory(selected.difficulties, form.category)) {
        errors.push(
          `La tarea "${selected.title}" no tiene dificultad definida para la categoría ${form.category || "elegida"}.`,
        );
        break;
      }
    }

    return errors;
  }, [form, isCreation, selectedTasks]);

  const publishValidationErrors = useMemo(() => {
    const errors = [...validationErrors];

    if (!form.startsAt || !form.endsAt) {
      errors.push("Define la ventana de rendición antes de publicar.");
    }

    if (!form.registrationStartsAt || !form.registrationEndsAt) {
      errors.push("Define la ventana de inscripción antes de publicar.");
    }

    if (form.tasks.length === 0) {
      errors.push("Agrega al menos una tarea antes de publicar.");
    }

    return errors;
  }, [
    form.registrationEndsAt,
    form.registrationStartsAt,
    form.startsAt,
    form.endsAt,
    form.tasks.length,
    validationErrors,
  ]);

  const scoreSummary = useMemo(() => {
    const counts = { easy: 0, medium: 0, hard: 0 };
    let maxScore = 0;
    let penalties = 0;
    let unresolved = 0;

    for (const task of selectedTasks) {
      const difficulty = taskDifficultyForCategory(
        task.difficulties,
        form.category,
      );

      if (!difficulty) {
        unresolved += 1;
        continue;
      }

      counts[difficulty] += 1;
      maxScore += form.scoring[difficulty].correct;
      penalties += Math.abs(form.scoring[difficulty].wrong);
    }

    return {
      counts,
      unresolved,
      initialScore: penalties,
      maxScore: penalties + maxScore,
    };
  }, [selectedTasks, form.category, form.scoring]);

  const hasTitleError = submitAttempted && !form.title.trim();
  const hasCategoryError = submitAttempted && !form.category;
  const hasDurationError =
    submitAttempted &&
    !isCreation &&
    (!Number.isFinite(form.durationMinutes) || form.durationMinutes <= 0);
  // Dejar la rendición vacía es válido incluso al publicar; solo se marca si
  // lo que ya está escrito no cuadra.
  // Las incoherencias del calendario se avisan apenas aparecen, sin esperar a
  // submitAttempted: el desafio se guarda solo, asi que nadie pulsa Guardar y
  // el aviso quedaria invisible justo mientras el autoguardado esta detenido.
  const hasDateError = Boolean(
    !isCreation &&
    form.startsAt &&
    form.endsAt &&
    new Date(form.endsAt) <= new Date(form.startsAt),
  );
  const registrationOrderError = Boolean(
    !isCreation &&
    form.registrationStartsAt &&
    form.registrationEndsAt &&
    new Date(form.registrationEndsAt) <= new Date(form.registrationStartsAt),
  );
  const registrationOverlapError = Boolean(
    !isCreation &&
    !registrationOrderError &&
    form.registrationEndsAt &&
    form.startsAt &&
    new Date(form.registrationEndsAt) >= new Date(form.startsAt),
  );
  const registrationMissingError = Boolean(
    submitAttempted &&
    publishAttempted &&
    !isCreation &&
    (!form.registrationStartsAt || !form.registrationEndsAt),
  );
  const hasRegistrationError =
    registrationOrderError ||
    registrationOverlapError ||
    registrationMissingError;
  const registrationErrorMessage = registrationOrderError
    ? "El cierre de inscripción debe ser posterior a su inicio."
    : registrationOverlapError
      ? "La inscripción debe cerrar antes de que comience la rendición, para dejar la fase de preparación."
      : "La inscripción debe tener inicio y fin.";

  // Guarda solo cuando lo escrito es coherente y difiere de lo guardado. Va al
  // servidor y no a localStorage: el borrador ya vive en la base, así que una
  // copia local solo abriría la puerta a dos versiones distintas del mismo
  // desafío. El botón Guardar sigue ahí para forzarlo.
  useEffect(() => {
    if (isCreation || locked || !resolvedContestId || loading) {
      return;
    }

    const payload = toContestPayload(form, { keepTasks: true });
    const snapshot = JSON.stringify(payload);

    if (snapshot === savedSnapshotRef.current) {
      return;
    }

    if (validationErrors.length > 0) {
      return;
    }

    const timer = window.setTimeout(() => {
      const toastId = `contest-auto-save-${resolvedContestId}`;
      toast.loading("Guardando cambios...", { id: toastId });

      void updateContest(resolvedContestId, payload)
        .then((saved) => {
          savedSnapshotRef.current = snapshot;
          setContestState(saved.state);
          toast.success("Cambios guardados.", {
            id: toastId,
            duration: 1800,
          });
        })
        .catch(() => {
          toast.error(
            "No se pudieron guardar los últimos cambios. Usa Guardar desafío.",
            { id: toastId },
          );
        });
    }, 1200);

    return () => window.clearTimeout(timer);
  }, [
    form,
    isCreation,
    loading,
    locked,
    resolvedContestId,
    validationErrors.length,
  ]);

  const handlePublish = async () => {
    if (locked) {
      return;
    }

    if (!resolvedContestId) {
      toast.error("Primero guarda el desafío antes de publicarla.");
      return;
    }

    setSubmitAttempted(true);
    setPublishAttempted(true);

    if (publishValidationErrors.length > 0) {
      toast.error(publishValidationErrors[0]);
      return;
    }

    setPublishing(true);

    try {
      const savedContest = await updateContest(
        resolvedContestId,
        toContestPayload(form, { keepTasks: true }),
      );
      const publishedContest = await publishContest(savedContest.id);
      const publishedForm = createStateFromContest(publishedContest);

      setForm(publishedForm);
      setContestState(publishedContest.state);
      savedSnapshotRef.current = JSON.stringify(
        toContestPayload(publishedForm, { keepTasks: true }),
      );
      toast.success("El desafío quedó publicado.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo publicar el desafío.",
      );
    } finally {
      setPublishing(false);
    }
  };

  const updateScoring = (
    key: keyof ContestScoring,
    field: "correct" | "wrong",
    nextValue: number,
  ) => {
    if (locked) {
      return;
    }

    setForm((current) => ({
      ...current,
      scoring: {
        ...current.scoring,
        [key]: { ...current.scoring[key], [field]: nextValue },
      },
    }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (locked) {
      return;
    }

    setSubmitAttempted(true);
    setPublishAttempted(false);

    if (validationErrors.length > 0) {
      toast.error(validationErrors[0]);
      return;
    }

    setSaving(true);

    try {
      // Al crear sí van (vacías); al editar se conservan las de su pantalla.
      const payload = toContestPayload(form, {
        keepTasks: Boolean(resolvedContestId),
      });

      const savedContest = resolvedContestId
        ? await updateContest(resolvedContestId, payload)
        : await createContest(payload);

      if (!resolvedContestId) {
        // Al listado, señalando el nuevo: de ahí se decide si se edita ahora.
        window.location.href = `/desafios?creado=${savedContest.id}`;
        return;
      }

      const savedForm = createStateFromContest(savedContest);
      setForm(savedForm);
      setContestState(savedContest.state);
      savedSnapshotRef.current = JSON.stringify(
        toContestPayload(savedForm, { keepTasks: true }),
      );
      toast.success("El desafío se guardó correctamente.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo guardar el desafío.",
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[18rem] items-center justify-center">
        <LoaderCircleIcon className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (notFound) {
    return (
      <Alert>
        <AlertTitle>Desafío no encontrado</AlertTitle>
        <AlertDescription>
          No se pudo cargar el desafío que intentas editar.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <form className="flex min-w-0 flex-col gap-10" onSubmit={handleSubmit}>
      <FormSection
        title="Datos generales"
        description={
          isCreation
            ? "Con estos datos se crea el borrador. El calendario, la duración y las tareas se definen al editarlo."
            : "Nombre y categoría con los que se identifica el desafío."
        }
      >
        <FieldGroup
          className={cn(
            "grid gap-4",
            !isCreation && "md:grid-cols-2 xl:grid-cols-3",
          )}
        >
          <Field data-invalid={hasTitleError || undefined}>
            <FieldLabel htmlFor="contest-title">
              Nombre <span className="text-destructive">*</span>
            </FieldLabel>
            <FieldContent>
              <Input
                id="contest-title"
                aria-invalid={hasTitleError}
                disabled={locked}
                value={form.title}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
                placeholder={defaultContestTitle("")}
              />
            </FieldContent>
          </Field>
          <Field data-invalid={hasCategoryError || undefined}>
            <LabelWithHint
              htmlFor="contest-category"
              required
              hint="Define qué cursos pueden inscribirse y de qué rango de edad sale la dificultad de cada tarea para calcular el puntaje."
            >
              Categoría
            </LabelWithHint>
            <FieldContent>
              <Select
                disabled={locked}
                value={form.category || "none"}
                onValueChange={(value) =>
                  setForm((current) => {
                    const nextCategory = value === "none" ? "" : value;

                    return {
                      ...current,
                      category: nextCategory,
                      title: isGeneratedTitle(current.title, current.category)
                        ? defaultContestTitle(nextCategory)
                        : current.title,
                    };
                  })
                }
              >
                <SelectTrigger
                  id="contest-category"
                  aria-invalid={hasCategoryError}
                  className="w-full"
                >
                  <SelectValue placeholder="Selecciona una categoría" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" disabled={Boolean(form.category)}>
                    Sin categoría
                  </SelectItem>
                  {CONTEST_CATEGORIES.map((category) => (
                    <SelectItem key={category.name} value={category.name}>
                      {category.name} ({category.age})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldContent>
          </Field>
        </FieldGroup>
      </FormSection>

      {!isCreation && (
        <>
          <FormSection
            title="Inscripción"
            hint="Mientras la ventana esté abierta los maestros crean grupos e inscriben participantes. Al cerrarse empieza la preparación, que dura hasta que comienza la rendición."
            description="Cuándo pueden inscribirse los grupos y participantes."
          >
            <FieldGroup className="gap-4">
              <WindowField
                id="contest-registration-window"
                label="Ventana de inscripción"
                hint="Elige un solo día o un rango. La inscripción tiene que cerrar antes de que comience la rendición."
                startsAt={form.registrationStartsAt}
                endsAt={form.registrationEndsAt}
                maxDate={parseDateTimeLocal(form.startsAt)}
                invalid={hasRegistrationError}
                disabled={locked}
                onChange={(nextStartsAt, nextEndsAt) =>
                  setForm((current) => ({
                    ...current,
                    registrationStartsAt: nextStartsAt,
                    registrationEndsAt: nextEndsAt,
                  }))
                }
              />
              {hasRegistrationError && (
                <FieldError errors={[{ message: registrationErrorMessage }]} />
              )}
            </FieldGroup>
          </FormSection>

          <FormSection
            title="Rendición"
            hint="El desafío se abre al alumnado al comenzar esta ventana y se cierra automáticamente al terminarla."
            description="Cuándo se rinde, cuánto tiempo tiene cada equipo y cómo lo rinde."
          >
            <FieldGroup className="gap-4">
              <WindowField
                id="contest-run-window"
                label="Ventana de rendición"
                hint="Elige un solo día o un rango. Dentro de esta ventana cada equipo dispone de su propia duración."
                startsAt={form.startsAt}
                endsAt={form.endsAt}
                minDate={parseDateTimeLocal(form.registrationEndsAt)}
                invalid={hasDateError}
                disabled={locked}
                onChange={(nextStartsAt, nextEndsAt) =>
                  setForm((current) => ({
                    ...current,
                    startsAt: nextStartsAt,
                    endsAt: nextEndsAt,
                  }))
                }
              />
              {hasDateError && (
                <FieldError
                  errors={[
                    {
                      message:
                        "La fecha de fin debe ser posterior a la de inicio.",
                    },
                  ]}
                />
              )}
              <FieldGroup className="grid gap-4 md:grid-cols-2">
                <Field data-invalid={hasDurationError || undefined}>
                  <LabelWithHint
                    htmlFor="contest-duration"
                    required
                    hint="Tiempo de cada equipo dentro de la ventana de rendición. El reloj arranca cuando presiona Empezar, no cuando abre el desafío. El estándar Bebras son 45 minutos."
                  >
                    Duración por equipo (minutos)
                  </LabelWithHint>
                  <FieldContent>
                    <Input
                      id="contest-duration"
                      aria-invalid={hasDurationError}
                      disabled={locked}
                      min={1}
                      type="number"
                      value={String(form.durationMinutes)}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          durationMinutes: Number(event.target.value || 0),
                        }))
                      }
                    />
                  </FieldContent>
                </Field>
                <Field>
                  <LabelWithHint
                    htmlFor="contest-display-mode"
                    hint="Una por una muestra una pregunta a la vez y el estudiante navega entre ellas. Todas juntas las deja en una sola lista, para desplazarse."
                  >
                    Forma de mostrar las preguntas
                  </LabelWithHint>
                  <FieldContent>
                    <Select
                      disabled={locked}
                      value={form.questionDisplayMode}
                      onValueChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          questionDisplayMode:
                            value === "all" ? "all" : "one_by_one",
                        }))
                      }
                    >
                      <SelectTrigger
                        id="contest-display-mode"
                        className="w-full"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="one_by_one">
                          Una por una (con navegación)
                        </SelectItem>
                        <SelectItem value="all">
                          Todas juntas en una lista
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </FieldContent>
                </Field>
              </FieldGroup>
              <Field orientation="horizontal">
                <Checkbox
                  id="contest-allowPairs"
                  checked={form.allowPairs}
                  disabled={locked}
                  onCheckedChange={(checked) =>
                    setForm((current) => ({
                      ...current,
                      allowPairs: checked === true,
                    }))
                  }
                />
                <LabelWithHint
                  htmlFor="contest-allowPairs"
                  hint="Dos estudiantes pueden rendir juntos en un mismo equipo, con un solo intento y un solo puntaje."
                >
                  Permitir parejas
                </LabelWithHint>
              </Field>
              <Field orientation="horizontal">
                <Checkbox
                  id="contest-shuffleOptions"
                  checked={form.shuffleOptions}
                  disabled={locked}
                  onCheckedChange={(checked) =>
                    setForm((current) => ({
                      ...current,
                      shuffleOptions: checked === true,
                    }))
                  }
                />
                <LabelWithHint
                  htmlFor="contest-shuffleOptions"
                  hint="En las preguntas de opción múltiple, cada equipo ve las opciones en otro orden. Cada opción conserva su letra, así la solución sigue diciendo la misma."
                >
                  Mezclar el orden de las opciones
                </LabelWithHint>
              </Field>
            </FieldGroup>
          </FormSection>

          <FormSection
            title="Puntuación"
            hint="La dificultad de cada tarea sale de la que le pusiste al rango de edad de esta categoría, en el formulario de la tarea. Los puntajes arrancan en los de Bebras y puedes cambiarlos."
            description="Cuánto suma o resta cada tarea según su dificultad."
            action={
              !locked &&
              !isStandardScoring(form.scoring) && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setForm((current) => ({
                      ...current,
                      scoring: defaultContestScoring(),
                    }))
                  }
                >
                  <RotateCcwIcon data-icon="inline-start" />
                  Restablecer
                </Button>
              )
            }
          >
            <div className="flex flex-col gap-4">
              <div className="grid gap-3 sm:grid-cols-3">
                {DIFFICULTY_KEYS.map((key) => (
                  <div
                    key={key}
                    className="flex flex-col gap-3 rounded-sm border px-4 py-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">
                        {BEBRAS_SCORING[key].label}
                      </span>
                      <Badge variant="secondary">
                        {scoreSummary.counts[key]} tarea(s)
                      </Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <ScoreInput
                        id={`score-correct-${key}`}
                        label="Correcta"
                        difficulty={BEBRAS_SCORING[key].label}
                        value={form.scoring[key].correct}
                        disabled={locked}
                        onChange={(nextValue) =>
                          updateScoring(key, "correct", nextValue)
                        }
                      />
                      <ScoreInput
                        id={`score-wrong-${key}`}
                        label="Incorrecta"
                        difficulty={BEBRAS_SCORING[key].label}
                        value={form.scoring[key].wrong}
                        disabled={locked}
                        onChange={(nextValue) =>
                          updateScoring(key, "wrong", nextValue)
                        }
                      />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Sin responder 0
                    </p>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-6 rounded-sm bg-secondary/30 px-4 py-3 text-sm">
                <div>
                  <div className="text-muted-foreground">Puntaje inicial</div>
                  <div className="text-lg font-semibold">
                    {scoreSummary.initialScore}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Puntaje máximo</div>
                  <div className="text-lg font-semibold">
                    {scoreSummary.maxScore}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Puntaje mínimo</div>
                  <div className="text-lg font-semibold">0</div>
                </div>
              </div>

              {scoreSummary.unresolved > 0 && (
                <Alert variant="destructive">
                  <AlertTitle>
                    {scoreSummary.unresolved} tarea(s) sin dificultad para esta
                    categoría
                  </AlertTitle>
                  <AlertDescription>
                    Cada tarea necesita una dificultad asignada al rango de edad
                    de {form.category || "la categoría elegida"}. Edítalas o
                    quítalas del desafío.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          </FormSection>

          <FormSection
            title="Al terminar"
            hint="Se aplica en cuanto el equipo entrega. Los resultados oficiales del desafío se publican aparte, cuando lo consolidas."
            description="Qué ve el equipo en la pantalla final."
          >
            <FieldGroup className="gap-4">
              {RESULT_TOGGLES.map((toggle) => (
                <Field key={toggle.key} orientation="horizontal">
                  <Checkbox
                    id={`contest-${toggle.key}`}
                    checked={form[toggle.key]}
                    disabled={locked}
                    onCheckedChange={(checked) =>
                      setForm((current) => ({
                        ...current,
                        [toggle.key]: checked === true,
                      }))
                    }
                  />
                  <LabelWithHint
                    htmlFor={`contest-${toggle.key}`}
                    hint={toggle.hint}
                  >
                    {toggle.label}
                  </LabelWithHint>
                </Field>
              ))}
            </FieldGroup>
          </FormSection>
        </>
      )}

      {submitAttempted &&
        (publishAttempted
          ? publishValidationErrors.length > 0
          : validationErrors.length > 0) && (
          <Alert variant="destructive">
            <AlertTitle>Faltan datos</AlertTitle>
            <AlertDescription>
              {
                (publishAttempted
                  ? publishValidationErrors
                  : validationErrors)[0]
              }
            </AlertDescription>
          </Alert>
        )}

      {locked && (
        <Alert>
          <AlertTitle>Este desafío ya no se puede modificar</AlertTitle>
          <AlertDescription>
            {contestState === "abierta"
              ? "Está en curso. Cambiar las tareas o los puntajes ahora afectaría a los estudiantes que están rindiendo."
              : "Ya terminó. Sus tareas y puntajes quedan como registro de lo que se rindió."}
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-4 border-t pt-5 md:flex-row md:items-center md:justify-between">
        {!isCreation && (
          <div className="text-sm text-muted-foreground">
            {form.tasks.length} tarea(s) seleccionada(s).{" "}
            {validationErrors.length > 0
              ? "El autoguardado está en pausa hasta corregir lo marcado en rojo."
              : "Los cambios se guardan solos."}
          </div>
        )}
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap md:ml-auto">
          <Button
            type="submit"
            disabled={saving || locked}
            className="w-full sm:w-auto"
          >
            <SaveIcon data-icon="inline-start" />
            {saving
              ? "Guardando..."
              : isCreation
                ? "Crear desafío"
                : "Guardar desafío"}
          </Button>
          {!isCreation && form.tasks.length > 0 && (
            <Button
              asChild
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
            >
              <a href={`/desafios/probar?id=${resolvedContestId}`}>
                <PlayIcon data-icon="inline-start" />
                Probar preguntas
              </a>
            </Button>
          )}
          {!isCreation && (
            <Button
              type="button"
              variant="secondary"
              disabled={saving || publishing || locked}
              className="w-full sm:w-auto"
              onClick={handlePublish}
            >
              {publishing ? "Publicando..." : "Publicar desafío"}
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}
