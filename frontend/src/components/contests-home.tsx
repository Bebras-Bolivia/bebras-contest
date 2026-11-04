"use client";

import { useEffect, useState } from "react";
import {
  ArchiveIcon,
  BarChart3Icon,
  EyeIcon,
  FilePenLineIcon,
  FilePlus2Icon,
  ListChecksIcon,
  LoaderCircleIcon,
  PlayCircleIcon,
  StarIcon,
  UsersIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  createContest,
  listContests,
  setContestFavorite,
} from "@/lib/contests-api";
import {
  CONTEST_STATE_LABELS,
  defaultContestScoring,
  formatContestWindow,
  type StoredContest,
} from "@/lib/contest-schema";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { categoryStyle } from "@/components/category-logo";
import { cn } from "@/lib/utils";

export function ContestsHome() {
  const [contests, setContests] = useState<StoredContest[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void listContests()
      .then((loaded) => {
        if (active) setContests(loaded);
      })
      .catch((error) => {
        if (active) setContests([]);
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

  const create = async () => {
    setCreating(true);
    try {
      const contest = await createContest({
        title: `Desafío Bebras ${new Date().getFullYear()}`,
        categories: [],
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
      window.location.assign(`/desafios/editar?id=${contest.id}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "No se pudo crear el desafío.",
      );
      setCreating(false);
    }
  };

  const favorite = async (contest: StoredContest) => {
    setBusyId(contest.id);
    try {
      const selected = await setContestFavorite(
        contest.id,
        !contest.isFavorite,
      );
      setContests(
        (current) =>
          current?.map((item) => ({
            ...item,
            isFavorite: item.id === selected.favoriteContestId,
          })) ?? null,
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo cambiar el favorito.",
      );
    } finally {
      setBusyId(null);
    }
  };

  const ordered = contests
    ?.slice()
    .sort(
      (a, b) =>
        Number(b.isFavorite) - Number(a.isFavorite) ||
        b.createdAt.localeCompare(a.createdAt),
    );
  const actionClass = "w-full max-lg:px-2 lg:justify-start";

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b pb-5">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">
          Desafíos
        </h1>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="ghost">
            <a href="/desafios/papelera">
              <ArchiveIcon data-icon="inline-start" />
              Papelera
            </a>
          </Button>
          <Button
            type="button"
            disabled={creating}
            onClick={() => void create()}
          >
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
      </div>
      {ordered === undefined ? (
        <div aria-busy>
          <span className="sr-only">Cargando desafíos…</span>
          {[0, 1, 2].map((index) => (
            <div key={index} className="flex flex-col gap-3 border-b px-3 py-5">
              <Skeleton className="h-5 w-64" />
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-5 w-80 max-w-full" />
            </div>
          ))}
        </div>
      ) : ordered.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Todavía no hay desafíos. Crea uno y elige sus preguntas.
        </p>
      ) : (
        <ul className="divide-y border-b">
          {ordered.map((contest, index) => {
            const hasGroups = contest.categories.length > 0;
            const editable = [
              "borrador",
              "programada",
              "inscripcion",
              "detenida",
            ].includes(contest.state);
            const ended = ["cerrada", "consolidada", "publicada"].includes(
              contest.state,
            );
            const extending = [
              "abierta",
              "inscripcion",
              "preparacion",
            ].includes(contest.state);
            const showResults = ended && !contest.isTest;
            const showLiveResults =
              contest.state === "abierta" && !contest.isTest;
            const showUsage = ended && contest.isTest && contest.collectUsage;
            const showDetails = ended && (showResults || showUsage);
            const actionCount =
              editable || showLiveResults || showDetails ? 4 : 3;
            const mainHref = `/desafios/${showResults ? "resultados" : showUsage ? "uso" : "editar"}?id=${contest.id}`;
            const mainLabel = showResults
              ? "Resultados"
              : showUsage
                ? "Uso y opiniones"
                : editable || extending
                  ? "Editar"
                  : "Ver desafío";
            const MainIcon =
              showResults || showUsage
                ? BarChart3Icon
                : editable || extending
                  ? FilePenLineIcon
                  : EyeIcon;
            return (
              <li
                key={contest.id}
                style={{ animationDelay: `${Math.min(index, 10) * 45}ms` }}
                className="flex min-w-0 flex-col gap-4 px-3 py-5 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-300 motion-safe:fill-mode-both lg:flex-row lg:items-start lg:justify-between lg:gap-8"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex items-start gap-2">
                    <h2 className="text-lg font-semibold break-words">
                      <a
                        href={mainHref}
                        className="outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      >
                        {contest.title}
                      </a>
                    </h2>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={busyId !== null}
                      onClick={() => void favorite(contest)}
                      aria-pressed={contest.isFavorite}
                      aria-label={
                        contest.isFavorite
                          ? `Quitar ${contest.title} de favorito`
                          : `Marcar ${contest.title} como favorito`
                      }
                    >
                      <StarIcon
                        fill={contest.isFavorite ? "currentColor" : "none"}
                      />
                    </Button>
                  </div>
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
                        {" "}
                        · Rendición{" "}
                        {formatContestWindow(contest.startsAt, contest.endsAt)}
                      </>
                    )}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {contest.categories.map((category) => {
                      const count = contest.tasks.filter(
                        (task) => task.category === category,
                      ).length;
                      return (
                        <Badge
                          key={category}
                          variant="outline"
                          title={`${count} ${count === 1 ? "pregunta" : "preguntas"}`}
                          data-category={count === 0 ? undefined : ""}
                          style={
                            count === 0 ? undefined : categoryStyle(category)
                          }
                          className={cn(
                            "gap-1.5",
                            count === 0 &&
                              "border-dashed border-foreground/30 text-muted-foreground",
                          )}
                        >
                          {category}
                          <span className="tabular-nums opacity-60">
                            {count}
                          </span>
                        </Badge>
                      );
                    })}
                  </div>
                </div>
                <div
                  className={cn(
                    "grid w-full shrink-0 grid-cols-2 gap-1.5 lg:w-72 lg:grid-cols-2 lg:gap-2",
                    actionCount === 4
                      ? "min-[400px]:grid-cols-4"
                      : actionCount === 3
                        ? "min-[400px]:grid-cols-3"
                        : "min-[400px]:grid-cols-2",
                  )}
                >
                  <Button
                    asChild
                    size="sm"
                    variant="outline"
                    className={cn(
                      actionClass,
                      actionCount === 3 &&
                        "col-span-2 min-[400px]:col-span-1 lg:col-span-2",
                    )}
                  >
                    <a href={mainHref}>
                      <MainIcon data-icon="inline-start" />
                      {mainLabel}
                    </a>
                  </Button>
                  {editable && (
                    <Button
                      asChild
                      size="sm"
                      variant="outline"
                      className={actionClass}
                    >
                      <a href={`/desafios/preguntas?id=${contest.id}`}>
                        <ListChecksIcon data-icon="inline-start" />
                        Preguntas
                      </a>
                    </Button>
                  )}
                  {showLiveResults && (
                    <Button
                      asChild
                      size="sm"
                      variant="outline"
                      className={actionClass}
                    >
                      <a href={`/desafios/resultados?id=${contest.id}`}>
                        <BarChart3Icon data-icon="inline-start" />
                        Resultados
                      </a>
                    </Button>
                  )}
                  {showDetails ? (
                    <Button
                      asChild
                      size="sm"
                      variant="outline"
                      className={actionClass}
                    >
                      <a href={`/desafios/editar?id=${contest.id}`}>
                        {contest.state === "publicada" ? (
                          <FilePenLineIcon data-icon="inline-start" />
                        ) : (
                          <EyeIcon data-icon="inline-start" />
                        )}
                        {contest.state === "publicada"
                          ? "Editar"
                          : "Ver desafío"}
                      </a>
                    </Button>
                  ) : null}
                  <Button
                    asChild
                    size="sm"
                    variant="outline"
                    className={cn(
                      actionClass,
                      contest.taskCount === 0 &&
                        "pointer-events-none opacity-50",
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
                    asChild={hasGroups}
                    disabled={!hasGroups}
                    size="sm"
                    variant="outline"
                    className={actionClass}
                  >
                    {hasGroups ? (
                      <a href={`/grupos?desafio=${contest.id}`}>
                        <UsersIcon data-icon="inline-start" />
                        Grupos
                      </a>
                    ) : (
                      <>
                        <UsersIcon data-icon="inline-start" />
                        Grupos
                      </>
                    )}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
