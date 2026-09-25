"use client";

import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowLeftIcon,
  CheckCircle2Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleIcon,
  ClockIcon,
  LoaderCircleIcon,
  SendIcon,
  XCircleIcon,
} from "lucide-react";
import { toast } from "sonner";

import { TaskContentRenderer } from "@/components/task-content-renderer";
import { TaskPlayContent } from "@/components/task-play-content";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  answerHasResponse,
  forgetPlaySession,
  getAttempt,
  readPlaySession,
  saveAnswer,
  sendPlayHeartbeat,
  startAttempt,
  submitAttempt,
  type AttemptState,
  type PlayTask,
} from "@/lib/play-api";
import { getContestPreview, scoreContestPreview } from "@/lib/contests-api";
import { cn } from "@/lib/utils";

function formatRemaining(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatStartCountdown(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const clock = [hours, minutes, seconds]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");

  return days > 0 ? `${days} ${days === 1 ? "día" : "días"} ${clock}` : clock;
}

const SAVE_RETRY_DELAYS = [250, 750] as const;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function saveAnswerWithRetry(
  taskId: string,
  payload: unknown,
  preview = false,
) {
  if (preview) {
    // La vista previa no persiste nada: la respuesta vive solo en la pantalla.
    return;
  }

  let lastError: unknown;

  for (let attempt = 0; attempt <= SAVE_RETRY_DELAYS.length; attempt += 1) {
    try {
      await saveAnswer(taskId, payload);
      return;
    } catch (error) {
      lastError = error;
      const retryDelay = SAVE_RETRY_DELAYS[attempt];
      if (retryDelay === undefined) {
        break;
      }
      await wait(retryDelay);
    }
  }

  throw lastError;
}

export function AttemptPage({
  preview: previewMode = false,
  contestId = null,
}: {
  /**
   * Vista previa para el administrador: la misma pantalla que ve el estudiante,
   * pero los datos salen del desafío y nada se guarda. El id llega por la query
   * porque la página es estática.
   */
  preview?: boolean;
  contestId?: string | null;
} = {}) {
  const [previewContestId] = useState(() => {
    if (contestId) {
      return contestId;
    }

    if (!previewMode || typeof window === "undefined") {
      return null;
    }

    return new URLSearchParams(window.location.search).get("id");
  });
  const preview = Boolean(previewContestId);
  const [sessionToken] = useState(() =>
    previewContestId ? "preview" : readPlaySession(),
  );
  const [sessionLost, setSessionLost] = useState(false);
  const [attempt, setAttempt] = useState<AttemptState | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [currentIndex, setCurrentIndex] = useState(0);

  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const saveQueues = useRef<Record<string, Promise<void>>>({});
  const answersRef = useRef<Record<string, unknown>>({});
  const submittedRef = useRef(false);
  const automaticFinishAttemptedRef = useRef(false);

  const load = useCallback(async () => {
    if (!sessionToken) {
      setLoading(false);
      return;
    }
    try {
      const data = previewContestId
        ? ((await getContestPreview(previewContestId)) as AttemptState)
        : await getAttempt();
      setAttempt(data);
      answersRef.current = data.answers ?? {};
      setAnswers(answersRef.current);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "No se pudo cargar.";

      if (message.includes("sesión")) {
        forgetPlaySession();
        setSessionLost(true);
      } else {
        toast.error(message);
      }
    } finally {
      setLoading(false);
    }
  }, [sessionToken, previewContestId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const suspended = attempt?.state === "suspendida";
  const waitingForStart =
    attempt?.status === "pending" &&
    ["programada", "inscripcion", "preparacion"].includes(attempt.state);
  const attemptActive = starting || attempt?.status === "in_progress";
  const chromeHidden = loading || attemptActive;
  const contestStartsAtMs = attempt?.contestStartsAt
    ? new Date(attempt.contestStartsAt).getTime()
    : 0;
  const contestEndsAtMs = attempt?.contestEndsAt
    ? new Date(attempt.contestEndsAt).getTime()
    : 0;
  const startsIn = contestStartsAtMs - now;
  const scheduledStartReached =
    waitingForStart && contestStartsAtMs > 0 && startsIn <= 0;
  const suspendedAtMs = attempt?.suspendedAt
    ? new Date(attempt.suspendedAt).getTime()
    : 0;
  const endsAtMs = attempt?.endsAt ? new Date(attempt.endsAt).getTime() : 0;
  const remaining =
    endsAtMs - (suspended && suspendedAtMs ? suspendedAtMs : now);
  const availableStartTime = contestEndsAtMs - now;
  const startsWithReducedTime = Boolean(
    !preview &&
    attempt?.status === "pending" &&
    attempt.state === "abierta" &&
    contestEndsAtMs > 0 &&
    availableStartTime < attempt.durationMinutes * 60000,
  );

  useEffect(() => {
    const chrome = document.querySelectorAll<HTMLElement>("[data-site-chrome]");
    chrome.forEach((element) => {
      element.hidden = chromeHidden;
    });

    return () => {
      chrome.forEach((element) => {
        element.hidden = false;
      });
    };
  }, [chromeHidden]);

  useEffect(() => {
    // Probar no es rendir: al administrador no se le retiene con la
    // confirmacion del navegador.
    if (!attemptActive || preview) {
      return;
    }

    const confirmExit = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", confirmExit);
    return () => window.removeEventListener("beforeunload", confirmExit);
  }, [attemptActive, preview]);

  const queueSave = (taskId: string, payload: unknown) => {
    const previousSave = saveQueues.current[taskId] ?? Promise.resolve();
    const nextSave = previousSave
      .catch(() => undefined)
      .then(() => saveAnswerWithRetry(taskId, payload, preview));

    saveQueues.current[taskId] = nextSave;
    return nextSave;
  };

  const scheduleSave = (taskId: string, payload: unknown) => {
    if (saveTimers.current[taskId]) {
      clearTimeout(saveTimers.current[taskId]);
    }
    const delay = remaining <= 10000 ? 0 : 500;
    saveTimers.current[taskId] = setTimeout(() => {
      delete saveTimers.current[taskId];
      void queueSave(taskId, payload).catch(() => undefined);
    }, delay);
  };

  const setAnswer = (taskId: string, payload: unknown) => {
    answersRef.current = { ...answersRef.current, [taskId]: payload };
    setAnswers(answersRef.current);
    scheduleSave(taskId, payload);
  };

  const flushSaves = async () => {
    Object.values(saveTimers.current).forEach((timer) => clearTimeout(timer));
    saveTimers.current = {};
    await Promise.all(
      Object.entries(answersRef.current).map(([taskId, payload]) =>
        queueSave(taskId, payload),
      ),
    );
  };

  /** Corrige con las reglas reales del desafío y deja la pantalla final. */
  const finishPreview = async (outOfTime = false) => {
    if (!previewContestId) {
      return;
    }

    const summary = await scoreContestPreview(
      previewContestId,
      answersRef.current,
    );

    setAttempt((current) =>
      current
        ? {
            ...current,
            status: "finished",
            finishedAt: outOfTime ? current.endsAt : new Date().toISOString(),
            resultsPublished: true,
            tasks: current.tasks.map((task) => {
              const graded = summary.tasks.find(
                (item) => item.taskId === task.taskId,
              );

              return {
                ...task,
                correct: graded?.correct ?? false,
                explanationBlocks: current.showSolutions
                  ? graded?.explanationBlocks
                  : undefined,
              };
            }),
            result: {
              totalScore: summary.totalScore,
              correctCount: summary.correctCount,
              answeredCount: summary.answeredCount,
              rankPosition: null,
            },
          }
        : current,
    );
  };

  const finishAutomatically = useEffectEvent(async () => {
    setSubmitting(true);
    try {
      try {
        await flushSaves();
      } catch {
        // The server enforces the deadline, so finalization must still continue.
      }
      if (preview) {
        await finishPreview(true);
      } else {
        await submitAttempt();
        await load();
      }
    } catch {
      submittedRef.current = false;
      toast.error(
        "No pudimos entregar el desafío. Revisa la conexión e inténtalo nuevamente.",
      );
    } finally {
      setSubmitting(false);
    }
  });

  useEffect(() => {
    if (
      attempt?.status === "in_progress" &&
      !suspended &&
      endsAtMs > 0 &&
      remaining <= 0 &&
      !submittedRef.current &&
      !automaticFinishAttemptedRef.current
    ) {
      automaticFinishAttemptedRef.current = true;
      submittedRef.current = true;
      void finishAutomatically();
    }
  }, [remaining, attempt?.status, endsAtMs, suspended]);

  useEffect(() => {
    if ((!waitingForStart && !suspended) || preview || sessionLost) {
      return;
    }

    if (scheduledStartReached) {
      void load();
    }

    const id = window.setInterval(() => void load(), 5000);
    return () => clearInterval(id);
  }, [
    waitingForStart,
    suspended,
    preview,
    sessionLost,
    scheduledStartReached,
    load,
  ]);

  useEffect(() => {
    if (!sessionToken || sessionLost || preview) {
      return;
    }

    const id = setInterval(() => {
      void sendPlayHeartbeat().catch(() => undefined);
    }, 10000);
    return () => clearInterval(id);
  }, [sessionToken, sessionLost, preview]);

  useEffect(
    () => () => {
      Object.values(saveTimers.current).forEach((timer) => clearTimeout(timer));
    },
    [],
  );

  const handleStart = async () => {
    setStarting(true);
    try {
      if (preview) {
        const startedAt = new Date();
        setAttempt((current) =>
          current
            ? {
                ...current,
                status: "in_progress",
                startedAt: startedAt.toISOString(),
                endsAt: new Date(
                  startedAt.getTime() + current.durationMinutes * 60_000,
                ).toISOString(),
              }
            : current,
        );
      } else {
        await startAttempt();
        await load();
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "No se pudo empezar.",
      );
    } finally {
      setStarting(false);
    }
  };

  const handleSubmit = async () => {
    if (submittedRef.current) {
      return;
    }

    submittedRef.current = true;
    setSubmitting(true);
    try {
      await flushSaves();

      if (preview) {
        await finishPreview();
        toast.success("Vista previa entregada.");
        return;
      }

      await submitAttempt();
      await load();
      toast.success("Entregaste el desafío.");
    } catch {
      submittedRef.current = false;
      toast.error(
        "No pudimos entregar el desafío. Revisa la conexión e inténtalo nuevamente.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  // La cabecera del sitio se oculta durante el intento para que la prueba se
  // vea igual que la del estudiante, asi que la salida vive aqui: este aviso
  // acompana a todas las pantallas de la vista previa.
  const previewNotice = preview ? (
    <Alert>
      <AlertTitle>Vista previa del desafío</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-3">
        <span>
          Es la misma pantalla que verá el estudiante. Nada de lo que respondas
          aquí se guarda, y el tiempo corre solo para que puedas probarlo.
        </span>
        <Button asChild variant="outline" size="sm">
          <a href={`/desafios/editar?id=${previewContestId}`}>
            <ArrowLeftIcon data-icon="inline-start" />
            Salir de la prueba
          </a>
        </Button>
      </AlertDescription>
    </Alert>
  ) : null;

  if (loading) {
    return (
      <div className="flex min-h-72 items-center justify-center">
        <LoaderCircleIcon className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (sessionLost) {
    return (
      <Alert>
        <AlertTitle>Tu sesión se cerró</AlertTitle>
        <AlertDescription>
          Se abrió tu prueba en otro dispositivo o pasó demasiado tiempo sin
          conexión. Vuelve a entrar con tu nombre para seguir donde estabas.
        </AlertDescription>
      </Alert>
    );
  }

  if (!sessionToken || !attempt) {
    return (
      <Alert>
        <AlertTitle>No encontramos tu sesión</AlertTitle>
        <AlertDescription>
          Entra con el código de tu maestro y tu nombre para empezar.
        </AlertDescription>
      </Alert>
    );
  }

  if (attempt.status === "pending") {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4">
        {previewNotice}
        <Card className="w-full">
          <CardContent className="flex flex-col gap-4 pt-6 text-center">
            <h1 className="text-2xl font-semibold">{attempt.contestTitle}</h1>
            {startsWithReducedTime ? (
              <Alert>
                <ClockIcon />
                <AlertTitle>Entraste después de la hora de inicio</AlertTitle>
                <AlertDescription>
                  Si empiezas ahora tendrás{" "}
                  {formatStartCountdown(availableStartTime)} hasta que cierre el
                  desafío. El tiempo no se detiene.
                </AlertDescription>
              </Alert>
            ) : (
              <p className="text-sm text-muted-foreground">
                Tendrás {attempt.durationMinutes} minutos desde que empieces. El
                tiempo no se detiene.
              </p>
            )}
            {attempt.state !== "abierta" ? (
              <Alert>
                {!suspended && contestStartsAtMs > 0 && <ClockIcon />}
                <AlertTitle>
                  {suspended
                    ? "El desafío está suspendido"
                    : contestStartsAtMs > 0
                      ? scheduledStartReached
                        ? "El desafío está por comenzar"
                        : "El desafío comienza en"
                      : "El horario aún no está definido"}
                </AlertTitle>
                <AlertDescription className="flex flex-col gap-2">
                  {suspended ? (
                    "Tu maestro la pausó. Deja esta página abierta: se habilita sola cuando la reanuden."
                  ) : contestStartsAtMs > 0 ? (
                    <>
                      <span
                        role="timer"
                        className="font-mono text-2xl font-semibold tabular-nums text-foreground"
                      >
                        {formatStartCountdown(startsIn)}
                      </span>
                      <span>
                        {scheduledStartReached
                          ? "Estamos habilitando el desafío."
                          : "Esta pantalla se actualizará automáticamente."}
                      </span>
                    </>
                  ) : (
                    "Tu maestro definirá la hora. Esta pantalla se actualizará automáticamente."
                  )}
                </AlertDescription>
              </Alert>
            ) : (
              <Button onClick={handleStart} disabled={starting}>
                {starting ? "Empezando..." : "Empezar el desafío"}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (attempt.status === "finished") {
    // El intento que se cierra por plazo queda marcado con finishedAt igual a
    // endsAt: el equipo merece saber que lo entregamos nosotros.
    const finishedAtMs = attempt.finishedAt
      ? new Date(attempt.finishedAt).getTime()
      : 0;
    const outOfTime =
      finishedAtMs > 0 && endsAtMs > 0 && finishedAtMs >= endsAtMs;

    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        {previewNotice}
        <Card>
          <CardContent className="flex flex-col items-center gap-3 pt-6 text-center">
            {outOfTime ? (
              <ClockIcon className="size-8 text-muted-foreground" />
            ) : (
              <CheckCircle2Icon className="size-8 text-primary" />
            )}
            <h1 className="text-2xl font-semibold">
              {outOfTime ? "Se acabó el tiempo" : "¡Desafío terminado!"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {attempt.contestTitle}
            </p>
            {outOfTime && (
              <p className="text-sm text-muted-foreground">
                Entregamos tus respuestas tal como estaban. Ya no puedes
                cambiarlas.
              </p>
            )}
            {attempt.result ? (
              <div className="flex flex-wrap justify-center gap-3 pt-2">
                <Badge variant="secondary">
                  Puntaje: {attempt.result.totalScore}
                </Badge>
                <Badge variant="outline">
                  Correctas: {attempt.result.correctCount}
                </Badge>
                {attempt.result.rankPosition && (
                  <Badge variant="outline">
                    Posición: #{attempt.result.rankPosition}
                  </Badge>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {attempt.resultsPublished
                  ? "Tu maestro te compartirá los resultados."
                  : "Los resultados se publicarán unos días después del desafío."}
              </p>
            )}
          </CardContent>
        </Card>

        {(attempt.showFeedback || attempt.showSolutions) &&
          attempt.tasks.map((task) => (
            <Card key={task.taskId}>
              <CardContent className="flex flex-col gap-2 pt-6">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold">
                    {task.position}. {task.title}
                  </h2>
                  <Badge
                    variant={
                      task.correct === true
                        ? "default"
                        : task.correct === false
                          ? "destructive"
                          : "outline"
                    }
                  >
                    {task.correct === true ? (
                      <CheckCircle2Icon data-icon="inline-start" />
                    ) : task.correct === false ? (
                      <XCircleIcon data-icon="inline-start" />
                    ) : (
                      <CircleIcon data-icon="inline-start" />
                    )}
                    {task.correct === true
                      ? "Correcta"
                      : task.correct === false
                        ? "Incorrecta"
                        : "Sin responder"}
                  </Badge>
                </div>
                {attempt.showSolutions && task.explanationBlocks?.length && (
                  <div className="text-sm text-muted-foreground">
                    <TaskContentRenderer blocks={task.explanationBlocks} />
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      {previewNotice}
      <div className="sticky top-2 z-10 flex items-center justify-between gap-4 rounded-md border bg-background px-4 py-3 shadow-sm">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            {attempt.contestTitle}
          </p>
          <p className="text-xs text-muted-foreground">
            {attempt.tasks.length} tarea(s)
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 font-mono text-lg font-semibold",
              remaining < 60000 && "text-destructive",
            )}
          >
            <ClockIcon className="size-4" />
            {formatRemaining(remaining)}
          </span>
          <SubmitAttemptDialog
            submitting={submitting}
            onSubmit={() => void handleSubmit()}
          >
            <Button type="button" disabled={submitting || suspended}>
              {submitting ? (
                <LoaderCircleIcon
                  data-icon="inline-start"
                  className="animate-spin"
                />
              ) : (
                <SendIcon data-icon="inline-start" />
              )}
              {submitting ? "Entregando..." : "Entregar"}
            </Button>
          </SubmitAttemptDialog>
        </div>
      </div>

      {suspended && (
        <Alert>
          <AlertTitle>El desafío está suspendido</AlertTitle>
          <AlertDescription>
            Tu maestro la pausó y tu tiempo quedó detenido. No cierres esta
            página: se reanuda sola y recuperas los {formatRemaining(remaining)}{" "}
            que te quedaban.
          </AlertDescription>
        </Alert>
      )}

      {attempt.questionDisplayMode === "all" ? (
        attempt.tasks.map((task) => (
          <TaskSection
            key={task.taskId}
            task={task}
            value={answers[task.taskId]}
            disabled={submitting || suspended}
            onChange={(payload) => setAnswer(task.taskId, payload)}
          />
        ))
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            {attempt.tasks.map((task, index) => {
              const answered = answerHasResponse(
                task.answerType,
                answers[task.taskId],
              );
              const isCurrent = index === currentIndex;
              return (
                <button
                  key={task.taskId}
                  type="button"
                  aria-current={isCurrent ? "true" : undefined}
                  onClick={() => setCurrentIndex(index)}
                  className={cn(
                    "flex size-9 items-center justify-center rounded-md border text-sm font-medium transition",
                    isCurrent
                      ? "border-primary bg-primary text-primary-foreground"
                      : answered
                        ? "border-primary/40 bg-primary/10 text-foreground"
                        : "bg-background text-muted-foreground hover:border-foreground",
                  )}
                >
                  {index + 1}
                </button>
              );
            })}
          </div>

          {attempt.tasks[currentIndex] && (
            <TaskSection
              key={attempt.tasks[currentIndex].taskId}
              task={attempt.tasks[currentIndex]}
              value={answers[attempt.tasks[currentIndex].taskId]}
              disabled={submitting || suspended}
              onChange={(payload) =>
                setAnswer(attempt.tasks[currentIndex].taskId, payload)
              }
            />
          )}

          <div className="flex items-center justify-between gap-4">
            <Button
              type="button"
              variant="outline"
              disabled={currentIndex === 0}
              onClick={() => setCurrentIndex((index) => Math.max(0, index - 1))}
            >
              <ChevronLeftIcon data-icon="inline-start" />
              Anterior
            </Button>
            <span className="text-sm text-muted-foreground">
              Tarea {currentIndex + 1} de {attempt.tasks.length}
            </span>
            {currentIndex >= attempt.tasks.length - 1 ? (
              <SubmitAttemptDialog
                submitting={submitting}
                onSubmit={() => void handleSubmit()}
              >
                <Button type="button" disabled={submitting || suspended}>
                  {submitting ? (
                    <LoaderCircleIcon
                      data-icon="inline-start"
                      className="animate-spin"
                    />
                  ) : (
                    <SendIcon data-icon="inline-start" />
                  )}
                  {submitting ? "Entregando..." : "Terminar"}
                </Button>
              </SubmitAttemptDialog>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setCurrentIndex((index) =>
                    Math.min(attempt.tasks.length - 1, index + 1),
                  )
                }
              >
                Siguiente
                <ChevronRightIcon data-icon="inline-end" />
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SubmitAttemptDialog({
  submitting,
  onSubmit,
  children,
}: {
  submitting: boolean;
  onSubmit: () => void;
  children: ReactNode;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Entregar el desafío?</AlertDialogTitle>
          <AlertDialogDescription>
            Ya no podrás cambiar tus respuestas. Esta acción no se puede
            deshacer.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Seguir respondiendo</AlertDialogCancel>
          <AlertDialogAction disabled={submitting} onClick={onSubmit}>
            {submitting ? "Entregando..." : "Entregar"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Una tarea del intento, suelta en la página como en el probador, sin tarjeta. */
function TaskSection({
  task,
  value,
  onChange,
  disabled = false,
}: {
  task: PlayTask;
  value: unknown;
  onChange: (payload: unknown) => void;
  disabled?: boolean;
}) {
  return (
    // Con todas las tareas a la vez, una línea fina separa una de la otra.
    <section className="flex flex-col gap-5 border-b pb-8 last:border-b-0 last:pb-0">
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          Tarea {task.position}
        </span>
        <h2 className="text-xl font-semibold">{task.title}</h2>
      </div>
      <TaskPlayContent
        task={task}
        value={value}
        disabled={disabled}
        onChange={onChange}
      />
    </section>
  );
}
