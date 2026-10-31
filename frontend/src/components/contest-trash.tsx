"use client";

import { useEffect, useState } from "react";
import { RotateCcwIcon } from "lucide-react";
import { toast } from "sonner";
import {
  listTrashedContests,
  restoreContest,
  type TrashedContest,
} from "@/lib/contests-api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export function ContestTrash() {
  const [contests, setContests] = useState<TrashedContest[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void listTrashedContests()
      .then((data) => {
        if (active) setContests(data);
      })
      .catch((failure) => {
        if (active)
          setError(
            failure instanceof Error
              ? failure.message
              : "No se pudo cargar la papelera.",
          );
      });
    return () => {
      active = false;
    };
  }, []);
  const restore = async (id: string) => {
    setBusy(id);
    try {
      await restoreContest(id);
      setContests(
        (current) => current?.filter((contest) => contest.id !== id) ?? [],
      );
      toast.success("Desafío recuperado con sus grupos y resultados.");
    } catch (failure) {
      toast.error(
        failure instanceof Error
          ? failure.message
          : "No se pudo recuperar el desafío.",
      );
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-2 border-b pb-5">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">
          Papelera
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Los desafíos conservan sus grupos, estudiantes y resultados durante 30
          días. Después se eliminan automáticamente. Este plazo no se puede
          adelantar.
        </p>
      </div>
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : contests === null ? (
        <Skeleton className="h-20 w-full" />
      ) : contests.length === 0 ? (
        <p className="text-sm text-muted-foreground">La papelera está vacía.</p>
      ) : (
        <ul className="divide-y border-b">
          {contests.map((contest) => (
            <li
              key={contest.id}
              className="flex flex-wrap items-center justify-between gap-4 px-3 py-5"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <h2 className="text-lg font-semibold break-words">
                  {contest.title}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {contest.groupCount}{" "}
                  {contest.groupCount === 1 ? "grupo" : "grupos"} · Se elimina
                  el{" "}
                  {new Date(contest.deletesAt).toLocaleDateString("es-BO", {
                    dateStyle: "long",
                    timeZone: "America/La_Paz",
                  })}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy !== null}
                onClick={() => void restore(contest.id)}
              >
                <RotateCcwIcon data-icon="inline-start" />
                {busy === contest.id ? "Recuperando…" : "Recuperar"}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
