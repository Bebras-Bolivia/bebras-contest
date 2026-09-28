"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  ArrowRightIcon,
  BadgeCheckIcon,
  CheckIcon,
  CircleAlertIcon,
  CircleHelpIcon,
  ClockIcon,
  EyeIcon,
  FileUpIcon,
  HouseIcon,
  LockIcon,
  MailIcon,
  PhoneIcon,
  PlusIcon,
  SchoolIcon,
  ShieldCheckIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import { API_BASE_URL, apiRequest } from "@/lib/api-client";
import { REGISTRATION_ONLY } from "@/lib/registration-only";
import { getUser, setUser } from "@/lib/auth";
import { landingPath } from "@/lib/session-api";
import { useFirebaseSession } from "@/lib/use-firebase-session";
import { authorizationHeaders } from "@/lib/firebase-auth";
import { displayPhone } from "@/lib/phone-display";
import { cn } from "@/lib/utils";
import { notice, surface, surfaceLink } from "@/lib/surface";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { DocumentUpload } from "@/components/document-upload";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { openMyDocument, openMySchoolLetter } from "@/lib/users-api";
import { SchoolPicker, type SchoolValue } from "@/components/school-picker";

type ProfileDocuments = {
  institutionType: "school" | "homeschool";
  letter: boolean;
  idFront: boolean;
  idBack: boolean;
  missing: string[];
  complete: boolean;
};

type TeacherSchool = {
  id: string;
  schoolCodUe: string | null;
  schoolName: string;
  status: string;
  hasLetter: boolean;
  createdAt: string;
};

type Profile = {
  id: number;
  email: string;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  role: string;
  status: string;
  institutionType: string | null;
  schoolName: string | null;
  schoolCodUe: string | null;
  phone: string | null;
  place: string | null;
  departmentSlug: string | null;
  createdAt: string;
  documents: ProfileDocuments;
  schools: TeacherSchool[];
};

const ACCOUNT_STATUS: Record<
  string,
  { label: string; title: string; hint: string }
> = {
  pending: {
    label: "Pendiente de verificación",
    title: "Tu cuenta está pendiente",
    hint: "Un administrador revisará tus datos.",
  },
  approved: {
    label: "Verificada",
    title: "Tu cuenta está verificada",
    hint: REGISTRATION_ONLY
      ? "Tu registro ha sido aprobado. Puedes mantener tus datos y documentos al día."
      : "Ya puedes crear grupos e inscribir estudiantes.",
  },
  suspended: {
    label: "Suspendida",
    title: "Tu cuenta está suspendida",
    hint: "Un administrador suspendió tu cuenta; escríbele para seguir.",
  },
  rejected: {
    label: "Rechazada",
    title: "No pudimos aprobar tu registro",
    hint: "Un administrador rechazó tu registro; escríbele si fue un error.",
  },
};

const SCHOOL_STATUS_LABEL: Record<string, string> = {
  pending: "Pendiente",
  approved: "Aprobado",
  rejected: "Rechazado",
};

