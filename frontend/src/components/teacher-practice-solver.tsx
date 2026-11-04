"use client";

import { QuestionSkeleton } from "@/components/page-skeletons";
import { useEffect, useState } from "react";
import { RotateCcwIcon, XIcon } from "lucide-react";
import { toast } from "sonner";

import { AnswerResult } from "@/components/answer-result";
import { TaskPlayContent } from "@/components/task-play-content";
import { TaskCountry } from "@/components/task-country";
import { NextButton, PreviousButton } from "@/components/step-buttons";
import { Button } from "@/components/ui/button";
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
import { answerHasResponse } from "@/lib/play-api";
import type { PracticeCheck } from "@/lib/practice-api";
import {
  checkStudentPractice,
  finishStudentPractice,
  getStudentPractice,
  readPracticeCode,
  type StudentPractice,
  type StudentPracticeSummary,
} from "@/lib/student-practice-api";
import { cn } from "@/lib/utils";

type Progress = {
  answers: Record<string, unknown>;
  checked: Record<string, PracticeCheck>;
};

function progressKey(id: string) {
  return `bebras_teacher_practice:${id}`;
}

function readProgress(id: string): Progress {
  try {
    const raw = window.sessionStorage.getItem(progressKey(id));
    if (raw) return JSON.parse(raw) as Progress;
  } catch {
    return { answers: {}, checked: {} };
  }
  return { answers: {}, checked: {} };
}

function writeProgress(id: string, progress: Progress) {
  try {
    window.sessionStorage.setItem(progressKey(id), JSON.stringify(progress));
  } catch {
    return;
  }
}

