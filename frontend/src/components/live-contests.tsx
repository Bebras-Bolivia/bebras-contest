"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarClockIcon,
  CircleCheckIcon,
  ClockIcon,
  UsersIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { API_BASE_URL } from "@/lib/api-client";
import { getToken, getUser, isApproved } from "@/lib/auth";
import type { ContestState } from "@/lib/contest-schema";

type PublicContest = {
  id: string;
  title: string;
  categories: string[];
  durationMinutes: number;
  registrationStartsAt: string | null;
  registrationEndsAt: string | null;
  startsAt: string | null;
  endsAt: string | null;
  state: ContestState;
  isOpen: boolean;
};

/** Fases que el visitante puede accionar o esperar; el resto no se muestra. */
const VISIBLE_STATES = [
  "abierta",
  "inscripcion",
  "preparacion",
  "programada",
] as const;

type VisibleState = (typeof VISIBLE_STATES)[number];

const STATE_ORDER: Record<VisibleState, number> = {
  abierta: 0,
  inscripcion: 1,
  preparacion: 2,
  programada: 3,
};

const STATE_LABEL: Record<VisibleState, string> = {
  abierta: "Disponible ahora",
  inscripcion: "Inscripción abierta",
  preparacion: "En preparación",
  programada: "Próximamente",
};

const dateFormatter = new Intl.DateTimeFormat("es-BO", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

const timeFormatter = new Intl.DateTimeFormat("es-BO", {
  hour: "2-digit",
  minute: "2-digit",
});

function formatDateTime(value: string | null) {
  if (!value) {
    return "una fecha por definir";
  }

  const date = new Date(value);
  return `${dateFormatter.format(date)} a las ${timeFormatter.format(date)}`;
}

function formatCountdown(target: string | null, now: number) {
  if (!target) {
    return null;
  }

  const diff = new Date(target).getTime() - now;

  if (diff <= 0) {
    return null;
  }

  const totalSeconds = Math.ceil(diff / 1000);
  const totalMinutes = Math.floor(totalSeconds / 60);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return hours > 0
      ? `${days} ${days === 1 ? "día" : "días"} y ${hours} h`
      : `${days} ${days === 1 ? "día" : "días"}`;
  }

  if (hours > 0) {
    return minutes > 0
      ? `${hours} h ${minutes} min`
      : `${hours} ${hours === 1 ? "hora" : "horas"}`;
  }

  if (minutes > 0) {
    return `${minutes} ${minutes === 1 ? "minuto" : "minutos"}`;
  }

  return `${totalSeconds} ${totalSeconds === 1 ? "segundo" : "segundos"}`;
}

/** Hacia qué momento cuenta cada fase. */
function countdownTarget(contest: PublicContest) {
  if (contest.state === "abierta") {
    return { date: contest.endsAt, label: "para que cierre" };
  }

  if (contest.state === "inscripcion") {
    return {
      date: contest.registrationEndsAt ?? contest.startsAt,
      label: "para que cierre la inscripción",
    };
  }

  if (contest.state === "preparacion") {
    return { date: contest.startsAt, label: "para la rendición" };
  }

  return {
    date: contest.registrationStartsAt ?? contest.startsAt,
    label: "para la inscripción",
  };
}

