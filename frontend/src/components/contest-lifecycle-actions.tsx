"use client";

import { useEffect, useState } from "react";
import { LoaderCircleIcon, PlayIcon, SquareIcon, XIcon } from "lucide-react";
import {
  extendContestClosing,
  removeContest,
  restartContest,
  stopContest,
} from "@/lib/contests-api";
import {
  fromDatetimeLocalValue,
  toDatetimeLocalValue,
  type StoredContest,
} from "@/lib/contest-schema";
import { DateTimeField } from "@/components/datetime-field";
import { FieldHint } from "@/components/field-hint";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
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

const local = (value: string | null) =>
  value ? toDatetimeLocalValue(value) : "";

export function ContestLifecycleActions({
  contest,
  onChanged,
  beforeRestart,
  placement,
}: {
  contest: StoredContest;
  onChanged: (contest: StoredContest) => void;
  beforeRestart: () => Promise<boolean>;
  placement: "closing" | "actions" | "deletion";
}) {
  const [confirm, setConfirm] = useState<"stop" | "trash" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [registrationEnd, setRegistrationEnd] = useState(
    local(contest.registrationEndsAt ?? contest.startsAt),
  );
  const [ends, setEnds] = useState<Record<string, string>>({});
  const byCategory = Object.keys(contest.schedules).length > 0;
  const windows = byCategory
    ? Object.entries(contest.schedules).map(([key, window]) => ({
        key,
        end: window.endsAt,
        label: `Cierre de ${key}`,
      }))
    : [{ key: "", end: contest.endsAt, label: "Cierre de rendición" }];
  useEffect(() => {
    setRegistrationEnd(local(contest.registrationEndsAt ?? contest.startsAt));
    setEnds(
      Object.fromEntries(
        Object.keys(contest.schedules).length
          ? Object.entries(contest.schedules).map(([key, window]) => [
              key,
              local(window.endsAt),
            ])
          : [["", local(contest.endsAt)]],
      ),
    );
  }, [
    contest.id,
    contest.updatedAt,
    contest.registrationEndsAt,
    contest.startsAt,
    contest.endsAt,
    contest.schedules,
  ]);
  const running = contest.state === "abierta";
  const registration =
    contest.state === "inscripcion" || contest.state === "preparacion";

  const run = async (action: "stop" | "trash" | "restart") => {
    setBusy(action);
    setError(null);
    try {
      if (action === "trash") {
        await removeContest(contest.id);
        window.location.assign("/desafios");
      } else if (action === "restart") {
        if (await beforeRestart()) onChanged(await restartContest(contest.id));
      } else onChanged(await stopContest(contest.id));
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "No se pudo completar la acción.",
      );
    } finally {
      setBusy(null);
    }
  };

  const extend = async () => {
    setBusy("closing");
    setError(null);
    try {
      const dates = registration
        ? { registrationEndsAt: fromDatetimeLocalValue(registrationEnd) }
        : byCategory
          ? {
              categoryEndsAt: Object.fromEntries(
                Object.entries(ends).map(([key, value]) => [
                  key,
                  fromDatetimeLocalValue(value),
                ]),
              ),
            }
          : { endsAt: fromDatetimeLocalValue(ends[""] ?? "") };
      onChanged(await extendContestClosing(contest.id, dates));
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "No se pudo ampliar el cierre.",
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="flex flex-col gap-4">
      {placement === "closing" && (running || registration) && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-1.5">
            <h2 className="font-heading text-base font-semibold">
              {registration ? "Ampliar inscripción" : "Ampliar rendición"}
            </h2>
            <FieldHint>
              El inicio se conserva. Para cambiarlo, modificar las preguntas o
              reprogramar el desafío, primero debes detenerlo.
            </FieldHint>
          </div>
          <FieldGroup className="gap-4 sm:grid sm:grid-cols-2">
            {registration ? (
              <Field>
                <FieldLabel htmlFor="extend-registration">
                  Cierre de inscripción
                </FieldLabel>
                <DateTimeField
                  id="extend-registration"
                  label="Cierre de inscripción"
                  value={registrationEnd}
                  minDate={new Date(contest.registrationEndsAt ?? Date.now())}
                  maxDate={contest.startsAt ? new Date(contest.startsAt) : null}
                  disabled={busy !== null}
                  onChange={setRegistrationEnd}
                />
              </Field>
            ) : (
              windows
                .filter(
                  (window) =>
                    window.end && new Date(window.end).getTime() > Date.now(),
                )
                .map((window) => (
                  <Field key={window.key}>
                    <FieldLabel htmlFor={`extend-${window.key || "run"}`}>
                      {window.label}
                    </FieldLabel>
                    <DateTimeField
                      id={`extend-${window.key || "run"}`}
                      label={window.label}
                      value={ends[window.key] ?? local(window.end)}
                      minDate={window.end ? new Date(window.end) : new Date()}
                      disabled={busy !== null}
                      onChange={(value) =>
                        setEnds((current) => ({
                          ...current,
                          [window.key]: value,
                        }))
                      }
                    />
                  </Field>
                ))
            )}
          </FieldGroup>
          <Button
            type="button"
            variant="outline"
            className="self-start"
            disabled={busy !== null}
            onClick={() => void extend()}
          >
            {busy === "closing" && (
              <LoaderCircleIcon
                data-icon="inline-start"
                className="animate-spin"
              />
            )}
            Guardar nuevo cierre
          </Button>
        </div>
      )}
      {placement === "actions" && (
        <div className="flex flex-wrap items-center gap-2">
          {contest.stoppedAt ? (
            <Button
              type="button"
              disabled={busy !== null}
              onClick={() => void run("restart")}
            >
              <PlayIcon data-icon="inline-start" />
              {busy === "restart" ? "Reprogramando…" : "Reprogramar"}
            </Button>
          ) : (
            contest.publishedAt && (
              <Button
                type="button"
                variant="outline"
                disabled={busy !== null}
                onClick={() => setConfirm("stop")}
              >
                <SquareIcon data-icon="inline-start" />
                Detener para reprogramar
              </Button>
            )
          )}
        </div>
      )}
      {placement === "deletion" && !running && (
        <Button
          type="button"
          variant="ghost"
          className="self-start text-muted-foreground hover:text-destructive"
          disabled={busy !== null}
          onClick={() => setConfirm("trash")}
        >
          <XIcon data-icon="inline-start" />
          Eliminar desafío
        </Button>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <AlertDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === "stop"
                ? "¿Detener y reiniciar este desafío?"
                : "¿Enviar este desafío a la papelera?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "stop"
                ? "Se descartarán todas las respuestas y resultados, y los intentos volverán al inicio. Las inscripciones y los códigos se conservan. Después podrás cambiar las fechas y preguntas para reprogramarlo."
                : "Se ocultarán el desafío y todos sus grupos, estudiantes y resultados. Podrás recuperarlos durante 30 días; después se eliminarán automáticamente. Nadie puede adelantar ese plazo."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirm) void run(confirm);
              }}
            >
              {confirm === "stop"
                ? "Detener y reiniciar"
                : "Enviar a la papelera"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
