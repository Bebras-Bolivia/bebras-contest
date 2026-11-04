"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { CheckIcon, LoaderCircleIcon } from "lucide-react";
import { toast } from "sonner";

import { ListPageSkeleton } from "@/components/page-skeletons";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  checkTrialTask,
  downloadTrialPlanilla,
  getTrialState,
  prepareTrialTask,
  saveTrialRun,
  saveTrialSus,
  type TrialResult,
  type TrialState,
} from "@/lib/trial-api";
import {
  SUS_STATEMENTS,
  TRIAL_AUTO,
  TRIAL_LIMIT_MINUTES,
  TRIAL_RESULT_LABEL,
  TRIAL_TASK_HINT,
  TRIAL_TASK_TEXT,
  formatTrialSeconds,
} from "@/lib/trial-content";
import { trialSessionUrl, trialViewUrl } from "@/lib/trial-view";
import { cn } from "@/lib/utils";

type TrialNotes = Record<
  string,
  { note: string; planilla: boolean; path?: string }
>;

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    return JSON.parse(window.localStorage.getItem(key) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return;
  }
}

function viewPath(code: string) {
  return code === "M2" || code === "M3" ? "/grupos" : "/";
}

function otherHost() {
  const { hostname } = window.location;
  if (hostname === "localhost") return "127.0.0.1";
  if (hostname === "127.0.0.1") return "localhost";
  return null;
}

function registrationUrl(sessionId: string) {
  const host = otherHost();
  if (!host) return trialSessionUrl("/login?prueba=1", sessionId);
  const { protocol, port } = window.location;
  return trialSessionUrl(
    `${protocol}//${host}${port ? `:${port}` : ""}/login?prueba=1`,
    sessionId,
  );
}

export function TrialGuide() {
  const [sessionId] = useState(() =>
    typeof window === "undefined"
      ? ""
      : (new URLSearchParams(window.location.search).get("sesion") ?? ""),
  );
  const [initial, setInitial] = useState<TrialState | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!sessionId) return;
    let alive = true;
    void getTrialState(sessionId)
      .then((data) => {
        if (alive) setInitial(data);
      })
      .catch((failure: unknown) => {
        if (alive) {
          setError(
            failure instanceof Error ? failure.message : "No se pudo cargar.",
          );
        }
      });
    return () => {
      alive = false;
    };
  }, [sessionId]);

  if (!sessionId || error) {
    return (
      <p role="alert" className="text-sm font-medium text-destructive">
        {error || "Falta elegir la prueba. Empiézala desde «Pruebas guiadas»."}
      </p>
    );
  }

  if (!initial) {
    return <ListPageSkeleton />;
  }

  return <GuideBody sessionId={sessionId} initial={initial} />;
}

