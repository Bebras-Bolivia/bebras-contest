"use client";

import { useEffect, useRef, type ReactNode } from "react";
import {
  CheckIcon,
  ChevronDownIcon,
  CircleCheckBigIcon,
  ClockIcon,
  MinusIcon,
  TrophyIcon,
  XIcon,
} from "lucide-react";

import { formatCountdown, useNow } from "@/lib/countdown";
import type { AttemptState } from "@/lib/play-api";
import { cn } from "@/lib/utils";
import { TaskExplanation } from "@/components/task-explanation";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

export type FinishVisibility = {
  score: boolean;
  feedback: boolean;
  solutions: boolean;
};

function Stat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 border-2 border-border/20 px-4 py-4">
      <span className="text-3xl leading-none font-semibold tabular-nums">
        {value}
      </span>
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  );
}

const STATUS = {
  correct: {
    label: "Correcta",
    icon: CheckIcon,
    className: "bg-difficulty-easy text-difficulty-easy-foreground",
  },
  wrong: {
    label: "Incorrecta",
    icon: XIcon,
    className: "bg-difficulty-hard text-difficulty-hard-foreground",
  },
  blank: {
    label: "Sin responder",
    icon: MinusIcon,
    className: "bg-muted text-muted-foreground",
  },
} as const;

/** Mientras no hay resultados: cuánto falta para que cierre la rendición. */
function PendingResults({
  releaseAt,
  hasScore,
  onDue,
}: {
  releaseAt: string | null;
  hasScore: boolean;
  onDue?: () => void;
}) {
  const releaseMs = releaseAt ? new Date(releaseAt).getTime() : 0;
  const now = useNow(Boolean(releaseMs));
  const remaining = releaseMs - now;
  const due = Boolean(releaseMs) && remaining <= 0;

  const onDueRef = useRef(onDue);
  useEffect(() => {
    onDueRef.current = onDue;
  });

  // Al llegar la hora los resultados ya se publicaron solos: se vuelven a pedir.
  useEffect(() => {
    if (!due) return;
    const id = window.setTimeout(() => onDueRef.current?.(), 1500);
    return () => window.clearTimeout(id);
  }, [due]);

  return (
    <div className="flex flex-col items-center gap-2 border-2 border-dashed border-border/30 px-4 py-5 text-center text-sm leading-6 text-muted-foreground">
      {remaining > 0 ? (
        <>
          <span>Tus resultados se publican en</span>
          <span
            role="timer"
            className="font-heading text-3xl font-semibold text-foreground tabular-nums"
          >
            {formatCountdown(remaining)}
          </span>
          <span>
            {hasScore
              ? "Ahí verás tu lugar en la categoría."
              : "Se publican solos: vuelve a esta página o espera aquí."}
          </span>
        </>
      ) : due ? (
        "Publicando los resultados…"
      ) : (
        "Los resultados se publican cuando termine el desafío."
      )}
    </div>
  );
}

