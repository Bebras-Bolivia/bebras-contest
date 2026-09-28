"use client";

import { LogOutIcon } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { type AuthUser } from "@/lib/auth";
import { signOutFirebase } from "@/lib/firebase-auth";
import { useAuthUser } from "@/lib/use-auth-user";
import { useFirebaseSession } from "@/lib/use-firebase-session";
import { Button } from "@/components/ui/button";

function getInitials(user: AuthUser) {
  const source = (user.name && user.name.trim()) || user.email;
  const parts = source.trim().split(/\s+/).filter(Boolean);

  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  return source.slice(0, 2).toUpperCase();
}

function firstName(user: AuthUser) {
  const source = (user.name && user.name.trim()) || user.email;
  return source.split(/\s+/)[0] ?? source;
}

/** Foto de Google si la hay; si no carga o no existe, las iniciales. */
function UserAvatar({
  user,
  photoURL,
  fallbackClassName,
}: {
  user: AuthUser;
  photoURL: string | null;
  fallbackClassName?: string;
}) {
  return (
    <Avatar className="after:hidden">
      {photoURL && (
        // Google rechaza a veces las fotos pedidas con referer.
        <AvatarImage src={photoURL} alt="" referrerPolicy="no-referrer" />
      )}
      <AvatarFallback className={fallbackClassName}>
        {getInitials(user)}
      </AvatarFallback>
    </Avatar>
  );
}

export function UserMenu() {
  const user = useAuthUser();
  const { photoURL } = useFirebaseSession();

  if (!user) {
    return (
      <Button asChild size="sm">
        <a href="/login">Iniciar sesión</a>
      </Button>
    );
  }

  const handleLogout = () => {
    // Cerrar tambien en Firebase: si no, la proxima visita a /login retomaria
    // la sesion automaticamente.
    void signOutFirebase().finally(() => {
      window.location.href = "/";
    });
  };

  const isMaestro = user.role === "maestro";
  const unverified = isMaestro && user.status !== "approved";

  return (
    <div className="flex items-center gap-1">
      <a
        href={isMaestro ? "/perfil" : "/admin"}
        aria-label={
          isMaestro
            ? unverified
              ? "Mi cuenta (pendiente de verificación)"
              : "Mi cuenta"
            : "Mi panel"
        }
        className="group/user flex items-center gap-2 py-0.5 pr-1 pl-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <UserAvatar
          user={user}
          photoURL={photoURL}
          fallbackClassName="bg-primary font-semibold text-primary-foreground"
        />
        <span className="hidden max-w-40 truncate text-sm font-medium transition-colors group-hover/user:text-primary sm:inline">
          {firstName(user)}
        </span>
      </a>
      <Button
        size="icon"
        variant="ghost"
        onClick={handleLogout}
        aria-label="Cerrar sesión"
        title="Cerrar sesión"
      >
        <LogOutIcon />
      </Button>
    </div>
  );
}
