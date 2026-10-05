"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeftIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  LoaderCircleIcon,
  PrinterIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import {
  StateGridPlayer,
  readAssignments,
} from "@/components/assignment-player";
import { ImageHotspotPlayer } from "@/components/image-hotspot-player";
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
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { answerHasResponse } from "@/lib/answer-presence";
import { ApiError } from "@/lib/api-client";
import { gradeLabel } from "@/lib/contest-schema";
import type { HotspotConfig } from "@/lib/image-hotspot";
import {
  choiceLetter,
  clearPaperAnswers,
  clozeConfig,
  dateAtEnd,
  getPaperAnswers,
  getPaperBundle,
  gridCellLabels,
  gridConfig,
  letter,
  paperPieces,
  paperTargets,
  savePaperAnswers,
  usable,
  type PaperAnswers,
  type PaperBundle,
  type PaperTask,
  type PaperTeam,
} from "@/lib/paper";
import { enter } from "@/lib/surface";
import { cn } from "@/lib/utils";

function teamName(team: PaperTeam) {
  const one = `${team.memberOneFirstName} ${team.memberOneLastName}`.trim();
  if (team.participationMode === "pareja" && team.memberTwoFirstName) {
    return `${one} y ${team.memberTwoFirstName} ${team.memberTwoLastName ?? ""}`.trim();
  }
  return one;
}

function readParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    groupId: params.get("id") ?? "",
    teamId: params.get("equipo") ?? "",
  };
}

type Answers = Record<string, unknown>;

