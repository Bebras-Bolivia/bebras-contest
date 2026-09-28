"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarClockIcon,
  CircleCheckIcon,
  ClockIcon,
  TimerIcon,
  TrophyIcon,
  UsersIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { API_BASE_URL } from "@/lib/api-client";
import { getToken, getUser, isApproved } from "@/lib/auth";
import type { ContestState } from "@/lib/contest-schema";
import { cn } from "@/lib/utils";

type PublicContest = {
  id: string;
  title: string;
  categories: string[];
  durationMinutes: number;
  participants: number;
  registrationStartsAt: string | null;
  registrationEndsAt: string | null;
  startsAt: string | null;
  endsAt: string | null;
  /** Desde cuándo y hasta cuándo el desafío muestra sus resultados. */
  resultsAt: string | null;
  resultsUntil: string | null;
  state: ContestState;
  isOpen: boolean;
};

/** Lo que la portada muestra de cada desafío, según su fase. */
type Phase =
  | "abierta"
  | "inscripcion"
  | "resultados"
  | "preparacion"
  | "programada"
  | "terminado";

const PHASE_ORDER: Record<Phase, number> = {
  abierta: 0,
  inscripcion: 1,
  resultados: 2,
  preparacion: 3,
  programada: 4,
  terminado: 5,
};

const PHASE_LABEL: Record<Phase, string> = {
  abierta: "Disponible ahora",
  inscripcion: "Inscripción abierta",
  resultados: "Resultados publicados",
  preparacion: "Inscripción cerrada",
  programada: "Próximamente",
  terminado: "Esperando resultados",
};

function phaseOf(contest: PublicContest, now: number): Phase | null {
  const time = (value: string | null) =>
    value ? new Date(value).getTime() : 0;

  switch (contest.state) {
    case "abierta":
    case "inscripcion":
    case "preparacion":
    case "programada":
      return contest.state;
    case "publicada":
      return now < time(contest.resultsUntil) ? "resultados" : null;
    case "cerrada":
    case "consolidada":
      // Terminó y los resultados todavía no salen: se anuncia cuándo.
      return now < time(contest.resultsAt) ? "terminado" : null;
    default:
      return null;
  }
}

