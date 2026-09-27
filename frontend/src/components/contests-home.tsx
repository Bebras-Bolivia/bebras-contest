"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  AlarmClockIcon,
  BarChart3Icon,
  CalculatorIcon,
  CalendarRangeIcon,
  FilePlus2Icon,
  FilePenLineIcon,
  ListChecksIcon,
  PauseIcon,
  PlayIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";

import {
  consolidateContest,
  createContest,
  listContests,
  removeContest,
  resumeContest,
  suspendContest,
} from "@/lib/contests-api";
import {
  CONTEST_CATEGORIES,
  CONTEST_STATE_LABELS,
  defaultContestScoring,
  formatContestWindow,
  type ContestDraftInput,
  type StoredContest,
} from "@/lib/contest-schema";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
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

/** Un desafío nace solo con nombre y categoría; el resto se define al editarlo. */
function emptyContestDraft(): ContestDraftInput {
  return {
    title: "",
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

function defaultContestTitle(category: string) {
  const year = new Date().getFullYear();
  return category
    ? `Desafío Bebras ${year} - ${category}`
    : `Desafío Bebras ${year}`;
}

function isGeneratedTitle(title: string, category: string) {
  return !title.trim() || title === defaultContestTitle(category);
}

type ConfirmAction = "suspend" | "resume" | "consolidate" | "delete";

type Confirmation = {
  action: ConfirmAction;
  contest: StoredContest;
};

const CONFIRMATION_COPY: Record<
  ConfirmAction,
  {
    title: string;
    description: (contest: StoredContest) => string;
    confirm: string;
  }
> = {
  suspend: {
    title: "¿Suspender este desafío?",
    description: () =>
      "Nadie podrá empezar ni responder mientras esté suspendida, y el tiempo de quienes ya están rindiendo queda en pausa.",
    confirm: "Suspender",
  },
  resume: {
    title: "¿Reanudar este desafío?",
    description: () =>
      "Se habilita de nuevo y a cada equipo que estaba rindiendo se le devuelve el tiempo que estuvo en pausa.",
    confirm: "Reanudar",
  },
  consolidate: {
    title: "¿Consolidar este desafío?",
    description: () =>
      "Se cerrarán los intentos que continúen abiertos y se calcularán los resultados definitivos.",
    confirm: "Consolidar",
  },
  delete: {
    title: "¿Eliminar este desafío?",
    description: (contest) =>
      `Se eliminará "${contest.title}" y sus grupos, equipos y resultados. Esta acción no se puede deshacer.`,
    confirm: "Eliminar",
  },
};

export function ContestsHome() {
  const [contests, setContests] = useState<StoredContest[]>([]);
  const [confirming, setConfirming] = useState<Confirmation | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Desafío recién creado: se marca un momento para saber cuál es y decidir
  // si se edita ahora, en vez de caer de golpe en su edición.
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState(() => defaultContestTitle(""));
  const [newCategory, setNewCategory] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  const replaceContest = (updated: StoredContest) => {
    setContests((current) =>
      current.map((contest) => (contest.id === updated.id ? updated : contest)),
    );
  };

  const runAction = async (
    contest: StoredContest,
    action: () => Promise<StoredContest>,
    successMessage: (updated: StoredContest) => string,
  ) => {
    setBusyId(contest.id);

    try {
      const updated = await action();
      replaceContest(updated);
      toast.success(successMessage(updated));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo completar la acción.",
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleSuspend = (contest: StoredContest) =>
    runAction(
      contest,
      () => suspendContest(contest.id),
      () => "Desafío suspendido. El tiempo quedó en pausa.",
    );

  const handleResume = (contest: StoredContest) =>
    runAction(
      contest,
      () => resumeContest(contest.id),
      (updated) => {
        const resumed = (
          updated as StoredContest & { resumedAttempts?: number }
        ).resumedAttempts;
        return resumed
          ? `Desafío reanudado. Se devolvió el tiempo a ${resumed} intento(s).`
          : "Desafío reanudado.";
      },
    );

  const handleConsolidate = (contest: StoredContest) =>
    runAction(
      contest,
      () => consolidateContest(contest.id),
      (updated) => {
        const closed = (updated as StoredContest & { closedAttempts?: number })
          .closedAttempts;
        return closed
          ? `Desafío consolidado. Se cerraron ${closed} intento(s) vencido(s).`
          : "Desafío consolidado. Puntajes y ranking al día.";
      },
    );

  useEffect(() => {
    let active = true;

    void listContests()
      .then((loadedContests) => {
        if (!active) {
          return;
        }

        setContests(loadedContests);
      })
      .catch((error) => {
        toast.error(
          error instanceof Error
            ? error.message
            : "No se pudieron cargar los desafíos.",
        );
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const created = params.get("creado");

    if (!created) {
      return;
    }

    setCreatedId(created);
    // Fuera de la URL: recargar no debería volver a resaltarlo.
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  useEffect(() => {
    if (!createdId || contests.length === 0) {
      return;
    }

    const row = document.getElementById(`contest-${createdId}`);

    if (!row) {
      setCreatedId(null);
      return;
    }

    row.scrollIntoView({ behavior: "smooth", block: "center" });

    // Un fotograma para que el realce entre con transición, no de golpe.
    const enter = window.requestAnimationFrame(() => setHighlighted(true));
    const leave = window.setTimeout(() => setHighlighted(false), 2600);
    const clear = window.setTimeout(() => setCreatedId(null), 4000);

    return () => {
      window.cancelAnimationFrame(enter);
      window.clearTimeout(leave);
      window.clearTimeout(clear);
    };
  }, [createdId, contests.length]);

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!newTitle.trim()) {
      setCreateError("El nombre del desafío es obligatorio.");
      return;
    }

    if (!newCategory) {
      setCreateError("Elige la categoría del desafío.");
      return;
    }

    setCreating(true);
    setCreateError(null);

    try {
      const created = await createContest({
        ...emptyContestDraft(),
        title: newTitle.trim(),
        category: newCategory,
      });

      // Entra arriba de la lista y se resalta: de ahí se decide si se edita.
      setContests((current) => [created, ...current]);
      setCreatedId(created.id);
      setCreateOpen(false);
      setNewTitle(defaultContestTitle(""));
      setNewCategory("");
      toast.success("Desafío creado. Ya puedes programarlo.");
    } catch (error) {
      setCreateError(
        error instanceof Error ? error.message : "No se pudo crear el desafío.",
      );
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = (contest: StoredContest) => {
    setBusyId(contest.id);
    void removeContest(contest.id)
      .then(() => {
        setContests((current) =>
          current.filter((currentContest) => currentContest.id !== contest.id),
        );
        toast.success("El desafío se eliminó correctamente.");
      })
      .catch((error) => {
        toast.error(
          error instanceof Error
            ? error.message
            : "No se pudo eliminar el desafío.",
        );
      })
      .finally(() => {
        setBusyId(null);
      });
  };

  const confirmAction = () => {
    if (!confirming) {
      return;
    }

    const { action, contest } = confirming;
    setConfirming(null);

    if (action === "suspend") {
      void handleSuspend(contest);
    } else if (action === "resume") {
      void handleResume(contest);
    } else if (action === "consolidate") {
      void handleConsolidate(contest);
    } else {
      handleDelete(contest);
    }
  };

  return (
    <div className="flex w-full flex-col gap-8">
      <div className="flex flex-col gap-4 border-b pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h1 className="font-heading text-3xl font-semibold tracking-tight">
            Desafíos
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
            Programa las fases de cada desafío, elige sus tareas y sigue su
            estado.
          </p>
        </div>
        {/* Son dos campos: el modal deja la lista a la vista y el desafío nuevo
            aparece arriba en cuanto se crea. */}
        <Dialog
          open={createOpen}
          onOpenChange={(open) => {
            setCreateOpen(open);
            if (!open) {
              setCreateError(null);
            }
          }}
        >
          <DialogTrigger asChild>
            <Button className="shrink-0">
              <FilePlus2Icon data-icon="inline-start" />
              Nuevo desafío
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Nuevo desafío</DialogTitle>
              <DialogDescription>
                Con esto se crea el borrador. El calendario, la duración y las
                tareas se definen al editarlo.
              </DialogDescription>
            </DialogHeader>
            <form
              className="flex flex-col gap-4 pt-2"
              onSubmit={handleCreate}
              aria-busy={creating}
              noValidate
            >
              {createError && (
                <Alert variant="destructive">
                  <AlertDescription>{createError}</AlertDescription>
                </Alert>
              )}
              <Field>
                <FieldLabel htmlFor="new-contest-title">
                  Nombre <span className="text-destructive">*</span>
                </FieldLabel>
                <FieldContent>
                  <Input
                    id="new-contest-title"
                    value={newTitle}
                    disabled={creating}
                    placeholder={defaultContestTitle("")}
                    onChange={(event) => {
                      setNewTitle(event.target.value);
                      setCreateError(null);
                    }}
                  />
                </FieldContent>
              </Field>
              <Field>
                <FieldLabel htmlFor="new-contest-category">
                  Categoría <span className="text-destructive">*</span>
                </FieldLabel>
                <FieldContent>
                  <Select
                    value={newCategory || undefined}
                    disabled={creating}
                    onValueChange={(value) => {
                      setNewCategory(value);
                      setCreateError(null);
                      setNewTitle((current) =>
                        isGeneratedTitle(current, newCategory)
                          ? defaultContestTitle(value)
                          : current,
                      );
                    }}
                  >
                    <SelectTrigger id="new-contest-category" className="w-full">
                      <SelectValue placeholder="Selecciona una categoría" />
                    </SelectTrigger>
                    <SelectContent>
                      {CONTEST_CATEGORIES.map((category) => (
                        <SelectItem key={category.name} value={category.name}>
                          {category.name} ({category.age})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FieldContent>
              </Field>
              <DialogFooter>
                <Button type="submit" disabled={creating}>
                  <FilePlus2Icon data-icon="inline-start" />
                  {creating ? "Creando..." : "Crear desafío"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {contests.length === 0 ? (
        <Alert>
          <AlertTitle>No hay desafíos registrados</AlertTitle>
          <AlertDescription>
            Crea el primer desafío y asígnale tareas para arrancar el flujo.
          </AlertDescription>
        </Alert>
      ) : (
        <ul className="divide-y border-y">
          {contests.map((contest) => (
            <li
              key={contest.id}
              id={`contest-${contest.id}`}
              className={cn(
                "flex min-w-0 flex-col gap-4 px-3 py-5 transition-colors duration-700 lg:flex-row lg:items-start lg:justify-between lg:gap-8",
                createdId === contest.id && highlighted
                  ? "bg-primary/10"
                  : "bg-transparent",
              )}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold break-words">
                    {contest.title}
                  </h2>
                  <Badge variant="secondary">
                    {CONTEST_STATE_LABELS[contest.state]}
                  </Badge>
                  {contest.category && (
                    <Badge variant="outline">{contest.category}</Badge>
                  )}
                  {createdId === contest.id && <Badge>Recién creado</Badge>}
                </div>
                <div className="flex flex-col gap-1 text-sm text-muted-foreground">
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <CalendarRangeIcon className="size-4 shrink-0" />
                    Inscripción:{" "}
                    {contest.registrationStartsAt && contest.registrationEndsAt
                      ? formatContestWindow(
                          contest.registrationStartsAt,
                          contest.registrationEndsAt,
                        )
                      : "sin definir"}
                  </span>
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <PlayIcon className="size-4 shrink-0" />
                    Rendición:{" "}
                    {formatContestWindow(contest.startsAt, contest.endsAt)}
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-2">
                    <AlarmClockIcon className="size-4" />
                    {contest.durationMinutes} min por equipo
                  </span>
                  <span>{contest.taskCount} tarea(s)</span>
                  <span>
                    {contest.allowPairs ? "Permite parejas" : "Solo individual"}
                  </span>
                </div>
              </div>

              <div className="grid w-full shrink-0 gap-2 lg:w-72 lg:grid-cols-2">
                {[
                  "abierta",
                  "suspendida",
                  "cerrada",
                  "consolidada",
                  "publicada",
                ].includes(contest.state) && (
                  <Button
                    asChild
                    size="sm"
                    variant="outline"
                    className="w-full justify-start"
                  >
                    <a href={`/desafios/resultados?id=${contest.id}`}>
                      <BarChart3Icon data-icon="inline-start" />
                      Resultados
                    </a>
                  </Button>
                )}
                {contest.state === "abierta" && (
                  <Button
                    size="sm"
                    type="button"
                    variant="outline"
                    disabled={busyId === contest.id}
                    className="w-full justify-start"
                    onClick={() =>
                      setConfirming({ action: "suspend", contest })
                    }
                  >
                    <PauseIcon data-icon="inline-start" />
                    Suspender
                  </Button>
                )}
                {contest.state === "suspendida" && (
                  <Button
                    size="sm"
                    type="button"
                    disabled={busyId === contest.id}
                    className="w-full justify-start"
                    onClick={() => setConfirming({ action: "resume", contest })}
                  >
                    <PlayIcon data-icon="inline-start" />
                    Reanudar
                  </Button>
                )}
                {contest.state === "cerrada" && (
                  <Button
                    size="sm"
                    type="button"
                    disabled={busyId === contest.id}
                    className="w-full justify-start"
                    onClick={() =>
                      setConfirming({ action: "consolidate", contest })
                    }
                  >
                    <CalculatorIcon data-icon="inline-start" />
                    Consolidar
                  </Button>
                )}
                <Button
                  asChild
                  size="sm"
                  variant="outline"
                  className="w-full justify-start"
                >
                  <a href={`/desafios/preguntas?id=${contest.id}`}>
                    <ListChecksIcon data-icon="inline-start" />
                    Preguntas
                  </a>
                </Button>
                <Button
                  asChild
                  size="sm"
                  variant="outline"
                  className="w-full justify-start"
                >
                  <a href={`/desafios/editar?id=${contest.id}`}>
                    <FilePenLineIcon data-icon="inline-start" />
                    Ajustes
                  </a>
                </Button>
                <Button
                  size="sm"
                  type="button"
                  variant="outline"
                  disabled={busyId === contest.id}
                  className="w-full justify-start"
                  onClick={() => setConfirming({ action: "delete", contest })}
                >
                  <Trash2Icon data-icon="inline-start" />
                  Eliminar
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) {
            setConfirming(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirming ? CONFIRMATION_COPY[confirming.action].title : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirming
                ? CONFIRMATION_COPY[confirming.action].description(
                    confirming.contest,
                  )
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmAction}>
              {confirming ? CONFIRMATION_COPY[confirming.action].confirm : ""}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
