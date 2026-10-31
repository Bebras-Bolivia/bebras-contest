"use client";

import { RowsSkeleton } from "@/components/page-skeletons";
import { ListPageSkeleton } from "@/components/page-skeletons";
import { useEffect, useState } from "react";
import {
  BarChart3Icon,
  ClockIcon,
  PlusIcon,
  XIcon,
  UsersIcon,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import {
  CONTEST_STATE_LABELS,
  formatContestWindow,
} from "@/lib/contest-schema";
import {
  listPracticeResults,
  listPractices,
  removePractice,
  type PracticeResults,
  type StoredPractice,
} from "@/lib/practices-api";
import { FieldHint } from "@/components/field-hint";
import { categoryStyle } from "@/components/category-logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

export function PracticesHome() {
  const [practices, setPractices] = useState<StoredPractice[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<StoredPractice | null>(null);
  const [viewing, setViewing] = useState<StoredPractice | null>(null);
  const [results, setResults] = useState<PracticeResults | null>(null);

  useEffect(() => {
    let active = true;

    void listPractices()
      .then((loaded) => {
        if (active) setPractices(loaded);
      })
      .catch((error: unknown) => {
        toast.error(
          error instanceof Error
            ? error.message
            : "No se pudieron cargar tus prácticas.",
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const openResults = (practice: StoredPractice) => {
    setViewing(practice);
    setResults(null);
    void listPracticeResults(practice.id)
      .then(setResults)
      .catch((error: unknown) => {
        setViewing(null);
        toast.error(
          error instanceof Error
            ? error.message
            : "No se pudieron cargar los resultados.",
        );
      });
  };

  const confirmDelete = () => {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);

    void removePractice(target.id)
      .then(() => {
        setPractices((current) =>
          current.filter((item) => item.id !== target.id),
        );
        toast.success("Práctica eliminada.");
      })
      .catch((error: unknown) => {
        toast.error(
          error instanceof Error ? error.message : "No se pudo eliminar.",
        );
      });
  };

  if (loading) {
    return <ListPageSkeleton label="Cargando prácticas..." />;
  }

  return (
    <div className="flex w-full flex-col gap-8">
      <div className="flex flex-col gap-4 border-b pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="font-heading text-3xl font-semibold tracking-tight">
            Mis prácticas
          </h1>
          <FieldHint>
            Tus estudiantes inscritos la ven al entrar con su código personal,
            dentro del horario que elijas.
          </FieldHint>
        </div>
        <Button asChild className="shrink-0">
          <a href="/mis-practicas/nueva">
            <PlusIcon data-icon="inline-start" />
            Nueva práctica
          </a>
        </Button>
      </div>

      {practices.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Todavía no tienes prácticas.
        </p>
      ) : (
        <ul className="flex flex-col border-b">
          {practices.map((practice) => (
            <li key={practice.id} className="border-t first:border-t-0">
              <div className="flex flex-col gap-3 py-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex min-w-0 flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      data-category
                      style={categoryStyle(practice.category)}
                    >
                      {practice.category}
                    </Badge>
                    <Badge variant="outline">
                      {CONTEST_STATE_LABELS[practice.state] ?? practice.state}
                    </Badge>
                  </div>
                  <h2 className="break-words text-lg font-semibold">
                    {practice.title}
                  </h2>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <ClockIcon className="size-4 shrink-0" />
                      {practice.durationMinutes} min · {practice.taskCount}{" "}
                      pregunta(s)
                    </span>
                    <span className="flex items-center gap-1.5">
                      <UsersIcon className="size-4 shrink-0" />
                      {practice.resultCount}{" "}
                      {practice.resultCount === 1
                        ? "la terminó"
                        : "la terminaron"}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Horario:{" "}
                    {formatContestWindow(practice.startsAt, practice.endsAt)}
                  </p>
                </div>

                <div className="grid w-full shrink-0 gap-2 lg:w-72 lg:grid-cols-2">
                  {practice.resultCount > 0 && (
                    <Button
                      size="sm"
                      type="button"
                      variant="outline"
                      onClick={() => openResults(practice)}
                    >
                      <BarChart3Icon data-icon="inline-start" />
                      Resultados
                    </Button>
                  )}
                  <Button
                    size="sm"
                    type="button"
                    variant="outline"
                    onClick={() => setDeleting(practice)}
                  >
                    <XIcon data-icon="inline-start" />
                    Eliminar
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={viewing !== null}
        onOpenChange={(open) => {
          if (!open) setViewing(null);
        }}
      >
        <DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="break-words">
              {viewing?.title ?? ""}
            </DialogTitle>
          </DialogHeader>
          <div className="min-h-0 overflow-auto">
            {!results ? (
              <RowsSkeleton rows={5} label="Cargando resultados..." />
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-2 pr-4 font-normal">Estudiante</th>
                    <th className="px-2 py-2 text-right font-normal">
                      Puntaje
                    </th>
                    {results.tasks.map((task, index) => (
                      <th
                        key={task.id}
                        title={task.title}
                        className="w-8 px-1 py-2 text-center font-normal tabular-nums"
                      >
                        {index + 1}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {results.results.map((row) => (
                    <tr key={row.id} className="border-t">
                      <td className="py-2.5 pr-4">{row.name}</td>
                      <td className="px-2 py-2.5 text-right font-semibold tabular-nums">
                        {row.totalScore}
                      </td>
                      {results.tasks.map((task, index) => {
                        const mark = row.marks[index] ?? "-";
                        return (
                          <td
                            key={task.id}
                            title={`${task.title}: ${mark === "C" ? "correcta" : mark === "X" ? "incorrecta" : "sin responder"}`}
                            className="px-1 py-2.5 text-center"
                          >
                            <span
                              className={cn(
                                "mx-auto block size-3",
                                mark === "C"
                                  ? "bg-difficulty-easy"
                                  : mark === "X"
                                    ? "bg-destructive"
                                    : "bg-muted",
                              )}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar esta práctica?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting
                ? `Se borrarán también sus resultados${
                    deleting.resultCount > 0
                      ? ` (${deleting.resultCount} ${deleting.resultCount === 1 ? "estudiante" : "estudiantes"})`
                      : ""
                  }. No se puede deshacer.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
