"use client";

import { useEffect, useState } from "react";
import {
  ArrowRightIcon,
  LoaderCircleIcon,
  RotateCcwIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import { AnswerResult } from "@/components/answer-result";
import { TaskPlayContent } from "@/components/task-play-content";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  cachedPracticeTasks,
  checkPracticeAnswer,
  getPracticeTask,
  listPracticeTasks,
  type PracticeCheck,
  type PracticeTaskList,
} from "@/lib/practice-api";
import { answerHasResponse, type PlayTask } from "@/lib/play-api";
import { readSavedAnswer, saveAnswer } from "@/lib/answer-memory";
import { recordPracticeOutcome } from "@/lib/practice-progress";
import { smoothReset } from "@/lib/smooth-reset";
import { difficultyStyles } from "@/lib/difficulty";
import {
  practiceCategoryHref,
  practiceOrigin,
  practiceTaskHref,
} from "@/lib/practice-navigation";
import { cn } from "@/lib/utils";

/**
 * Tareas ya descargadas en esta visita: al volver a una, aparece al instante y
 * se refresca por detrás en vez de mostrar otra vez la carga.
 */
const loadedTasks = new Map<string, PlayTask>();

export function PracticeSolver() {
  const [taskId] = useState(() =>
    typeof window !== "undefined"
      ? (new URLSearchParams(window.location.search).get("id") ?? "").trim()
      : "",
  );
  const [{ category, origin }] = useState(() => {
    const params = new URLSearchParams(
      typeof window === "undefined" ? "" : window.location.search,
    );
    return {
      category: (params.get("nombre") ?? "").trim(),
      origin: practiceOrigin(params.get("from")),
    };
  });
  const backHref = category ? practiceCategoryHref(category, origin) : origin;
  const [list, setList] = useState<PracticeTaskList | null>(() =>
    category ? cachedPracticeTasks(category) : null,
  );
  const memoryKey = `practica:${taskId}`;
  const [task, setTask] = useState<PlayTask | null>(
    () => loadedTasks.get(taskId) ?? null,
  );
  const [failed, setFailed] = useState(false);
  const [saved] = useState(() =>
    readSavedAnswer<PracticeCheck>(memoryKey, { lasting: true }),
  );
  const [answer, setAnswer] = useState<unknown>(saved?.answer);
  const [result, setResult] = useState<PracticeCheck | null>(
    saved?.result ?? null,
  );
  const [checking, setChecking] = useState(false);
  const [justChecked, setJustChecked] = useState(false);

  useEffect(() => {
    if (taskId) saveAnswer(memoryKey, { answer, result }, { lasting: true });
  }, [taskId, memoryKey, answer, result]);

  useEffect(() => {
    if (!taskId) {
      return;
    }
    let active = true;
    getPracticeTask(taskId)
      .then((data) => {
        loadedTasks.set(taskId, data);
        if (active) {
          setTask(data);
        }
      })
      .catch(() => {
        // Si ya se mostraba una copia, se queda esa en vez del error.
        if (active && !loadedTasks.has(taskId)) {
          setFailed(true);
        }
      });
    return () => {
      active = false;
    };
  }, [taskId]);

  useEffect(() => {
    if (!category || list) return;
    let active = true;
    listPracticeTasks(category)
      .then((data) => {
        if (active) setList(data);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [category, list]);

  const tasks = list?.tasks ?? [];
  const position = tasks.findIndex((item) => item.id === taskId);
  const current = position >= 0 ? tasks[position] : null;
  const next = position >= 0 ? (tasks[position + 1] ?? null) : null;
  const nextHref = next ? practiceTaskHref(next.id, category, origin) : null;

  const check = () => {
    if (!task || !answerHasResponse(task.answerType, answer)) {
      return;
    }

    setChecking(true);
    checkPracticeAnswer(taskId, answer)
      .then((data) => {
        recordPracticeOutcome(taskId, data.correct);
        setJustChecked(true);
        setResult(data);
      })
      .catch((error) => {
        setResult(null);
        toast.error(
          error instanceof Error
            ? error.message
            : "No se pudo comprobar la respuesta.",
        );
      })
      .finally(() => setChecking(false));
  };

  const retry = () => {
    smoothReset(() => {
      setResult(null);
      setAnswer(undefined);
    });
  };

  if (!taskId || failed) {
    return (
      <Alert>
        <AlertTitle>No se encontró el desafío</AlertTitle>
        <AlertDescription>
          Es posible que ya no esté disponible.
        </AlertDescription>
      </Alert>
    );
  }

  const topBar = (
    <div className="-ml-2 flex items-center gap-1">
      <Button
        asChild
        variant="ghost"
        size="icon"
        aria-label="Salir de la práctica"
        title="Salir"
      >
        <a href={backHref}>
          <XIcon />
        </a>
      </Button>
      <span className="truncate text-sm text-muted-foreground">
        {category || "Práctica"}
      </span>
    </div>
  );

  if (task === null) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        {topBar}
        <div className="flex justify-center py-10">
          <LoaderCircleIcon className="size-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  const level = current?.difficulty
    ? difficultyStyles[current.difficulty]
    : null;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      {topBar}
      <section className="flex flex-col gap-5 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-300">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="text-xl font-semibold">{task.title}</h1>
          {level && (
            <span
              className={cn(
                "px-1.5 py-px text-[0.7rem] font-semibold",
                level.className,
              )}
            >
              {level.label}
            </span>
          )}
        </div>
        <TaskPlayContent
          task={task}
          value={answer}
          onChange={setAnswer}
          disabled={result !== null}
        />
      </section>

      {result && (
        <AnswerResult
          correct={result.correct}
          explanationBlocks={result.explanationBlocks}
          reveal={justChecked}
        />
      )}

      <div className="flex flex-wrap items-center justify-end gap-3 border-t pt-5">
        {result ? (
          <>
            <Button type="button" variant="outline" onClick={retry}>
              <RotateCcwIcon data-icon="inline-start" />
              Intentar de nuevo
            </Button>
            <Button asChild>
              <a href={nextHref ?? backHref}>
                {nextHref ? "Siguiente pregunta" : "Ver todas las preguntas"}
                <ArrowRightIcon data-icon="inline-end" />
              </a>
            </Button>
          </>
        ) : (
          <>
            {nextHref && (
              <Button asChild variant="ghost">
                <a href={nextHref}>Saltar</a>
              </Button>
            )}
            <Button
              type="button"
              disabled={checking || !answerHasResponse(task.answerType, answer)}
              onClick={check}
            >
              {checking ? "Comprobando…" : "Comprobar"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
