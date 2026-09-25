"use client";

import { ChevronDownIcon, LogOutIcon } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
      <a
        href="/login"
        className="rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
      >
        Iniciar sesión
      </a>
    );
  }

  const handleLogout = () => {
    // Cerrar tambien en Firebase: si no, la proxima visita a /login retomaria
    // la sesion automaticamente.
    void signOutFirebase().finally(() => {
      window.location.href = "/";
    });
  };

  if (user.role === "maestro") {
    return (
      <div className="flex items-center gap-1">
        <a
          href="/perfil"
          aria-label="Mi cuenta"
          className="flex items-center gap-2 rounded-full py-0.5 pr-2 pl-0.5 outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <UserAvatar user={user} photoURL={photoURL} />
          <span className="hidden max-w-40 truncate text-sm font-medium sm:inline">
            {firstName(user)}
          </span>
        </a>
        <Button
          size="icon"
          variant="ghost"
          onClick={handleLogout}
          aria-label="Cerrar sesión"
        >
          <LogOutIcon />
        </Button>
      </div>
    );
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Menú de usuario"
          className="flex items-center gap-2 rounded-full py-0.5 pr-1 pl-0.5 outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <UserAvatar
            user={user}
            photoURL={photoURL}
            fallbackClassName="bg-primary font-semibold text-primary-foreground"
          />
          <span className="hidden max-w-40 truncate text-sm font-medium sm:inline">
            {firstName(user)}
          </span>
          <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 p-2">
        <div className="flex items-center gap-3 px-1 py-1.5">
          <UserAvatar
            user={user}
            photoURL={photoURL}
            fallbackClassName="bg-primary font-semibold text-primary-foreground"
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              {user.name ?? "Cuenta"}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {user.email}
            </p>
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem variant="destructive" onSelect={handleLogout}>
            <LogOutIcon />
            Salir
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
