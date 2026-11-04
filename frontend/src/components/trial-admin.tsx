"use client";

import { useEffect, useState } from "react";
import { RefreshCwIcon, XIcon } from "lucide-react";
import { toast } from "sonner";

import { ListPageSkeleton } from "@/components/page-skeletons";
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
import { Field, FieldContent, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  clearTrialScenarios,
  createTrialSession,
  deleteTrialSession,
  getTrialReport,
  type TrialParticipant,
  type TrialReport,
  type TrialRole,
  type TrialRoleSummary,
} from "@/lib/trial-api";
import { formatTrialSeconds } from "@/lib/trial-content";
import { cn } from "@/lib/utils";

const RESULT_LABEL = {
  alone: "Solo",
  help: "Con ayuda",
  failed: "No pudo",
} as const;

const ROLES = [
  {
    role: "maestro" as const,
    title: "Maestros",
    codes: ["M1", "M2", "M3", "M4", "M5", "M6", "M7"],
  },
  {
    role: "admin" as const,
    title: "Organizadores",
    codes: ["A1", "A2", "A3", "A4", "A5", "A6"],
  },
];

function summaryText(summary: TrialRoleSummary) {
  const parts = [
    `Personas: ${summary.participants}`,
    `Tareas solo: ${summary.alone}`,
    `Con ayuda: ${summary.help}`,
    `No pudo: ${summary.failed}`,
  ];
  if (summary.averageSus !== null) {
    parts.push(`SUS promedio ${summary.averageSus}`);
  }
  return parts.join(" · ");
}

function comments(participant: TrialParticipant) {
  return Object.entries(participant.tasks)
    .filter(([, task]) => task.comment)
    .map(([code, task]) => `${code}: ${task.comment}`)
    .join(" · ");
}

