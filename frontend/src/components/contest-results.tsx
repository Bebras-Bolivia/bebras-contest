"use client";

import { useEffect, useState } from "react";
import {
  CalculatorIcon,
  DownloadIcon,
  EyeIcon,
  EyeOffIcon,
  LoaderCircleIcon,
} from "lucide-react";
import { toast } from "sonner";

import {
  consolidateContest,
  getContestResults,
  publishContestResults,
  type ContestResultRow,
  type ContestResults,
  unpublishContestResults,
} from "@/lib/contests-api";
import { CONTEST_STATE_LABELS, gradeLabel } from "@/lib/contest-schema";
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
import { Button } from "@/components/ui/button";

const STATUS_LABEL: Record<string, string> = {
  pending: "Sin empezar",
  in_progress: "En curso",
  finished: "Terminado",
};

type VisibilityAction = "publish" | "unpublish" | "consolidate";

const VISIBILITY_COPY: Record<
  VisibilityAction,
  { title: string; description: string; confirm: string; success: string }
> = {
  publish: {
    title: "¿Publicar los resultados?",
    description:
      "Los participantes podrán consultar la información habilitada. Revisa los puntajes y el ranking antes de continuar.",
    confirm: "Publicar resultados",
    success: "Resultados publicados. Los participantes ya pueden verlos.",
  },
  consolidate: {
    title: "¿Calcular los resultados?",
    description:
      "Se cierran los intentos que quedaron abiertos y se arma el ranking de cada categoría.",
    confirm: "Calcular resultados",
    success: "Resultados calculados. Revísalos antes de publicarlos.",
  },
  unpublish: {
    title: "¿Ocultar los resultados?",
    description:
      "Los participantes dejarán de ver sus resultados hasta que vuelvan a publicarse. Los puntajes guardados no se eliminarán.",
    confirm: "Ocultar resultados",
    success: "Resultados ocultados.",
  },
};

function teamName(row: ContestResultRow) {
  const one = `${row.memberOneFirstName} ${row.memberOneLastName}`.trim();
  if (row.participationMode === "pareja" && row.memberTwoFirstName) {
    return `${one} · ${row.memberTwoFirstName} ${row.memberTwoLastName ?? ""}`.trim();
  }
  return one;
}

