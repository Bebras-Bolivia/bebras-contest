"use client";
import { REGISTRATION_ONLY } from "@/lib/registration-only";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { toast } from "sonner";
import type { User } from "firebase/auth";

import { getUser } from "@/lib/auth";
import {
  refreshEmailVerification,
  shouldResumeFirebaseSession,
  VERIFICATION_POLL_INTERVAL_MS,
} from "@/lib/email-verification";
import { EMAIL_VERIFICATION_CHANNEL } from "@/lib/email-action";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldContent,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { GoogleButton } from "@/components/google-button";
import { isFirebaseConfigured } from "@/lib/firebase";
import { REGISTRATION_LIMITS } from "@/lib/registration-limits";
import {
  GoogleRedirectStarted,
  continueWithGoogle,
  firebaseErrorMessage,
  linkPendingGoogleCredential,
  pendingGoogleLinkEmail,
  readGoogleProfile,
  rememberGoogleProfile,
  rememberPendingGoogleCredential,
  sendVerificationEmail,
  signInWithEmail,
  signOutFirebase,
} from "@/lib/firebase-auth";
import { useFirebaseSession } from "@/lib/use-firebase-session";
import { landingPath, openBebrasSession } from "@/lib/session-api";

export function LoginForm() {
  const configured = isFirebaseConfigured();
  const session = useFirebaseSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [checkingVerification, setCheckingVerification] = useState(false);
  const [unverified, setUnverified] = useState<User | null>(null);
  const [linkEmail, setLinkEmail] = useState("");
  const [errors, setErrors] = useState<{
    email?: string;
    password?: string;
    form?: string;
  }>({});
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const resumedRef = useRef(false);
  const verificationCheckRef = useRef<
    ((showPendingMessage?: boolean) => void) | null
  >(null);

  const busy = submitting || googleBusy;

  /** Camino comun de los dos proveedores: Firebase ya autentico, falta Bebras. */
  const enterBebras = async (user: User, isCurrent = () => true) => {
    const outcome = await openBebrasSession(user);
    if (!isCurrent()) return;

    switch (outcome.status) {
      case "ok":
        toast.success("Sesión iniciada.");
        window.location.replace(landingPath(outcome.user));
        return;
      case "profile-required":
        window.location.replace("/registro");
        return;
      case "email-not-verified":
        setUnverified(user);
        return;
      case "error":
        setErrors({ form: outcome.message });
    }
  };

  // Si Firebase todavia recuerda la sesion (volvio de un redirect de Google o
  // expiro solo la sesion Bebras), se retoma sin pedir credenciales de nuevo.
  useEffect(() => {
    const explicitVerificationReturn =
      new URLSearchParams(window.location.search).get("verified") === "1";
    if (
      !configured ||
      session.loading ||
      !session.user ||
      resumedRef.current ||
      // Mientras se esta enviando el formulario, ese envio ya abre la sesion:
      // reanudar aqui dispararia una segunda llamada por la misma entrada.
      busy ||
      unverified ||
      !shouldResumeFirebaseSession(Boolean(getUser()), explicitVerificationReturn)
    ) {
      return;
    }
    resumedRef.current = true;
    const user = session.user;
    let disposed = false;
    void (async () => {
      if (explicitVerificationReturn) {
        try {
          await refreshEmailVerification(user);
        } catch {
          if (disposed) return;
          setErrors({
            form: "No se pudo comprobar la verificación del correo.",
          });
          resumedRef.current = false;
          return;
        }
      }
      if (!disposed) await enterBebras(user, () => !disposed);
    })();
    return () => {
      disposed = true;
    };
  }, [busy, configured, session.loading, session.user, unverified]);

  useEffect(() => {
    if (!unverified) return;

    const user = unverified;
    const uid = user.uid;
    let disposed = false;
    let running = false;
    let manualCheckQueued = false;

    const isCurrent = () =>
      !disposed && session.user?.uid === uid && user.uid === uid;
    const check = async (showPendingMessage = false) => {
      if (!isCurrent()) return;
      if (running) {
        if (showPendingMessage) {
          manualCheckQueued = true;
          setCheckingVerification(true);
        }
        return;
      }
      running = true;
      if (showPendingMessage) setCheckingVerification(true);

      try {
        const verified = await refreshEmailVerification(user);
        if (!isCurrent()) return;
        if (!verified) {
          if (showPendingMessage) {
            toast.info("Firebase todavía no confirmó el correo.");
          }
          return;
        }
        await enterBebras(user, isCurrent);
      } catch {
        if (showPendingMessage && isCurrent()) {
          toast.error("No se pudo comprobar la verificación del correo.");
        }
      } finally {
        running = false;
        const runQueuedCheck = manualCheckQueued && isCurrent();
        manualCheckQueued = false;
        if (runQueuedCheck) {
          void check(true);
        } else if (isCurrent()) {
          setCheckingVerification(false);
        }
      }
    };

    verificationCheckRef.current = (showPendingMessage = false) => {
      void check(showPendingMessage);
    };
    void check();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void check();
    }, VERIFICATION_POLL_INTERVAL_MS);
    const checkWhenVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    window.addEventListener("focus", checkWhenVisible);
    document.addEventListener("visibilitychange", checkWhenVisible);
    const channel =
      "BroadcastChannel" in window
        ? new BroadcastChannel(EMAIL_VERIFICATION_CHANNEL)
        : null;
    channel?.addEventListener("message", checkWhenVisible);

    return () => {
      disposed = true;
      verificationCheckRef.current = null;
      window.clearInterval(interval);
      window.removeEventListener("focus", checkWhenVisible);
      document.removeEventListener("visibilitychange", checkWhenVisible);
      channel?.close();
    };
  }, [session.user, unverified]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const emailInvalid =
      Boolean(email.trim()) && Boolean(emailRef.current?.validity.typeMismatch);
    const nextErrors = {
      email: !email.trim()
        ? "Ingresa tu correo."
        : emailInvalid
          ? "Ingresa un correo válido."
          : undefined,
      password: password ? undefined : "Ingresa tu contraseña.",
    };

    if (nextErrors.email || nextErrors.password) {
      setErrors(nextErrors);
      if (nextErrors.email) {
        emailRef.current?.focus();
      } else {
        passwordRef.current?.focus();
      }
      return;
    }

    setErrors({});
    setUnverified(null);
    setSubmitting(true);

    try {
      const user = await signInWithEmail(email.trim(), password);
      // Quedaba una credencial de Google pendiente del mismo correo: ahora que
      // hay sesion se enlaza y la persona podra usar cualquiera de los dos.
      if (pendingGoogleLinkEmail()) {
        await linkPendingGoogleCredential(user);
        setLinkEmail("");
      }
      if (!user.emailVerified) {
        setUnverified(user);
        return;
      }
      await enterBebras(user);
    } catch (error) {
      setErrors({
        form: firebaseErrorMessage(error, "No se pudo iniciar sesión."),
      });
      emailRef.current?.focus();
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogle = async () => {
    setErrors({});
    setUnverified(null);
    setGoogleBusy(true);

    try {
      const credential = await continueWithGoogle();
      rememberGoogleProfile(readGoogleProfile(credential));
      await enterBebras(credential.user);
    } catch (error) {
      if (error instanceof GoogleRedirectStarted) return;

      const pending = rememberPendingGoogleCredential(error);
      if (pending) {
        setLinkEmail(pending);
        setEmail(pending);
        passwordRef.current?.focus();
        return;
      }

      setErrors({
        form: firebaseErrorMessage(error, "No se pudo continuar con Google."),
      });
    } finally {
      setGoogleBusy(false);
    }
  };

  const handleResend = async () => {
    if (!unverified) return;
    setResending(true);
    try {
      await sendVerificationEmail(unverified);
      toast.success("Te reenviamos el correo de verificación.");
    } catch (error) {
      toast.error(
        firebaseErrorMessage(error, "No se pudo reenviar el correo."),
      );
    } finally {
      setResending(false);
    }
  };

  if (!configured) {
    return (
      <Card className="mx-auto w-full max-w-md">
        <CardHeader>
          <CardTitle>Iniciar sesión</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertDescription>
              Este entorno todavía no tiene configurado Firebase Authentication.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  if (unverified) {
    return (
      <Card className="mx-auto w-full max-w-md">
        <CardHeader>
          <CardTitle>Verifica tu correo</CardTitle>
          <CardDescription>
            Te enviamos un enlace a {unverified.email}. Ábrelo y vuelve a entrar.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Button
            type="button"
            disabled={checkingVerification}
            onClick={() => verificationCheckRef.current?.(true)}
          >
            {checkingVerification
              ? "Comprobando..."
              : "Ya verifiqué mi correo"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={resending}
            onClick={() => void handleResend()}
          >
            {resending ? "Enviando..." : "Reenviar correo de verificación"}
          </Button>
          <Button
            type="button"
            onClick={() => {
              void signOutFirebase().then(() => {
                setUnverified(null);
                setPassword("");
              });
            }}
          >
            Volver a iniciar sesión
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Revisa también la carpeta de correo no deseado.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mx-auto w-full max-w-md">
      <CardHeader>
        <CardTitle>Iniciar sesión</CardTitle>
        <CardDescription>Acceso para maestros y organizadores.</CardDescription>
      </CardHeader>
      <CardContent>
        <GoogleButton
          disabled={busy}
          loading={googleBusy}
          onClick={() => void handleGoogle()}
        />

        <div className="my-5 flex items-center gap-3">
          <span className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted-foreground">o con tu correo</span>
          <span className="h-px flex-1 bg-border" />
        </div>

        <form
          className="flex flex-col gap-4"
          onSubmit={handleSubmit}
          noValidate
        >
          {linkEmail && (
            <Alert>
              <AlertDescription>
                Ya tienes una cuenta con contraseña para {linkEmail}. Ingresa esa
                contraseña una vez y dejamos Google vinculado a tu cuenta.
              </AlertDescription>
            </Alert>
          )}
          {errors.form && (
            <Alert variant="destructive">
              <AlertDescription>{errors.form}</AlertDescription>
            </Alert>
          )}
          <Field data-invalid={Boolean(errors.email) || undefined}>
            <FieldLabel htmlFor="login-email">Correo</FieldLabel>
            <FieldContent>
              <Input
                ref={emailRef}
                id="login-email"
                type="email"
                autoComplete="email"
                maxLength={REGISTRATION_LIMITS.email}
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  if (errors.email || errors.form) {
                    setErrors((current) => ({
                      ...current,
                      email: undefined,
                      form: undefined,
                    }));
                  }
                }}
                placeholder="tu@correo.com"
                aria-invalid={Boolean(errors.email)}
                aria-describedby={
                  errors.email ? "login-email-error" : undefined
                }
              />
              <FieldError id="login-email-error">{errors.email}</FieldError>
            </FieldContent>
          </Field>
          <Field data-invalid={Boolean(errors.password) || undefined}>
            <FieldLabel htmlFor="login-password">Contraseña</FieldLabel>
            <FieldContent>
              <div className="relative">
                <Input
                  ref={passwordRef}
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  maxLength={REGISTRATION_LIMITS.password}
                  autoComplete="current-password"
                  className="pr-10"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    if (errors.password || errors.form) {
                      setErrors((current) => ({
                        ...current,
                        password: undefined,
                        form: undefined,
                      }));
                    }
                  }}
                  aria-invalid={Boolean(errors.password)}
                  aria-describedby={
                    errors.password ? "login-password-error" : undefined
                  }
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={
                    showPassword ? "Ocultar contraseña" : "Mostrar contraseña"
                  }
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground transition hover:text-foreground"
                >
                  {showPassword ? (
                    <EyeOffIcon className="size-4" />
                  ) : (
                    <EyeIcon className="size-4" />
                  )}
                </button>
              </div>
              <FieldError id="login-password-error">
                {errors.password}
              </FieldError>
            </FieldContent>
          </Field>
          <Button type="submit" className="w-full" disabled={busy}>
            {submitting ? "Entrando..." : "Entrar"}
          </Button>
        </form>

        <div className="mt-6 border-t pt-5 text-center">
          <p className="text-sm text-muted-foreground">
            ¿Todavía no tienes una cuenta de maestro?
          </p>
          <Button asChild variant="outline" className="mt-3 w-full">
            <a href="/registro">Registrarme como maestro</a>
          </Button>
        </div>

        {!REGISTRATION_ONLY && (
          <p className="mt-5 text-center text-xs text-muted-foreground">
            ¿Eres estudiante? No necesitas cuenta: entra con el{" "}
            <a
              href="/entrar"
              className="underline underline-offset-2 hover:text-foreground"
            >
              código de tu maestro
            </a>
            .
          </p>
        )}
      </CardContent>
    </Card>
  );
}
