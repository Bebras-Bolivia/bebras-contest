"use client";

import { PracticesSkeleton } from "@/components/page-skeletons";
import { useEffect, useState } from "react";
import {
  BarChart3Icon,
  ClockIcon,
  PlusIcon,
  XIcon,
  UsersIcon,
} from "lucide-react";
import { toast } from "sonner";

import {
  CONTEST_STATE_LABELS,
  formatContestWindow,
} from "@/lib/contest-schema";
import {
  listPractices,
  removePractice,
  type StoredPractice,
} from "@/lib/practices-api";
import { cn } from "@/lib/utils";
import { enter } from "@/lib/surface";
import { FieldHint } from "@/components/field-hint";
import { categoryStyle } from "@/components/category-logo";
import { Badge } from "@/components/ui/badge";
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

export function PracticesHome() {
  const [practices, setPractices] = useState<StoredPractice[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<StoredPractice | null>(null);

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
    return <PracticesSkeleton />;
  }

  return (
    <div className="flex w-full flex-col gap-8 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-300">
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
          {practices.map((practice, index) => (
            <li
              key={practice.id}
              style={{ animationDelay: `${Math.min(index, 10) * 40}ms` }}
              className={cn(enter, "border-t first:border-t-0")}
            >
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
                    <Button asChild size="sm" variant="outline">
                      <a
                        href={`/mis-practicas/resultados?id=${encodeURIComponent(practice.id)}`}
                      >
                        <BarChart3Icon data-icon="inline-start" />
                        Resultados
                      </a>
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
