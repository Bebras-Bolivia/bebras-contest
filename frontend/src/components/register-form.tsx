"use client";
import { REGISTRATION_ONLY } from "@/lib/registration-only";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { toast } from "sonner";

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
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { SchoolPicker, type SchoolValue } from "@/components/school-picker";
import { cn } from "@/lib/utils";
import { formatPersonName } from "@/lib/person-name";
import { validatePhone } from "@/lib/phone";
import { validateEmail } from "@/lib/email";
import { validateRegistrationText } from "@/lib/registration-text";
import { registrationPasswordError } from "@/lib/registration-password";
import { REGISTRATION_LIMITS } from "@/lib/registration-limits";
import {
  registrationInputError,
  registrationInputGuards,
  type RestrictedRegistrationField,
} from "@/lib/registration-input";
import { API_BASE_URL } from "@/lib/api-client";
import {
  refreshEmailVerification,
  VERIFICATION_POLL_INTERVAL_MS,
} from "@/lib/email-verification";
import { EMAIL_VERIFICATION_CHANNEL } from "@/lib/email-action";
import { GoogleButton } from "@/components/google-button";
import { isFirebaseConfigured } from "@/lib/firebase";
import {
  GoogleRedirectStarted,
  continueWithGoogle,
  firebaseErrorMessage,
  forgetGoogleProfile,
  readGoogleProfile,
  recallGoogleProfile,
  registerWithEmail,
  rememberGoogleProfile,
  sendVerificationEmail,
  signOutFirebase,
} from "@/lib/firebase-auth";
import { useFirebaseSession } from "@/lib/use-firebase-session";
import { landingPath, openBebrasSession } from "@/lib/session-api";

type RegisterErrors = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  password?: string;
  confirmPassword?: string;
  school?: string;
  letter?: string;
  idFront?: string;
  idBack?: string;
  form?: string;
};

type DocumentField = "letter" | "idFront" | "idBack";

const DOC_MAX_BYTES = 5 * 1024 * 1024;
const DOC_ALLOWED_EXTENSIONS = [".pdf", ".jpg", ".jpeg", ".png"];

function documentError(file: File) {
  const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  if (!DOC_ALLOWED_EXTENSIONS.includes(extension)) {
    return "Elige un archivo PDF, JPG, JPEG o PNG.";
  }
  if (file.size > DOC_MAX_BYTES) {
    return "El archivo no debe superar los 5 MB.";
  }
  return undefined;
}

function confirmationError(password: string, confirmation: string) {
  if (!confirmation) return "Confirma tu contraseña.";
  return password === confirmation
    ? undefined
    : "Las contraseñas no coinciden.";
}

