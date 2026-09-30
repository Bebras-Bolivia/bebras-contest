"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ClockIcon,
  CopyIcon,
  EyeIcon,
  LinkIcon,
  LoaderCircleIcon,
  PlusIcon,
  XIcon,
  UsersIcon,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import {
  CONTEST_CATEGORIES,
  CONTEST_STATE_LABELS,
  difficultyBadgeClass,
  difficultyLabel,
  formatContestWindow,
} from "@/lib/contest-schema";
import {
  createPractice,
  listPracticeTasks,
  listPractices,
  removePractice,
  type PracticeTask,
  type StoredPractice,
} from "@/lib/practices-api";
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
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { TaskContentRenderer } from "@/components/task-content-renderer";
import { getPracticeTask } from "@/lib/practice-api";
import type { PlayTask } from "@/lib/play-api";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** `datetime-local` trabaja en hora local sin zona; el input la necesita así. */
function toLocalInput(date: Date) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function fromLocalInput(value: string) {
  return value ? new Date(value).toISOString() : null;
}

type FormErrors = {
  title?: string;
  category?: string;
  durationMinutes?: string;
  window?: string;
  tasks?: string;
  form?: string;
};

export function PracticesHome() {
  const [practices, setPractices] = useState<StoredPractice[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<StoredPractice | null>(null);

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("20");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [pool, setPool] = useState<PracticeTask[]>([]);
  const [poolLoading, setPoolLoading] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [errors, setErrors] = useState<FormErrors>({});

  const [preview, setPreview] = useState<PracticeTask | null>(null);
  const [previewTask, setPreviewTask] = useState<PlayTask | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  // El enunciado solo se pide cuando alguien lo abre, y una sola vez.
  const previewCache = useRef(new Map<string, PlayTask>());

  const titleRef = useRef<HTMLInputElement>(null);
  const categoryRef = useRef<HTMLButtonElement>(null);
  const durationRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;

    void listPractices()
      .then((loaded) => {
        if (active) setPractices(loaded);
      })
      .catch((error: unknown) => {
        toast.error(
          error instanceof Error
            ? error.message
            : "No se pudieron cargar tus prácticas.",
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  // Cada categoría tiene su propio conjunto liberado: al cambiarla, la
  // selección anterior deja de ser válida.
  useEffect(() => {
    if (!category) {
      setPool([]);
      setPicked([]);
      return;
    }

    let active = true;
    setPoolLoading(true);
    setPicked([]);

    void listPracticeTasks(category)
      .then((data) => {
        if (active) setPool(data.tasks);
      })
      .catch((error: unknown) => {
        if (active) setPool([]);
        toast.error(
          error instanceof Error
            ? error.message
            : "No se pudieron cargar las preguntas.",
        );
      })
      .finally(() => {
        if (active) setPoolLoading(false);
      });

    return () => {
      active = false;
    };
  }, [category]);

  const resetForm = () => {
    const now = new Date();
    setTitle("");
    setCategory("");
    setDurationMinutes("20");
    setStartsAt(toLocalInput(new Date(now.getTime() + 15 * 60000)));
    setEndsAt(toLocalInput(new Date(now.getTime() + 75 * 60000)));
    setPool([]);
    setPicked([]);
    setErrors({});
  };

  const openPreview = (task: PracticeTask) => {
    setPreview(task);

    const cached = previewCache.current.get(task.id);
    if (cached) {
      setPreviewTask(cached);
      return;
    }

    setPreviewTask(null);
    setPreviewLoading(true);
    void getPracticeTask(task.id)
      .then((loaded) => {
        previewCache.current.set(task.id, loaded);
        setPreviewTask(loaded);
      })
      .catch((error: unknown) => {
        toast.error(
          error instanceof Error
            ? error.message
            : "No se pudo cargar la pregunta.",
        );
        setPreview(null);
      })
      .finally(() => setPreviewLoading(false));
  };

  const togglePicked = (taskId: string) => {
    setPicked((current) =>
      current.includes(taskId)
        ? current.filter((id) => id !== taskId)
        : [...current, taskId],
    );
    if (errors.tasks) {
      setErrors((current) => ({ ...current, tasks: undefined }));
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const minutes = Number(durationMinutes);
    const next: FormErrors = {
      title: title.trim() ? undefined : "Ponle un nombre.",
      category: category ? undefined : "Elige una categoría.",
      durationMinutes:
        Number.isInteger(minutes) && minutes > 0
          ? undefined
          : "Debe ser un número de minutos mayor que cero.",
      tasks: picked.length > 0 ? undefined : "Elige al menos una pregunta.",
    };

    if (!startsAt || !endsAt) {
      next.window = "Elige cuándo empieza y cuándo termina.";
    } else if (new Date(endsAt) <= new Date(startsAt)) {
      next.window = "El cierre debe ser posterior al inicio.";
    }

    const firstInvalid = (
      ["title", "category", "durationMinutes", "window", "tasks"] as const
    ).find((field) => next[field]);

    if (firstInvalid) {
      setErrors(next);
      if (firstInvalid === "title") titleRef.current?.focus();
      if (firstInvalid === "category") categoryRef.current?.focus();
      if (firstInvalid === "durationMinutes") durationRef.current?.focus();
      return;
    }

    setErrors({});
    setCreating(true);

    try {
      const created = await createPractice({
        title: title.trim(),
        category,
        durationMinutes: minutes,
        startsAt: fromLocalInput(startsAt),
        endsAt: fromLocalInput(endsAt),
        tasks: picked,
      });
      setPractices((current) => [created, ...current]);
      setCreateOpen(false);
      toast.success(
        "Práctica creada. Comparte su código: tus estudiantes entran con él y su nombre.",
      );
    } catch (error) {
      setErrors({
        form:
          error instanceof Error
            ? error.message
            : "No se pudo crear la práctica.",
      });
    } finally {
      setCreating(false);
    }
  };

  const copy = async (value: string, done: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(done);
    } catch {
      toast.error("No se pudo copiar.");
    }
  };

  const confirmDelete = () => {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);

    void removePractice(target.id)
      .then(() => {
        setPractices((current) =>
          current.filter((item) => item.id !== target.id),
        );
        toast.success("Práctica eliminada.");
      })
      .catch((error: unknown) => {
        toast.error(
          error instanceof Error ? error.message : "No se pudo eliminar.",
        );
      });
  };

  if (loading) {
    return (
      <div className="flex min-h-72 items-center justify-center">
        <LoaderCircleIcon className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-8">
      <div className="flex flex-col gap-4 border-b pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h1 className="font-heading text-3xl font-semibold tracking-tight">
            Mis prácticas
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
            Arma un desafío de práctica con las preguntas que el organizador
            liberó. Solo tú lo ves, y tus estudiantes entran con el código de
            la práctica y su nombre.
          </p>
        </div>
        <Dialog
          open={createOpen}
          onOpenChange={(open) => {
            setCreateOpen(open);
            if (open) resetForm();
          }}
        >
          <DialogTrigger asChild>
            <Button className="shrink-0">
              <PlusIcon data-icon="inline-start" />
              Nueva práctica
            </Button>
          </DialogTrigger>
          <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Nueva práctica</DialogTitle>
              <DialogDescription>
                Elige la categoría y las preguntas. El resto queda con los
                puntajes estándar y la retroalimentación encendida.
              </DialogDescription>
            </DialogHeader>
            <form
              id="practice-form"
              className="flex min-h-0 flex-col gap-4 overflow-y-auto"
              onSubmit={submit}
              aria-busy={creating}
              noValidate
            >
              {errors.form && (
                <Alert variant="destructive">
                  <AlertDescription>{errors.form}</AlertDescription>
                </Alert>
              )}

              <Field data-invalid={Boolean(errors.title) || undefined}>
                <FieldLabel htmlFor="practice-title">Nombre</FieldLabel>
                <FieldContent>
                  <Input
                    ref={titleRef}
                    id="practice-title"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="Ej. Repaso del viernes"
                    aria-invalid={Boolean(errors.title)}
                  />
                  <FieldError>{errors.title}</FieldError>
                </FieldContent>
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field data-invalid={Boolean(errors.category) || undefined}>
                  <FieldLabel htmlFor="practice-category">Categoría</FieldLabel>
                  <FieldContent>
                    <Select value={category} onValueChange={setCategory}>
                      <SelectTrigger
                        ref={categoryRef}
                        id="practice-category"
                        aria-invalid={Boolean(errors.category)}
                      >
                        <SelectValue placeholder="Elige una" />
                      </SelectTrigger>
                      <SelectContent>
                        {CONTEST_CATEGORIES.map((item) => (
                          <SelectItem key={item.name} value={item.name}>
                            {item.name} ({item.age})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldError>{errors.category}</FieldError>
                  </FieldContent>
                </Field>

                <Field
                  data-invalid={Boolean(errors.durationMinutes) || undefined}
                >
                  <FieldLabel htmlFor="practice-duration">
                    Duración (minutos)
                  </FieldLabel>
                  <FieldContent>
                    <Input
                      ref={durationRef}
                      id="practice-duration"
                      type="number"
                      min={1}
                      value={durationMinutes}
                      onChange={(event) =>
                        setDurationMinutes(event.target.value)
                      }
                      aria-invalid={Boolean(errors.durationMinutes)}
                    />
                    <FieldError>{errors.durationMinutes}</FieldError>
                  </FieldContent>
                </Field>
              </div>

              <Field data-invalid={Boolean(errors.window) || undefined}>
                <FieldLabel htmlFor="practice-starts">Horario</FieldLabel>
                <FieldContent>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Input
                      id="practice-starts"
                      type="datetime-local"
                      value={startsAt}
                      onChange={(event) => setStartsAt(event.target.value)}
                      aria-label="Inicio"
                    />
                    <Input
                      id="practice-ends"
                      type="datetime-local"
                      value={endsAt}
                      onChange={(event) => setEndsAt(event.target.value)}
                      aria-label="Cierre"
                    />
                  </div>
                  <FieldDescription>
                    Tus estudiantes solo pueden entrar dentro de esta ventana.
                  </FieldDescription>
                  <FieldError>{errors.window}</FieldError>
                </FieldContent>
              </Field>

              <Field data-invalid={Boolean(errors.tasks) || undefined}>
                <FieldLabel htmlFor="practice-tasks">
                  Preguntas {picked.length > 0 && `(${picked.length} elegidas)`}
                </FieldLabel>
                <FieldContent>
                  <div
                    id="practice-tasks"
                    className="flex max-h-64 flex-col overflow-y-auto rounded-md border"
                  >
                    {!category ? (
                      <p className="p-3 text-sm text-muted-foreground">
                        Elige una categoría para ver las preguntas disponibles.
                      </p>
                    ) : poolLoading ? (
                      <p className="p-3 text-sm text-muted-foreground">
                        Cargando preguntas...
                      </p>
                    ) : pool.length === 0 ? (
                      <p className="p-3 text-sm text-muted-foreground">
                        El organizador todavía no liberó preguntas para esta
                        categoría.
                      </p>
                    ) : (
                      pool.map((task) => {
                        const active = picked.includes(task.id);
                        return (
                          <div
                            key={task.id}
                            className={cn(
                              "flex items-center justify-between gap-2 border-b px-3 py-2 text-sm transition last:border-b-0",
                              active ? "bg-muted" : "hover:bg-muted/60",
                            )}
                          >
                            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                              <input
                                type="checkbox"
                                checked={active}
                                onChange={() => togglePicked(task.id)}
                                className="size-4 shrink-0"
                              />
                              <span className="min-w-0 break-words">
                                {task.title}
                              </span>
                            </label>
                            <div className="flex shrink-0 items-center gap-1.5">
                              <Badge
                                variant="outline"
                                className={difficultyBadgeClass(
                                  task.difficulty,
                                )}
                              >
                                {difficultyLabel(task.difficulty)}
                              </Badge>
                              <Button
                                size="icon-sm"
                                type="button"
                                variant="ghost"
                                aria-label={`Ver la pregunta ${task.title}`}
                                onClick={() => openPreview(task)}
                              >
                                <EyeIcon />
                              </Button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                  <FieldError>{errors.tasks}</FieldError>
                </FieldContent>
              </Field>
            </form>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={creating}
                onClick={() => setCreateOpen(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" form="practice-form" disabled={creating}>
                {creating ? "Creando..." : "Crear práctica"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <ol className="flex flex-col gap-2 rounded-md border bg-muted/40 p-4 text-sm sm:flex-row sm:gap-6">
        {[
          "Creas la práctica y eliges sus preguntas.",
          "Compartes su código con tu curso.",
          "Cada estudiante lo escribe, pone su nombre y entra. Sin que inscribas a nadie.",
        ].map((step, index) => (
          <li key={step} className="flex min-w-0 flex-1 items-start gap-2">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background">
              {index + 1}
            </span>
            <span className="min-w-0 text-muted-foreground">{step}</span>
          </li>
        ))}
      </ol>

      {practices.length === 0 ? (
        <Alert>
          <AlertTitle>Todavía no tienes prácticas</AlertTitle>
          <AlertDescription>
            Crea una para que tus estudiantes practiquen antes del desafío. Solo
            tú la ves.
          </AlertDescription>
        </Alert>
      ) : (
        <ul className="flex flex-col border-b">
          {practices.map((practice) => (
            <li key={practice.id} className="border-t">
              <div className="flex flex-col gap-3 py-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex min-w-0 flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{practice.category}</Badge>
                    <Badge variant="outline">
                      {CONTEST_STATE_LABELS[practice.state] ?? practice.state}
                    </Badge>
                  </div>
                  <h2 className="break-words text-lg font-semibold">
                    {practice.title}
                  </h2>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <ClockIcon className="size-4 shrink-0" />
                      {practice.durationMinutes} min · {practice.taskCount}{" "}
                      pregunta(s)
                    </span>
                    <span className="flex items-center gap-1.5">
                      <UsersIcon className="size-4 shrink-0" />
                      {practice.groupCount} grupo(s) · {practice.studentCount}{" "}
                      estudiante(s)
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Horario:{" "}
                    {formatContestWindow(practice.startsAt, practice.endsAt)}
                  </p>
                </div>

                <div className="grid w-full shrink-0 gap-2 lg:w-72 lg:grid-cols-2">
                  {practice.accessCode && (
                    <>
                      <div className="flex w-full items-center justify-between gap-2 rounded-md border bg-background px-3 py-2 lg:col-span-2">
                        <span className="font-mono text-lg font-semibold tracking-widest">
                          {practice.accessCode}
                        </span>
                        <Button
                          size="icon-sm"
                          type="button"
                          variant="outline"
                          aria-label="Copiar código"
                          onClick={() =>
                            void copy(
                              practice.accessCode!,
                              `Código copiado: ${practice.accessCode}`,
                            )
                          }
                        >
                          <CopyIcon />
                        </Button>
                      </div>
                      <Button
                        size="sm"
                        type="button"
                        variant="outline"
                        className="w-full justify-start lg:col-span-2"
                        onClick={() =>
                          void copy(
                            `${window.location.origin}/entrar?code=${practice.accessCode}`,
                            "Enlace copiado. Compártelo con tu curso.",
                          )
                        }
                      >
                        <LinkIcon data-icon="inline-start" />
                        Copiar enlace
                      </Button>
                    </>
                  )}
                  <Button asChild size="sm" variant="outline">
                    <a href="/grupos">Ver quién entró</a>
                  </Button>
                  <Button
                    size="sm"
                    type="button"
                    variant="outline"
                    onClick={() => setDeleting(practice)}
                  >
                    <XIcon data-icon="inline-start" />
                    Eliminar
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Anidado dentro del de crear: dejar la selección intacta detrás es lo
          que hace útil poder mirar el enunciado antes de decidir. */}
      <Dialog
        open={preview !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPreview(null);
            setPreviewTask(null);
          }
        }}
      >
        <DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="break-words">
              {preview?.title ?? ""}
            </DialogTitle>
            <DialogDescription>
              {preview
                ? `Dificultad ${difficultyLabel(preview.difficulty).toLowerCase()} para esta categoría. Así la verá tu estudiante.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
            {previewLoading || !previewTask ? (
              <div className="flex min-h-40 items-center justify-center">
                <LoaderCircleIcon className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <TaskContentRenderer
                  blocks={previewTask.bodyBlocks}
                  className="gap-4"
                />
                {previewTask.challengeBlocks.length > 0 && (
                  <TaskContentRenderer
                    blocks={previewTask.challengeBlocks}
                    className="gap-4"
                  />
                )}
              </>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPreview(null)}
            >
              Cerrar
            </Button>
            {preview && (
              <Button type="button" onClick={() => togglePicked(preview.id)}>
                {picked.includes(preview.id)
                  ? "Quitar de la práctica"
                  : "Agregar a la práctica"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar esta práctica?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting
                ? `Se borrarán también sus grupos${
                    deleting.studentCount > 0
                      ? `, sus ${deleting.studentCount} estudiante(s) inscrito(s)`
                      : ""
                  } y lo que hayan respondido. No se puede deshacer.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