export function TrialAdminPage() {
  const [report, setReport] = useState<TrialReport | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [role, setRole] = useState<TrialRole>("maestro");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [starting, setStarting] = useState(false);
  const [removing, setRemoving] = useState<TrialParticipant | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    let alive = true;
    void getTrialReport()
      .then((data) => {
        if (alive) setReport(data);
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
  }, [refresh]);

  const startTrial = async () => {
    setStarting(true);
    try {
      const { id } = await createTrialSession(role, firstName, lastName);
      window.location.href = `/prueba-guiada?sesion=${id}`;
    } catch (failure) {
      toast.error(
        failure instanceof Error ? failure.message : "No se pudo empezar.",
      );
      setStarting(false);
    }
  };

  const removeSession = async () => {
    if (!removing) return;
    try {
      await deleteTrialSession(removing.id);
      setRemoving(null);
      setRefresh((value) => value + 1);
    } catch (failure) {
      toast.error(
        failure instanceof Error ? failure.message : "No se pudo borrar.",
      );
    }
  };

  const clear = async () => {
    setClearing(true);
    try {
      const { contests, users } = await clearTrialScenarios();
      toast.success(
        `Se borraron ${contests} desafíos y ${users} maestros de ensayo.`,
      );
    } catch (failure) {
      toast.error(
        failure instanceof Error ? failure.message : "No se pudo borrar.",
      );
    } finally {
      setClearing(false);
      setConfirming(false);
    }
  };

  if (error) {
    return (
      <p role="alert" className="text-sm font-medium text-destructive">
        {error}
      </p>
    );
  }

  if (!report) {
    return <ListPageSkeleton />;
  }

  const canStart = firstName.trim().length >= 2 && lastName.trim().length >= 2;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">
          Pruebas guiadas
        </h1>
        <p className="text-sm text-muted-foreground">
          Tú manejas la prueba desde tu sesión: elige cuál es, escribe el nombre
          de la persona y empieza. Cada tarea prepara su escenario al pulsar
          «Empezar».
        </p>
      </div>

      <form
        className="flex max-w-xl flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (canStart) void startTrial();
        }}
      >
        <h2 className="font-heading text-xl font-semibold">
          Iniciar una prueba
        </h2>
        <div
          role="radiogroup"
          aria-label="Qué prueba"
          className="grid grid-cols-2 gap-2"
        >
          {ROLES.map((item) => {
            const selected = role === item.role;
            return (
              <button
                key={item.role}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setRole(item.role)}
                className={cn(
                  "min-h-12 border-2 px-3 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
                  selected
                    ? "border-primary bg-primary/5 font-semibold text-foreground"
                    : "border-border/30 text-muted-foreground hover:border-primary/60 hover:text-foreground",
                )}
              >
                {item.title}
              </button>
            );
          })}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="trial-first">Nombre</FieldLabel>
            <FieldContent>
              <Input
                id="trial-first"
                value={firstName}
                maxLength={40}
                autoComplete="off"
                onChange={(event) => setFirstName(event.target.value)}
              />
            </FieldContent>
          </Field>
          <Field>
            <FieldLabel htmlFor="trial-last">Apellido</FieldLabel>
            <FieldContent>
              <Input
                id="trial-last"
                value={lastName}
                maxLength={40}
                autoComplete="off"
                onChange={(event) => setLastName(event.target.value)}
              />
            </FieldContent>
          </Field>
        </div>
        <div>
          <Button type="submit" disabled={!canStart || starting}>
            Empezar la prueba
          </Button>
        </div>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-6">
        <h2 className="font-heading text-xl font-semibold">Resultados</h2>
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

      {ROLES.map(({ role: tableRole, title, codes }) => {
        const members = report.participants.filter(
          (participant) => participant.role === tableRole,
        );
        return (
          <section key={tableRole} className="flex flex-col gap-3">
            <h3 className="font-heading text-lg font-semibold">{title}</h3>
            <p className="text-sm text-muted-foreground">
              {summaryText(report.summary[tableRole])}
            </p>
            {members.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Todavía nadie hizo esta prueba.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[60rem] text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      {[
                        "Código",
                        "Nombre",
                        ...codes,
                        "SUS",
                        "Críticas",
                        "Comentarios",
                        "",
                      ].map((label, index) => (
                        <th
                          key={`${label}-${index}`}
                          className="px-2 py-2 font-normal"
                        >
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((participant) => (
                      <tr key={participant.id} className="border-t align-top">
                        <td className="px-2 py-2 font-medium">
                          {participant.code}
                        </td>
                        <td className="px-2 py-2">
                          <a
                            className="underline underline-offset-2"
                            href={`/prueba-guiada?sesion=${participant.id}`}
                          >
                            {participant.name}
                          </a>
                        </td>
                        {codes.map((code) => {
                          const task = participant.tasks[code];
                          return (
                            <td key={code} className="px-2 py-2">
                              {task
                                ? `${RESULT_LABEL[task.result]} ${formatTrialSeconds(task.seconds)}`
                                : "-"}
                            </td>
                          );
                        })}
                        <td className="px-2 py-2">{participant.sus ?? "-"}</td>
                        <td className="px-2 py-2">
                          {participant.criticalDone ? "Sí" : "No"}
                        </td>
                        <td className="max-w-xs px-2 py-2">
                          {comments(participant) || "-"}
                        </td>
                        <td className="px-2 py-2">
                          <button
                            type="button"
                            aria-label={`Borrar la prueba de ${participant.name}`}
                            className="p-1 text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/60"
                            onClick={() => setRemoving(participant)}
                          >
                            <XIcon className="size-4" aria-hidden="true" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}

      <section className="flex flex-col gap-3 border-t pt-6">
        <h2 className="font-heading text-xl font-semibold">
          Escenarios de ensayo
        </h2>
        <p className="text-sm text-muted-foreground">
          Al empezar una tarea, el sistema crea desafíos «[Ensayo]», sus
          estudiantes y resultados, y maestros de ensayo. Al terminar las
          pruebas, bórralos aquí. No toca nada oficial.
        </p>
        <div>
          <Button
            type="button"
            variant="outline"
            disabled={clearing}
            onClick={() => setConfirming(true)}
          >
            Borrar los escenarios de ensayo
          </Button>
        </div>
      </section>

      <AlertDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              ¿Borrar la prueba de {removing?.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Se borran sus resultados, sus tiempos y su SUS. No se puede
              deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void removeSession()}>
              Borrar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              ¿Borrar los escenarios de ensayo?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Se borran los desafíos que empiezan con «[Ensayo]», con sus
              grupos, estudiantes y resultados, y los maestros de ensayo. Los
              resultados de las pruebas no se tocan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void clear()}>
              Borrar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
