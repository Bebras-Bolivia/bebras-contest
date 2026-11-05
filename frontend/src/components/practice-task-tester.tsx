"use client";

import { useEffect, useRef, useState } from "react";
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  RotateCcwIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { smoothReset } from "@/lib/smooth-reset";
import { answerHasResponse, type PlayTask } from "@/lib/play-api";
import type { PracticeCheck } from "@/lib/practice-api";
import {
  checkTeacherPracticeAnswer,
  getTeacherPracticeTask,
  type PracticeTask,
} from "@/lib/practices-api";
import { AnswerResult } from "@/components/answer-result";
import { DifficultyTag } from "@/components/contest-task-parts";
import { QuestionSkeleton } from "@/components/page-skeletons";
import { TaskPlayContent } from "@/components/task-play-content";
import { TaskCountry } from "@/components/task-country";
import { Button } from "@/components/ui/button";

const playTasks = new Map<string, Promise<PlayTask>>();

function fetchPlayTask(taskId: string) {
  let entry = playTasks.get(taskId);
  if (!entry) {
    entry = getTeacherPracticeTask(taskId);
    entry.catch(() => playTasks.delete(taskId));
    playTasks.set(taskId, entry);
  }
  return entry;
}

export function PracticeTaskTester({
  tasks,
  startId,
  picked,
  onToggle,
  onClose,
}: {
  tasks: PracticeTask[];
  startId: string;
  picked: string[];
  onToggle: (taskId: string) => void;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(() =>
    Math.max(
      0,
      tasks.findIndex((task) => task.id === startId),
    ),
  );
  const [direction, setDirection] = useState<-1 | 0 | 1>(0);
  const [loaded, setLoaded] = useState<{ id: string; task: PlayTask } | null>(
    null,
  );
  const [answer, setAnswer] = useState<unknown>({});
  const [result, setResult] = useState<PracticeCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const revision = useRef(0);

  const task = tasks[index];
  const playTask = loaded && loaded.id === task?.id ? loaded.task : null;
  const active = task ? picked.includes(task.id) : false;
  const taskId = task?.id;
  const previousId = tasks[index - 1]?.id;
  const nextId = tasks[index + 1]?.id;

  useEffect(() => {
    if (!taskId) return;
    let alive = true;
    void fetchPlayTask(taskId)
      .then((value) => {
        if (alive) setLoaded({ id: taskId, task: value });
      })
      .catch(() => {
        if (alive) toast.error("No se pudo cargar la pregunta.");
      });
    for (const neighbor of [previousId, nextId]) {
      if (neighbor) void fetchPlayTask(neighbor).catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [taskId, previousId, nextId]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [index]);

  useEffect(() => {
    const chrome = document.querySelectorAll<HTMLElement>("[data-site-chrome]");
    chrome.forEach((element) => {
      element.hidden = true;
    });
    return () => {
      chrome.forEach((element) => {
        element.hidden = false;
      });
    };
  }, []);

  const goTo = (step: -1 | 1) => {
    const next = index + step;
    if (next < 0 || next >= tasks.length) return;
    revision.current += 1;
    setDirection(step);
    setIndex(next);
    setAnswer({});
    setResult(null);
    setChecking(false);
  };

  const changeAnswer = (payload: unknown) => {
    revision.current += 1;
    setChecking(false);
    setResult(null);
    setAnswer(payload);
  };

  const check = async () => {
    if (!playTask || checking) return;
    const checkedRevision = ++revision.current;
    setChecking(true);
    try {
      const checked = await checkTeacherPracticeAnswer(playTask.taskId, answer);
      if (checkedRevision === revision.current) setResult(checked);
    } catch (error) {
      if (checkedRevision === revision.current) {
        toast.error(
          error instanceof Error
            ? error.message
            : "No se pudo comprobar la respuesta.",
        );
      }
    } finally {
      if (checkedRevision === revision.current) setChecking(false);
    }
  };

  if (!task) return null;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-300 sm:gap-7">
      <div className="sticky top-0 z-20 -mx-4 flex flex-wrap items-center gap-2 border-b bg-background px-4 py-3 text-sm text-muted-foreground sm:mx-0 sm:px-0">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Volver a la práctica"
          title="Volver a la práctica"
          onClick={onClose}
        >
          <XIcon />
        </Button>
        <span>Probando:</span>
        <h1 className="font-medium break-words text-foreground">
          {task.title}
        </h1>
        <DifficultyTag difficulty={task.difficulty} />
        <TaskCountry country={task.country} className="max-sm:hidden" />
        <nav
          aria-label="Moverse entre preguntas"
          className="ml-auto flex items-center gap-1.5"
        >
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="Pregunta anterior"
            disabled={index === 0}
            onClick={() => goTo(-1)}
          >
            <ChevronLeftIcon />
          </Button>
          <span className="min-w-12 text-center text-xs tabular-nums">
            {index + 1} / {tasks.length}
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="Pregunta siguiente"
            disabled={index === tasks.length - 1}
            onClick={() => goTo(1)}
          >
            <ChevronRightIcon />
          </Button>
        </nav>
      </div>

      <div
        key={task.id}
        className={cn(
          "flex flex-col gap-6 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-300 sm:gap-7",
          direction === 1 && "motion-safe:slide-in-from-right-8",
          direction === -1 && "motion-safe:slide-in-from-left-8",
        )}
      >
        {playTask ? (
          <TaskPlayContent
            task={playTask}
            value={answer}
            onChange={changeAnswer}
          />
        ) : (
          <QuestionSkeleton />
        )}

        {result && (
          <AnswerResult
            correct={result.correct}
            explanationBlocks={result.explanationBlocks}
            reveal
          />
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-5 sm:gap-3">
          <button
            type="button"
            role="checkbox"
            aria-checked={active}
            onClick={() => onToggle(task.id)}
            className="mr-auto flex items-center gap-2.5 py-1 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            <span
              className={cn(
                "flex size-6 items-center justify-center border-2 transition-colors duration-200",
                active
                  ? "border-difficulty-easy bg-difficulty-easy text-white"
                  : "border-border/30 text-transparent",
              )}
            >
              <CheckIcon
                className={cn(
                  "size-4 transition-transform duration-200",
                  active ? "scale-100" : "scale-0",
                )}
                strokeWidth={3}
              />
            </span>
            Agregar a la práctica
          </button>
          <Button
            type="button"
            variant="outline"
            onClick={() => smoothReset(() => changeAnswer({}))}
          >
            <RotateCcwIcon data-icon="inline-start" />
            Reiniciar
          </Button>
          <Button
            type="button"
            disabled={
              !playTask ||
              checking ||
              !answerHasResponse(playTask.answerType, answer)
            }
            onClick={() => void check()}
          >
            {checking ? "Comprobando…" : "Comprobar"}
          </Button>
        </div>
      </div>
    </div>
  );
}
