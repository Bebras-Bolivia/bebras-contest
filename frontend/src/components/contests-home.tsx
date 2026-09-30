"use client";

import { useEffect, useState } from "react";
import {
  BarChart3Icon,
  CalculatorIcon,
  FilePenLineIcon,
  FilePlus2Icon,
  ListChecksIcon,
  LoaderCircleIcon,
  PauseIcon,
  PlayCircleIcon,
  PlayIcon,
  XIcon,
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
  CATEGORY_NAMES,
  CONTEST_STATE_LABELS,
  defaultContestScoring,
  formatContestWindow,
  type ContestState,
  type StoredContest,
} from "@/lib/contest-schema";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
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
import { cn } from "@/lib/utils";

type ConfirmAction = "suspend" | "resume" | "consolidate" | "delete";

const CONFIRMATION_COPY: Record<
  ConfirmAction,
  {
    title: string;
    description: (contest: StoredContest) => string;
    confirm: string;
  }
> = {
  suspend: {
    title: "¿Pausar este desafío?",
    description: () =>
      "Nadie podrá empezar ni responder, y el tiempo de quienes están rindiendo queda en pausa.",
    confirm: "Pausar",
  },
  resume: {
    title: "¿Reanudar este desafío?",
    description: () =>
      "Se abre de nuevo y cada equipo recupera el tiempo que estuvo en pausa.",
    confirm: "Reanudar",
  },
  consolidate: {
    title: "¿Calcular los resultados?",
    description: () =>
      "Se cierran los intentos que quedaron abiertos y se arma el ranking de cada categoría.",
    confirm: "Calcular resultados",
  },
  delete: {
    title: "¿Eliminar este desafío?",
    description: (contest) =>
      `Se eliminará el borrador «${contest.title}». No se puede deshacer.`,
    confirm: "Eliminar",
  },
};

const STARTED: ContestState[] = [
  "abierta",
  "suspendida",
  "cerrada",
  "consolidada",
  "publicada",
];