export function ProfilePage() {
  const { photoURL } = useFirebaseSession();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [addingSchool, setAddingSchool] = useState(false);
  const [newSchool, setNewSchool] = useState<SchoolValue>({
    codUe: null,
    name: "",
    institutionType: "school",
  });
  const [verificationSchool, setVerificationSchool] =
    useState<TeacherSchool | null>(null);
  const hasNewSchool =
    newSchool.institutionType === "school" && Boolean(newSchool.name.trim());

  const load = useCallback(async () => {
    // El token rota solo cada hora; lo que invalida una respuesta en vuelo es
    // que haya cambiado la persona, no que se haya renovado su token.
    const userId = getUser()?.id ?? null;
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
        headers: await authorizationHeaders(),
      });

      if ((getUser()?.id ?? null) !== userId) return;
      if (!response.ok) {
        toast.error("No se pudo cargar tu perfil.");
        return;
      }

      const data = (await response.json()) as Profile;
      if (getUser()?.id !== data.id) return;
      setProfile(data);
      setUser({
        id: data.id,
        email: data.email,
        name: data.name,
        role: data.role,
        status: data.status,
      });
    } catch {
      toast.error("No se pudo conectar con el servidor.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // El perfil es del maestro (colegios, carta, grupos); un administrador no
    // tiene nada que ver aquí y vuelve a su inicio.
    const user = getUser();
    if (user?.role === "admin") {
      window.location.replace(landingPath(user));
      return;
    }
    void load();
    const refresh = () => {
      void load();
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [load]);

  const send = async (path: string, form: FormData, done: string) => {
    setBusy(true);

    try {
      const response = await fetch(`${API_BASE_URL}${path}`, {
        method: "POST",
        headers: await authorizationHeaders(),
        body: form,
      });

      const data = (await response.json().catch(() => ({}))) as {
        message?: string;
      };

      if (!response.ok) {
        toast.error(data.message ?? "No se pudo guardar el documento.");
        return false;
      }

      toast.success(done);
      await load();
      return true;
    } catch {
      toast.error("No se pudo conectar con el servidor.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const uploadOwnDocument = (field: string, file: File) => {
    const form = new FormData();
    form.append(field, file);
    return send(
      "/api/auth/me/documents",
      form,
      "Documento guardado. El administrador lo revisará.",
    );
  };

  const uploadSchoolLetter = (school: TeacherSchool, file: File) => {
    const form = new FormData();
    form.append("letter", file);
    return send(
      `/api/auth/me/schools/${school.id}/letter`,
      form,
      `Carta de ${school.schoolName} guardada.`,
    );
  };

  const addSchool = async () => {
    if (busy) return;
    if (!hasNewSchool) {
      toast.error("Elige el colegio que quieres administrar.");
      return;
    }

    const form = new FormData();
    form.append("schoolName", newSchool.name.trim());
    if (newSchool.codUe) {
      form.append("schoolCodUe", newSchool.codUe);
    }
    setBusy(true);
    try {
      const school = await apiRequest<TeacherSchool>("/api/auth/me/schools", {
        method: "POST",
        body: form,
        fallbackMessage: "No se pudo agregar el colegio.",
      });
      setVerificationSchool(school);
      setNewSchool({ codUe: null, name: "", institutionType: "school" });
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo agregar el colegio.",
      );
    } finally {
      setBusy(false);
    }
  };

  const cancelSchool = async (school: TeacherSchool) => {
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/auth/me/schools/${school.id}`,
        { method: "DELETE", headers: await authorizationHeaders() },
      );

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          message?: string;
        };
        toast.error(data.message ?? "No se pudo quitar el colegio.");
        return;
      }

      toast.success("Solicitud retirada.");
      await load();
    } catch {
      toast.error("No se pudo conectar con el servidor.");
    }
  };

  if (loading) {
    return (
      <div aria-busy className="flex w-full flex-col gap-8">
        <span className="sr-only">Cargando tu cuenta...</span>
        <div className="flex items-center gap-5">
          <div className="size-16 shrink-0 animate-pulse rounded-full bg-muted" />
          <div className="flex flex-col gap-2">
            <div className="h-7 w-56 animate-pulse bg-muted" />
            <div className="h-4 w-72 max-w-full animate-pulse bg-muted/70" />
          </div>
        </div>
        <div className="h-36 animate-pulse bg-muted/60" />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="h-20 animate-pulse bg-muted/50" />
          <div className="h-20 animate-pulse bg-muted/50" />
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex w-full flex-col items-center gap-3 py-16 text-center">
        <img
          src="/castores/estandar.webp"
          alt=""
          className="h-28 w-auto opacity-80"
        />
        <p className="font-semibold">No pudimos cargar tu perfil</p>
        <p className="text-sm text-muted-foreground">
          Vuelve a entrar e inténtalo de nuevo.
        </p>
      </div>
    );
  }

  const status = ACCOUNT_STATUS[profile.status] ?? ACCOUNT_STATUS.pending;
  const isSchool = profile.documents.institutionType === "school";
  const extraSchools = profile.schools ?? [];
  const documentsReady = profile.documents.complete;
  const isMaestro = profile.role === "maestro";

  const initials = (profile.name ?? profile.email)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  const viewDocument = (open: () => Promise<void>) => {
    void open().catch((error: unknown) => {
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo abrir el documento.",
      );
    });
  };

  const letterLink = (schoolName: string | null) =>
    `/carta-modelo?colegio=${encodeURIComponent(schoolName ?? "")}`;

  const ownDocuments = isSchool
    ? [
        {
          key: "letter",
          title: profile.schoolName ?? "Tu colegio",
          detail: "Carta del director, firmada y sellada",
          sent: profile.documents.letter,
          view: () => openMyDocument("letter"),
          action: (
            <>
              <a href={letterLink(profile.schoolName)} className={linkClass}>
                Llenar carta
              </a>
              <DocumentUpload
                id="own-letter"
                label="Subir carta"
                description={`Carta de autorización de ${profile.schoolName ?? "tu colegio"}. ¿Quieres enviarla para revisión?`}
                confirmLabel="Sí, enviar carta"
                busy={busy}
                onPick={(file) => uploadOwnDocument("letter", file)}
              />
            </>
          ),
        },
      ]
    : (["idFront", "idBack"] as const).map((side) => ({
        key: side,
        title: `Carnet de identidad, ${side === "idFront" ? "anverso" : "reverso"}`,
        detail: "Educación en casa",
        sent: profile.documents[side],
        view: () => openMyDocument(side),
        action: (
          <DocumentUpload
            id={`own-${side}`}
            label="Subir"
            description={`Cédula de identidad: ${side === "idFront" ? "anverso" : "reverso"}. ¿Quieres enviarla para revisión?`}
            busy={busy}
            onPick={(file) => uploadOwnDocument(side, file)}
          />
        ),
      }));

  return (
    <div className="flex w-full flex-col gap-8">
      <header className="flex flex-col gap-5 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-300 sm:flex-row sm:items-center">
        <div className="relative w-fit shrink-0">
          <Avatar className="size-16 after:hidden">
            {photoURL && (
              <AvatarImage src={photoURL} alt="" referrerPolicy="no-referrer" />
            )}
            <AvatarFallback className="bg-primary text-2xl font-semibold text-primary-foreground">
              {initials}
            </AvatarFallback>
          </Avatar>
          {profile.departmentSlug && (
            <img
              src={`/castores/${profile.departmentSlug}-cabeza.webp`}
              alt=""
              className="absolute -right-3 -bottom-2 size-8 object-contain"
            />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {profile.name ?? profile.email}
            </h1>
            <StatusBadge status={profile.status} />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <MailIcon className="size-4 shrink-0" />
              <span className="truncate">{profile.email}</span>
            </span>
            {profile.phone && (
              <span className="inline-flex items-center gap-1.5">
                <PhoneIcon className="size-4 shrink-0" />
                {displayPhone(profile.phone)}
              </span>
            )}
            <span className="inline-flex min-w-0 items-center gap-1.5">
              {isSchool ? (
                <SchoolIcon className="size-4 shrink-0" />
              ) : (
                <HouseIcon className="size-4 shrink-0" />
              )}
              <span className="truncate">
                {isSchool ? (profile.schoolName ?? "—") : "Educación en casa"}
                {profile.place ? ` · ${profile.place}` : ""}
              </span>
            </span>
          </div>
        </div>
      </header>

      {profile.status === "approved" ? null : (
        <section
          aria-labelledby="estado-cuenta"
          className={cn(
            "p-5 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-500 motion-safe:fill-mode-both sm:p-6",
            profile.status === "pending" ? notice : "bg-primary/5",
          )}
          style={{ animationDelay: "120ms" }}
        >
          <div className="flex items-center gap-6">
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <h2
                id="estado-cuenta"
                className="text-lg font-semibold tracking-tight"
              >
                {profile.status !== "pending"
                  ? status.title
                  : documentsReady
                    ? "Estamos revisando tus documentos"
                    : "Sube tus documentos para verificar tu cuenta"}
              </h2>
              <p className="max-w-prose text-sm text-muted-foreground">
                {profile.status !== "pending"
                  ? status.hint
                  : documentsReady
                    ? "Un administrador revisará lo que enviaste. Cuando aprueben tu cuenta podrás crear grupos e inscribir a tus estudiantes."
                    : isSchool
                      ? "Necesitamos la carta del director de tu colegio, firmada y sellada. Hasta que la revisemos no podrás inscribir estudiantes."
                      : "Necesitamos tu carnet de identidad por los dos lados. Hasta que lo revisemos no podrás inscribir estudiantes."}
              </p>

              {profile.status === "pending" && (
                <>
                  {documentsReady ? null : (
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-3">
                      {isSchool ? (
                        <>
                          <DocumentUpload
                            id="banner-letter"
                            label="Subir la carta"
                            variant="default"
                            size="default"
                            description={`Carta de autorización de ${profile.schoolName ?? "tu colegio"}. ¿Quieres enviarla para revisión?`}
                            confirmLabel="Sí, enviar carta"
                            busy={busy}
                            onPick={(file) => uploadOwnDocument("letter", file)}
                          />
                          <a
                            href={letterLink(profile.schoolName)}
                            className={linkClass}
                          >
                            ¿No la tienes? Llenar el modelo
                          </a>
                        </>
                      ) : (
                        (["idFront", "idBack"] as const)
                          .filter((side) => !profile.documents[side])
                          .map((side) => (
                            <DocumentUpload
                              key={side}
                              id={`banner-${side}`}
                              label={`Subir ${side === "idFront" ? "anverso" : "reverso"} del carnet`}
                              variant="default"
                              size="default"
                              description={`Cédula de identidad: ${side === "idFront" ? "anverso" : "reverso"}. ¿Quieres enviarla para revisión?`}
                              busy={busy}
                              onPick={(file) => uploadOwnDocument(side, file)}
                            />
                          ))
                      )}
                    </div>
                  )}
                  <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <ClockIcon className="size-3.5 shrink-0" />
                    {documentsReady
                      ? "La revisión suele tardar de 1 a 2 días hábiles."
                      : REVIEW_ESTIMATE}
                  </p>
                </>
              )}
            </div>
            <img
              src={
                profile.status === "pending" && documentsReady
                  ? "/castores/laptop.webp"
                  : "/castores/idea.webp"
              }
              alt=""
              className="beaver-pop hidden h-28 w-auto shrink-0 sm:block"
            />
          </div>
        </section>
      )}

      {!REGISTRATION_ONLY && isMaestro && (
        <section
          id="mis-grupos"
          aria-label="Tus herramientas"
          className="grid scroll-mt-6 gap-3 sm:grid-cols-2"
        >
          <ToolCard
            href="/grupos"
            image="/castores/laptop.webp"
            title="Mis grupos"
            summary="Inscribe a tus estudiantes en los desafíos."
            explanation="Crea grupos para inscribir a tus estudiantes en los desafíos de Bebras y reparte a cada uno su código para entrar."
            locked={profile.status !== "approved"}
            lockedText={lockedText(profile.status)}
            delay={200}
          />
          <ToolCard
            href="/mis-practicas"
            image="/castores/bandera.webp"
            title="Mis prácticas"
            summary="Arma prácticas para que tus estudiantes entrenen."
            explanation="Arma prácticas con las tareas de Bebras para que tus estudiantes entrenen antes del desafío y mira cómo les fue."
            locked={profile.status !== "approved"}
            lockedText={lockedText(profile.status)}
            delay={260}
          />
        </section>
      )}

      <section
        className="flex flex-col gap-3 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-300 motion-safe:fill-mode-both"
        style={{ animationDelay: "280ms" }}
      >
        <h2 className="text-lg font-semibold tracking-tight">
          {isSchool ? "Mis colegios" : "Mis documentos"}
        </h2>
        <ul className="flex flex-col divide-y divide-border/60 border-y border-border/60">
          {ownDocuments.map((item) => (
            <DocumentRow
              key={item.key}
              title={item.title}
              detail={
                isSchool
                  ? `Colegio principal · ${item.sent ? "carta enviada" : "falta la carta del director"}`
                  : `${item.detail} · ${item.sent ? "enviado" : "falta"}`
              }
              sent={item.sent}
              action={
                item.sent ? (
                  <ViewButton onClick={() => viewDocument(item.view)} />
                ) : (
                  item.action
                )
              }
            />
          ))}
          {extraSchools.map((school) => (
            <DocumentRow
              key={school.id}
              title={school.schoolName}
              detail={`${SCHOOL_STATUS_LABEL[school.status] ?? school.status} · ${school.hasLetter ? "carta enviada" : "falta la carta del director"}`}
              sent={school.hasLetter}
              approved={school.status === "approved"}
              action={
                <>
                  {school.hasLetter ? (
                    <ViewButton
                      onClick={() =>
                        viewDocument(() => openMySchoolLetter(school.id))
                      }
                    />
                  ) : (
                    <>
                      <a
                        href={letterLink(school.schoolName)}
                        className={linkClass}
                      >
                        Llenar carta
                      </a>
                      <DocumentUpload
                        id={`school-${school.id}`}
                        label="Subir carta"
                        description={`Carta de autorización de ${school.schoolName}. ¿Quieres enviarla para revisión?`}
                        confirmLabel="Sí, enviar carta"
                        busy={busy}
                        onPick={(file) => uploadSchoolLetter(school, file)}
                      />
                    </>
                  )}
                  {school.status === "approved" ? null : (
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      title={`Quitar ${school.schoolName}`}
                      aria-label={`Quitar ${school.schoolName}`}
                      onClick={() => void cancelSchool(school)}
                    >
                      <XIcon />
                    </Button>
                  )}
                </>
              }
            />
          ))}
        </ul>

        <Dialog
          open={addingSchool}
          onOpenChange={(open) => {
            if (busy) return;
            setAddingSchool(open);
            if (!open) {
              setVerificationSchool(null);
              setNewSchool({
                codUe: null,
                name: "",
                institutionType: "school",
              });
            }
          }}
        >
          <DialogTrigger asChild>
            <button
              type="button"
              disabled={busy}
              className="inline-flex items-center gap-1.5 self-start text-sm text-muted-foreground transition-colors duration-200 hover:text-primary disabled:opacity-50"
            >
              <PlusIcon className="size-4" />
              Administrar otro colegio
            </button>
          </DialogTrigger>
          <DialogContent
            className="flex max-h-[90dvh] flex-col sm:max-w-xl"
            showCloseButton={!busy}
          >
            <DialogHeader>
              <DialogTitle>
                {verificationSchool
                  ? "Verifica tu vínculo con el colegio"
                  : "Agregar otro colegio"}
              </DialogTitle>
              <DialogDescription>
                {verificationSchool
                  ? "Para verificar tu vínculo con este colegio, sube la carta de autorización del director, firmada y sellada. Un administrador la revisará."
                  : "Busca y selecciona el colegio donde enseñas."}
              </DialogDescription>
            </DialogHeader>
            {verificationSchool ? (
              <div
                key="verification"
                className="flex min-h-0 flex-col gap-4 overflow-y-auto motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-2 motion-safe:duration-200"
              >
                <p className="font-medium">{verificationSchool.schoolName}</p>
                <DocumentUpload
                  id={`verify-school-${verificationSchool.id}`}
                  label="Subir carta de autorización"
                  busy={busy}
                  description={`Carta de ${verificationSchool.schoolName}. ¿Quieres enviarla para revisión?`}
                  confirmLabel="Sí, enviar carta"
                  onPick={async (file) => {
                    const ok = await uploadSchoolLetter(
                      verificationSchool,
                      file,
                    );
                    if (ok) {
                      setAddingSchool(false);
                      setVerificationSchool(null);
                    }
                    return ok;
                  }}
                />
                <a
                  href={letterLink(verificationSchool.schoolName)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm underline underline-offset-4"
                >
                  ¿No tienes la carta? Completar el modelo
                </a>
                <p className="text-sm text-muted-foreground">
                  También puedes subirla después desde tu perfil. El colegio
                  quedará pendiente de verificación.
                </p>
              </div>
            ) : (
              <FieldGroup className="min-h-0 gap-4 overflow-y-auto">
                <Field>
                  <FieldLabel htmlFor="school-search">Otro colegio</FieldLabel>
                  <FieldContent>
                    <SchoolPicker
                      allowHomeschool={false}
                      value={newSchool}
                      onChange={setNewSchool}
                    />
                  </FieldContent>
                </Field>
              </FieldGroup>
            )}
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={busy}>
                  {verificationSchool ? "Lo haré después" : "Cancelar"}
                </Button>
              </DialogClose>
              {!verificationSchool && hasNewSchool && (
                <Button
                  type="button"
                  size="sm"
                  disabled={busy}
                  onClick={addSchool}
                >
                  {busy ? "Agregando..." : "Agregar colegio"}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <p className="mt-3 flex max-w-prose items-start gap-2 text-xs text-muted-foreground">
          <ShieldCheckIcon className="mt-px size-4 shrink-0" />
          <span>
            Pedimos {isSchool ? "la carta del director" : "tu carnet"} para
            confirmar que eres maestro y cuidar a los estudiantes que
            participan. Solo lo ve el equipo de Bebras Bolivia y lo guardamos
            como respaldo de tu verificación. Al subirlo aceptas que lo usemos
            solo para esto.
          </span>
        </p>
      </section>
    </div>
  );
}

const REVIEW_ESTIMATE =
  "La verificación suele tardar de 1 a 2 días hábiles después de enviar tus documentos.";

function lockedText(status: string) {
  return status === "pending"
    ? "Se desbloquea al verificar tu cuenta."
    : "Disponible cuando tu cuenta vuelva a estar aprobada.";
}

function ToolCard({
  href,
  image,
  title,
  summary,
  explanation,
  locked,
  lockedText,
  delay,
}: {
  href: string;
  image: string;
  title: string;
  summary: string;
  explanation: string;
  locked: boolean;
  lockedText: string;
  delay: number;
}) {
  const enter =
    "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-300 motion-safe:fill-mode-both";

  if (!locked) {
    return (
      <a
        href={href}
        style={{ animationDelay: `${delay}ms` }}
        className={cn(surfaceLink, "group flex items-center gap-4 p-4", enter)}
      >
        <img
          src={image}
          alt=""
          className="h-12 w-auto shrink-0 transition-transform duration-300 group-hover:-rotate-6 motion-reduce:transition-none"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="font-semibold transition-colors group-hover:text-primary">
            {title}
          </span>
          <span className="text-sm text-muted-foreground">{summary}</span>
        </div>
        <ArrowRightIcon className="size-5 shrink-0 text-primary transition-transform duration-200 group-hover:translate-x-1 motion-reduce:transition-none" />
      </a>
    );
  }

  return (
    <div
      style={{ animationDelay: `${delay}ms` }}
      className={cn(surface, "flex items-center gap-4 p-4", enter)}
    >
      <span className="relative shrink-0">
        <img src={image} alt="" className="h-12 w-auto opacity-40 grayscale" />
        <span className="absolute -right-1.5 -bottom-1 flex size-6 items-center justify-center bg-background">
          <LockIcon className="size-3.5 text-muted-foreground" />
        </span>
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-semibold text-muted-foreground">{title}</span>
        <span className="text-sm text-muted-foreground">{lockedText}</span>
      </div>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`¿Qué es ${title}?`}
            className="flex size-8 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:outline-none"
          >
            <CircleHelpIcon className="size-5" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          data-plain-menu=""
          className="w-72 bg-background text-sm outline outline-1 outline-foreground/10 drop-shadow-lg"
        >
          <p className="font-semibold">{title}</p>
          <p className="mt-1 text-muted-foreground">{explanation}</p>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function ViewButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      type="button"
      size="icon-sm"
      variant="ghost"
      aria-label="Ver documento"
      title="Ver documento"
      onClick={onClick}
    >
      <EyeIcon />
    </Button>
  );
}

const linkClass =
  "text-sm text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground";

function StatusBadge({ status }: { status: string }) {
  const { label } = ACCOUNT_STATUS[status] ?? ACCOUNT_STATUS.pending;
  const Icon =
    status === "approved"
      ? BadgeCheckIcon
      : status === "pending"
        ? ClockIcon
        : CircleAlertIcon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-semibold",
        status === "approved" &&
          "bg-difficulty-easy text-difficulty-easy-foreground",
        status === "pending" &&
          "bg-difficulty-medium text-difficulty-medium-foreground",
        status !== "approved" &&
          status !== "pending" &&
          "bg-difficulty-hard text-difficulty-hard-foreground",
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </span>
  );
}

function DocumentRow({
  title,
  detail,
  sent,
  approved = false,
  action,
}: {
  title: string;
  detail: string;
  sent: boolean;
  approved?: boolean;
  action: ReactNode;
}) {
  return (
    <li className={cn("flex flex-wrap items-center gap-x-4 gap-y-3 py-3")}>
      <span
        key={String(sent)}
        className={cn(
          "flex size-8 shrink-0 items-center justify-center motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:duration-300",
          sent ? "bg-difficulty-easy/25" : "bg-secondary/50",
        )}
      >
        {sent ? (
          <CheckIcon className="size-4" />
        ) : (
          <FileUpIcon className="size-4" />
        )}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">
          {title}
          {approved && (
            <BadgeCheckIcon className="ml-1.5 inline size-4 text-foreground" />
          )}
        </span>
        <span className="text-xs text-muted-foreground">{detail}</span>
      </div>
      {action && (
        <div className="flex flex-wrap items-center gap-3">{action}</div>
      )}
    </li>
  );
}
