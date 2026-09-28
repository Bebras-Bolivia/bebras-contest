"use client";

import { useEffect, useState } from "react";
import { ArrowRightIcon, CheckIcon, RotateCcwIcon } from "lucide-react";

import { practiceOutcome } from "@/lib/practice-progress";
import { difficultyStyles } from "@/lib/difficulty";
import {
  cachedPracticeTasks,
  listPracticeTasks,
  type PracticeTaskList,
} from "@/lib/practice-api";
import { practiceOrigin, practiceTaskHref } from "@/lib/practice-navigation";
import { cn } from "@/lib/utils";
import { surface, surfaceLink } from "@/lib/surface";

const HOW_TO_ANSWER: Record<string, string> = {
  multiple_choice: "Elige la respuesta",
  short_text: "Escribe la respuesta",
  drag_drop: "Arrastra las piezas",
  image_hotspot: "Toca la imagen",
  state_grid: "Marca las casillas",
  text_cloze: "Completa la frase",
};

type Outcome = "correct" | "wrong" | null;

function outcomesFor(list: PracticeTaskList | null) {
  return Object.fromEntries(
    (list?.tasks ?? []).map((task) => [task.id, outcomeOf(task.id)]),
  ) as Record<string, Outcome>;
}

function outcomeOf(taskId: string): Outcome {
  return practiceOutcome(taskId);
}

export function PracticeList() {
  const [category] = useState(() =>
    typeof window !== "undefined"
      ? (new URLSearchParams(window.location.search).get("nombre") ?? "").trim()
      : "",
  );
  const [origin] = useState(() =>
    typeof window !== "undefined"
      ? practiceOrigin(new URLSearchParams(window.location.search).get("from"))
      : "/practica",
  );
  const [instant] = useState(
    () => category !== "" && cachedPracticeTasks(category) !== null,
  );
  const [data, setData] = useState<PracticeTaskList | null>(() =>
    category ? cachedPracticeTasks(category) : null,
  );
  const [outcomes, setOutcomes] = useState(() => outcomesFor(data));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!category) {
      return;
    }
    let active = true;
    listPracticeTasks(category)
      .then((result) => {
        if (!active) return;
        setData(result);
        setOutcomes(outcomesFor(result));
      })
      .catch(() => {
        if (active) {
          setFailed(true);
        }
      });
    return () => {
      active = false;
    };
  }, [category]);

  if (!category || failed) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <img
          src="/castores/estandar.webp"
          alt=""
          className="h-24 w-auto opacity-80"
        />
        <p className="font-semibold">No encontramos esta categoría</p>
        <a
          href={origin}
          className="text-sm text-primary underline underline-offset-4"
        >
          Ver todas las categorías
        </a>
      </div>
    );
  }

  if (data === null) {
    return (
      <div aria-busy className="flex flex-col gap-6">
        <span className="sr-only">Cargando desafíos...</span>
        <div className="flex flex-col gap-2">
          <div className="h-9 w-48 animate-pulse bg-muted" />
          <div className="h-4 w-24 animate-pulse bg-muted/70" />
        </div>
        <div className="flex flex-col gap-2">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className={cn(surface, "h-16 animate-pulse")} />
          ))}
        </div>
      </div>
    );
  }

  const solved = data.tasks.filter(
    (task) => outcomes[task.id] === "correct",
  ).length;

  return (
    <div className="flex flex-col gap-6">
      <div
        className={cn(
          "flex flex-col gap-1",
          !instant &&
            "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-300",
        )}
      >
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          {data.category}
        </h1>
        <p className="text-sm text-muted-foreground">
          {data.age}
          {data.tasks.length > 0 &&
            ` · ${data.tasks.length} ${data.tasks.length === 1 ? "desafío" : "desafíos"}`}
          {solved > 0 && (
            <span className="text-foreground">
              {" "}
              · {solved} {solved === 1 ? "resuelto" : "resueltos"}
            </span>
          )}
        </p>
      </div>

      {data.tasks.length === 0 ? (
        <p
          className={cn(
            surface,
            "px-4 py-6 text-center text-sm text-muted-foreground",
          )}
        >
          Aún no hay desafíos en esta categoría.
        </p>
      ) : (
        <ol className="grid gap-3 lg:grid-cols-2">
          {data.tasks.map((task, index) => {
            const outcome = outcomes[task.id];
            return (
              <li
                key={task.id}
                style={
                  instant
                    ? undefined
                    : { animationDelay: `${Math.min(index, 12) * 40}ms` }
                }
                className={cn(
                  !instant &&
                    "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-300 motion-safe:fill-mode-both",
                )}
              >
                <a
                  href={practiceTaskHref(task.id, data.category, origin)}
                  className={cn(
                    surfaceLink,
                    "group flex items-center gap-4 p-3 pr-4",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-10 shrink-0 items-center justify-center font-semibold tabular-nums transition-colors duration-200",
                      outcome === "correct"
                        ? "bg-difficulty-easy/40"
                        : "bg-background group-hover:text-primary",
                    )}
                  >
                    {outcome === "correct" ? (
                      <CheckIcon className="size-5" />
                    ) : (
                      index + 1
                    )}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="font-medium">{task.title}</span>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      {task.difficulty && (
                        <span
                          className={cn(
                            "px-1.5 py-px text-[0.7rem] font-semibold",
                            difficultyStyles[task.difficulty].className,
                          )}
                        >
                          {difficultyStyles[task.difficulty].label}
                        </span>
                      )}
                      {outcome === "correct"
                        ? "¡Resuelto!"
                        : outcome === "wrong"
                          ? "Inténtalo de nuevo"
                          : (HOW_TO_ANSWER[task.answerType] ?? "Resuélvelo")}
                    </span>
                  </span>
                  {outcome === "wrong" ? (
                    <RotateCcwIcon className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
                  ) : (
                    <ArrowRightIcon className="size-5 shrink-0 text-muted-foreground transition-[color,transform] duration-200 group-hover:translate-x-1 group-hover:text-primary motion-reduce:transition-none" />
                  )}
                </a>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