function GuideBody({
  sessionId,
  initial,
}: {
  sessionId: string;
  initial: TrialState;
}) {
  const startedKey = `bebras_trial_started_${sessionId}`;
  const notesKey = `bebras_trial_notes_${sessionId}`;
  const [state, setState] = useState(initial);
  const [started, setStarted] = useState(() =>
    readJson<Record<string, number>>(startedKey, {}),
  );
  const [notes, setNotes] = useState(() => readJson<TrialNotes>(notesKey, {}));
  const [preparing, setPreparing] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [comment, setComment] = useState("");
  const [detected, setDetected] = useState<{
    code: string;
    seconds: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);
  const [answers, setAnswers] = useState<number[]>(() =>
    SUS_STATEMENTS.map(() => 0),
  );
  const [susSent, setSusSent] = useState(false);

  const runs = new Map(state.runs.map((run) => [run.taskCode, run]));
  const current = state.tasks.find((code) => !runs.has(code)) ?? null;
  const startedAt = current ? started[current] : undefined;
  const limit = current ? (TRIAL_LIMIT_MINUTES[current] ?? 10) * 60 : 0;
  const elapsed = startedAt
    ? Math.max(0, Math.floor((now - startedAt) / 1000))
    : 0;
  const expired = Boolean(startedAt) && elapsed >= limit;
  const auto = current ? TRIAL_AUTO.includes(current) : false;

  const finishWith = async (
    code: string,
    result: TrialResult,
    seconds: number,
    text: string,
  ) => {
    setBusy(true);
    try {
      await saveTrialRun(sessionId, code, result, seconds, text);
      setState((previous) => ({
        ...previous,
        runs: [
          ...previous.runs,
          { taskCode: code, result, seconds, comment: text || null },
        ],
      }));
      setComment("");
      setDetected(null);
      const next = { ...started };
      delete next[code];
      setStarted(next);
      writeJson(startedKey, next);
    } catch (failure) {
      toast.error(
        failure instanceof Error ? failure.message : "No se pudo guardar.",
      );
    } finally {
      setBusy(false);
      setClosing(false);
    }
  };

  const autoFinish = useEffectEvent(
    async (kind: "done" | "timeout", at: string | null) => {
      if (!current || !startedAt || closing || detected) return;
      if (kind === "timeout") {
        setClosing(true);
        await finishWith(current, "failed", limit, "Se acabó el tiempo.");
        return;
      }
      const seconds = at
        ? Math.round((Date.parse(at) - startedAt) / 1000)
        : elapsed;
      setDetected({
        code: current,
        seconds: Math.min(Math.max(seconds, 1), limit),
      });
    },
  );

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (
      !current ||
      !startedAt ||
      !TRIAL_AUTO.includes(current) ||
      detected?.code === current
    )
      return;
    let alive = true;
    const check = () =>
      void checkTrialTask(sessionId, current, startedAt)
        .then((result) => {
          if (alive && result.done) void autoFinish("done", result.at);
        })
        .catch(() => undefined);
    check();
    const timer = setInterval(check, 4000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [sessionId, current, startedAt, detected]);

  useEffect(() => {
    if (expired) void autoFinish("timeout", null);
  }, [expired, current]);

  const start = async (code: string) => {
    const teacher = state.teacher;
    const tab =
      state.role === "admin" || code === "M1" || teacher
        ? window.open("about:blank", "_blank")
        : null;
    setPreparing(code);
    try {
      const prepared = await prepareTrialTask(sessionId, code);
      if (prepared.note || prepared.path || prepared.planilla) {
        const nextNotes = {
          ...notes,
          [code]: {
            note: prepared.note ?? "",
            planilla: Boolean(prepared.planilla),
            path: prepared.path,
          },
        };
        setNotes(nextNotes);
        writeJson(notesKey, nextNotes);
      }
      if (tab && code === "M1") {
        tab.location.href = registrationUrl(sessionId);
      } else if (tab && state.role === "admin") {
        tab.location.href = trialViewUrl("/", state.actor, sessionId);
      } else if (tab && teacher) {
        tab.location.href = trialViewUrl(viewPath(code), teacher, sessionId);
      }
    } catch (failure) {
      tab?.close();
      toast.error(
        failure instanceof Error
          ? failure.message
          : "No se pudo preparar la tarea.",
      );
      setPreparing(null);
      return;
    }
    setPreparing(null);
    const next = { ...started, [code]: Date.now() };
    setStarted(next);
    writeJson(startedKey, next);
  };

  const sendSus = async () => {
    setBusy(true);
    try {
      await saveTrialSus(sessionId, answers);
      setSusSent(true);
    } catch (failure) {
      toast.error(
        failure instanceof Error ? failure.message : "No se pudo guardar.",
      );
    } finally {
      setBusy(false);
    }
  };

  const allTasksDone = current === null;
  const finished = state.susDone || susSent;
  const teacher = state.teacher;

  return (
    <div className="flex w-full flex-col gap-8">
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold tracking-wide text-primary uppercase">
          {state.role === "admin" ? "Organizador" : "Maestro"} ·{" "}
          {state.person.firstName} {state.person.lastName}
        </span>
        <h1 className="font-heading text-3xl font-semibold tracking-tight">
          Prueba guiada
        </h1>
        <p className="text-muted-foreground">
          Que haga cada tarea en el sistema, sin ayuda. La app detecta sola
          cuándo la termina y, si se pasa del tiempo, la marca «No pude». Si
          sales, al volver sigue donde quedó.
        </p>
      </div>

      <ol className="flex flex-col">
        {state.tasks.map((code) => {
          const run = runs.get(code);
          const isCurrent = code === current;
          return (
            <li
              key={code}
              className={cn(
                "flex flex-col gap-3 border-t py-4",
                !run && !isCurrent && "opacity-50",
              )}
            >
              <div className="flex items-start gap-3">
                <span className="w-9 shrink-0 text-sm font-semibold text-primary">
                  {code}
                </span>
                <span className="flex-1">{TRIAL_TASK_TEXT[code]}</span>
                {run && (
                  <span className="flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground">
                    <CheckIcon
                      className="size-4 text-difficulty-easy"
                      aria-hidden="true"
                    />
                    {TRIAL_RESULT_LABEL[run.result]} ·{" "}
                    {formatTrialSeconds(run.seconds)}
                  </span>
                )}
              </div>

              {isCurrent &&
                TRIAL_TASK_HINT[code] &&
                !(code === "M1" && otherHost()) && (
                  <p className="pl-12 text-sm text-muted-foreground">
                    {TRIAL_TASK_HINT[code]}
                  </p>
                )}

              {isCurrent && !startedAt && (
                <div className="flex flex-col gap-2 pl-12">
                  <p className="text-sm text-muted-foreground">
                    Tiene {TRIAL_LIMIT_MINUTES[code] ?? 10} minutos.
                  </p>
                  <div>
                    <Button
                      type="button"
                      disabled={preparing !== null}
                      onClick={() => void start(code)}
                    >
                      {preparing === code && (
                        <LoaderCircleIcon
                          data-icon="inline-start"
                          className="animate-spin"
                        />
                      )}
                      Empezar
                    </Button>
                  </div>
                  {preparing === code && (
                    <p className="text-sm text-muted-foreground">
                      Preparando el escenario…
                    </p>
                  )}
                </div>
              )}

              {isCurrent && startedAt && (
                <div className="flex flex-col gap-4 pl-12">
                  {detected?.code !== code && (
                    <p className="text-sm text-muted-foreground">
                      Lleva {formatTrialSeconds(elapsed)} de{" "}
                      {formatTrialSeconds(limit)}.{" "}
                      {auto
                        ? "Cuando lo haga, la app lo detecta sola."
                        : "Esta tarea no se detecta sola: márcala tú."}
                    </p>
                  )}
                  {detected?.code !== code && notes[code]?.note && (
                    <p className="text-sm">{notes[code].note}</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {code === "M1" && (
                      <Button asChild variant="outline" size="sm">
                        <a
                          href={registrationUrl(sessionId)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Abrir el registro
                        </a>
                      </Button>
                    )}
                    {state.role === "admin" && (
                      <Button asChild variant="outline" size="sm">
                        <a
                          href={trialViewUrl("/", state.actor, sessionId)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Abrir la pantalla
                        </a>
                      </Button>
                    )}
                    {code !== "M1" && state.role === "maestro" && teacher && (
                      <Button asChild variant="outline" size="sm">
                        <a
                          href={trialViewUrl(
                            viewPath(code),
                            teacher,
                            sessionId,
                          )}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Abrir la vista de maestro
                        </a>
                      </Button>
                    )}
                    {notes[code]?.planilla && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void downloadTrialPlanilla()}
                      >
                        Descargar planilla de ejemplo
                      </Button>
                    )}
                  </div>
                  {detected?.code === code && (
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <CheckIcon
                        className="size-4 shrink-0 text-difficulty-easy"
                        aria-hidden="true"
                      />
                      Tarea terminada en {formatTrialSeconds(detected.seconds)}.
                      ¿Lo logró solo o con ayuda?
                    </p>
                  )}
                  <Textarea
                    value={comment}
                    maxLength={500}
                    rows={2}
                    placeholder="¿Algo le costó o no se entendió? (opcional)"
                    onChange={(event) => setComment(event.target.value)}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void finishWith(
                          code,
                          "alone",
                          detected?.code === code ? detected.seconds : elapsed,
                          comment,
                        )
                      }
                    >
                      Lo logró solo
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void finishWith(
                          code,
                          "help",
                          detected?.code === code ? detected.seconds : elapsed,
                          comment,
                        )
                      }
                    >
                      Lo logró con ayuda
                    </Button>
                    {detected?.code !== code && (
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          void finishWith(code, "failed", elapsed, comment)
                        }
                      >
                        No pudo
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {allTasksDone && !finished && (
        <section className="flex flex-col gap-4 border-t pt-6">
          <div className="flex flex-col gap-1">
            <h2 className="font-heading text-xl font-semibold">
              Para terminar
            </h2>
            <p className="text-sm text-muted-foreground">
              Que elija de 1 (nada de acuerdo) a 5 (totalmente de acuerdo) en
              cada frase.
            </p>
          </div>
          <ol className="flex flex-col gap-5">
            {SUS_STATEMENTS.map((statement, index) => (
              <li key={statement} className="flex flex-col gap-2">
                <span className="text-sm">
                  {index + 1}. {statement}
                </span>
                <div
                  role="radiogroup"
                  aria-label={statement}
                  className="grid max-w-sm grid-cols-5 gap-2"
                >
                  {[1, 2, 3, 4, 5].map((value) => {
                    const selected = answers[index] === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() =>
                          setAnswers((list) =>
                            list.map((item, position) =>
                              position === index ? value : item,
                            ),
                          )
                        }
                        className={cn(
                          "min-h-11 border-2 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
                          selected
                            ? "border-primary bg-primary/5 font-semibold"
                            : "border-border/30 text-muted-foreground hover:border-primary/60",
                        )}
                      >
                        {value}
                      </button>
                    );
                  })}
                </div>
              </li>
            ))}
          </ol>
          <div>
            <Button
              type="button"
              disabled={busy || answers.some((value) => value === 0)}
              onClick={() => void sendSus()}
            >
              {busy && (
                <LoaderCircleIcon
                  data-icon="inline-start"
                  className="animate-spin"
                />
              )}
              Enviar
            </Button>
          </div>
        </section>
      )}

      {allTasksDone && finished && (
        <p className="flex items-center gap-2 border-t pt-6 text-muted-foreground">
          <CheckIcon
            className="size-5 text-difficulty-easy"
            aria-hidden="true"
          />
          Gracias. La prueba terminó.
        </p>
      )}
    </div>
  );
}
