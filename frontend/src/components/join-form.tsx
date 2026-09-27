"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from "react";
import {
  CalendarClockIcon,
  CheckIcon,
  CircleCheckBigIcon,
  CopyIcon,
  KeyRoundIcon,
  LoaderCircleIcon,
  UsersIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { API_BASE_URL } from "@/lib/api-client";
import { formatCountdown, formatDateTime, useNow } from "@/lib/countdown";
import {
  forgetPlaySession,
  getAttempt,
  enterPractice,
  openPlaySession,
  readPlaySession,
  storePlaySession,
} from "@/lib/play-api";
import { cn } from "@/lib/utils";

type GroupGrade = {
  value: string;
  label: string;
  category: string;
};

type GroupInfo = {
  groupName: string;
  contestTitle: string;
  isPractice: boolean;
  contestCategories: string[];
  allowPairs: boolean;
  durationMinutes: number;
  registrationStartsAt: string | null;
  registrationEndsAt: string | null;
  contestStartsAt: string | null;
  contestEndsAt: string | null;
  category: string | null;
  grades: GroupGrade[];
  state: string;
};

type JoinResult = {
  personalCode: string;
  groupName: string;
  contestTitle: string;
};

type Step = "code" | "practice" | "register" | "confirm" | "done";

type JoinErrors = {
  code?: string;
  grade?: string;
  oneFirst?: string;
  oneLast?: string;
  twoFirst?: string;
  twoLast?: string;
  form?: string;
};

function canRegister(group: GroupInfo) {
  return (
    group.state === "inscripcion" ||
    (!group.registrationStartsAt &&
      (group.state === "programada" || group.state === "abierta"))
  );
}

const GROUP_CODE_LENGTH = 6;
const PERSONAL_CODE_LENGTH = 8;

function fmt(value: string) {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(
      /(^|\s|-)(\p{L})/gu,
      (_match, sep, letter) => sep + letter.toUpperCase(),
    );
}

function nameKey(first: string, last: string) {
  const norm = (value: string) =>
    value
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "");
  return `${norm(first)} ${norm(last)}`;
}