export function TeacherPracticeSolver() {
  const [practiceId] = useState(() =>
    (new URLSearchParams(window.location.search).get("id") ?? "").trim(),
  );
  const [code] = useState(readPracticeCode);
  const [practice, setPractice] = useState<StudentPractice | null>(null);
  const [failure, setFailure] = useState<string | null>(
    !practiceId || !code ? "Entra con tu código personal." : null,
  );
  const [progress, setProgress] = useState<Progress>(() =>
    readProgress(practiceId),
  );
  const [index, setIndex] = useState(0);
  const [checking, setChecking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [summary, setSummary] = useState<StudentPracticeSummary | null>(null);

  useEffect(() => {
    if (!practiceId || !code) return;
    let active = true;
    void getStudentPractice(practiceId, code)
      .then((loaded) => {
        if (active) setPractice(loaded);
      })
      .catch((error: unknown) => {
        if (active)
          setFailure(
            error instanceof Error
              ? error.message
              : "No se pudo abrir la práctica.",
          );
      });
    return () => {
      active = false;
    };
  }, [practiceId, code]);

  const save = (next: Progress) => {
    setProgress(next);
    writeProgress(practiceId, next);
  };

  const exit = (
    <Button
      asChild
      variant="ghost"
      size="icon"
      aria-label="Salir de la práctica"
      title="Salir"
    >
      <a href="/entrar">
        <XIcon />
      </a>
    </Button>
  );

  if (failure) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 py-16 text-center">
        <p className="text-muted-foreground">{failure}</p>
        <Button asChild>
          <a href="/entrar">Entrar con mi código</a>
        </Button>
      </div>
    );
  }

  if (!practice) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <div className="-ml-2">{exit}</div>
        <QuestionSkeleton />
      </div>
    );
  }

  if (summary) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col items-center gap-3 py-16 text-center motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-300">
        <span className="text-sm text-muted-foreground">{practice.title}</span>
        <h1 className="font-heading text-3xl font-semibold">
          ¡Terminaste la práctica!
        </h1>
        <p className="font-heading text-5xl font-semibold tabular-nums text-primary">
          {summary.totalScore}
        </p>
        <p className="text-muted-foreground">
          Acertaste {summary.correctCount} de {summary.taskCount}{" "}
          {summary.taskCount === 1 ? "pregunta" : "preguntas"}.
        </p>
        <Button asChild className="mt-4">
          <a href="/entrar">Listo</a>
        </Button>
      </div>
    );
  }

  const tasks = practice.tasks;
  const task = tasks[Math.min(index, tasks.length - 1)];
  const answer = progress.answers[task.taskId];
  const result = progress.checked[task.taskId] ?? null;
  const last = index >= tasks.length - 1;

  const check = () => {
    if (!answerHasResponse(task.answerType, answer)) return;
    setChecking(true);
    void checkStudentPractice(practiceId, code, task.taskId, answer)
      .then((checked) =>
        save({
          ...progress,
          checked: { ...progress.checked, [task.taskId]: checked },
        }),
      )
      .catch((error: unknown) =>
        toast.error(
          error instanceof Error
            ? error.message
            : "No se pudo comprobar la respuesta.",
        ),
      )
      .finally(() => setChecking(false));
  };

  const retry = () => {
    const checked = { ...progress.checked };
    delete checked[task.taskId];
    const answers = { ...progress.answers };
    delete answers[task.taskId];
    save({ answers, checked });
  };

  const finish = async () => {
    setFinishing(true);
    try {
      const done = await finishStudentPractice(
        practiceId,
        code,
        progress.answers,
      );
      writeProgress(practiceId, { answers: {}, checked: {} });
      setSummary(done);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "No se pudo terminar.",
      );
    } finally {
      setFinishing(false);
      setConfirming(false);
    }
  };

  const go = (next: number) => {
    setIndex(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <div className="-ml-2 flex items-center gap-1">
        {exit}
        <span className="truncate text-sm text-muted-foreground">
          {practice.title}
        </span>
      </div>

      <nav aria-label="Preguntas" className="flex flex-wrap gap-1.5">
        {tasks.map((item, position) => {
          const checked = progress.checked[item.taskId];
          return (
            <button
              key={item.taskId}
              type="button"
              aria-current={position === index ? "step" : undefined}
              aria-label={`Pregunta ${position + 1}`}
              onClick={() => go(position)}
              className={cn(
                "flex size-8 items-center justify-center border-2 text-sm tabular-nums transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
                position === index
                  ? "border-primary bg-primary/10 font-semibold"
                  : "border-border/20 hover:border-primary/60",
                checked &&
                  (checked.correct
                    ? "bg-difficulty-easy/20"
                    : "bg-destructive/10"),
              )}
            >
              {position + 1}
            </button>
          );
        })}
      </nav>

      <section
        key={task.taskId}
        className="flex flex-col gap-5 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-300"
      >
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h1 className="text-xl font-semibold">{task.title}</h1>
          <TaskCountry country={task.country} />
        </div>
        <TaskPlayContent
          task={task}
          value={answer}
          onChange={(value) =>
            save({
              ...progress,
              answers: { ...progress.answers, [task.taskId]: value },
            })
          }
          disabled={result !== null}
        />
      </section>

      {result && (
        <AnswerResult
          correct={result.correct}
          explanationBlocks={result.explanationBlocks}
          reveal
        />
      )}

      <div className="flex flex-wrap items-center justify-end gap-3 border-t pt-5">
        {index > 0 && (
          <PreviousButton
            size="default"
            className="mr-auto"
            onClick={() => go(index - 1)}
          />
        )}
        {result ? (
          <Button type="button" variant="outline" onClick={retry}>
            <RotateCcwIcon data-icon="inline-start" />
            Intentar de nuevo
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            disabled={checking || !answerHasResponse(task.answerType, answer)}
            onClick={check}
          >
            {checking ? "Comprobando…" : "Comprobar"}
          </Button>
        )}
        {last ? (
          <Button type="button" onClick={() => setConfirming(true)}>
            Terminar práctica
          </Button>
        ) : (
          <NextButton size="default" onClick={() => go(index + 1)} />
        )}
      </div>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Terminar la práctica?</AlertDialogTitle>
            <AlertDialogDescription>
              Tu maestro verá tu puntaje. Después puedes volver a hacerla.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={finishing}>Seguir</AlertDialogCancel>
            <AlertDialogAction
              disabled={finishing}
              onClick={(event) => {
                event.preventDefault();
                void finish();
              }}
            >
              {finishing ? "Terminando…" : "Terminar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
