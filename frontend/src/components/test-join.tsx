"use client";

import { useEffect, useState, type FormEvent } from "react";
import { CheckIcon, LoaderCircleIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/api-client";
import { gradesForCategories } from "@/lib/contest-schema";
import { openPlaySession, storePlaySession } from "@/lib/play-api";
import { cn } from "@/lib/utils";

type TestContest = {
  id: string;
  title: string;
  categories: string[];
  isTest?: boolean;
  durationMinutes: number;
};

export function TestJoin() {
  const [contestId] = useState(() =>
    typeof window === "undefined"
      ? ""
      : (new URLSearchParams(window.location.search).get("id") ?? ""),
  );
  const [contest, setContest] = useState<TestContest | null | undefined>();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [grade, setGrade] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void apiRequest<TestContest[]>(
      `/api/public-contests?id=${encodeURIComponent(contestId)}`,
    )
      .then((list) => {
        if (alive) {
          setContest(
            list.find((item) => item.id === contestId && item.isTest) ?? null,
          );
        }
      })
      .catch(() => {
        if (alive) setContest(null);
      });
    return () => {
      alive = false;
    };
  }, [contestId]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!firstName.trim() || !lastName.trim() || !grade) {
      setError("Escribe tus nombres y apellidos y elige tu curso.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { personalCode } = await apiRequest<{ personalCode: string }>(
        "/api/play/test-join",
        {
          method: "POST",
          body: JSON.stringify({ contestId, firstName, lastName, grade }),
        },
      );
      const session = await openPlaySession(personalCode);
      storePlaySession(session.sessionToken);
      window.location.href = "/rendir";
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "No pudimos entrar.",
      );
      setBusy(false);
    }
  };

  if (contest === undefined) {
    return (
      <p className="text-center text-sm text-muted-foreground">Cargando…</p>
    );
  }

  if (contest === null) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <h1 className="font-heading text-2xl font-semibold">
          Esta prueba no está disponible
        </h1>
        <Button asChild variant="outline">
          <a href="/">Ir al inicio</a>
        </Button>
      </div>
    );
  }

  return (
    <form
      className="mx-auto flex w-full max-w-xl flex-col gap-6"
      onSubmit={(event) => void submit(event)}
    >
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold tracking-wide text-primary uppercase">
          {contest.title}
        </span>
        <h1 className="font-heading text-3xl font-semibold tracking-tight">
          Entra a la prueba
        </h1>
        <p className="text-muted-foreground">
          No necesitas código. Tendrás {contest.durationMinutes} minutos desde
          que toques «Empezar».
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="test-first">Nombres</FieldLabel>
          <FieldContent>
            <Input
              id="test-first"
              value={firstName}
              autoComplete="given-name"
              onChange={(event) => setFirstName(event.target.value)}
            />
          </FieldContent>
        </Field>
        <Field>
          <FieldLabel htmlFor="test-last">Apellidos</FieldLabel>
          <FieldContent>
            <Input
              id="test-last"
              value={lastName}
              autoComplete="family-name"
              onChange={(event) => setLastName(event.target.value)}
            />
          </FieldContent>
        </Field>
      </div>

      <Field>
        <FieldLabel id="test-grade-label">¿En qué curso estás?</FieldLabel>
        <FieldContent>
          <div
            role="radiogroup"
            aria-labelledby="test-grade-label"
            className="grid grid-cols-2 gap-2"
          >
            {gradesForCategories(contest.categories).map((item) => {
              const selected = grade === item.value;
              return (
                <button
                  key={item.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setGrade(item.value)}
                  className={cn(
                    "flex min-h-12 items-center justify-center gap-2 border-2 px-3 py-2 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
                    selected
                      ? "border-primary bg-primary/5 font-semibold text-foreground"
                      : "border-border/30 text-muted-foreground hover:border-primary/60 hover:text-foreground",
                  )}
                >
                  {selected && (
                    <CheckIcon
                      className="size-4 text-primary"
                      aria-hidden="true"
                    />
                  )}
                  {item.label}
                </button>
              );
            })}
          </div>
        </FieldContent>
      </Field>

      {error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="outline">
          <a href="/">‹ Volver</a>
        </Button>
        <Button type="submit" disabled={busy}>
          {busy && (
            <LoaderCircleIcon
              data-icon="inline-start"
              className="animate-spin"
            />
          )}
          Entrar
        </Button>
      </div>
    </form>
  );
}