export function JoinForm() {
  const [step, setStep] = useState<Step>("code");
  const [accessCode, setAccessCode] = useState("");
  const [group, setGroup] = useState<GroupInfo | null>(null);
  const [mode, setMode] = useState<"individual" | "pareja">("individual");
  const [grade, setGrade] = useState("");
  const [oneFirst, setOneFirst] = useState("");
  const [oneLast, setOneLast] = useState("");
  const [twoFirst, setTwoFirst] = useState("");
  const [twoLast, setTwoLast] = useState("");
  const [result, setResult] = useState<JoinResult | null>(null);
  const [practiceName, setPracticeName] = useState("");
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<JoinErrors>({});
  const accessCodeRef = useRef<HTMLInputElement>(null);
  const practiceNameRef = useRef<HTMLInputElement>(null);
  const gradeRef = useRef<HTMLButtonElement>(null);
  const oneFirstRef = useRef<HTMLInputElement>(null);
  const oneLastRef = useRef<HTMLInputElement>(null);
  const twoFirstRef = useRef<HTMLInputElement>(null);
  const twoLastRef = useRef<HTMLInputElement>(null);
  const formErrorRef = useRef<HTMLDivElement>(null);

  const clearErrors = (...fields: (keyof JoinErrors)[]) => {
    setErrors((current) => {
      const next = { ...current, form: undefined };
      fields.forEach((field) => {
        next[field] = undefined;
      });
      return next;
    });
  };

  const copyPersonalCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success("Código copiado.");
    } catch {
      toast.error("No se pudo copiar. Anótalo tal cual aparece.");
    }
  };

  const performLookup = async (rawCode: string, silent = false) => {
    /** Abre la sesion con el codigo personal. Devuelve el mensaje de error en
     *  vez de lanzarlo, para poder reintentar como codigo de grupo. */
    const enterWithPersonalCode = async (code: string) => {
      try {
        const session = await openPlaySession(code);
        storePlaySession(session.sessionToken);
        window.location.href = "/rendir";
        return null;
      } catch (error) {
        if (error instanceof TypeError) {
          throw error;
        }
        return error instanceof Error ? error.message : "No se pudo entrar.";
      }
    };

    const code = rawCode.trim().toUpperCase();

    if (!code) {
      if (!silent) {
        setErrors({ code: "Escribe el código que te dio tu maestro." });
        accessCodeRef.current?.focus();
      }
      return;
    }

    setLoading(true);

    try {
      // El personal tiene 8 caracteres y el de grupo 6, pero se prueban ambos
      // por si el estudiante se equivoca de campo.
      if (code.length !== GROUP_CODE_LENGTH) {
        const failure = await enterWithPersonalCode(code);

        if (!failure) {
          return;
        }

        if (code.length === PERSONAL_CODE_LENGTH) {
          if (!silent) {
            setErrors({ code: failure });
            accessCodeRef.current?.focus();
          }
          return;
        }
      }

      const response = await fetch(`${API_BASE_URL}/api/play/group/${code}`);
      const data = (await response.json().catch(() => ({}))) as
        | GroupInfo
        | { message?: string };

      if (!response.ok) {
        if (!silent) {
          setErrors({
            code:
              ("message" in data && data.message) ||
              "No se pudo validar el código.",
          });
          accessCodeRef.current?.focus();
        }
        return;
      }

      const info = data as GroupInfo;

      if (info.isPractice) {
        setErrors({});
        setGroup(info);
        setStep("practice");
        return;
      }

      if (!canRegister(info)) {
        if (!silent) {
          setErrors({
            code: "La inscripción de este grupo no está abierta. Si ya te inscribiste, entra con tu código personal.",
          });
          accessCodeRef.current?.focus();
        }
        return;
      }

      setErrors({});
      setGroup(info);
      setMode("individual");
      setGrade("");

      // Una sesión guardada de este mismo grupo lleva directo al desafío; la
      // de otro desafío anterior no, así puede inscribirse en este.
      if (readPlaySession()) {
        try {
          const current = await getAttempt();
          if (current.accessCode === code) {
            window.location.href = "/rendir";
            return;
          }
        } catch {
          forgetPlaySession();
        }
      }

      // El codigo del grupo solo sirve para inscribirse.
      setStep("register");
    } catch {
      if (!silent) {
        toast.error("No se pudo conectar con el servidor.");
      }
    } finally {
      setLoading(false);
    }
  };

  // Si llega ?code=XXXX en el enlace, prellena y valida automáticamente.
  useEffect(() => {
    const urlCode = new URLSearchParams(window.location.search)
      .get("code")
      ?.trim()
      .toUpperCase();

    if (urlCode) {
      setAccessCode(urlCode);
      void performLookup(urlCode, true);
    }
  }, []);

  useEffect(() => {
    if (errors.form) {
      formErrorRef.current?.focus();
    }
  }, [errors.form, step]);

  const lookupCode = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void performLookup(accessCode);
  };

  const goToConfirm = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const nextErrors: JoinErrors = {
      grade: grade ? undefined : "Elige tu curso.",
      oneFirst: oneFirst.trim() ? undefined : "Ingresa tus nombres.",
      oneLast: oneLast.trim() ? undefined : "Ingresa tus apellidos.",
      twoFirst:
        mode === "pareja" && !twoFirst.trim()
          ? "Ingresa los nombres del segundo integrante."
          : undefined,
      twoLast:
        mode === "pareja" && !twoLast.trim()
          ? "Ingresa los apellidos del segundo integrante."
          : undefined,
    };

    if (
      !nextErrors.twoFirst &&
      !nextErrors.twoLast &&
      mode === "pareja" &&
      nameKey(oneFirst, oneLast) === nameKey(twoFirst, twoLast)
    ) {
      nextErrors.twoFirst = "Debe ser una persona diferente.";
    }

    const firstInvalid = (
      ["grade", "oneFirst", "oneLast", "twoFirst", "twoLast"] as const
    ).find((field) => nextErrors[field]);

    if (firstInvalid) {
      setErrors(nextErrors);
      const refs = {
        grade: gradeRef,
        oneFirst: oneFirstRef,
        oneLast: oneLastRef,
        twoFirst: twoFirstRef,
        twoLast: twoLastRef,
      };
      refs[firstInvalid].current?.focus();
      return;
    }

    setErrors({});
    setStep("confirm");
  };

  const startPractice = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!practiceName.trim()) {
      setErrors({ oneFirst: "Escribe tu nombre." });
      practiceNameRef.current?.focus();
      return;
    }

    setErrors({});
    setLoading(true);

    try {
      const session = await enterPractice(
        accessCode.trim().toUpperCase(),
        practiceName,
      );
      storePlaySession(session.sessionToken);
      window.location.href = "/rendir";
    } catch (error) {
      if (error instanceof TypeError) {
        toast.error("No se pudo conectar con el servidor.");
      } else {
        setErrors({
          form: error instanceof Error ? error.message : "No se pudo entrar.",
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const join = async () => {
    setLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/play/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessCode: accessCode.trim().toUpperCase(),
          participationMode: mode,
          grade,
          memberOneFirstName: fmt(oneFirst),
          memberOneLastName: fmt(oneLast),
          memberTwoFirstName: fmt(twoFirst),
          memberTwoLastName: fmt(twoLast),
        }),
      });

      const data = (await response.json().catch(() => ({}))) as
        | JoinResult
        | { message?: string };

      if (!response.ok) {
        setErrors({
          form: ("message" in data && data.message) || "No se pudo registrar.",
        });
        setStep("register");
        return;
      }

      const joinResult = data as JoinResult;

      try {
        const session = await openPlaySession(joinResult.personalCode);
        storePlaySession(session.sessionToken);
      } catch {
        forgetPlaySession();
      }

      setResult(joinResult);
      setStep("done");
    } catch {
      toast.error("No se pudo conectar con el servidor.");
    } finally {
      setLoading(false);
    }
  };

  const gradeLabelOf = (value: string) =>
    group?.grades.find((item) => item.value === value)?.label ?? "—";

  if (step === "done" && result) {
    return (
      <Screen
        eyebrow={result.contestTitle}
        title="¡Listo, ya estás inscrito!"
        icon={
          <CircleCheckBigIcon
            aria-hidden="true"
            className="size-14 text-difficulty-easy motion-safe:animate-in motion-safe:zoom-in-0 motion-safe:-spin-in-45 motion-safe:duration-500 motion-safe:ease-[cubic-bezier(0.34,1.56,0.64,1)]"
          />
        }
      >
        <div className="flex flex-col items-center gap-2 border-2 border-dashed border-primary/50 px-4 py-5 text-center">
          <span className="text-sm text-muted-foreground">
            Tu código personal
          </span>
          <div className="flex items-center gap-3">
            <span className="font-mono text-3xl font-semibold tracking-[0.2em]">
              {result.personalCode}
            </span>
            <Button
              size="icon-sm"
              type="button"
              variant="outline"
              aria-label="Copiar mi código"
              onClick={() => copyPersonalCode(result.personalCode)}
            >
              <CopyIcon />
            </Button>
          </div>
          <span className="text-sm leading-6 text-muted-foreground">
            Anótalo: lo necesitas para entrar a la prueba. Si lo pierdes,
            pídeselo a tu maestro.
          </span>
        </div>

        <StartsIn startsAt={group?.contestStartsAt ?? null} />

        <Button asChild size="lg" className="w-full">
          <a href="/rendir">Ir al desafío</a>
        </Button>
      </Screen>
    );
  }

  if (step === "practice" && group) {
    return (
      <Screen
        eyebrow="Práctica"
        title={group.contestTitle}
        description={`Tienes ${group.durationMinutes} minutos. Escribe tu nombre y empieza.`}
      >
        <form className="flex flex-col gap-5" onSubmit={startPractice}>
          <Field data-invalid={Boolean(errors.oneFirst) || undefined}>
            <FieldLabel htmlFor="practice-name">¿Cómo te llamas?</FieldLabel>
            <FieldContent>
              <Input
                ref={practiceNameRef}
                id="practice-name"
                autoComplete="name"
                autoFocus
                value={practiceName}
                onChange={(event) => {
                  setPracticeName(event.target.value);
                  if (errors.oneFirst || errors.form) {
                    clearErrors("oneFirst");
                  }
                }}
                aria-invalid={Boolean(errors.oneFirst)}
                aria-describedby={
                  errors.oneFirst ? "practice-name-error" : undefined
                }
              />
              <FieldError id="practice-name-error">
                {errors.oneFirst}
              </FieldError>
            </FieldContent>
          </Field>
          <FormError message={errors.form} errorRef={formErrorRef} />
          <Button type="submit" size="lg" className="w-full" disabled={loading}>
            {loading && (
              <LoaderCircleIcon
                data-icon="inline-start"
                className="animate-spin"
              />
            )}
            {loading ? "Entrando..." : "Empezar"}
          </Button>
        </form>
      </Screen>
    );
  }

  if (step === "confirm" && group) {
    const rows: Array<[string, string]> = [
      ["Desafío", group.contestTitle],
      ["Curso", gradeLabelOf(grade)],
      ...(group.allowPairs
        ? [["Modalidad", mode === "pareja" ? "En pareja" : "Individual"]]
        : []),
      [
        mode === "pareja" ? "Integrante 1" : "Nombre",
        `${fmt(oneFirst)} ${fmt(oneLast)}`,
      ],
      ...(mode === "pareja"
        ? [["Integrante 2", `${fmt(twoFirst)} ${fmt(twoLast)}`]]
        : []),
    ] as Array<[string, string]>;

    return (
      <Screen
        eyebrow={group.contestTitle}
        title="¿Está todo bien?"
        description="Revisa tus datos: así aparecerás en los resultados."
      >
        <dl className="flex flex-col border-t text-sm">
          {rows.map(([label, value]) => (
            <div
              key={label}
              className="flex items-baseline justify-between gap-4 border-b py-3"
            >
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="text-right font-medium">{value}</dd>
            </div>
          ))}
        </dl>
        <FormError message={errors.form} errorRef={formErrorRef} />
        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="ghost"
            disabled={loading}
            onClick={() => setStep("register")}
          >
            Corregir
          </Button>
          <Button
            type="button"
            size="lg"
            disabled={loading}
            onClick={() => void join()}
          >
            {loading ? "Inscribiendo..." : "Sí, inscribirme"}
          </Button>
        </div>
      </Screen>
    );
  }

  if (step === "register" && group) {
    return (
      <Screen
        eyebrow={`${group.contestTitle} · ${group.groupName}`}
        title="Inscríbete"
        description={`Cuando empieces tendrás ${group.durationMinutes} minutos para resolver la prueba.`}
      >
        <StartsIn startsAt={group.contestStartsAt} compact />
        <form className="flex flex-col gap-6" onSubmit={goToConfirm}>
          <Field data-invalid={Boolean(errors.grade) || undefined}>
            <FieldLabel id="grade-label">¿En qué curso estás?</FieldLabel>
            <FieldContent>
              <div
                role="radiogroup"
                aria-labelledby="grade-label"
                aria-describedby={errors.grade ? "grade-error" : undefined}
                className="grid grid-cols-2 gap-2"
              >
                {group.grades.map((item, index) => {
                  const selected = grade === item.value;
                  return (
                    <button
                      key={item.value}
                      ref={index === 0 ? gradeRef : undefined}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => {
                        setGrade(item.value);
                        if (errors.grade || errors.form) {
                          clearErrors("grade");
                        }
                      }}
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
              <FieldError id="grade-error">{errors.grade}</FieldError>
            </FieldContent>
          </Field>

          {group.allowPairs && (
            <Field>
              <FieldLabel id="mode-label">¿Cómo vas a rendir?</FieldLabel>
              <FieldContent>
                <div
                  role="radiogroup"
                  aria-labelledby="mode-label"
                  className="grid grid-cols-2 gap-2"
                >
                  {(
                    [
                      ["individual", "Solo"],
                      ["pareja", "En pareja"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={mode === value}
                      onClick={() => {
                        setMode(value);
                        if (value === "individual") {
                          clearErrors("twoFirst", "twoLast");
                        } else if (errors.form) {
                          clearErrors();
                        }
                      }}
                      className={cn(
                        "min-h-12 border-2 px-3 py-2 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
                        mode === value
                          ? "border-primary bg-primary/5 font-semibold text-foreground"
                          : "border-border/30 text-muted-foreground hover:border-primary/60 hover:text-foreground",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </FieldContent>
            </Field>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field data-invalid={Boolean(errors.oneFirst) || undefined}>
              <FieldLabel htmlFor="one-first">
                {mode === "pareja" ? "Tus nombres" : "Nombres"}
              </FieldLabel>
              <FieldContent>
                <Input
                  ref={oneFirstRef}
                  id="one-first"
                  value={oneFirst}
                  onChange={(event) => {
                    setOneFirst(event.target.value);
                    if (errors.oneFirst || errors.form) {
                      clearErrors("oneFirst");
                    }
                  }}
                  aria-invalid={Boolean(errors.oneFirst)}
                  aria-describedby={
                    errors.oneFirst ? "one-first-error" : undefined
                  }
                />
                <FieldError id="one-first-error">{errors.oneFirst}</FieldError>
              </FieldContent>
            </Field>
            <Field data-invalid={Boolean(errors.oneLast) || undefined}>
              <FieldLabel htmlFor="one-last">
                {mode === "pareja" ? "Tus apellidos" : "Apellidos"}
              </FieldLabel>
              <FieldContent>
                <Input
                  ref={oneLastRef}
                  id="one-last"
                  value={oneLast}
                  onChange={(event) => {
                    setOneLast(event.target.value);
                    if (errors.oneLast || errors.form) {
                      clearErrors("oneLast");
                    }
                  }}
                  aria-invalid={Boolean(errors.oneLast)}
                  aria-describedby={
                    errors.oneLast ? "one-last-error" : undefined
                  }
                />
                <FieldError id="one-last-error">{errors.oneLast}</FieldError>
              </FieldContent>
            </Field>
          </div>

          {mode === "pareja" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field data-invalid={Boolean(errors.twoFirst) || undefined}>
                <FieldLabel htmlFor="two-first">
                  Nombres de tu compañero
                </FieldLabel>
                <FieldContent>
                  <Input
                    ref={twoFirstRef}
                    id="two-first"
                    value={twoFirst}
                    onChange={(event) => {
                      setTwoFirst(event.target.value);
                      if (errors.twoFirst || errors.form) {
                        clearErrors("twoFirst");
                      }
                    }}
                    aria-invalid={Boolean(errors.twoFirst)}
                    aria-describedby={
                      errors.twoFirst ? "two-first-error" : undefined
                    }
                  />
                  <FieldError id="two-first-error">
                    {errors.twoFirst}
                  </FieldError>
                </FieldContent>
              </Field>
              <Field data-invalid={Boolean(errors.twoLast) || undefined}>
                <FieldLabel htmlFor="two-last">
                  Apellidos de tu compañero
                </FieldLabel>
                <FieldContent>
                  <Input
                    ref={twoLastRef}
                    id="two-last"
                    value={twoLast}
                    onChange={(event) => {
                      setTwoLast(event.target.value);
                      if (errors.twoLast || errors.form) {
                        clearErrors("twoLast");
                      }
                    }}
                    aria-invalid={Boolean(errors.twoLast)}
                    aria-describedby={
                      errors.twoLast ? "two-last-error" : undefined
                    }
                  />
                  <FieldError id="two-last-error">{errors.twoLast}</FieldError>
                </FieldContent>
              </Field>
            </div>
          )}

          <FormError message={errors.form} errorRef={formErrorRef} />

          <div className="flex items-center justify-between gap-3">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setErrors({});
                setStep("code");
              }}
            >
              Volver
            </Button>
            <Button type="submit" size="lg">
              Continuar
            </Button>
          </div>
        </form>
      </Screen>
    );
  }

  return (
    <Screen title="Entrar al desafío">
      <ul className="flex flex-col gap-3 text-sm leading-6">
        <li className="flex gap-3">
          <UsersIcon
            className="mt-0.5 size-5 shrink-0 text-primary"
            aria-hidden="true"
          />
          <span>
            <strong>¿Primera vez?</strong> Escribe el código del grupo que te
            dio tu maestro (6 letras y números).
          </span>
        </li>
        <li className="flex gap-3">
          <KeyRoundIcon
            className="mt-0.5 size-5 shrink-0 text-primary"
            aria-hidden="true"
          />
          <span>
            <strong>¿Ya te inscribiste?</strong> Escribe tu código personal (8
            letras y números).
          </span>
        </li>
      </ul>
      <form className="flex flex-col gap-4" onSubmit={lookupCode}>
        <Field data-invalid={Boolean(errors.code) || undefined}>
          <FieldLabel htmlFor="access-code" className="sr-only">
            Tu código
          </FieldLabel>
          <FieldContent>
            <input
              ref={accessCodeRef}
              id="access-code"
              value={accessCode}
              onChange={(event) => {
                setAccessCode(event.target.value.toUpperCase());
                if (errors.code) {
                  clearErrors("code");
                }
              }}
              placeholder="TU CÓDIGO"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              aria-invalid={Boolean(errors.code)}
              aria-describedby={errors.code ? "access-code-error" : undefined}
              className="h-16 w-full border-2 border-border/30 bg-transparent px-4 text-center font-mono text-3xl tracking-[0.3em] uppercase transition-colors outline-none placeholder:text-xl placeholder:tracking-widest placeholder:text-muted-foreground/50 focus-visible:border-primary aria-invalid:border-destructive"
            />
            <FieldError id="access-code-error">{errors.code}</FieldError>
          </FieldContent>
        </Field>
        <Button type="submit" size="lg" className="w-full" disabled={loading}>
          {loading ? (
            <LoaderCircleIcon className="size-4 animate-spin" />
          ) : (
            "Continuar"
          )}
        </Button>
      </form>
      <p className="text-center text-sm leading-6 text-muted-foreground">
        ¿Perdiste tu código personal? Pídeselo a tu maestro: lo tiene en la
        lista de su grupo.
      </p>
    </Screen>
  );
}

function Screen({
  eyebrow,
  title,
  description,
  icon,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 py-2">
      <header
        className={cn(
          "flex flex-col gap-1",
          icon && "items-center gap-2 text-center",
        )}
      >
        {icon}
        {eyebrow && (
          <span className="text-sm font-semibold tracking-wide text-primary uppercase">
            {eyebrow}
          </span>
        )}
        <h1 className="font-heading text-3xl font-semibold tracking-tight">
          {title}
        </h1>
        {description && (
          <p className="text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        )}
      </header>
      {children}
    </div>
  );
}

function FormError({
  message,
  errorRef,
}: {
  message?: string;
  errorRef: RefObject<HTMLDivElement | null>;
}) {
  if (!message) return null;
  return (
    <div
      ref={errorRef}
      tabIndex={-1}
      role="alert"
      className="text-sm font-medium text-destructive outline-none"
    >
      {message}
    </div>
  );
}

/** Cuánto falta para que empiece la prueba, o cuándo empieza. */
function StartsIn({
  startsAt,
  compact = false,
}: {
  startsAt: string | null;
  compact?: boolean;
}) {
  const startsAtMs = startsAt ? new Date(startsAt).getTime() : 0;
  const now = useNow(Boolean(startsAtMs));
  const remaining = startsAtMs - now;

  if (!startsAtMs) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <CalendarClockIcon className="size-4 shrink-0" aria-hidden="true" />
        Tu maestro te dirá cuándo empieza la prueba.
      </p>
    );
  }

  if (remaining <= 0) {
    return (
      <p className="flex items-center gap-2 text-sm font-medium text-primary">
        <CalendarClockIcon className="size-4 shrink-0" aria-hidden="true" />
        La prueba ya empezó: puedes entrar ahora.
      </p>
    );
  }

  if (compact) {
    return (
      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <CalendarClockIcon
          className="mt-0.5 size-4 shrink-0"
          aria-hidden="true"
        />
        <span>
          La prueba empieza el {formatDateTime(startsAt!)} (faltan{" "}
          <span className="font-medium text-foreground tabular-nums">
            {formatCountdown(remaining)}
          </span>
          ).
        </span>
      </p>
    );
  }

  return (
    <div className="flex flex-col items-center gap-1 text-center">
      <span className="text-sm text-muted-foreground">
        La prueba empieza en
      </span>
      <span
        role="timer"
        className="font-heading text-3xl font-semibold tabular-nums"
      >
        {formatCountdown(remaining)}
      </span>
      <span className="text-sm text-muted-foreground">
        el {formatDateTime(startsAt!)}
      </span>
    </div>
  );
}