export function RegisterForm() {
  const configured = isFirebaseConfigured();
  const session = useFirebaseSession();
  // Ya autenticado en Firebase pero sin perfil Bebras: la identidad y el correo
  // estan decididos, solo faltan los datos propios de Bebras (§9).
  const completing = Boolean(session.user);
  const [step, setStep] = useState<"form" | "confirm" | "verify">("form");
  const [googleBusy, setGoogleBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [checkingVerification, setCheckingVerification] = useState(false);
  const [verificationDeliveryFailed, setVerificationDeliveryFailed] =
    useState(false);
  const [verificationError, setVerificationError] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [school, setSchool] = useState<SchoolValue>({
    codUe: null,
    name: "",
    institutionType: "school",
  });
  const [phone, setPhone] = useState("");
  const [letterFile, setLetterFile] = useState<File | null>(null);
  const [idFrontFile, setIdFrontFile] = useState<File | null>(null);
  const [idBackFile, setIdBackFile] = useState<File | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const confirmPasswordTouchedRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<RegisterErrors>({});
  const firstNameRef = useRef<HTMLInputElement>(null);
  const lastNameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmPasswordRef = useRef<HTMLInputElement>(null);
  const schoolRef = useRef<HTMLInputElement>(null);
  const letterRef = useRef<HTMLInputElement>(null);
  const idFrontRef = useRef<HTMLInputElement>(null);
  const idBackRef = useRef<HTMLInputElement>(null);
  const formErrorRef = useRef<HTMLDivElement>(null);
  const prefilledRef = useRef(false);
  const verificationCheckRef = useRef<((showPendingMessage?: boolean) => void) | null>(
    null,
  );
  const pendingResponseFocusRef = useRef<
    | "firstName"
    | "lastName"
    | "school"
    | "email"
    | "phone"
    | "password"
    | DocumentField
    | null
  >(null);

  const isSchool = school.institutionType === "school";
  const hasSchoolChoice = Boolean(school.name.trim());

  const clearErrors = (...fields: (keyof RegisterErrors)[]) => {
    setErrors((current) => {
      const next = { ...current, form: undefined };
      fields.forEach((field) => {
        next[field] = undefined;
      });
      return next;
    });
  };

  const rejectCharacters = (
    field: RestrictedRegistrationField,
    message: string,
  ) => {
    setErrors((current) => ({ ...current, [field]: message, form: undefined }));
  };
  const inputGuards = (field: RestrictedRegistrationField) =>
    registrationInputGuards(field, (message) =>
      rejectCharacters(field, message),
    );
  const acceptCharacters = (
    field: RestrictedRegistrationField,
    value: string,
  ) => {
    const error = registrationInputError(field, value);
    if (error) rejectCharacters(field, error);
    return !error;
  };

  const updateDocument = (
    field: DocumentField,
    file: File | null,
    setFile: (value: File | null) => void,
  ) => {
    setFile(file);
    const error = file ? documentError(file) : undefined;
    setErrors((current) => ({ ...current, [field]: error, form: undefined }));
    if (error) {
      toast.error(error);
    }
  };

  useEffect(() => {
    if (errors.form) {
      formErrorRef.current?.focus();
    }
  }, [errors.form, step]);

  // Correo, nombre y apellido llegan desde Google. El correo queda fijo porque
  // es la identidad verificada; nombre y apellido son editables (§9, §12).
  useEffect(() => {
    if (!completing || prefilledRef.current || !session.user) return;
    prefilledRef.current = true;
    const profile = recallGoogleProfile();
    setEmail(session.email ?? profile?.email ?? "");
    if (profile?.firstName) setFirstName(profile.firstName);
    if (profile?.lastName) setLastName(profile.lastName);
  }, [completing, session.email, session.user]);

  useEffect(() => {
    if (submitting || step !== "form" || !pendingResponseFocusRef.current) {
      return;
    }

    const refs = {
      firstName: firstNameRef,
      lastName: lastNameRef,
      school: schoolRef,
      email: emailRef,
      phone: phoneRef,
      password: passwordRef,
      letter: letterRef,
      idFront: idFrontRef,
      idBack: idBackRef,
    };
    refs[pendingResponseFocusRef.current].current?.focus();
    pendingResponseFocusRef.current = null;
  }, [step, submitting]);

  useEffect(() => {
    if (step !== "verify" || !session.user) return;

    const user = session.user;
    let disposed = false;
    let running = false;
    let manualCheckQueued = false;

    const check = async (showPendingMessage = false) => {
      if (disposed) return;
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
        if (disposed) return;
        if (!verified) {
          if (showPendingMessage) {
            toast.info("Firebase todavía no confirmó el correo.");
          }
          return;
        }

        const outcome = await openBebrasSession(user);
        if (disposed) return;
        if (outcome.status === "ok") {
          toast.success("Correo verificado. Sesión iniciada.");
          disposed = true;
          window.location.replace(landingPath(outcome.user));
          return;
        }

        setVerificationError(
          outcome.status === "error"
            ? outcome.message
            : "El correo está verificado, pero no pudimos iniciar tu sesión.",
        );
      } catch {
        if (showPendingMessage && !disposed) {
          toast.error("No se pudo comprobar la verificación del correo.");
        }
      } finally {
        running = false;
        const runQueuedCheck = manualCheckQueued && !disposed;
        manualCheckQueued = false;
        if (runQueuedCheck) {
          void check(true);
        } else if (!disposed) {
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
  }, [session.user, step]);

  const goToConfirm = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    confirmPasswordTouchedRef.current = true;

    const validatedEmail = validateEmail(email);
    const validatedPhone = validatePhone(phone);
    const validatedFirstName = validateRegistrationText(firstName, "firstName");
    const validatedLastName = validateRegistrationText(lastName, "lastName");
    const validatedSchool =
      isSchool && !school.codUe
        ? validateRegistrationText(school.name, "schoolName")
        : { value: school.name, error: undefined };
    const nextErrors: RegisterErrors = {
      firstName: validatedFirstName.error,
      lastName: validatedLastName.error,
      email: validatedEmail.error,
      phone: validatedPhone.error,
      password: completing ? undefined : registrationPasswordError(password),
      confirmPassword: completing
        ? undefined
        : confirmationError(password, confirmPassword),
      school: hasSchoolChoice
        ? validatedSchool.error
        : "Indica tu colegio o selecciona educación en casa.",
      // Los documentos son opcionales al registrarse: la carta necesita la
      // firma del director y casi nadie la tiene a mano. Solo se revisa el
      // formato de lo que sí adjunten.
      letter: letterFile ? documentError(letterFile) : undefined,
      idFront: idFrontFile ? documentError(idFrontFile) : undefined,
      idBack: idBackFile ? documentError(idBackFile) : undefined,
    };
    const fieldOrder = [
      "firstName",
      "lastName",
      "email",
      "phone",
      "password",
      "confirmPassword",
      "school",
      ...(isSchool ? (["letter"] as const) : (["idFront", "idBack"] as const)),
    ] as const;
    const firstInvalid = fieldOrder.find((field) => nextErrors[field]);

    if (firstInvalid) {
      setErrors(nextErrors);
      const refs = {
        firstName: firstNameRef,
        lastName: lastNameRef,
        email: emailRef,
        phone: phoneRef,
        password: passwordRef,
        confirmPassword: confirmPasswordRef,
        school: schoolRef,
        letter: letterRef,
        idFront: idFrontRef,
        idBack: idBackRef,
      };
      refs[firstInvalid].current?.focus();
      return;
    }

    setPhone(validatedPhone.number!);
    setEmail(validatedEmail.email!);
    setFirstName(validatedFirstName.value!);
    setLastName(validatedLastName.value!);
    setSchool({ ...school, name: validatedSchool.value! });
    setErrors({});
    setShowPassword(false);
    setShowConfirmPassword(false);
    setStep("confirm");
  };

  const handleGoogle = async () => {
    setErrors({});
    setGoogleBusy(true);

    try {
      const credential = await continueWithGoogle();
      rememberGoogleProfile(readGoogleProfile(credential));
      const outcome = await openBebrasSession(credential.user);

      // Si ya era usuario de Bebras entra directo: no se vuelve a registrar (§8).
      if (outcome.status === "ok") {
        forgetGoogleProfile();
        window.location.replace(landingPath(outcome.user));
        return;
      }
      if (outcome.status === "error") {
        setErrors({ form: outcome.message });
      }
      // `profile-required`: el efecto de precarga cambia el formulario a modo
      // completar perfil en cuanto llega la sesion de Firebase.
    } catch (error) {
      if (error instanceof GoogleRedirectStarted) return;
      setErrors({
        form: firebaseErrorMessage(error, "No se pudo continuar con Google."),
      });
    } finally {
      setGoogleBusy(false);
    }
  };

  const handleResend = async () => {
    if (!session.user) return;
    setResending(true);
    try {
      await sendVerificationEmail(session.user);
      setVerificationDeliveryFailed(false);
      toast.success("Te reenviamos el correo de verificación.");
    } catch (error) {
      toast.error(firebaseErrorMessage(error, "No se pudo reenviar el correo."));
    } finally {
      setResending(false);
    }
  };

  const submit = async () => {
    setErrors({});
    setSubmitting(true);

    try {
      // Firebase decide la identidad; Bebras solo guarda el perfil asociado.
      let user = session.user;

      if (!user) {
        try {
          user = await registerWithEmail(email.trim(), password);
        } catch (error) {
          const message = firebaseErrorMessage(
            error,
            "No se pudo crear la cuenta.",
          );
          toast.error(message);
          setErrors({ email: message });
          pendingResponseFocusRef.current = "email";
          setStep("form");
          return;
        }
      }

      const token = await user.getIdToken();
      const form = new FormData();
      form.append("firstName", formatPersonName(firstName));
      form.append("lastName", formatPersonName(lastName));
      form.append("schoolName", school.name.trim());
      form.append("institutionType", school.institutionType);
      form.append("phone", phone.trim());
      if (school.codUe) {
        form.append("schoolCodUe", school.codUe);
      }
      // Lo que se haya adjuntado viaja; lo que no, se completa desde el perfil.
      const attached = isSchool
        ? [["letter", letterFile] as const]
        : ([
            ["idFront", idFrontFile],
            ["idBack", idBackFile],
          ] as const);

      for (const [field, file] of attached) {
        if (file) {
          form.append(field, file);
        }
      }

      const response = await fetch(`${API_BASE_URL}/api/auth/register`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });

      const data = (await response.json().catch(() => ({}))) as {
        message?: string;
        field?:
          | "firstName"
          | "lastName"
          | "schoolName"
          | "email"
          | "phone"
          | "password"
          | DocumentField;
      };

      if (!response.ok) {
        const message = data.message ?? "No se pudo crear la cuenta.";
        toast.error(message);
        if (data.field) {
          const field = data.field === "schoolName" ? "school" : data.field;
          setErrors({ [field]: message });
          pendingResponseFocusRef.current = field;
          setStep("form");
        } else {
          setErrors({ form: message });
        }
        return;
      }

      // Google ya trae el correo verificado: entra sin pasos extra.
      if (user.emailVerified) {
        const outcome = await openBebrasSession(user);
        forgetGoogleProfile();
        if (outcome.status === "ok") {
          window.location.replace(landingPath(outcome.user));
          return;
        }
        setErrors({
          form:
            outcome.status === "error"
              ? outcome.message
              : "Cuenta creada. Inicia sesión para continuar.",
        });
        return;
      }

      // Correo y contraseña: Firebase manda la verificación y recién después
      // se puede iniciar sesión (§4, §5).
      try {
        await sendVerificationEmail(user);
        setVerificationDeliveryFailed(false);
      } catch (error) {
        setVerificationDeliveryFailed(true);
        toast.error(
          firebaseErrorMessage(
            error,
            "Tu cuenta fue creada, pero no pudimos enviar el correo de verificación.",
          ),
        );
      }
      setStep("verify");
    } catch {
      toast.error("No se pudo conectar con el servidor.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!configured) {
    return (
      <Card className="mx-auto w-full max-w-2xl">
        <CardHeader>
          <CardTitle>Registro de maestro</CardTitle>
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

  if (step === "verify") {
    return (
      <Card className="mx-auto w-full max-w-md">
        <CardHeader>
          <CardTitle>Verifica tu correo</CardTitle>
          <CardDescription>
            {verificationDeliveryFailed
              ? `Tu cuenta quedó creada, pero el correo no pudo enviarse. Intenta reenviarlo a ${email.trim()}.`
              : `Te enviamos un enlace a ${email.trim()}. Al verificarlo, iniciaremos tu sesión automáticamente.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {verificationError && (
            <Alert variant="destructive">
              <AlertDescription>{verificationError}</AlertDescription>
            </Alert>
          )}
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
            disabled={checkingVerification}
            onClick={() => {
              setVerificationError("");
              verificationCheckRef.current?.(true);
            }}
          >
            {checkingVerification
              ? "Comprobando..."
              : "Ya verifiqué mi correo"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              void signOutFirebase().then(() => {
                window.location.replace("/login");
              });
            }}
          >
            Usar otra cuenta
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Revisa también la carpeta de correo no deseado.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (step === "confirm") {
    return (
      <Card className="mx-auto w-full max-w-2xl">
        <CardHeader>
          <CardTitle>Confirma tus datos</CardTitle>
          <CardDescription>
            Revisa que esté todo correcto antes de crear tu cuenta.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {errors.form && (
            <Alert ref={formErrorRef} variant="destructive" tabIndex={-1}>
              <AlertDescription>{errors.form}</AlertDescription>
            </Alert>
          )}
          <dl className="flex flex-col gap-2 rounded-md border bg-background px-4 py-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Nombres</dt>
              <dd className="text-right font-medium">
                {formatPersonName(firstName)}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Apellidos</dt>
              <dd className="text-right font-medium">
                {formatPersonName(lastName)}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Correo</dt>
              <dd className="text-right font-medium">{email.trim()}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Teléfono</dt>
              <dd className="text-right font-medium">{phone.trim()}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Colegio</dt>
              <dd className="text-right font-medium">{school.name.trim()}</dd>
            </div>
            {isSchool ? (
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Carta</dt>
                <dd className="text-right font-medium">
                  {letterFile?.name ?? "—"}
                </dd>
              </div>
            ) : (
              <>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Carnet anverso</dt>
                  <dd className="text-right font-medium">
                    {idFrontFile?.name ?? "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Carnet reverso</dt>
                  <dd className="text-right font-medium">
                    {idBackFile?.name ?? "—"}
                  </dd>
                </div>
              </>
            )}
          </dl>
          <div className="flex items-center justify-between gap-3">
            <Button
              type="button"
              variant="ghost"
              disabled={submitting}
              onClick={() => {
                setErrors({});
                setStep("form");
              }}
            >
              Editar
            </Button>
            <Button
              type="button"
              disabled={submitting}
              onClick={() => void submit()}
            >
              {submitting ? "Creando cuenta..." : "Confirmar y crear cuenta"}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mx-auto w-full max-w-2xl">
      <CardHeader>
        <CardTitle>Registro de maestro</CardTitle>
        <CardDescription>
          {completing
            ? "Confirma tus datos y completa lo que falta para terminar tu registro."
            : REGISTRATION_ONLY
              ? "Crea tu cuenta y completa tus datos y documentos. Un administrador revisará tu registro."
              : "Crea tu cuenta y entra enseguida. El administrador la aprueba para que puedas crear grupos e inscribir estudiantes."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!completing && (
          <>
            <GoogleButton
              disabled={googleBusy || submitting}
              loading={googleBusy}
              onClick={() => void handleGoogle()}
            />
            <div className="my-5 flex items-center gap-3">
              <span className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground">
                o con tu correo
              </span>
              <span className="h-px flex-1 bg-border" />
            </div>
          </>
        )}
        {errors.form && (
          <Alert ref={formErrorRef} variant="destructive" tabIndex={-1} className="mb-4">
            <AlertDescription>{errors.form}</AlertDescription>
          </Alert>
        )}
        <form className="flex flex-col gap-6" onSubmit={goToConfirm} noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field data-invalid={Boolean(errors.firstName) || undefined}>
              <FieldLabel htmlFor="reg-first">Nombres</FieldLabel>
              <FieldContent>
                <Input
                  ref={firstNameRef}
                  id="reg-first"
                  maxLength={REGISTRATION_LIMITS.firstName}
                  {...inputGuards("firstName")}
                  value={firstName}
                  onChange={(event) => {
                    if (!acceptCharacters("firstName", event.target.value))
                      return;
                    setFirstName(event.target.value);
                    if (errors.firstName) {
                      clearErrors("firstName");
                    }
                  }}
                  aria-invalid={Boolean(errors.firstName)}
                  aria-describedby={
                    errors.firstName ? "reg-first-error" : undefined
                  }
                />
                <FieldError id="reg-first-error">{errors.firstName}</FieldError>
              </FieldContent>
            </Field>
            <Field data-invalid={Boolean(errors.lastName) || undefined}>
              <FieldLabel htmlFor="reg-last">Apellidos</FieldLabel>
              <FieldContent>
                <Input
                  ref={lastNameRef}
                  id="reg-last"
                  maxLength={REGISTRATION_LIMITS.lastName}
                  {...inputGuards("lastName")}
                  value={lastName}
                  onChange={(event) => {
                    if (!acceptCharacters("lastName", event.target.value))
                      return;
                    setLastName(event.target.value);
                    if (errors.lastName) {
                      clearErrors("lastName");
                    }
                  }}
                  aria-invalid={Boolean(errors.lastName)}
                  aria-describedby={
                    errors.lastName ? "reg-last-error" : undefined
                  }
                />
                <FieldError id="reg-last-error">{errors.lastName}</FieldError>
              </FieldContent>
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field data-invalid={Boolean(errors.email) || undefined}>
              <FieldLabel htmlFor="reg-email">Correo</FieldLabel>
              <FieldContent>
                <Input
                  ref={emailRef}
                  id="reg-email"
                  type="email"
                  maxLength={REGISTRATION_LIMITS.email}
                  value={email}
                  readOnly={completing}
                  disabled={completing}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    if (errors.email) {
                      clearErrors("email");
                    }
                  }}
                  placeholder="tu@correo.com"
                  aria-invalid={Boolean(errors.email)}
                  aria-describedby={
                    errors.email ? "reg-email-error" : "reg-email-hint"
                  }
                />
                {completing && (
                  <p id="reg-email-hint" className="text-xs text-muted-foreground">
                    Es el correo de la cuenta con la que entraste; no se puede
                    cambiar.
                  </p>
                )}
                <FieldError id="reg-email-error">{errors.email}</FieldError>
              </FieldContent>
            </Field>
            <Field data-invalid={Boolean(errors.phone) || undefined}>
              <FieldLabel htmlFor="reg-phone">Teléfono</FieldLabel>
              <FieldContent>
                <Input
                  ref={phoneRef}
                  id="reg-phone"
                  maxLength={REGISTRATION_LIMITS.phone}
                  {...inputGuards("phone")}
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(event) => {
                    if (!acceptCharacters("phone", event.target.value)) return;
                    setPhone(event.target.value);
                    if (errors.phone) {
                      clearErrors("phone");
                    }
                  }}
                  placeholder="Ej. 71234567"
                  aria-invalid={Boolean(errors.phone)}
                  aria-describedby={
                    errors.phone ? "reg-phone-error" : undefined
                  }
                />
                <FieldError id="reg-phone-error">{errors.phone}</FieldError>
              </FieldContent>
            </Field>
          </div>
          {!completing && (
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            <Field data-invalid={Boolean(errors.password) || undefined}>
              <FieldLabel htmlFor="reg-password">Contraseña</FieldLabel>
              <FieldContent>
                <InputGroup>
                  <InputGroupInput
                    ref={passwordRef}
                    id="reg-password"
                    maxLength={REGISTRATION_LIMITS.password}
                    {...inputGuards("password")}
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    name="password"
                    minLength={6}
                    value={password}
                    onChange={(event) => {
                      const next = event.target.value;
                      if (!acceptCharacters("password", next)) return;
                      setPassword(next);
                      setErrors((current) => ({
                        ...current,
                        form: undefined,
                        password: registrationPasswordError(next),
                        confirmPassword: confirmPasswordTouchedRef.current
                          ? confirmationError(next, confirmPassword)
                          : undefined,
                      }));
                    }}
                    aria-invalid={Boolean(errors.password)}
                    aria-describedby={
                      errors.password ? "reg-password-error" : undefined
                    }
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      size="icon-sm"
                      onClick={() => setShowPassword((current) => !current)}
                      aria-label="Mostrar contraseña"
                      aria-pressed={showPassword}
                      aria-controls="reg-password"
                    >
                      {showPassword ? (
                        <EyeOffIcon aria-hidden="true" />
                      ) : (
                        <EyeIcon aria-hidden="true" />
                      )}
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
                <FieldError id="reg-password-error">
                  {errors.password}
                </FieldError>
              </FieldContent>
            </Field>
            <Field data-invalid={Boolean(errors.confirmPassword) || undefined}>
              <FieldLabel htmlFor="reg-confirm">
                Confirmar contraseña
              </FieldLabel>
              <FieldContent>
                <InputGroup>
                  <InputGroupInput
                    ref={confirmPasswordRef}
                    id="reg-confirm"
                    maxLength={REGISTRATION_LIMITS.password}
                    {...inputGuards("confirmPassword")}
                    type={showConfirmPassword ? "text" : "password"}
                    autoComplete="new-password"
                    name="confirmPassword"
                    minLength={6}
                    value={confirmPassword}
                    onChange={(event) => {
                      const next = event.target.value;
                      if (!acceptCharacters("confirmPassword", next)) return;
                      confirmPasswordTouchedRef.current = true;
                      setConfirmPassword(next);
                      setErrors((current) => ({
                        ...current,
                        form: undefined,
                        confirmPassword: confirmationError(password, next),
                      }));
                    }}
                    aria-invalid={Boolean(errors.confirmPassword)}
                    aria-describedby={
                      errors.confirmPassword ? "reg-confirm-error" : undefined
                    }
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      size="icon-sm"
                      onClick={() =>
                        setShowConfirmPassword((current) => !current)
                      }
                      aria-label="Mostrar confirmación de contraseña"
                      aria-pressed={showConfirmPassword}
                      aria-controls="reg-confirm"
                    >
                      {showConfirmPassword ? (
                        <EyeOffIcon aria-hidden="true" />
                      ) : (
                        <EyeIcon aria-hidden="true" />
                      )}
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
                <FieldError id="reg-confirm-error">
                  {errors.confirmPassword}
                </FieldError>
              </FieldContent>
            </Field>
          </FieldGroup>
          )}
          <Field data-invalid={Boolean(errors.school) || undefined}>
            <FieldLabel htmlFor="school-search">¿Dónde enseñas?</FieldLabel>
            <FieldContent>
              <SchoolPicker
                value={school}
                onChange={(value) => {
                  setSchool(value);
                  if (value.name.trim() && errors.school) {
                    clearErrors("school", "letter", "idFront", "idBack");
                  } else if (errors.letter || errors.idFront || errors.idBack) {
                    clearErrors("letter", "idFront", "idBack");
                  }
                }}
                inputRef={schoolRef}
                invalid={Boolean(errors.school)}
                describedBy={errors.school ? "reg-school-error" : undefined}
              />
              <FieldError id="reg-school-error">{errors.school}</FieldError>
            </FieldContent>
          </Field>
          <div
            className={cn(
              "grid transition-[grid-template-rows] duration-300 ease-out",
              hasSchoolChoice && isSchool
                ? "grid-rows-[1fr]"
                : "grid-rows-[0fr]",
            )}
          >
            <div className="overflow-hidden">
              <Field
                className="pt-2"
                data-invalid={Boolean(errors.letter) || undefined}
              >
                <FieldLabel htmlFor="reg-letter">
                  Carta de autorización del director{" "}
                  <span className="font-normal text-muted-foreground">
                    (opcional)
                  </span>
                </FieldLabel>
                <FieldContent>
                  <Input
                    ref={letterRef}
                    id="reg-letter"
                    type="file"
                    accept=".pdf,image/jpeg,image/png"
                    onChange={(event) => {
                      updateDocument(
                        "letter",
                        event.target.files?.[0] ?? null,
                        setLetterFile,
                      );
                    }}
                    aria-invalid={Boolean(errors.letter)}
                    aria-describedby={
                      errors.letter ? "reg-letter-error" : undefined
                    }
                  />
                  <FieldError id="reg-letter-error">{errors.letter}</FieldError>
                  {letterFile && (
                    <p className="text-xs text-muted-foreground">
                      Archivo: {letterFile.name}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    PDF o imagen (JPG, PNG), máximo 5 MB.{" "}
                    <a
                      href="/carta-modelo"
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-4 hover:text-foreground"
                    >
                      Llenar la carta aquí
                    </a>
                  </p>
                </FieldContent>
              </Field>
            </div>
          </div>

          <div
            className={cn(
              "grid transition-[grid-template-rows] duration-300 ease-out",
              hasSchoolChoice && !isSchool
                ? "grid-rows-[1fr]"
                : "grid-rows-[0fr]",
            )}
          >
            <div className="overflow-hidden">
              <div className="mt-3 flex flex-col gap-3 rounded-md border bg-secondary/20 p-4">
                <p className="text-sm text-muted-foreground">
                  Como enseñas en casa, adjunta el anverso y el reverso de tu
                  carnet de identidad para verificar tu registro.
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field data-invalid={Boolean(errors.idFront) || undefined}>
                    <FieldLabel htmlFor="reg-id-front">
                      Carnet — anverso
                    </FieldLabel>
                    <FieldContent>
                      <Input
                        ref={idFrontRef}
                        id="reg-id-front"
                        type="file"
                        accept=".pdf,image/jpeg,image/png"
                        onChange={(event) => {
                          updateDocument(
                            "idFront",
                            event.target.files?.[0] ?? null,
                            setIdFrontFile,
                          );
                        }}
                        aria-invalid={Boolean(errors.idFront)}
                        aria-describedby={
                          errors.idFront ? "reg-id-front-error" : undefined
                        }
                      />
                      <FieldError id="reg-id-front-error">
                        {errors.idFront}
                      </FieldError>
                      {idFrontFile && (
                        <p className="truncate text-xs text-muted-foreground">
                          {idFrontFile.name}
                        </p>
                      )}
                    </FieldContent>
                  </Field>
                  <Field data-invalid={Boolean(errors.idBack) || undefined}>
                    <FieldLabel htmlFor="reg-id-back">
                      Carnet — reverso
                    </FieldLabel>
                    <FieldContent>
                      <Input
                        ref={idBackRef}
                        id="reg-id-back"
                        type="file"
                        accept=".pdf,image/jpeg,image/png"
                        onChange={(event) => {
                          updateDocument(
                            "idBack",
                            event.target.files?.[0] ?? null,
                            setIdBackFile,
                          );
                        }}
                        aria-invalid={Boolean(errors.idBack)}
                        aria-describedby={
                          errors.idBack ? "reg-id-back-error" : undefined
                        }
                      />
                      <FieldError id="reg-id-back-error">
                        {errors.idBack}
                      </FieldError>
                      {idBackFile && (
                        <p className="truncate text-xs text-muted-foreground">
                          {idBackFile.name}
                        </p>
                      )}
                    </FieldContent>
                  </Field>
                </div>
                <p className="text-xs text-muted-foreground">
                  Imagen (JPG, PNG) o PDF, máximo 5 MB cada uno.
                </p>
              </div>
            </div>
          </div>
          <Button type="submit" className="w-full" disabled={googleBusy}>
            Continuar
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
