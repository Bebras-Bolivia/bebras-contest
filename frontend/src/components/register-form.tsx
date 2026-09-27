"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type Ref,
} from "react";
import { CircleAlertIcon, EyeIcon, EyeOffIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
  department?: string;
  form?: string;
};

const DEPARTMENTS = [
  { value: "LA PAZ", name: "La Paz", slug: "la-paz" },
  { value: "COCHABAMBA", name: "Cochabamba", slug: "cochabamba" },
  { value: "SANTA CRUZ", name: "Santa Cruz", slug: "santa-cruz" },
  { value: "ORURO", name: "Oruro", slug: "oruro" },
  { value: "POTOSI", name: "Potosí", slug: "potosi" },
  { value: "CHUQUISACA", name: "Chuquisaca", slug: "sucre" },
  { value: "TARIJA", name: "Tarija", slug: "tarija" },
  { value: "BENI", name: "Beni", slug: "beni" },
  { value: "PANDO", name: "Pando", slug: "pando" },
];

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
  const [department, setDepartment] = useState("");
  const [manualSchool, setManualSchool] = useState(false);
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
  const departmentRef = useRef<HTMLButtonElement>(null);
  const formErrorRef = useRef<HTMLParagraphElement>(null);
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
    | "department"
    | null
  >(null);

  const isSchool = school.institutionType === "school";
  const hasSchoolChoice = Boolean(school.name.trim());
  const needsDepartment = !isSchool || (manualSchool && !school.codUe);

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
      department: departmentRef,
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
      department:
        needsDepartment && !department ? "Elige tu departamento." : undefined,
    };
    const fieldOrder = [
      "firstName",
      "lastName",
      "email",
      "phone",
      "password",
      "confirmPassword",
      "school",
      "department",
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
        department: departmentRef,
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
      } else {
        form.append("department", department);
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
          | "department";
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
      <section className="mx-auto w-full max-w-md">
        <Heading title="Registro de maestro" />
        <FormMessage>
          Este entorno todavía no tiene configurado Firebase Authentication.
        </FormMessage>
      </section>
    );
  }

  if (step === "verify") {
    return (
      <section className="mx-auto w-full max-w-md">
        <Heading
          title="Verifica tu correo"
          description={
            verificationDeliveryFailed
              ? `Tu cuenta quedó creada, pero el correo no pudo enviarse. Intenta reenviarlo a ${email.trim()}.`
              : `Te enviamos un enlace a ${email.trim()}. Al verificarlo, iniciaremos tu sesión automáticamente.`
          }
        />
        <div className="flex flex-col gap-3">
          {verificationError && <FormMessage>{verificationError}</FormMessage>}
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
        </div>
      </section>
    );
  }

  if (step === "confirm") {
    const summary = [
      ["Nombres", formatPersonName(firstName)],
      ["Apellidos", formatPersonName(lastName)],
      ["Correo", email.trim()],
      ["Teléfono", phone.trim()],
      [isSchool ? "Colegio" : "Dónde enseñas", school.name.trim()],
      ...(needsDepartment
        ? [
            [
              "Departamento",
              DEPARTMENTS.find((item) => item.value === department)?.name ??
                "",
            ],
          ]
        : []),
    ];
    return (
      <section className="mx-auto w-full max-w-md">
        <Heading
          title="Confirma tus datos"
          description="Revisa que esté todo correcto antes de crear tu cuenta."
        />
        <div className="flex flex-col gap-6">
          <dl className="divide-y border-y text-sm">
            {summary.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4 py-3">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="text-right font-medium">{value}</dd>
              </div>
            ))}
          </dl>
          {errors.form && (
            <FormMessage ref={formErrorRef}>{errors.form}</FormMessage>
          )}
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
        </div>
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-2xl">
      <Heading
        title="Registro de maestro"
        description={
          completing ? "Completa tus datos para terminar tu registro." : undefined
        }
      />
      <div>
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
          <FormMessage ref={formErrorRef} className="mb-4">
            {errors.form}
          </FormMessage>
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
                    errors.email ? "reg-email-error" : undefined
                  }
                />
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
                    clearErrors("school");
                  }
                }}
                onManualChange={setManualSchool}
                inputRef={schoolRef}
                invalid={Boolean(errors.school)}
                describedBy={errors.school ? "reg-school-error" : undefined}
              />
              <FieldError id="reg-school-error">{errors.school}</FieldError>
            </FieldContent>
          </Field>
          <div
            className={cn(
              "-mt-6 grid transition-[grid-template-rows] duration-300 ease-out",
              needsDepartment ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
            )}
            inert={!needsDepartment}
          >
            <div className="overflow-hidden">
              <Field
                className="pt-6"
                data-invalid={Boolean(errors.department) || undefined}
              >
                <FieldLabel id="reg-department-label">
                  ¿En qué departamento?
                </FieldLabel>
                <FieldContent>
                  <div
                    role="radiogroup"
                    aria-labelledby="reg-department-label"
                    aria-describedby={
                      errors.department ? "reg-department-error" : undefined
                    }
                    className="grid grid-cols-3 gap-1.5"
                  >
                    {DEPARTMENTS.map((item, index) => {
                      const selected = department === item.value;
                      return (
                        <button
                          key={item.value}
                          ref={index === 0 ? departmentRef : undefined}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => {
                            setDepartment(item.value);
                            if (errors.department) clearErrors("department");
                          }}
                          className={cn(
                            "flex flex-col items-center gap-1 border-2 px-1 py-2 text-sm text-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/60 sm:flex-row sm:gap-2 sm:px-2 sm:py-1.5 sm:text-left",
                            selected
                              ? "border-primary bg-primary/10 font-semibold"
                              : "border-border/30 hover:border-primary/60",
                            errors.department &&
                              !selected &&
                              "border-destructive/60",
                          )}
                        >
                          <img
                            src={`/castores/${item.slug}-cabeza.webp`}
                            alt=""
                            className="size-7 shrink-0 object-contain"
                          />
                          <span className="min-w-0">{item.name}</span>
                        </button>
                      );
                    })}
                  </div>
                  <FieldError id="reg-department-error">
                    {errors.department}
                  </FieldError>
                </FieldContent>
              </Field>
            </div>
          </div>
          <Button type="submit" className="w-full" disabled={googleBusy}>
            Continuar
          </Button>
        </form>
      </div>
    </section>
  );
}

function Heading({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <header className="mb-6 flex flex-col gap-1.5">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {description && (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}
    </header>
  );
}

function FormMessage({
  ref,
  className,
  children,
}: {
  ref?: Ref<HTMLParagraphElement>;
  className?: string;
  children: ReactNode;
}) {
  return (
    <p
      ref={ref}
      role="alert"
      tabIndex={-1}
      className={cn(
        "flex items-start gap-2 text-sm font-medium text-destructive outline-none",
        className,
      )}
    >
      <CircleAlertIcon className="mt-0.5 size-4 shrink-0" />
      {children}
    </p>
  );
}
