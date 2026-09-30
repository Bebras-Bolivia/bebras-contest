"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  CircleCheckIcon,
  ClockIcon,
  ListOrderedIcon,
  MonitorSmartphoneIcon,
  UserIcon,
  SaveIcon,
  SendIcon,
  TimerIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";

import {
  BEBRAS_SCORING,
  gradeLabel,
  isTaskDifficulty,
} from "@/lib/contest-schema";
import { difficultyStyles } from "@/lib/difficulty";
import type { AttemptState } from "@/lib/play-api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

function Stat({
  icon: Icon,
  value,
  label,
}: {
  icon: LucideIcon;
  value: string;
  label: string;
}) {
  return (
    <div className="flex items-center gap-3 border-2 border-border/20 px-4 py-3">
      <Icon className="size-6 shrink-0 text-primary" aria-hidden="true" />
      <div className="flex min-w-0 flex-col">
        <span className="text-lg leading-tight font-semibold">{value}</span>
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
    </div>
  );
}

function Rule({
  icon: Icon,
  children,
}: {
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-3 text-sm leading-6">
      <Icon
        className="mt-0.5 size-5 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <span>{children}</span>
    </li>
  );
}

const READING_SECONDS = 5;

/** Lo que el estudiante lee antes de empezar: el desafío, sus reglas y el puntaje. */
export function ContestIntro({
  attempt,
  top,
  notice,
  canStart,
  starting,
  onStart,
  onLeave,
}: {
  attempt: AttemptState;
  top?: ReactNode;
  notice?: ReactNode;
  canStart: boolean;
  starting: boolean;
  onStart: () => void;
  onLeave?: () => void;
}) {
  const taskCount = attempt.taskCount ?? attempt.tasks.length;
  // Unos segundos obligados en las reglas antes de poder empezar.
  const [readingLeft, setReadingLeft] = useState(READING_SECONDS);

  useEffect(() => {
    if (readingLeft <= 0) return;
    const id = window.setTimeout(
      () => setReadingLeft((left) => left - 1),
      1000,
    );
    return () => window.clearTimeout(id);
  }, [readingLeft]);
  const oneByOne = attempt.questionDisplayMode !== "all";
  const rules = attempt.rules;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
      {top}

      <header className="flex flex-col gap-1">
        {attempt.category && (
          <span className="text-sm font-semibold tracking-wide text-primary uppercase">
            Categoría {attempt.category}
          </span>
        )}
        <h1 className="font-heading text-3xl font-semibold tracking-tight">
          {attempt.contestTitle}
        </h1>
        {attempt.participant && (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 text-sm text-muted-foreground">
            <CircleCheckIcon
              className="size-4 text-difficulty-easy"
              aria-hidden="true"
            />
            <span>
              Entraste como{" "}
              <strong className="text-foreground">
                {attempt.participant.members.join(" y ")}
              </strong>
              {attempt.participant.grade
                ? ` · ${gradeLabel(attempt.participant.grade)}`
                : ""}
            </span>
            {onLeave && (
              <button
                type="button"
                onClick={onLeave}
                className="underline underline-offset-4 hover:text-foreground"
              >
                ¿No eres tú? Salir
              </button>
            )}
          </p>
        )}
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          icon={TimerIcon}
          value={`${attempt.durationMinutes} minutos`}
          label="para resolverlo"
        />
        <Stat
          icon={ListOrderedIcon}
          value={`${taskCount} ${taskCount === 1 ? "pregunta" : "preguntas"}`}
          label={oneByOne ? "una por una" : "todas en una página"}
        />
        <Stat
          icon={attempt.participationMode === "pareja" ? UsersIcon : UserIcon}
          value={
            attempt.participationMode === "pareja" ? "En pareja" : "Individual"
          }
          label="un solo intento"
        />
      </div>

      <section className="flex flex-col gap-4">
        <h2 className="font-heading text-lg font-semibold">Antes de empezar</h2>
        <ul className="flex flex-col gap-3">
          <Rule icon={ClockIcon}>
            El reloj arranca cuando tocas <strong>Empezar el desafío</strong> y
            no se detiene, aunque cierres la página.
          </Rule>
          <Rule icon={SaveIcon}>
            Tus respuestas se guardan solas. Puedes cambiarlas todas las veces
            que quieras hasta que entregues.
          </Rule>
          <Rule icon={SendIcon}>
            Cuando se acaba el tiempo, lo que respondiste se entrega solo.
          </Rule>
          {oneByOne && (
            <Rule icon={ListOrderedIcon}>
              Puedes ir y volver entre las preguntas tocando sus números.
            </Rule>
          )}
          <Rule icon={MonitorSmartphoneIcon}>
            Úsalo en un solo dispositivo a la vez: si entras desde otro, este se
            cierra.
          </Rule>
        </ul>
      </section>

      {rules && rules.scoring.length > 0 && (
        <section className="flex flex-col gap-4">
          <h2 className="font-heading text-lg font-semibold">
            Cómo se cuentan los puntos
          </h2>
          <div className="flex flex-col border-t">
            {rules.scoring.map((row) => (
              <div
                key={row.difficulty}
                className="grid grid-cols-[5rem_1fr] items-center gap-x-4 gap-y-1 border-b py-3 text-sm sm:grid-cols-[5rem_1fr_auto_auto]"
              >
                <span
                  className={cn(
                    "w-fit px-1.5 py-0.5 text-xs font-semibold",
                    difficultyStyles[row.difficulty]?.className,
                  )}
                >
                  {isTaskDifficulty(row.difficulty)
                    ? BEBRAS_SCORING[row.difficulty].label
                    : row.difficulty}
                </span>
                <span className="text-muted-foreground">
                  {row.count} {row.count === 1 ? "pregunta" : "preguntas"}
                </span>
                <span className="col-start-2 font-medium sm:col-start-auto">
                  +{row.correct} si aciertas
                </span>
                <span className="col-start-2 font-medium text-destructive sm:col-start-auto">
                  {row.wrong} si fallas
                </span>
              </div>
            ))}
          </div>
          <p className="text-sm leading-6 text-muted-foreground">
            Una pregunta en blanco no suma ni resta: si no estás seguro, mejor
            déjala sin responder. Empiezas con {rules.initialScore} puntos, así
            tu puntaje nunca baja de cero.
          </p>
        </section>
      )}

      <div className="flex flex-col gap-4 border-t pt-6">
        {notice}
        {canStart && (
          <Button
            size="lg"
            className="w-full tabular-nums sm:ml-auto sm:w-auto"
            onClick={onStart}
            disabled={starting || readingLeft > 0}
          >
            {starting
              ? "Empezando..."
              : readingLeft > 0
                ? `Lee las reglas… ${readingLeft}`
                : "Empezar el desafío"}
          </Button>
        )}
      </div>
    </div>
  );
}
