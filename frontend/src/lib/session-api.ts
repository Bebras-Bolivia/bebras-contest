import type { User } from "firebase/auth";

import { API_BASE_URL } from "@/lib/api-client";
import { setSession, type AuthUser } from "@/lib/auth";
import { trialSessionHeaders } from "@/lib/trial-view";

export type SessionOutcome =
  | { status: "ok"; user: AuthUser }
  /** Autenticado en Firebase pero sin perfil Bebras: hay que registrarse (§9). */
  | { status: "profile-required"; email: string }
  | { status: "email-not-verified"; email: string }
  | { status: "error"; message: string };

interface SessionResponse {
  user?: AuthUser;
  message?: string;
  code?: string;
  email?: string;
}

/**
 * Cambia el ID Token de Firebase por el perfil Bebras. El backend enlaza el UID
 * con la cuenta existente cuando corresponde, asi que aqui no se decide nada
 * sobre duplicados.
 */
export async function openBebrasSession(user: User): Promise<SessionOutcome> {
  let token: string;
  try {
    token = await user.getIdToken();
  } catch {
    return { status: "error", message: "No se pudo validar tu sesión." };
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/auth/session`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, ...trialSessionHeaders() },
    });
  } catch {
    return { status: "error", message: "No se pudo conectar con el servidor." };
  }

  const data = (await response.json().catch(() => ({}))) as SessionResponse;

  if (response.ok && data.user) {
    setSession(token, data.user);
    return { status: "ok", user: data.user };
  }

  if (data.code === "PROFILE_REQUIRED") {
    return {
      status: "profile-required",
      email: data.email ?? user.email ?? "",
    };
  }

  if (data.code === "EMAIL_NOT_VERIFIED") {
    return {
      status: "email-not-verified",
      email: data.email ?? user.email ?? "",
    };
  }

  return {
    status: "error",
    message: data.message ?? "No se pudo iniciar sesión.",
  };
}

/** Destino segun el rol, igual que antes de Firebase. */
export function landingPath(user: AuthUser) {
  return user.role === "admin" ? "/desafios" : "/perfil";
}