export function ContestsHome() {
  const [contests, setContests] = useState<StoredContest[] | null>(null);
  const [confirming, setConfirming] = useState<{
    action: ConfirmAction;
    contest: StoredContest;
  } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let alive = true;
    void listContests()
      .then((loaded) => {
        if (alive) setContests(loaded);
      })
      .catch((error) => {
        if (alive) setContests([]);
        toast.error(
          error instanceof Error
            ? error.message
            : "No se pudieron cargar los desafíos.",
        );
      });
    return () => {
      alive = false;
    };
  }, []);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const created = await createContest({
        title: `Desafío Bebras ${new Date().getFullYear()}`,
        categories: CATEGORY_NAMES,
        durationMinutes: 45,
        registrationStartsAt: "",
        registrationEndsAt: "",
        startsAt: "",
        endsAt: "",
        resultsAt: "",
        resultsUntil: "",
        scoring: defaultContestScoring(),
        questionDisplayMode: "one_by_one",
        allowPairs: false,
        shuffleOptions: false,
        showFeedback: false,
        showSolutions: false,
        showTotalScore: false,
        showScoreOnSubmit: false,
        showFeedbackOnSubmit: false,
        showSolutionsOnSubmit: false,
        tasks: [],
      });
      window.location.href = `/desafios/editar?id=${created.id}`;
    } catch (error) {
      setCreating(false);
      toast.error(
        error instanceof Error ? error.message : "No se pudo crear el desafío.",
      );
    }
  };

  const run = async (contest: StoredContest, action: ConfirmAction) => {
    setBusyId(contest.id);
    try {
      if (action === "delete") {
        await removeContest(contest.id);
        setContests((current) =>
          (current ?? []).filter((item) => item.id !== contest.id),
        );
        return;
      }

      const request =
        action === "suspend"
          ? suspendContest
          : action === "resume"
            ? resumeContest
            : consolidateContest;
      const updated = await request(contest.id);
      setContests((current) =>
        (current ?? []).map((item) =>
          item.id === updated.id ? updated : item,
        ),
      );

      if (action === "consolidate") {
        window.location.href = `/desafios/resultados?id=${contest.id}`;
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "No se pudo completar.",
      );
    } finally {
      setBusyId(null);
    }
  };

  const actionClass = "w-full max-lg:px-2 lg:justify-start";

  /** El paso que toca según la fase; antes de empezar, elegir preguntas. */
  const stateAction = (contest: StoredContest) => {
    const busy = busyId === contest.id;

    if (contest.state === "abierta") {
      return (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          className={actionClass}
          onClick={() => setConfirming({ action: "suspend", contest })}
        >
          <PauseIcon data-icon="inline-start" />
          Pausar
        </Button>
      );
    }

    if (contest.state === "suspendida") {
      return (
        <Button
          type="button"
          size="sm"
          disabled={busy}
          className={actionClass}
          onClick={() => setConfirming({ action: "resume", contest })}
        >
          <PlayIcon data-icon="inline-start" />
          Reanudar
        </Button>
      );
    }

    if (contest.state === "cerrada") {
      return (
        <Button
          type="button"
          size="sm"
          disabled={busy}
          className={actionClass}
          onClick={() => setConfirming({ action: "consolidate", contest })}
        >
          <CalculatorIcon data-icon="inline-start" />
          Calcular
        </Button>
      );
    }

    if (STARTED.includes(contest.state)) {
      return (
        <Button
          asChild
          size="sm"
          variant={contest.state === "consolidada" ? "default" : "outline"}
          className={actionClass}
        >
          <a href={`/desafios/resultados?id=${contest.id}`}>
            <BarChart3Icon data-icon="inline-start" />
            Resultados
          </a>
        </Button>
      );
    }

    return (
      <Button asChild size="sm" variant="outline" className={actionClass}>
        <a href={`/desafios/preguntas?id=${contest.id}`}>
          <ListChecksIcon data-icon="inline-start" />
          Preguntas
        </a>
      </Button>
    );
  };

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b pb-5">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">
          Desafíos
        </h1>
        <Button type="button" disabled={creating} onClick={handleCreate}>
          {creating ? (
            <LoaderCircleIcon
              data-icon="inline-start"
              className="animate-spin"
            />
          ) : (
            <FilePlus2Icon data-icon="inline-start" />
          )}
          Nuevo desafío
        </Button>
      </div>

      {contests === null ? (
        <ContestsSkeleton />
      ) : contests.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Todavía no hay desafíos. Crea uno y elige sus preguntas.
        </p>
      ) : (
        <ul className="divide-y border-b">
          {contests.map((contest, index) => (
            <li
              key={contest.id}
              style={{ animationDelay: `${Math.min(index, 10) * 45}ms` }}
              className="flex min-w-0 flex-col gap-4 px-3 py-5 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-300 motion-safe:fill-mode-both lg:flex-row lg:items-start lg:justify-between lg:gap-8"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <h2 className="text-lg font-semibold break-words">
                  <a
                    href={`/desafios/editar?id=${contest.id}`}
                    className="outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    {contest.title}
                  </a>
                </h2>
                <p className="text-sm text-muted-foreground">
                  <span
                    className={cn(
                      "font-medium",
                      contest.state === "abierta"
                        ? "text-primary"
                        : "text-foreground",
                    )}
                  >
                    {CONTEST_STATE_LABELS[contest.state]}
                  </span>
                  {contest.startsAt && (
                    <>
                      {" · "}Rendición{" "}
                      {formatContestWindow(contest.startsAt, contest.endsAt)}
                    </>
                  )}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {contest.categories.map((category) => {
                    const total = contest.tasks.filter(
                      (task) => task.category === category,
                    ).length;
                    return (
                      <Badge
                        key={category}
                        variant="outline"
                        title={`${total} ${total === 1 ? "pregunta" : "preguntas"}`}
                        className={cn(
                          "gap-1.5",
                          total === 0 &&
                            "border-dashed border-foreground/30 text-muted-foreground",
                        )}
                      >
                        {category}
                        <span className="tabular-nums opacity-60">{total}</span>
                      </Badge>
                    );
                  })}
                </div>
              </div>

              <div className="grid w-full shrink-0 grid-cols-2 gap-1.5 min-[400px]:grid-cols-[1fr_1fr_1fr_auto] lg:w-72 lg:grid-cols-2 lg:gap-2">
                <Button
                  asChild
                  size="sm"
                  variant="outline"
                  className={actionClass}
                >
                  <a href={`/desafios/editar?id=${contest.id}`}>
                    <FilePenLineIcon data-icon="inline-start" />
                    Editar
                  </a>
                </Button>
                {stateAction(contest)}
                <Button
                  asChild
                  size="sm"
                  variant="outline"
                  className={cn(
                    actionClass,
                    contest.taskCount === 0 && "pointer-events-none opacity-50",
                  )}
                >
                  <a
                    href={`/desafios/probar?id=${contest.id}`}
                    aria-disabled={contest.taskCount === 0}
                  >
                    <PlayCircleIcon data-icon="inline-start" />
                    Probar
                  </a>
                </Button>
                <Button
                  size="sm"
                  type="button"
                  variant="outline"
                  disabled={
                    busyId === contest.id || contest.state !== "borrador"
                  }
                  title={
                    contest.state === "borrador"
                      ? undefined
                      : "Solo se puede eliminar un desafío en borrador."
                  }
                  className={actionClass}
                  onClick={() => setConfirming({ action: "delete", contest })}
                >
                  <XIcon data-icon="inline-start" />
                  <span className="max-lg:min-[400px]:sr-only">Eliminar</span>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
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
            <AlertDialogAction
              onClick={() => {
                if (confirming) {
                  void run(confirming.contest, confirming.action);
                  setConfirming(null);
                }
              }}
            >
              {confirming ? CONFIRMATION_COPY[confirming.action].confirm : ""}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** La silueta de la lista mientras cargan los desafíos: la misma forma, sin saltos. */
function ContestsSkeleton() {
  return (
    <div aria-busy>
      <span className="sr-only">Cargando desafíos...</span>
      <ul className="divide-y border-b">
        {[56, 44, 64].map((width, index) => (
          <li
            key={index}
            className="flex flex-col gap-4 px-3 py-5 lg:flex-row lg:items-start lg:justify-between lg:gap-8"
          >
            <div className="flex flex-1 flex-col gap-2.5">
              <Skeleton
                className="h-6 rounded-none"
                style={{ width: `${width}%` }}
              />
              <Skeleton className="h-4 w-2/5 rounded-none" />
              <div className="flex gap-1.5">
                {[16, 12, 18, 14].map((badge, position) => (
                  <Skeleton
                    key={position}
                    className="h-6 rounded-none"
                    style={{ width: `${badge * 0.25}rem` }}
                  />
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:w-[26rem]">
              {[0, 1, 2, 3].map((button) => (
                <Skeleton key={button} className="h-9 rounded-none" />
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
