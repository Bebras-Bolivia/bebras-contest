import { formatPersonName } from "./person-name";
import { readTrialView, readTrialSession } from "./trial-view";

const TOKEN_KEY = "bebras_token";
const USER_KEY = "bebras_user";
const SESSION_EVENT = "bebras:session-change";
let cachedKey: string | null = null;
let cachedUser: AuthUser | null = null;

export interface AuthUser {
  id: number;
  email: string;
  name: string | null;
  role: string;
  status?: string;
}

export function isApproved(user: AuthUser | null) {
  return user?.status === "approved";
}

export function getToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function notifySession() {
  window.dispatchEvent(new Event(SESSION_EVENT));
}

function validUser(value: unknown): value is AuthUser {
  if (!value || typeof value !== "object") return false;
  const user = value as AuthUser;
  return (
    Number.isInteger(user.id) &&
    user.id > 0 &&
    typeof user.email === "string" &&
    Boolean(user.email) &&
    (user.name === null || typeof user.name === "string") &&
    (user.role === "admin" || user.role === "maestro") &&
    (user.status === undefined || typeof user.status === "string")
  );
}

export function setSession(token: string, user: AuthUser) {
  if (!token?.trim() || !validUser(user)) throw new Error("Sesión inválida.");
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
    window.localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch (error) {
    clearToken();
    throw error;
  }
  notifySession();
}

/**
 * Refresca solo el token, conservando el perfil Bebras ya guardado. Lo usa el
 * puente con Firebase: el ID Token se renueva cada hora por su cuenta y eso no
 * debe borrar ni reemplazar la sesion.
 */
export function setToken(token: string) {
  if (typeof window === "undefined" || !token?.trim()) return;
  try {
    if (window.localStorage.getItem(TOKEN_KEY) === token) return;
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    return;
  }
  notifySession();
}

export function setUser(user: AuthUser) {
  if (!getToken() || !validUser(user)) return;
  if (readTrialSession()) return;
  window.localStorage.setItem(USER_KEY, JSON.stringify(user));
  notifySession();
}

let cachedView: { key: string; user: AuthUser } | null = null;

function withTrialView(user: AuthUser | null) {
  const view = readTrialView();
  if (!view || user?.role !== "admin") return user;
  const key = JSON.stringify(view);
  if (cachedView?.key !== key) {
    cachedView = {
      key,
      user: {
        id: view.id,
        email: view.email,
        name: view.name || null,
        role: view.role ?? "maestro",
        status: "approved",
      },
    };
  }
  return cachedView.user;
}

export function getUser(): AuthUser | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const token = getToken();
    const raw = window.localStorage.getItem(USER_KEY);
    if (!token || !raw) return null;
    const key = JSON.stringify([token, raw]);
    if (key === cachedKey) return withTrialView(cachedUser);
    const user: unknown = JSON.parse(raw);
    cachedUser = validUser(user)
      ? {
          ...user,
          name: user.name === null ? null : formatPersonName(user.name),
        }
      : null;
    cachedKey = key;
    return withTrialView(cachedUser);
  } catch {
    return null;
  }
}

export function clearToken() {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(TOKEN_KEY);
      window.localStorage.removeItem(USER_KEY);
    } finally {
      cachedKey = null;
      cachedUser = null;
      notifySession();
    }
  }
}

export function subscribeSession(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (
      event.storageArea === window.localStorage &&
      (event.key === null || event.key === TOKEN_KEY || event.key === USER_KEY)
    )
      listener();
  };
  window.addEventListener(SESSION_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(SESSION_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}