function formatElapsed(seconds: number | null) {
  if (seconds === null) {
    return "—";
  }

  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function csvCell(value: string | number | null) {
  const text = value === null ? "" : String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function exportCsv(results: ContestResults) {
  const header = [
    "Categoria",
    "Posicion",
    "Nombres",
    "Apellidos",
    "Nombres 2",
    "Apellidos 2",
    "Curso",
    "Grupo",
    "Modalidad",
    "Estado",
    "Tiempo (s)",
    "Puntaje",
    "Correctas",
    "Respondidas",
  ];
  const lines = results.rows.map((row) =>
    [
      row.category ?? "",
      row.rankPosition,
      row.memberOneFirstName,
      row.memberOneLastName,
      row.memberTwoFirstName ?? "",
      row.memberTwoLastName ?? "",
      gradeLabel(row.grade),
      row.groupName,
      row.participationMode,
      STATUS_LABEL[row.status] ?? row.status,
      row.elapsedSeconds,
      row.totalScore,
      row.correctCount,
      row.answeredCount,
    ]
      .map(csvCell)
      .join(","),
  );
  const csv = [header.join(","), ...lines].join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `resultados-${results.contestTitle.replace(/[^\p{L}\p{N}_-]+/gu, "-")}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function ContestResults() {
  const [contestId] = useState(() =>
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("id")
      : null,
  );
  const [results, setResults] = useState<ContestResults | null>(null);
  const [loading, setLoading] = useState(Boolean(contestId));
  const [category, setCategory] = useState("");
  const [confirming, setConfirming] = useState<VisibilityAction | null>(null);
  const [changing, setChanging] = useState(false);

  useEffect(() => {
    if (!contestId) return;
    let alive = true;
    void getContestResults(contestId)
      .then((data) => {
        if (alive) setResults(data);
      })
      .catch((error) => {
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
  }, [contestId]);

  const runAction = async () => {
    if (!contestId || !confirming) return;
    const action = confirming;
    setConfirming(null);
    setChanging(true);

    try {
      if (action === "consolidate") {
        await consolidateContest(contestId);
        setResults(await getContestResults(contestId));
      } else {
        const updated =
          action === "publish"
            ? await publishContestResults(contestId)
            : await unpublishContestResults(contestId);
        setResults((current) =>
          current ? { ...current, state: updated.state } : current,
        );
      }
      toast.success(VISIBILITY_COPY[action].success);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "No se pudo completar.",
      );
    } finally {
      setChanging(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-72 items-center justify-center">
        <LoaderCircleIcon className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!results) {
    return (
      <p className="text-sm text-muted-foreground">
        No se encontró el desafío.{" "}
        <a href="/desafios" className="underline underline-offset-4">
          Volver a Desafíos
        </a>
      </p>
    );
  }

  const tabs = results.categories.filter((item) =>
    results.rows.some((row) => row.category === item),
  );
  const activeCategory = tabs.includes(category) ? category : (tabs[0] ?? "");
  const rows = results.rows.filter((row) => row.category === activeCategory);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b pb-5">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="font-heading text-2xl font-semibold break-words">
            {results.contestTitle}
          </h1>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">
              {CONTEST_STATE_LABELS[results.state]}
            </span>
            {" · "}
            {results.rows.length}{" "}
            {results.rows.length === 1 ? "participante" : "participantes"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {results.state === "cerrada" && (
            <Button
              type="button"
              disabled={changing}
              onClick={() => setConfirming("consolidate")}
            >
              <CalculatorIcon data-icon="inline-start" />
              Calcular resultados
            </Button>
          )}
          {results.state === "consolidada" && (
            <Button
              type="button"
              disabled={changing}
              onClick={() => setConfirming("publish")}
            >
              <EyeIcon data-icon="inline-start" />
              Publicar resultados
            </Button>
          )}
          {results.state === "publicada" && (
            <Button
              type="button"
              variant="outline"
              disabled={changing}
              onClick={() => setConfirming("unpublish")}
            >
              <EyeOffIcon data-icon="inline-start" />
              Ocultar resultados
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            disabled={results.rows.length === 0}
            onClick={() => exportCsv(results)}
          >
            <DownloadIcon data-icon="inline-start" />
            CSV
          </Button>
        </div>
      </div>

      {results.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Todavía no hay participantes. Aparecen aquí cuando se inscriben.
        </p>
      ) : (
        <>
          {tabs.length > 1 && (
            <div
              role="tablist"
              aria-label="Categoría"
              className="-mx-4 flex gap-5 overflow-x-auto px-4 shadow-[inset_0_-1px_0_var(--border)] sm:mx-0 sm:px-0"
            >
              {tabs.map((item) => {
                const selected = item === activeCategory;
                return (
                  <button
                    key={item}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => setCategory(item)}
                    className="relative flex shrink-0 items-baseline gap-1.5 py-2.5 text-sm whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground aria-selected:font-medium aria-selected:text-foreground"
                  >
                    {item}
                    <span className="text-xs tabular-nums opacity-60">
                      {
                        results.rows.filter((row) => row.category === item)
                          .length
                      }
                    </span>
                    {selected && (
                      <span
                        aria-hidden="true"
                        className="absolute inset-x-0 bottom-0 h-0.5 bg-primary"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            {activeCategory}: {results.taskCounts[activeCategory] ?? 0}{" "}
            preguntas
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-3 py-2 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">Participante</th>
                  <th className="px-3 py-2 font-medium">Curso</th>
                  <th className="px-3 py-2 font-medium">Grupo</th>
                  <th className="px-3 py-2 font-medium">Estado</th>
                  <th className="px-3 py-2 text-right font-medium">Tiempo</th>
                  <th className="px-3 py-2 text-right font-medium">Puntaje</th>
                  <th className="px-3 py-2 text-right font-medium">
                    Correctas
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.teamId} className="border-b">
                    <td className="px-3 py-2 font-medium">
                      {row.rankPosition ?? "—"}
                    </td>
                    <td className="px-3 py-2">{teamName(row)}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {gradeLabel(row.grade)}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {row.groupName}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {STATUS_LABEL[row.status] ?? row.status}
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">
                      {formatElapsed(row.elapsedSeconds)}
                    </td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">
                      {row.totalScore ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">
                      {row.correctCount ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirming ? VISIBILITY_COPY[confirming].title : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirming ? VISIBILITY_COPY[confirming].description : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={runAction}>
              {confirming ? VISIBILITY_COPY[confirming].confirm : ""}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