export function LiveContests() {
  const [contests, setContests] = useState<PublicContest[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [groupsByContest, setGroupsByContest] = useState<Record<
    string,
    number
  > | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const refreshContests = useCallback(() => {
    return fetch(`${API_BASE_URL}/api/public-contests`)
      .then((response) => {
        if (!response.ok) {
          throw new Error("no disponible");
        }
        return response.json() as Promise<PublicContest[]>;
      })
      .then((data) => {
        setContests(data);
        setFailed(false);
      })
      .catch(() => {
        setFailed(true);
      });
  }, []);

  useEffect(() => {
    void refreshContests();

    // Respaldo para cambios manuales de horario o estado desde el panel.
    const refreshTimer = window.setInterval(() => {
      void refreshContests();
    }, 30_000);

    return () => {
      window.clearInterval(refreshTimer);
    };
  }, [refreshContests]);

  useEffect(() => {
    if (!contests) {
      return;
    }

    const currentTime = Date.now();
    const nextTransition = contests
      .map((contest) => countdownTarget(contest).date)
      .filter((date): date is string => Boolean(date))
      .map((date) => new Date(date).getTime())
      .filter((timestamp) => timestamp > currentTime)
      .sort((left, right) => left - right)[0];

    if (!nextTransition) {
      return;
    }

    // El pequeño margen evita consultar antes que el reloj del servidor cambie.
    const transitionTimer = window.setTimeout(
      () => {
        void refreshContests();
      },
      Math.min(nextTransition - currentTime + 250, 2_147_000_000),
    );

    return () => window.clearTimeout(transitionTimer);
  }, [contests, refreshContests]);

  // Cuántos grupos tiene ya inscritos quien mira, si es un maestro con sesión.
  // La portada es pública: si la llamada falla, simplemente no se muestra.
  useEffect(() => {
    const user = getUser();
    const token = getToken();

    if (
      !token ||
      !user ||
      !isApproved(user) ||
      !["maestro", "admin"].includes(user.role)
    ) {
      return;
    }

    let active = true;

    fetch(`${API_BASE_URL}/api/groups`, {
      headers: { authorization: `Bearer ${token}` },
    })
      .then((response) =>
        response.ok
          ? (response.json() as Promise<Array<{ contestId: string }>>)
          : Promise.reject(new Error("sin acceso")),
      )
      .then((groups) => {
        if (!active) {
          return;
        }

        const counts: Record<string, number> = {};

        for (const group of groups) {
          counts[group.contestId] = (counts[group.contestId] ?? 0) + 1;
        }

        setGroupsByContest(counts);
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const visible = useMemo(() => {
    if (!contests) {
      return [];
    }

    return contests
      .filter((contest): contest is PublicContest & { state: VisibleState } =>
        (VISIBLE_STATES as readonly string[]).includes(contest.state),
      )
      .sort((left, right) => {
        const byState =
          STATE_ORDER[left.state as VisibleState] -
          STATE_ORDER[right.state as VisibleState];

        if (byState !== 0) {
          return byState;
        }

        return (
          new Date(countdownTarget(left).date ?? 0).getTime() -
          new Date(countdownTarget(right).date ?? 0).getTime()
        );
      });
  }, [contests]);

  if (failed || contests === null || visible.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4">
      {visible.map((contest) => {
        const state = contest.state as VisibleState;
        const target = countdownTarget(contest);
        const remaining = formatCountdown(target.date, now);
        const groupCount = groupsByContest
          ? (groupsByContest[contest.id] ?? 0)
          : null;

        return (
          <article
            key={contest.id}
            className={
              state === "abierta"
                ? "rounded-lg border border-primary/40 bg-primary/5 px-5 py-5"
                : "rounded-lg border px-5 py-5"
            }
          >
            <div className="flex flex-wrap items-center gap-2">
              {state === "abierta" ? (
                <CircleCheckIcon className="size-4 text-primary" />
              ) : (
                <CalendarClockIcon className="size-4 text-muted-foreground" />
              )}
              <span
                className={
                  state === "abierta"
                    ? "text-xs font-semibold tracking-wide text-primary uppercase"
                    : "text-xs font-semibold tracking-wide text-muted-foreground uppercase"
                }
              >
                {STATE_LABEL[state]}
              </span>
              {contest.categories.length > 0 &&
                contest.categories.length < 6 && (
                  <Badge variant="outline">
                    {contest.categories.join(", ")}
                  </Badge>
                )}
              {remaining && (
                <span className="ml-auto rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
                  Faltan {remaining} {target.label}
                </span>
              )}
            </div>

            <h3 className="mt-2 text-lg font-semibold">{contest.title}</h3>

            <div className="mt-1 flex flex-col gap-1 text-sm text-muted-foreground">
              {state === "abierta" && (
                <span>
                  Cierra el {formatDateTime(contest.endsAt)} · Tienes hasta{" "}
                  {contest.durationMinutes} minutos; si entras tarde, tendrás el
                  tiempo restante
                </span>
              )}
              {state === "inscripcion" && (
                <>
                  <span>
                    La inscripción cierra el{" "}
                    {formatDateTime(
                      contest.registrationEndsAt ?? contest.startsAt,
                    )}
                  </span>
                  {contest.startsAt && (
                    <span className="inline-flex items-center gap-2">
                      <ClockIcon className="size-4 shrink-0" />
                      La rendición empieza en{" "}
                      {formatCountdown(contest.startsAt, now) ?? "un momento"}
                    </span>
                  )}
                </>
              )}
              {state === "preparacion" && (
                <span>
                  {contest.startsAt
                    ? `La inscripción ya cerró · Faltan ${formatCountdown(contest.startsAt, now) ?? "minutos"} para la rendición`
                    : "La inscripción ya cerró."}
                </span>
              )}
              {state === "programada" && (
                <span>
                  La inscripción abre el{" "}
                  {formatDateTime(
                    contest.registrationStartsAt ?? contest.startsAt,
                  )}
                </span>
              )}
              {groupCount !== null && state !== "abierta" && (
                <span className="inline-flex items-center gap-2">
                  <UsersIcon className="size-4 shrink-0" />
                  {groupCount > 0
                    ? `Ya tienes ${groupCount} grupo(s) inscrito(s).`
                    : "Todavía no inscribes ningún grupo."}
                </span>
              )}
            </div>

            {state === "abierta" && (
              <Button asChild className="mt-4">
                <a href="/entrar">Entrar al desafío</a>
              </Button>
            )}

            {state === "inscripcion" && (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                {groupCount === null ? (
                  <>
                    {/* Al login, que ya ofrece crear la cuenta: mandar a un
                        visitante sin sesión directo al formulario de registro
                        deja fuera al maestro que ya tiene cuenta. */}
                    <Button asChild>
                      <a href="/login">Inscribir a mis estudiantes</a>
                    </Button>
                    <span className="text-sm text-muted-foreground">
                      ¿Ya tienes tu código?{" "}
                      <a
                        href="/entrar"
                        className="underline underline-offset-4 hover:text-foreground"
                      >
                        entra al desafío
                      </a>
                      .
                    </span>
                  </>
                ) : (
                  <Button asChild>
                    <a href="/grupos">
                      {groupCount > 0 ? "Ver mis grupos" : "Inscribir un grupo"}
                    </a>
                  </Button>
                )}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