/** La pantalla que ve el equipo cuando entrega o se le acaba el tiempo. */
export function ContestFinish({
  attempt,
  outOfTime,
  visible,
  top,
  onResultsDue,
}: {
  attempt: AttemptState;
  outOfTime: boolean;
  visible: FinishVisibility;
  top?: ReactNode;
  onResultsDue?: () => void;
}) {
  const releaseAt = attempt.resultsAt ?? attempt.contestEndsAt;
  const taskCount = attempt.tasks.length;
  const result = visible.score ? attempt.result : null;
  const showList = visible.feedback || visible.solutions;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
      {top}

      <section className="flex flex-col items-center gap-3 pt-4 text-center">
        {outOfTime ? (
          <ClockIcon
            aria-hidden="true"
            className="size-16 text-muted-foreground motion-safe:animate-in motion-safe:zoom-in-0 motion-safe:duration-500 motion-safe:ease-[cubic-bezier(0.34,1.56,0.64,1)]"
          />
        ) : (
          <CircleCheckBigIcon
            aria-hidden="true"
            className="size-16 text-difficulty-easy motion-safe:animate-in motion-safe:zoom-in-0 motion-safe:-spin-in-45 motion-safe:duration-500 motion-safe:ease-[cubic-bezier(0.34,1.56,0.64,1)]"
          />
        )}
        <span className="text-sm font-semibold tracking-wide text-primary uppercase">
          {attempt.contestTitle}
          {attempt.category ? ` · ${attempt.category}` : ""}
        </span>
        <h1 className="font-heading text-3xl font-semibold tracking-tight">
          {outOfTime ? "Se acabó el tiempo" : "¡Terminaste!"}
        </h1>
        <p className="max-w-md text-muted-foreground">
          {outOfTime
            ? "Entregamos tus respuestas tal como estaban."
            : "Tus respuestas quedaron entregadas."}
        </p>
      </section>

      {result ? (
        <div
          className={cn(
            "grid grid-cols-2 gap-3",
            result.rankPosition && "sm:grid-cols-3",
          )}
        >
          <Stat value={result.totalScore} label="puntos" />
          <Stat
            value={
              <>
                {result.correctCount}
                <span className="text-lg text-muted-foreground">
                  {" "}
                  de {taskCount}
                </span>
              </>
            }
            label="correctas"
          />
          {result.rankPosition && (
            <Stat
              value={
                <span className="flex items-center gap-2">
                  <TrophyIcon className="size-6 text-primary" />
                  {result.rankPosition}.º
                </span>
              }
              label="lugar en tu categoría"
            />
          )}
        </div>
      ) : attempt.resultsPublished ? (
        <p className="border-2 border-dashed border-border/30 px-4 py-5 text-center text-sm text-muted-foreground">
          Tu maestro te compartirá los resultados.
        </p>
      ) : (
        <PendingResults
          releaseAt={releaseAt}
          hasScore={false}
          onDue={onResultsDue}
        />
      )}

      {result && !attempt.resultsPublished && (
        <PendingResults releaseAt={releaseAt} hasScore onDue={onResultsDue} />
      )}

      {showList && (
        <section className="flex flex-col gap-3">
          <h2 className="font-heading text-lg font-semibold">Tus respuestas</h2>
          <ul className="flex flex-col border-t">
            {attempt.tasks.map((task, index) => {
              const status =
                task.correct === true
                  ? STATUS.correct
                  : task.correct === false
                    ? STATUS.wrong
                    : STATUS.blank;
              const solution =
                visible.solutions && task.explanationBlocks?.length
                  ? task.explanationBlocks
                  : null;
              const row = (
                <>
                  <span className="w-6 shrink-0 text-right text-sm text-muted-foreground tabular-nums">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-left text-sm font-medium">
                    {task.title}
                  </span>
                  {visible.feedback && (
                    <span
                      className={cn(
                        "flex shrink-0 items-center gap-1 px-1.5 py-0.5 text-xs font-semibold",
                        status.className,
                      )}
                    >
                      <status.icon className="size-3" aria-hidden="true" />
                      {status.label}
                    </span>
                  )}
                </>
              );

              return (
                <li key={task.taskId} className="border-b">
                  {solution ? (
                    <Collapsible>
                      <CollapsibleTrigger className="group/row flex w-full items-center gap-3 py-3 outline-none hover:bg-muted/40 focus-visible:bg-muted/40">
                        {row}
                        <ChevronDownIcon
                          aria-label="Ver solución"
                          className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]/row:rotate-180"
                        />
                      </CollapsibleTrigger>
                      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
                        <TaskExplanation
                          blocks={solution}
                          className="pb-4 pl-9 text-sm"
                        />
                      </CollapsibleContent>
                    </Collapsible>
                  ) : (
                    <div className="flex items-center gap-3 py-3">{row}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
