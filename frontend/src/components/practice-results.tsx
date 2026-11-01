"use client";

import { PracticeResultsSkeleton } from "@/components/page-skeletons";
import { useEffect, useState } from "react";
import { DownloadIcon } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { enter } from "@/lib/surface";
import {
  CONTEST_STATE_LABELS,
  formatContestWindow,
  gradeLabel,
} from "@/lib/contest-schema";
import {
  downloadPracticeResults,
  listPracticeResults,
  type PracticeResults,
} from "@/lib/practices-api";
import { CategoryLogo, categoryStyle } from "@/components/category-logo";
import { DifficultyTag } from "@/components/contest-task-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Mark = "C" | "X" | "-";

const MARK_STYLES: Record<Mark, string> = {
  C: "bg-difficulty-easy",
  X: "bg-destructive",
  "-": "bg-foreground/15",
};

const MARK_LABEL: Record<Mark, string> = {
  C: "correcta",
  X: "incorrecta",
  "-": "sin responder",
};

function markAt(marks: string, index: number): Mark {
  const mark = marks[index];
  return mark === "C" || mark === "X" ? mark : "-";
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className={cn(enter, "flex flex-col gap-0.5")}>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-3xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

export function PracticeResultsPage() {
  const [practiceId] = useState(() =>
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("id")
      : null,
  );
  const [data, setData] = useState<PracticeResults | null>(null);
  const [loading, setLoading] = useState(Boolean(practiceId));
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!practiceId) return;
    let alive = true;
    void listPracticeResults(practiceId)
      .then((loaded) => {
        if (alive) setData(loaded);
      })
      .catch((error: unknown) => {
        toast.error(
          error instanceof Error
            ? error.message
            : "No se pudieron cargar los resultados.",
        );
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [practiceId]);

  if (loading) {
    return <PracticeResultsSkeleton />;
  }

  if (!data) {
    return (
      <p className="text-sm text-muted-foreground">
        No se encontró la práctica.
      </p>
    );
  }

  const { practice, tasks, results, pending } = data;
  const finished = results.length;
  const average =
    finished > 0
      ? Math.round(
          results.reduce((total, row) => total + row.totalScore, 0) / finished,
        )
      : null;
  const taskStats = tasks.map((task, index) => {
    const correct = results.filter(
      (row) => markAt(row.marks, index) === "C",
    ).length;
    const wrong = results.filter(
      (row) => markAt(row.marks, index) === "X",
    ).length;
    return { task, correct, wrong };
  });
  const hardest = taskStats.reduce<(typeof taskStats)[number] | null>(
    (worst, item) => (!worst || item.correct < worst.correct ? item : worst),
    null,
  );
  const download = () => {
    setDownloading(true);
    downloadPracticeResults(practice.id, practice.title)
      .catch((error: unknown) =>
        toast.error(
          error instanceof Error
            ? error.message
            : "No se pudieron descargar los resultados.",
        ),
      )
      .finally(() => setDownloading(false));
  };
  const share = (value: number) =>
    finished ? `${(value / finished) * 100}%` : "0%";

  return (
    <div className="flex flex-col gap-8 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-300">
      <div className="flex min-w-0 items-center gap-4 border-b pb-6">
        <CategoryLogo name={practice.category} className="size-20 sm:size-24" />
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge data-category style={categoryStyle(practice.category)}>
              {practice.category}
            </Badge>
            <Badge variant="outline">
              {CONTEST_STATE_LABELS[practice.state] ?? practice.state}
            </Badge>
          </div>
          <h1 className="font-heading text-2xl font-semibold break-words sm:text-3xl">
            {practice.title}
          </h1>
          <p className="text-sm text-muted-foreground">
            {formatContestWindow(practice.startsAt, practice.endsAt)}
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        <Stat label="Inscritos" value={finished + pending.length} />
        <Stat label="Terminaron" value={finished} />
        <Stat label="Puntaje promedio" value={average ?? "—"} />
        <Stat label="Mejor puntaje" value={results[0]?.totalScore ?? "—"} />
      </dl>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-heading text-lg font-semibold">Puntajes</h2>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={downloading}
            onClick={download}
          >
            <DownloadIcon data-icon="inline-start" />
            {downloading ? "Descargando…" : "Descargar Excel"}
          </Button>
        </div>
        <ol className="divide-y border-y">
          {results.map((row, index) => (
            <li
              key={row.id}
              style={{ animationDelay: `${Math.min(index, 12) * 35}ms` }}
              className={cn(
                enter,
                "flex flex-wrap items-center gap-x-4 gap-y-2 py-3",
              )}
            >
              <span className="w-6 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
                {index + 1}
              </span>
              <div className="flex min-w-0 flex-1 basis-48 flex-col">
                <span className="font-medium break-words">{row.name}</span>
                <span className="text-sm text-muted-foreground">
                  {gradeLabel(row.grade)}
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {tasks.map((task, position) => {
                  const mark = markAt(row.marks, position);
                  return (
                    <span
                      key={task.id}
                      title={`${position + 1}. ${task.title}: ${MARK_LABEL[mark]}`}
                      className={cn("size-3.5", MARK_STYLES[mark])}
                    />
                  );
                })}
              </div>
              <div className="flex w-28 shrink-0 flex-col items-end">
                <span className="text-xl font-semibold tabular-nums">
                  {row.totalScore}
                  <span className="text-sm font-normal text-muted-foreground">
                    {" "}
                    / {data.maxScore}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {row.correctCount} de {row.taskCount} correctas
                </span>
              </div>
            </li>
          ))}
          {pending.map((student) => (
            <li
              key={student.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3"
            >
              <span className="w-6 shrink-0" />
              <div className="flex min-w-0 flex-1 basis-48 flex-col">
                <span className="font-medium break-words">{student.name}</span>
                <span className="text-sm text-muted-foreground">
                  {gradeLabel(student.grade)}
                </span>
              </div>
              <span className="text-sm text-muted-foreground">
                Todavía no la hizo
              </span>
            </li>
          ))}
        </ol>
        {finished > 0 && (
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {(["C", "X", "-"] as const).map((mark) => (
              <span key={mark} className="flex items-center gap-1.5">
                <span className={cn("size-3", MARK_STYLES[mark])} />
                {MARK_LABEL[mark][0].toUpperCase() + MARK_LABEL[mark].slice(1)}
              </span>
            ))}
          </p>
        )}
      </section>

      {finished > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-heading text-lg font-semibold">Preguntas</h2>
          <ol className="divide-y border-y">
            {taskStats.map((item, index) => (
              <li
                key={item.task.id}
                style={{ animationDelay: `${Math.min(index, 12) * 40}ms` }}
                className={cn(enter, "py-3")}
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="w-6 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 font-medium break-words">
                    {item.task.title}
                  </span>
                  {item === hardest && item.correct < finished && (
                    <span className="text-xs font-semibold text-destructive">
                      La que más costó
                    </span>
                  )}
                  <DifficultyTag difficulty={item.task.difficulty} />
                  <span className="w-24 shrink-0 text-right text-sm tabular-nums">
                    <span className="font-semibold">{item.correct}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      de {finished}
                    </span>
                  </span>
                </div>
                <div
                  className="grow-x mt-2 ml-9 flex h-1 origin-left overflow-hidden bg-foreground/10"
                  style={{
                    animationDelay: `${150 + Math.min(index, 12) * 40}ms`,
                  }}
                >
                  <span
                    className="bg-difficulty-easy"
                    style={{ width: share(item.correct) }}
                  />
                  <span
                    className="bg-destructive"
                    style={{ width: share(item.wrong) }}
                  />
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
