"use client";

import { useEffect, useState } from "react";
import { RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";

import { ListPageSkeleton } from "@/components/page-skeletons";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  getContestUsage,
  setContestUsage,
  type ContestUsage,
} from "@/lib/usage-api";

const STATUS_LABEL: Record<string, string> = {
  pending: "Sin empezar",
  in_progress: "En curso",
  finished: "Terminó",
};

function formatSeconds(seconds: number | null) {
  if (seconds === null) return "-";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function ContestUsagePage() {
  const [contestId] = useState(() =>
    typeof window === "undefined"
      ? ""
      : (new URLSearchParams(window.location.search).get("id") ?? ""),
  );
  const [usage, setUsage] = useState<ContestUsage | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!contestId) return;
    let alive = true;
    void getContestUsage(contestId)
      .then((data) => {
        if (alive) setUsage(data);
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
  }, [contestId, refresh]);

  const toggle = async (enabled: boolean) => {
    try {
      await setContestUsage(contestId, enabled);
      setUsage((current) =>
        current ? { ...current, collectUsage: enabled } : current,
      );
      toast.success(
        enabled
          ? "Se recogen el uso y las opiniones."
          : "Ya no se recogen el uso ni las opiniones.",
      );
    } catch (failure) {
      toast.error(
        failure instanceof Error ? failure.message : "No se pudo cambiar.",
      );
    }
  };

  if (!contestId || error) {
    return (
      <p role="alert" className="text-sm font-medium text-destructive">
        {error || "Falta el desafío."}
      </p>
    );
  }

  if (!usage) {
    return <ListPageSkeleton />;
  }

  const { summary } = usage;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-semibold tracking-wide text-primary uppercase">
          {usage.contestTitle}
        </span>
        <h1 className="font-heading text-3xl font-semibold tracking-tight">
          Uso y opiniones
        </h1>
      </div>

      <label className="flex items-start gap-3 text-sm">
        <Checkbox
          className="mt-0.5"
          checked={usage.collectUsage}
          onCheckedChange={(checked) => void toggle(checked === true)}
        />
        <span className="flex flex-col gap-0.5">
          Recoger uso y opiniones
          <span className="text-muted-foreground">
            Apagado, el estudiante no ve la reseña y no se guarda su
            dispositivo.
          </span>
        </span>
      </label>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Estudiantes: {summary.students} · Terminaron: {summary.finished} · Con
          reseña: {summary.reviewed}
          {summary.averageStars !== null
            ? ` · Promedio: ${summary.averageStars} de 5`
            : ""}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setRefresh((value) => value + 1)}
        >
          <RefreshCwIcon data-icon="inline-start" />
          Actualizar
        </Button>
      </div>

      {usage.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Todavía no entró nadie a la prueba.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[56rem] text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                {[
                  "Código",
                  "Estudiante",
                  "Curso",
                  "Dispositivo",
                  "Estado",
                  "Tiempo",
                  "Puntaje",
                  "Estrellas",
                  "Comentario",
                ].map((label) => (
                  <th key={label} className="px-2 py-2 font-normal">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {usage.rows.map((row) => (
                <tr key={row.code} className="border-t align-top">
                  <td className="px-2 py-2 font-medium">{row.code}</td>
                  <td className="px-2 py-2">{row.name}</td>
                  <td className="px-2 py-2">{row.grade ?? "-"}</td>
                  <td className="px-2 py-2">
                    {row.device
                      ? `${row.device.kind === "mobile" ? "Celular" : "Computadora"} ${row.device.width}×${row.device.height}`
                      : "-"}
                  </td>
                  <td className="px-2 py-2">
                    {STATUS_LABEL[row.status] ?? row.status}
                    {row.closedBy === "timeout" ? " (se acabó el tiempo)" : ""}
                  </td>
                  <td className="px-2 py-2">{formatSeconds(row.seconds)}</td>
                  <td className="px-2 py-2">{row.totalScore ?? "-"}</td>
                  <td className="px-2 py-2">{row.stars ?? "-"}</td>
                  <td className="max-w-xs px-2 py-2">{row.comment ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
