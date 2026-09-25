"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2Icon,
  LoaderCircleIcon,
  RotateCcwIcon,
  XCircleIcon,
} from "lucide-react";
import { toast } from "sonner";

import { TaskContentRenderer } from "@/components/task-content-renderer";
import { TaskPlayContent } from "@/components/task-play-content";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  checkPracticeAnswer,
  getPracticeTask,
  type PracticeCheck,
} from "@/lib/practice-api";
import { answerHasResponse, type PlayTask } from "@/lib/play-api";
import { readSavedAnswer, saveAnswer } from "@/lib/answer-memory";
import {
  practiceCategoryHref,
  practiceOrigin,
} from "@/lib/practice-navigation";

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
  const [backHref] = useState(() => {
    if (typeof window === "undefined") {
      return "/practica";
    }

    const params = new URLSearchParams(window.location.search);
    const category = (params.get("nombre") ?? "").trim();
    const origin = practiceOrigin(params.get("from"));
    return category ? practiceCategoryHref(category, origin) : origin;
  });
  const memoryKey = `practica:${taskId}`;
  const [task, setTask] = useState<PlayTask | null>(
    () => loadedTasks.get(taskId) ?? null,
  );
  const [failed, setFailed] = useState(false);
  const [saved] = useState(() => readSavedAnswer<PracticeCheck>(memoryKey));
  const [answer, setAnswer] = useState<unknown>(saved?.answer);
  const [result, setResult] = useState<PracticeCheck | null>(
    saved?.result ?? null,
  );
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (taskId) saveAnswer(memoryKey, { answer, result });
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

  const check = () => {
    if (!task || !answerHasResponse(task.answerType, answer)) {
      return;
    }

    setChecking(true);
    checkPracticeAnswer(taskId, answer)
      .then((data) => setResult(data))
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
    setResult(null);
    setAnswer(undefined);
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

  if (task === null) {
    return (
      <div className="flex justify-center py-10">
        <LoaderCircleIcon className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <section className="flex flex-col gap-5">
        <h1 className="text-xl font-semibold">{task.title}</h1>
        <TaskPlayContent
          task={task}
          value={answer}
          onChange={setAnswer}
          disabled={result !== null}
        />
      </section>

      {result && (
        <Alert variant={result.correct ? "default" : "destructive"}>
          {result.correct ? (
            <CheckCircle2Icon className="size-4" />
          ) : (
            <XCircleIcon className="size-4" />
          )}
          <AlertTitle>
            {result.correct ? "¡Correcto!" : "Respuesta incorrecta"}
          </AlertTitle>
          {result.explanationBlocks?.length && (
            <AlertDescription>
              <TaskContentRenderer blocks={result.explanationBlocks} />
            </AlertDescription>
          )}
        </Alert>
      )}

      <div className="flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            window.location.href = backHref;
          }}
        >
          Volver
        </Button>
        {result ? (
          <Button type="button" onClick={retry}>
            <RotateCcwIcon data-icon="inline-start" />
            Intentar de nuevo
          </Button>
        ) : (
          <Button
            type="button"
            disabled={checking || !answerHasResponse(task.answerType, answer)}
            onClick={check}
          >
            {checking ? "Verificando..." : "Comprobar"}
          </Button>
        )}
      </div>
    </div>
  );
}
