"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  KeyRoundIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  ShieldPlusIcon,
} from "lucide-react";
import { toast } from "sonner";

import {
  addAdmin,
  certificatesExportUrl,
  getCertificatesLink,
  getSiteSettings,
  listAdmins,
  renewCertificatesKey,
  saveSiteSettings,
  type AdminAccount,
  type CertificatesLink,
} from "@/lib/admin-api";
import { copyToClipboard } from "@/lib/clipboard";
import { useAuthUser } from "@/lib/use-auth-user";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const errorText = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

export function AdminPanel() {
  const user = useAuthUser();

  return (
    <div className="flex w-full flex-col gap-10">
      <div className="flex flex-col gap-1 border-b pb-6">
        <span className="text-xs font-semibold tracking-wide text-primary uppercase">
          Administrador
        </span>
        <h1 className="font-heading text-3xl font-semibold tracking-tight break-words">
          {user?.name ?? "Mi panel"}
        </h1>
        {user?.email && (
          <p className="text-sm text-muted-foreground">{user.email}</p>
        )}
      </div>
      <AdminsSection />
      <InfoSiteSection />
      <CertificatesSection />
    </div>
  );
}

function AdminsSection() {
  const [admins, setAdmins] = useState<AdminAccount[] | null>(null);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);

  useEffect(() => {
    void listAdmins()
      .then(setAdmins)
      .catch((caught: unknown) =>
        setError(errorText(caught, "No se pudo cargar la lista.")),
      );
  }, []);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setError("Escribe un correo válido.");
      return;
    }
    if (admins?.some((admin) => admin.email === value)) {
      setError("Ese correo ya es administrador.");
      return;
    }
    setConfirming(value);
  };

  const add = async (value: string) => {
    setSaving(true);
    try {
      const admin = await addAdmin(value);
      setAdmins((current) => [...(current ?? []), admin]);
      setEmail("");
      setError(null);
      toast.success(`${admin.email} ahora es administrador.`);
    } catch (caught) {
      setError(errorText(caught, "No se pudo agregar."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-heading text-xl font-semibold">Administradores</h2>

      <form noValidate onSubmit={submit} className="flex flex-col gap-2">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            type="email"
            value={email}
            disabled={saving}
            placeholder="correo@ejemplo.com"
            aria-label="Correo del nuevo administrador"
            aria-invalid={Boolean(error)}
            className="sm:flex-1"
            onChange={(event) => {
              setEmail(event.target.value);
              setError(null);
            }}
          />
          <Button type="submit" disabled={saving}>
            {saving ? (
              <LoaderCircleIcon
                data-icon="inline-start"
                className="animate-spin"
              />
            ) : (
              <ShieldPlusIcon data-icon="inline-start" />
            )}
            Hacer administrador
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </form>

      {admins === null ? (
        !error && (
          <LoaderCircleIcon className="size-5 animate-spin text-muted-foreground" />
        )
      ) : (
        <ul className="divide-y border-y">
          {admins.map((admin) => (
            <li key={admin.id} className="flex items-center gap-3 py-3">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium">
                  {admin.name ?? admin.email}
                </span>
                {admin.name && (
                  <span className="truncate text-sm text-muted-foreground">
                    {admin.email}
                  </span>
                )}
              </div>
              {admin.isSelf && (
                <span className="text-sm text-muted-foreground">Tú</span>
              )}
            </li>
          ))}
        </ul>
      )}

      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              ¿Hacer administrador a {confirming}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Revisa bien el correo: un administrador no se puede quitar
              después.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirming) void add(confirming);
              }}
            >
              Hacer administrador
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function InfoSiteSection() {
  const [saved, setSaved] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void getSiteSettings()
      .then(({ infoSiteUrl }) => {
        setSaved(infoSiteUrl);
        setValue(infoSiteUrl ?? "");
      })
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    try {
      const { infoSiteUrl } = await saveSiteSettings({
        infoSiteUrl: value.trim() || null,
      });
      setSaved(infoSiteUrl);
      setValue(infoSiteUrl ?? "");
      setError(null);
      toast.success(
        infoSiteUrl
          ? "Enlace guardado. Ya aparece en el inicio."
          : "Enlace quitado del inicio.",
      );
    } catch (caught) {
      setError(errorText(caught, "No se pudo guardar."));
    } finally {
      setSaving(false);
    }
  };

  const changed = value.trim() !== (saved ?? "");

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-heading text-xl font-semibold">
          Sitio informativo
        </h2>
        <p className="text-sm text-muted-foreground">
          Aparece en el inicio. Déjalo vacío para quitarlo.
        </p>
      </div>
      <form noValidate onSubmit={submit} className="flex flex-col gap-2">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            type="url"
            value={value}
            disabled={!loaded || saving}
            placeholder="https://bebras.bo"
            aria-label="Enlace al sitio informativo"
            aria-invalid={Boolean(error)}
            className="sm:flex-1"
            onChange={(event) => {
              setValue(event.target.value);
              setError(null);
            }}
          />
          <Button type="submit" disabled={!loaded || saving || !changed}>
            {saving ? (
              <LoaderCircleIcon
                data-icon="inline-start"
                className="animate-spin"
              />
            ) : (
              <CheckIcon data-icon="inline-start" />
            )}
            Guardar
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {saved && !changed && (
          <a
            href={saved}
            target="_blank"
            rel="noreferrer"
            className="inline-flex w-fit items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline"
          >
            Abrir el sitio
            <ExternalLinkIcon className="size-3.5" />
          </a>
        )}
      </form>
    </section>
  );
}