const dateFormatter = new Intl.DateTimeFormat("es-BO", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

const shortDateFormatter = new Intl.DateTimeFormat("es-BO", {
  day: "numeric",
  month: "short",
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

function formatShort(value: string) {
  const date = new Date(value);
  return `${shortDateFormatter.format(date)}, ${timeFormatter.format(date)}`;
}

/** El tiempo que falta en dos partes, para mostrarlo grande: «3 d 04 h». */
function countdownParts(target: string | null, now: number) {
  if (!target) {
    return null;
  }

  const diff = new Date(target).getTime() - now;

  if (diff <= 0) {
    return null;
  }

  const seconds = Math.floor(diff / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const two = (value: number) => String(value).padStart(2, "0");

  if (days > 0) return [`${days} d`, `${two(hours)} h`];
  if (hours > 0) return [`${hours} h`, `${two(minutes)} min`];
  return [`${minutes} min`, `${two(seconds % 60)} s`];
}

/** Hacia qué momento cuenta cada fase. */
function countdownTarget(contest: PublicContest, phase: Phase) {
  switch (phase) {
    case "abierta":
      return { date: contest.endsAt, label: "para que cierre" };
    case "inscripcion":
      return {
        date: contest.registrationEndsAt ?? contest.startsAt,
        label: "para que cierre la inscripción",
      };
    case "preparacion":
      return { date: contest.startsAt, label: "para la rendición" };
    case "programada":
      return {
        date: contest.registrationStartsAt ?? contest.startsAt,
        label: "para la inscripción",
      };
    case "terminado":
      return { date: contest.resultsAt, label: "para los resultados" };
    case "resultados":
      return { date: null, label: "" };
  }
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
      .flatMap((contest) => {
        const phase = phaseOf(contest, currentTime);
        return phase
          ? [countdownTarget(contest, phase).date, contest.resultsUntil]
          : [];
      })
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
      .flatMap((contest) => {
        const phase = phaseOf(contest, now);
        return phase ? [{ contest, phase }] : [];
      })
      .sort((left, right) => {
        const byPhase = PHASE_ORDER[left.phase] - PHASE_ORDER[right.phase];

        if (byPhase !== 0) {
          return byPhase;
        }

        return (
          new Date(
            countdownTarget(left.contest, left.phase).date ??
              left.contest.endsAt ??
              0,
          ).getTime() -
          new Date(
            countdownTarget(right.contest, right.phase).date ??
              right.contest.endsAt ??
              0,
          ).getTime()
        );
      });
  }, [contests, now]);

  if (failed || contests === null || visible.length === 0) {
    return null;
  }

  // El ranking de la portada es el del desafío con resultados más reciente.
  const rankedId = visible
    .filter(({ phase }) => phase === "resultados")
    .sort(
      (left, right) =>
        new Date(right.contest.endsAt ?? 0).getTime() -
        new Date(left.contest.endsAt ?? 0).getTime(),
    )[0]?.contest.id;

  return (
    <div className={cn("grid gap-4", visible.length > 1 && "md:grid-cols-2")}>
      {visible.map(({ contest, phase }) => (
        <ContestCard
          key={contest.id}
          contest={contest}
          phase={phase}
          now={now}
          groupCount={
            groupsByContest ? (groupsByContest[contest.id] ?? 0) : null
          }
          showRankingLink={contest.id === rankedId}
        />
      ))}
    </div>
  );
}

function participantsText(count: number, phase: Phase) {
  const ended = phase === "resultados" || phase === "terminado";
  if (count === 1) {
    return ended ? "1 estudiante participó" : "1 estudiante inscrito";
  }
  return `${count} estudiantes ${ended ? "participaron" : "inscritos"}`;
}

function ContestCard({
  contest,
  phase,
  now,
  groupCount,
  showRankingLink,
}: {
  contest: PublicContest;
  phase: Phase;
  now: number;
  groupCount: number | null;
  showRankingLink: boolean;
}) {
  const staff = groupCount !== null;
  const target = countdownTarget(contest, phase);
  const remaining = countdownParts(target.date, now);
  const highlighted = phase === "abierta";

  const facts: Array<{ icon: typeof ClockIcon; text: string }> = [];
  if (contest.startsAt && phase !== "resultados") {
    facts.push({
      icon: CalendarClockIcon,
      text: `Rendición: ${formatShort(contest.startsAt)}${
        contest.endsAt ? ` a ${formatShort(contest.endsAt)}` : ""
      }`,
    });
  }
  if (phase !== "resultados" && phase !== "terminado") {
    facts.push({
      icon: TimerIcon,
      text: `${contest.durationMinutes} minutos para resolverlo`,
    });
  }
  if (contest.participants > 0) {
    facts.push({
      icon: UsersIcon,
      text: participantsText(contest.participants, phase),
    });
  }
  if (phase === "resultados" && contest.resultsUntil) {
    facts.push({
      icon: TrophyIcon,
      text: `Resultados visibles hasta el ${formatShort(contest.resultsUntil)}`,
    });
  }

  return (
    <article
      className={cn(
        "group flex flex-col gap-4 border-2 bg-background px-5 py-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-hard)]",
        highlighted
          ? "border-primary bg-primary/5"
          : "border-border/20 hover:border-foreground",
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <span
            className={cn(
              "flex items-center gap-2 text-xs font-semibold tracking-wide uppercase",
              highlighted || phase === "resultados"
                ? "text-primary"
                : "text-muted-foreground",
            )}
          >
            {phase === "resultados" ? (
              <TrophyIcon className="size-4" />
            ) : phase === "abierta" ? (
              <CircleCheckIcon className="size-4" />
            ) : (
              <CalendarClockIcon className="size-4" />
            )}
            {PHASE_LABEL[phase]}
          </span>
          <h3 className="font-heading text-xl font-semibold break-words">
            {contest.title}
          </h3>
        </div>
        {remaining && (
          <div
            className={cn(
              "flex shrink-0 flex-col items-end border-2 px-3 py-1.5",
              highlighted
                ? "border-primary bg-primary text-primary-foreground"
                : "border-foreground/80",
            )}
            title={`Faltan ${remaining.join(" ")} ${target.label}`}
          >
            <span className="font-heading text-lg leading-tight font-semibold tabular-nums">
              {remaining.join(" ")}
            </span>
            <span
              className={cn(
                "max-w-32 text-right text-[11px] leading-tight",
                highlighted
                  ? "text-primary-foreground/80"
                  : "text-muted-foreground",
              )}
            >
              {target.label}
            </span>
          </div>
        )}
      </div>

      {contest.categories.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {contest.categories.length === 6 ? (
            <Badge variant="outline">Todas las categorías</Badge>
          ) : (
            contest.categories.map((category) => (
              <Badge key={category} variant="outline">
                {category}
              </Badge>
            ))
          )}
        </div>
      )}

      {facts.length > 0 && (
        <ul className="flex flex-col gap-1.5 text-sm text-muted-foreground">
          {facts.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-2">
              <Icon className="size-4 shrink-0" />
              {text}
            </li>
          ))}
          {groupCount !== null &&
            ["inscripcion", "preparacion", "programada"].includes(phase) && (
              <li className="flex items-center gap-2 font-medium text-foreground">
                <UsersIcon className="size-4 shrink-0" />
                {groupCount > 0
                  ? `Tienes ${groupCount} ${groupCount === 1 ? "grupo" : "grupos"} en este desafío`
                  : "Todavía no inscribes ningún grupo"}
              </li>
            )}
        </ul>
      )}

      {phase === "terminado" && (
        <p className="text-sm text-muted-foreground">
          Los resultados se publican el {formatDateTime(contest.resultsAt)}.
        </p>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
        {staff ? (
          phase !== "programada" && (
            <Button
              asChild
              variant={
                phase === "inscripcion" || phase === "abierta"
                  ? "default"
                  : "outline"
              }
            >
              <a href="/grupos">
                {phase === "inscripcion"
                  ? groupCount > 0
                    ? "Ver mis grupos"
                    : "Inscribir un grupo"
                  : phase === "abierta"
                    ? "Ver cómo van mis grupos"
                    : phase === "resultados"
                      ? "Ver resultados de mis grupos"
                      : "Ver mis grupos"}
              </a>
            </Button>
          )
        ) : (
          <>
            {phase === "abierta" && (
              <Button asChild>
                <a href="/entrar">Entrar al desafío</a>
              </Button>
            )}
            {phase === "inscripcion" && (
              <>
                <Button asChild>
                  <a href="/entrar">Inscribirme</a>
                </Button>
                {/* Al login, que ya ofrece crear la cuenta: mandar a un
                    visitante sin sesión directo al formulario de registro
                    deja fuera al maestro que ya tiene cuenta. */}
                <a
                  href="/login"
                  className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
                >
                  Soy maestro: inscribir a mis estudiantes
                </a>
              </>
            )}
            {phase === "preparacion" && (
              <Button asChild variant="outline">
                <a href="/entrar">Entrar con mi código</a>
              </Button>
            )}
            {phase === "resultados" && (
              <Button asChild variant="outline">
                <a href="/entrar">Ver mis resultados</a>
              </Button>
            )}
          </>
        )}

        {phase === "resultados" && showRankingLink && (
          <a
            href="#ranking"
            className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            Ver el ranking
          </a>
        )}

        {(phase === "preparacion" || phase === "programada") && (
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <ClockIcon className="size-4" />
            {phase === "preparacion"
              ? `Empieza el ${formatDateTime(contest.startsAt)}`
              : `La inscripción abre el ${formatDateTime(
                  contest.registrationStartsAt ?? contest.startsAt,
                )}`}
          </span>
        )}
      </div>
    </article>
  );
}