export function PaperEntry() {
  const [{ groupId, teamId: initialTeam }] = useState(readParams);
  const [bundle, setBundle] = useState<PaperBundle | null>(null);
  const [loadError, setLoadError] = useState<string | null>(
    groupId ? null : "Falta el grupo.",
  );
  const [teamId, setTeamId] = useState(initialTeam);
  const [saved, setSaved] = useState<PaperAnswers | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{
    message: string;
    taskId?: string;
  } | null>(null);
  const [leaving, setLeaving] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<
    "blank" | "blank-next" | "clear" | null
  >(null);

  useEffect(() => {
    if (!groupId) return;
    let active = true;
    getPaperBundle(groupId)
      .then((loaded) => {
        if (!active) return;
        setBundle(loaded);
        setTeamId((current) => {
          if (loaded.teams.some((team) => team.id === current)) return current;
          const next =
            loaded.teams.find(
              (team) => team.status === "pending" && team.category,
            ) ?? loaded.teams[0];
          return next?.id ?? "";
        });
      })
      .catch((caught: unknown) => {
        if (active)
          setLoadError(
            caught instanceof Error
              ? caught.message
              : "No se pudo cargar el grupo.",
          );
      });
    return () => {
      active = false;
    };
  }, [groupId]);

  useEffect(() => {
    if (!teamId) return;
    let active = true;
    setSaved(null);
    setError(null);
    const url = new URL(window.location.href);
    url.searchParams.set("equipo", teamId);
    window.history.replaceState(window.history.state, "", url);
    getPaperAnswers(teamId)
      .then((loaded) => {
        if (!active) return;
        setSaved(loaded);
        setAnswers(loaded.answers);
        setDirty(false);
      })
      .catch((caught: unknown) => {
        if (active)
          setError({
            message:
              caught instanceof Error
                ? caught.message
                : "No se pudieron cargar sus respuestas.",
          });
      });
    return () => {
      active = false;
    };
  }, [teamId]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const setAnswer = useCallback((taskId: string, payload: unknown) => {
    setAnswers((current) => ({ ...current, [taskId]: payload }));
    setDirty(true);
    setError((current) => (current?.taskId === taskId ? null : current));
  }, []);

  if (loadError) {
    return (
      <div className="flex flex-col items-start gap-3 py-10">
        <p className="text-muted-foreground">{loadError}</p>
        <Button asChild variant="outline">
          <a href="/grupos">Volver a mis grupos</a>
        </Button>
      </div>
    );
  }

  if (!bundle) {
    return <EntrySkeleton />;
  }

  const teams = bundle.teams;
  const index = teams.findIndex((team) => team.id === teamId);
  const team = teams[index];
  const tasks =
    bundle.categories.find((item) => item.name === team?.category)?.tasks ?? [];
  const previous = teams[index - 1];
  const next = teams[index + 1];
  // «Guardar y seguir» salta a quienes rindieron en línea: no tienen hoja.
  const toLoad = teams
    .slice(index + 1)
    .find(
      (item) =>
        item.category && (item.mode === "paper" || item.status === "pending"),
    );
  const online = Boolean(
    saved && saved.mode === "online" && saved.status !== "pending",
  );
  const editable = bundle.entryOpen && Boolean(saved) && !online;
  const answered = tasks.filter((task) =>
    answerHasResponse(task.answerType, answers[task.taskId]),
  ).length;

  const goTo = (id: string) => {
    if (dirty && editable) {
      setLeaving(id);
      return;
    }
    setTeamId(id);
  };

  const save = async (andNext: boolean, allowBlank = false) => {
    if (!team) return;
    if (answered === 0 && !allowBlank) {
      setConfirm(andNext ? "blank-next" : "blank");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = Object.fromEntries(
        tasks.flatMap((task) =>
          answerHasResponse(task.answerType, answers[task.taskId])
            ? [[task.taskId, answers[task.taskId]]]
            : [],
        ),
      );
      await savePaperAnswers(team.id, payload);
      toast.success(`Hoja de ${team.memberOneFirstName} guardada.`);
      setDirty(false);
      setBundle((current) =>
        current
          ? {
              ...current,
              teams: current.teams.map((item) =>
                item.id === team.id
                  ? { ...item, status: "finished", mode: "paper" }
                  : item,
              ),
            }
          : current,
      );
      if (andNext && toLoad) {
        setTeamId(toLoad.id);
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        setSaved(await getPaperAnswers(team.id));
      }
    } catch (caught) {
      setError({
        message:
          caught instanceof Error ? caught.message : "No se pudo guardar.",
        taskId: caught instanceof ApiError ? caught.field : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    if (!team) return;
    try {
      await clearPaperAnswers(team.id);
      toast.success("Se quitó lo cargado.");
      setBundle((current) =>
        current
          ? {
              ...current,
              teams: current.teams.map((item) =>
                item.id === team.id
                  ? { ...item, status: "pending", mode: "online" }
                  : item,
              ),
            }
          : current,
      );
      setSaved(await getPaperAnswers(team.id));
      setAnswers({});
      setDirty(false);
    } catch (caught) {
      toast.error(
        caught instanceof Error ? caught.message : "No se pudo quitar.",
      );
    }
  };

  const loadedCount = teams.filter((item) => item.mode === "paper").length;

  return (
    <div className="flex w-full flex-col gap-6">
      <div className={cn(enter, "flex flex-col gap-4 border-b pb-6")}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <a
            href={`/grupos/ver?id=${bundle.group.id}`}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeftIcon className="size-4" />
            {bundle.group.name}
          </a>
          <a
            href={`/grupos/imprimir?id=${bundle.group.id}`}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <PrinterIcon className="size-4" />
            Imprimir la prueba
          </a>
        </div>
        <div className="flex flex-col gap-1">
          <h1 className="font-heading text-3xl font-semibold tracking-tight">
            Respuestas en papel
          </h1>
          <p className="text-sm text-muted-foreground">
            Copia lo que cada estudiante marcó en su hoja. Se corrige igual que
            en línea y cuenta para el ranking y los certificados.{" "}
            {bundle.entryOpen && bundle.entryUntil
              ? `Puedes cargar o corregir hasta el ${dateAtEnd(bundle.entryUntil)}`
              : ""}
          </p>
        </div>
        {!bundle.entryOpen && (
          <p className="bg-secondary/20 px-4 py-3 text-sm">
            {bundle.contest.startsAt &&
            new Date(bundle.contest.startsAt) > new Date()
              ? `Las hojas se cargan desde que empieza la prueba: el ${dateAtEnd(bundle.contest.startsAt)}`
              : "Los resultados ya se calcularon: ya no se pueden cargar hojas."}
          </p>
        )}
      </div>

      {teams.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Este grupo no tiene estudiantes inscritos.
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Estudiante {index + 1} de {teams.length} · {loadedCount}{" "}
                {loadedCount === 1 ? "hoja cargada" : "hojas cargadas"}
              </span>
              <select
                value={teamId}
                onChange={(event) => goTo(event.target.value)}
                className="h-11 w-full border-2 border-border/40 bg-background px-3 text-base font-medium outline-none focus-visible:border-primary sm:max-w-md"
              >
                {teams.map((item, position) => (
                  <option key={item.id} value={item.id}>
                    {position + 1}. {teamName(item)}
                    {item.mode === "paper"
                      ? " · cargada"
                      : item.status !== "pending"
                        ? " · en línea"
                        : ""}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={!previous}
                onClick={() => previous && goTo(previous.id)}
              >
                <ChevronLeftIcon data-icon="inline-start" />
                Anterior
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={!next}
                onClick={() => next && goTo(next.id)}
              >
                Siguiente
                <ChevronRightIcon data-icon="inline-end" />
              </Button>
            </div>
          </div>

          {team && (
            <div
              key={team.id}
              className="flex flex-col gap-6 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-300"
            >
              <div className="flex flex-wrap items-end justify-between gap-3 bg-muted/40 px-4 py-3">
                <div className="flex min-w-0 flex-col">
                  <span className="font-heading text-xl font-semibold break-words">
                    {teamName(team)}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {gradeLabel(team.grade)}
                    {team.category && <> · Categoría {team.category}</>}
                  </span>
                </div>
                <span className="font-mono text-lg font-bold tracking-[0.15em]">
                  {team.personalCode}
                </span>
              </div>

              {!saved ? (
                <EntrySkeleton rows />
              ) : online ? (
                <p className="text-sm text-muted-foreground">
                  {saved.status === "finished"
                    ? "Rindió en línea: sus respuestas ya están en el sistema."
                    : "Está rindiendo en línea ahora: no hace falta cargar su hoja."}
                </p>
              ) : tasks.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  El desafío no tiene preguntas para su curso.
                </p>
              ) : (
                <>
                  {saved.mode === "paper" && saved.savedAt && (
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <CheckIcon className="size-4 text-primary" />
                      Hoja cargada el {dateAtEnd(saved.savedAt)}
                      {dirty && (
                        <span className="font-normal text-muted-foreground">
                          Tienes cambios sin guardar.
                        </span>
                      )}
                    </p>
                  )}
                  <ol className="flex flex-col divide-y border-y">
                    {tasks.map((task, position) => (
                      <li
                        key={task.taskId}
                        className={cn(
                          "flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:gap-4",
                          error?.taskId === task.taskId && "bg-destructive/5",
                        )}
                      >
                        <div className="flex items-center gap-3 sm:w-56 sm:shrink-0">
                          <span
                            className={cn(
                              "grid size-9 shrink-0 place-items-center border-2 text-sm font-bold tabular-nums transition-colors",
                              answerHasResponse(
                                task.answerType,
                                answers[task.taskId],
                              )
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border/50",
                            )}
                          >
                            {position + 1}
                          </span>
                          <span className="min-w-0 text-sm leading-5 text-muted-foreground">
                            {task.title}
                          </span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <AnswerControl
                            task={task}
                            value={answers[task.taskId]}
                            disabled={!editable || saving}
                            onChange={(payload) =>
                              setAnswer(task.taskId, payload)
                            }
                          />
                        </div>
                      </li>
                    ))}
                  </ol>

                  {error && (
                    <p role="alert" className="text-sm text-destructive">
                      {error.message}
                    </p>
                  )}

                  {editable && (
                    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                      {saved.mode === "paper" ? (
                        <Button
                          type="button"
                          variant="ghost"
                          className="w-fit text-muted-foreground hover:text-destructive"
                          onClick={() => setConfirm("clear")}
                        >
                          <XIcon data-icon="inline-start" />
                          Quitar lo cargado
                        </Button>
                      ) : (
                        <span className="text-sm text-muted-foreground tabular-nums">
                          {answered} de {tasks.length} respondidas
                        </span>
                      )}
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Button
                          type="button"
                          variant={toLoad ? "outline" : "default"}
                          disabled={saving}
                          onClick={() => void save(false)}
                        >
                          {saving ? (
                            <LoaderCircleIcon
                              data-icon="inline-start"
                              className="animate-spin"
                            />
                          ) : (
                            <CheckIcon data-icon="inline-start" />
                          )}
                          Guardar
                        </Button>
                        {toLoad && (
                          <Button
                            type="button"
                            disabled={saving}
                            onClick={() => void save(true)}
                          >
                            Guardar y seguir con {toLoad.memberOneFirstName}
                            <ChevronRightIcon data-icon="inline-end" />
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}

      <AlertDialog
        open={leaving !== null}
        onOpenChange={(open) => {
          if (!open) setLeaving(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Dejar esta hoja sin guardar?</AlertDialogTitle>
            <AlertDialogDescription>
              Se pierde lo que marcaste de {team?.memberOneFirstName}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Seguir aquí</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (leaving) {
                  setDirty(false);
                  setTeamId(leaving);
                }
              }}
            >
              Dejarla
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === "clear"
                ? "¿Quitar la hoja cargada?"
                : "¿Guardar la hoja en blanco?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "clear"
                ? `${team?.memberOneFirstName ?? "El estudiante"} vuelve a quedar como que no rindió, y podrá rendir en línea si la prueba sigue abierta.`
                : "No marcaste ninguna respuesta. Cuenta como que rindió sin responder nada. Si faltó a la prueba, no guardes su hoja."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirm === "clear") void clear();
                else void save(confirm === "blank-next", true);
              }}
            >
              {confirm === "clear" ? "Quitar" : "Guardar en blanco"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const letterButton =
  "grid size-10 shrink-0 touch-manipulation place-items-center border-2 text-sm font-bold transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-default disabled:opacity-60";
const letterOn = "border-primary bg-primary text-primary-foreground";
const letterOff =
  "border-border/40 bg-background enabled:hover:border-primary/60";

/** El control de cada pregunta imita su espacio en la hoja de respuestas. */
function AnswerControl({
  task,
  value,
  disabled,
  onChange,
}: {
  task: PaperTask;
  value: unknown;
  disabled: boolean;
  onChange: (payload: unknown) => void;
}) {
  const response =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};

  if (task.answerType === "multiple_choice") {
    const selected: string[] = Array.isArray(response.selected)
      ? (response.selected as string[])
      : [];
    const multi = task.multipleChoiceMode === "all";
    return (
      <div className="flex flex-wrap items-center gap-2">
        {task.answers.map((answer, index) => {
          const on = selected.includes(answer.id);
          const label = choiceLetter(answer.id, index);
          return (
            <button
              key={answer.id}
              type="button"
              disabled={disabled}
              aria-pressed={on}
              aria-label={`Opción ${label}`}
              className={cn(
                letterButton,
                "rounded-full",
                on ? letterOn : letterOff,
              )}
              onClick={() =>
                onChange({
                  selected: multi
                    ? on
                      ? selected.filter((id) => id !== answer.id)
                      : [...selected, answer.id]
                    : on
                      ? []
                      : [answer.id],
                })
              }
            >
              {label}
            </button>
          );
        })}
        {multi && (
          <span className="text-xs text-muted-foreground">
            Puede tener varias marcadas.
          </span>
        )}
      </div>
    );
  }

  if (task.answerType === "short_text") {
    return (
      <input
        type="text"
        aria-label="Lo que escribió"
        placeholder="Lo que escribió"
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        value={String(response.text ?? "")}
        onChange={(event) => onChange({ text: event.target.value })}
        className="h-11 w-full max-w-xs border-2 border-border/40 bg-background px-3 text-lg font-semibold outline-none focus-visible:border-primary disabled:opacity-60"
      />
    );
  }

  if (task.answerType === "image_hotspot" && task.answerConfig?.version === 1) {
    return (
      <div className="max-w-md">
        <ImageHotspotPlayer
          config={task.answerConfig as unknown as HotspotConfig}
          regionId={
            typeof response.regionId === "string" ? response.regionId : null
          }
          disabled={disabled}
          onChange={(regionId) =>
            onChange(regionId ? { version: 1, regionId } : null)
          }
        />
      </div>
    );
  }

  if (task.answerType === "drag_drop") {
    return (
      <DragDropControl
        task={task}
        value={response.placements}
        disabled={disabled}
        onChange={(placements) => onChange({ placements })}
      />
    );
  }

  const grid = gridConfig(task);
  if (grid) {
    return (
      <StateGridPlayer
        config={grid}
        value={readAssignments(value, "cells")}
        disabled={disabled}
        renderLabel={(_, index) => (
          <span className="max-w-full truncate text-xs font-semibold text-muted-foreground tabular-nums">
            {gridCellLabels(grid)[index]}
          </span>
        )}
        onChange={(cells) => onChange({ version: 1, cells })}
      />
    );
  }

  const cloze = clozeConfig(task);
  if (cloze) {
    const blanks = readAssignments(value, "blanks");
    const options = usable(cloze.options);
    return (
      <div className="flex flex-col gap-3">
        {cloze.blanks.map((blank, index) => {
          const chosen = options.find(
            (option) => option.id === blanks[blank.id],
          );
          return (
            <div key={blank.id} className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-16 text-sm text-muted-foreground">
                  Hueco {index + 1}
                </span>
                {options.map((option, position) =>
                  blank.allowedOptionIds.includes(option.id) ? (
                    <button
                      key={option.id}
                      type="button"
                      disabled={disabled}
                      aria-pressed={chosen?.id === option.id}
                      title={option.label}
                      className={cn(
                        letterButton,
                        chosen?.id === option.id ? letterOn : letterOff,
                      )}
                      onClick={() => {
                        const nextBlanks = { ...blanks };
                        if (chosen?.id === option.id) {
                          delete nextBlanks[blank.id];
                        } else {
                          if (option.limit !== null) {
                            const used = Object.keys(nextBlanks).filter(
                              (id) =>
                                id !== blank.id && nextBlanks[id] === option.id,
                            );
                            if (used.length >= option.limit)
                              delete nextBlanks[used[0]];
                          }
                          nextBlanks[blank.id] = option.id;
                        }
                        onChange({ version: 1, blanks: nextBlanks });
                      }}
                    >
                      {letter(position)}
                    </button>
                  ) : null,
                )}
              </div>
              {chosen && (
                <span className="pl-[4.5rem] text-sm text-muted-foreground">
                  {chosen.label}
                </span>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <p className="text-sm text-muted-foreground">
      Esta pregunta no se puede cargar desde el papel.
    </p>
  );
}

function DragDropControl({
  task,
  value,
  disabled,
  onChange,
}: {
  task: PaperTask;
  value: unknown;
  disabled: boolean;
  onChange: (placements: Record<string, string>) => void;
}) {
  const placements: Record<string, string> =
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value as Record<string, unknown>).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        )
      : {};
  const targets = paperTargets(task);
  const pieces = paperPieces(task);
  const pieceOf = (itemId: string) =>
    pieces.find((piece) => piece.itemIds.includes(itemId));
  const itemAt = (targetId: string) =>
    Object.keys(placements).find((itemId) => placements[itemId] === targetId);

  const place = (targetId: string, pieceLetter: string | null) => {
    const next = { ...placements };
    const current = itemAt(targetId);
    if (current) delete next[current];
    const piece = pieces.find((item) => item.letter === pieceLetter);
    if (piece) {
      let free = piece.itemIds.find((itemId) => !next[itemId]);
      if (!free) {
        // Todas sus copias ya están puestas: se mueve la primera.
        free = piece.itemIds[0];
      }
      next[free] = targetId;
    }
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {pieces.map((piece) => (
          <span
            key={piece.letter}
            className="flex items-center gap-1.5 bg-muted/40 py-1 pr-2 pl-1 text-xs"
          >
            <span className="grid size-5 place-items-center bg-foreground text-[0.7rem] font-bold text-background">
              {piece.letter}
            </span>
            {piece.image ? (
              <img
                src={piece.image.url}
                alt={piece.label}
                className="h-7 w-auto max-w-16 object-contain mix-blend-multiply"
              />
            ) : (
              <span className="max-w-32 truncate">
                {piece.label || "Pieza"}
              </span>
            )}
            {piece.itemIds.length > 1 && (
              <span className="text-muted-foreground">
                ×{piece.itemIds.length}
              </span>
            )}
          </span>
        ))}
      </div>
      <div className="flex flex-col gap-2">
        {targets.map((target, index) => {
          const chosen = itemAt(target.id);
          const chosenLetter = chosen ? pieceOf(chosen)?.letter : undefined;
          return (
            <div key={target.id} className="flex flex-wrap items-center gap-2">
              <span className="w-16 text-sm text-muted-foreground">
                Lugar {index + 1}
              </span>
              {pieces.map((piece) => (
                <button
                  key={piece.letter}
                  type="button"
                  disabled={disabled}
                  aria-pressed={chosenLetter === piece.letter}
                  aria-label={`Lugar ${index + 1}: pieza ${piece.letter}`}
                  className={cn(
                    letterButton,
                    "size-9",
                    chosenLetter === piece.letter ? letterOn : letterOff,
                  )}
                  onClick={() =>
                    place(
                      target.id,
                      chosenLetter === piece.letter ? null : piece.letter,
                    )
                  }
                >
                  {piece.letter}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EntrySkeleton({ rows = false }: { rows?: boolean }) {
  return (
    <div aria-busy className="flex w-full flex-col gap-6">
      <span className="sr-only">Cargando...</span>
      {!rows && (
        <div className="flex flex-col gap-2.5 border-b pb-6">
          <Skeleton className="h-8 w-64 rounded-none" />
          <Skeleton className="h-4 w-96 max-w-full rounded-none" />
        </div>
      )}
      <div className="flex flex-col divide-y border-y">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="flex items-center gap-4 py-4">
            <Skeleton className="size-9 rounded-none" />
            <Skeleton className="h-5 w-40 rounded-none" />
            <Skeleton className="h-9 flex-1 rounded-none" />
          </div>
        ))}
      </div>
    </div>
  );
}