function CertificatesSection() {
  const [link, setLink] = useState<CertificatesLink | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renewing, setRenewing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    void getCertificatesLink()
      .then(setLink)
      .catch((caught: unknown) =>
        setError(errorText(caught, "No se pudo cargar el enlace.")),
      );
  }, []);

  const renew = async () => {
    setRenewing(true);
    try {
      const next = await renewCertificatesKey();
      setLink(next);
      setError(null);
      if (
        next.key &&
        (await copyToClipboard(certificatesExportUrl(next.key)))
      ) {
        toast.success("Enlace nuevo copiado. Pégalo en el CMS del sitio.");
      }
    } catch (caught) {
      setError(errorText(caught, "No se pudo crear el enlace."));
    } finally {
      setRenewing(false);
    }
  };

  const url = link?.key ? certificatesExportUrl(link.key) : null;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-heading text-xl font-semibold">Certificados</h2>
        <p className="text-sm text-muted-foreground">
          Pega este enlace en el CMS del sitio informativo y toca «Actualizar»
          para llevar los certificados. Es secreto: con él se descargan los
          nombres de los estudiantes.
        </p>
      </div>

      {link === null ? (
        !error && (
          <LoaderCircleIcon className="size-5 animate-spin text-muted-foreground" />
        )
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm">
            {link.certificates === 0
              ? "Todavía no hay certificados: aparecen cuando un desafío publica sus resultados."
              : `${link.certificates} ${link.certificates === 1 ? "certificado" : "certificados"} de ${link.contests} ${link.contests === 1 ? "desafío" : "desafíos"} con resultados publicados.`}
          </p>
          {url ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                readOnly
                value={url}
                aria-label="Enlace de certificados"
                className="font-mono text-xs sm:flex-1"
                onFocus={(event) => event.currentTarget.select()}
              />
              <Button
                type="button"
                onClick={async () => {
                  if (await copyToClipboard(url))
                    toast.success("Enlace copiado.");
                }}
              >
                <CopyIcon data-icon="inline-start" />
                Copiar enlace
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={renewing}
                onClick={() => setConfirming(true)}
              >
                {renewing ? (
                  <LoaderCircleIcon
                    data-icon="inline-start"
                    className="animate-spin"
                  />
                ) : (
                  <RefreshCwIcon data-icon="inline-start" />
                )}
                Cambiar enlace
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              className="w-fit"
              disabled={renewing}
              onClick={() => void renew()}
            >
              {renewing ? (
                <LoaderCircleIcon
                  data-icon="inline-start"
                  className="animate-spin"
                />
              ) : (
                <KeyRoundIcon data-icon="inline-start" />
              )}
              Crear enlace
            </Button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              ¿Cambiar el enlace de certificados?
            </AlertDialogTitle>
            <AlertDialogDescription>
              El enlace actual dejará de funcionar y tendrás que pegar el nuevo
              en el CMS del sitio. Úsalo si alguien más lo vio.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void renew()}>
              Cambiar enlace
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
