"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowRightIcon,
  LoaderCircleIcon,
  PlusIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import { API_BASE_URL, apiRequest } from "@/lib/api-client";
import { REGISTRATION_ONLY } from "@/lib/registration-only";
import { getUser, setUser } from "@/lib/auth";
import { landingPath } from "@/lib/session-api";
import { useFirebaseSession } from "@/lib/use-firebase-session";
import { authorizationHeaders } from "@/lib/firebase-auth";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
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
  createdAt: string;
  documents: ProfileDocuments;
  schools: TeacherSchool[];
};

const ACCOUNT_STATUS: Record<string, { label: string; hint: string }> = {
  pending: { label: "Pendiente", hint: "Un administrador revisará tus datos." },
  approved: {
    label: "Aprobado",
    hint: REGISTRATION_ONLY
      ? "Tu registro ha sido aprobado. Puedes mantener tus datos y documentos al día."
      : "Ya puedes crear grupos e inscribir estudiantes.",
  },
  suspended: {
    label: "Suspendido",
    hint: "Un administrador suspendió tu cuenta; escríbele para seguir.",
  },
  rejected: {
    label: "Rechazado",
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
      <div className="flex min-h-72 items-center justify-center">
        <LoaderCircleIcon className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!profile) {
    return (
      <Alert>
        <AlertTitle>No pudimos cargar tu perfil</AlertTitle>
        <AlertDescription>
          Vuelve a entrar e inténtalo de nuevo.
        </AlertDescription>
      </Alert>
    );
  }

  const account = ACCOUNT_STATUS[profile.status] ?? ACCOUNT_STATUS.pending;
  const isSchool = profile.documents.institutionType === "school";
  const extraSchools = profile.schools ?? [];
  const missingLetters = [
    ...(isSchool && !profile.documents.letter
      ? [profile.schoolName ?? "tu colegio"]
      : []),
    ...extraSchools
      .filter((school) => !school.hasLetter)
      .map((school) => school.schoolName),
  ];

  const row = "flex flex-wrap items-center justify-between gap-2 py-2.5";

  const initials = (profile.name ?? profile.email)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div className="flex w-full flex-col gap-8">
      <header className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-start sm:gap-5">
        <Avatar className="size-14 after:hidden">
          {photoURL && (
            <AvatarImage src={photoURL} alt="" referrerPolicy="no-referrer" />
          )}
          <AvatarFallback className="bg-primary text-lg font-semibold text-primary-foreground">
            {initials}
          </AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {profile.name ?? profile.email}
            </h1>
            <Badge
              variant={profile.status === "approved" ? "secondary" : "outline"}
            >
              {account.label}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {profile.role === "admin" ? "Administrador" : "Maestro"} ·{" "}
            {profile.email}
            {profile.phone ? ` · ${profile.phone}` : ""}
          </p>
          <p className="text-sm text-muted-foreground">{account.hint}</p>
        </div>
      </header>

      {!REGISTRATION_ONLY && profile.role === "maestro" && (
        <section id="mis-grupos" className="flex scroll-mt-6 flex-col gap-2">
          <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Mis grupos
          </h2>
          {profile.status === "approved" ? (
            // Los grupos viven en su propia página; aquí solo queda la entrada.
            <div className="flex flex-col border-t border-border">
              <div className={row}>
                <div className="flex min-w-0 flex-col">
                  <span className="text-sm font-medium">
                    Grupos y participantes
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Crea grupos, inscribe estudiantes y reparte sus códigos.
                  </span>
                </div>
                <Button asChild size="sm" variant="outline">
                  <a href="/grupos">
                    Ir a mis grupos
                    <ArrowRightIcon data-icon="inline-end" />
                  </a>
                </Button>
              </div>
            </div>
          ) : (
            <Alert>
              <AlertTitle>Mis grupos</AlertTitle>
              <AlertDescription>
                {profile.status === "pending"
                  ? "Cuando se apruebe tu cuenta, aquí podrás crear grupos, inscribir estudiantes y consultar sus códigos de acceso."
                  : "La gestión de grupos estará disponible cuando tu cuenta vuelva a estar aprobada."}
              </AlertDescription>
            </Alert>
          )}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {isSchool ? "Mis colegios" : "Mi verificación"}
        </h2>
        <div className="flex flex-col divide-y border-t border-border">
          {isSchool ? (
            <div className={row}>
              <div className="flex min-w-0 flex-col">
                <span className="text-sm font-medium">
                  {profile.schoolName ?? "—"}
                </span>
                <span className="text-xs text-muted-foreground">
                  Colegio principal ·{" "}
                  {profile.documents.letter
                    ? "carta enviada"
                    : "falta la carta del director"}
                </span>
              </div>
              {profile.documents.letter ? null : (
                <div className="flex items-center gap-3">
                  <a
                    href={`/carta-modelo?colegio=${encodeURIComponent(
                      profile.schoolName ?? "",
                    )}`}
                    className="text-sm text-muted-foreground underline underline-offset-4 transition hover:text-foreground"
                  >
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
                </div>
              )}
            </div>
          ) : (
            (["idFront", "idBack"] as const).map((side) => (
              <div className={row} key={side}>
                <div className="flex min-w-0 flex-col">
                  <span className="text-sm font-medium">
                    Carnet — {side === "idFront" ? "anverso" : "reverso"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Educación en casa ·{" "}
                    {profile.documents[side] ? "enviado" : "falta"}
                  </span>
                </div>
                {profile.documents[side] ? null : (
                  <DocumentUpload
                    id={`own-${side}`}
                    label="Subir"
                    description={`Cédula de identidad: ${side === "idFront" ? "anverso" : "reverso"}. ¿Quieres enviarla para revisión?`}
                    busy={busy}
                    onPick={(file) => uploadOwnDocument(side, file)}
                  />
                )}
              </div>
            ))
          )}

          {extraSchools.map((school) => (
            <div className={row} key={school.id}>
              <div className="flex min-w-0 flex-col">
                <span className="text-sm font-medium">{school.schoolName}</span>
                <span className="text-xs text-muted-foreground">
                  {SCHOOL_STATUS_LABEL[school.status] ?? school.status} ·{" "}
                  {school.hasLetter
                    ? "carta enviada"
                    : "falta la carta del director"}
                </span>
              </div>
              <div className="flex items-center gap-3">
                {school.hasLetter ? null : (
                  <>
                    <a
                      href={`/carta-modelo?colegio=${encodeURIComponent(
                        school.schoolName,
                      )}`}
                      className="text-sm text-muted-foreground underline underline-offset-4 transition hover:text-foreground"
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
              </div>
            </div>
          ))}

          {missingLetters.length > 0 && (
            <p className="pt-4 text-xs text-muted-foreground">
              Falta la carta de: {missingLetters.join(", ")}.{" "}
              <a
                href="/carta-modelo"
                className="underline underline-offset-4 hover:text-foreground"
              >
                Llenar la carta aquí
              </a>
            </p>
          )}
        </div>

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
          <div className="pt-4">
            <DialogTrigger asChild>
              <Button type="button" size="sm" variant="outline" disabled={busy}>
                <PlusIcon data-icon="inline-start" />
                Administrar otro colegio
              </Button>
            </DialogTrigger>
          </div>
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
                  href={`/carta-modelo?colegio=${encodeURIComponent(verificationSchool.schoolName)}`}
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
      </section>
    </div>
  );
}
