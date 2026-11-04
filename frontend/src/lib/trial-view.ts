const VIEW_KEY = "bebras_trial_view";
const SESSION_KEY = "bebras_trial_session";
const SIGNUP_KEY = "bebras_trial_signup";

export function readTrialSession(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

export function trialSessionHeaders(): Record<string, string> {
  const session = readTrialSession();
  return session ? { "x-trial-session": session } : {};
}

export function trialSessionUrl(path: string, sessionId: string) {
  const url = new URL(path, window.location.origin);
  url.searchParams.set("ensayo", sessionId);
  return url.href;
}

export type TrialView = {
  id: number;
  email: string;
  name: string;
  role?: "maestro" | "admin";
};

export function readTrialView(): TrialView | null {
  if (typeof window === "undefined") return null;
  try {
    const value = JSON.parse(window.sessionStorage.getItem(VIEW_KEY) ?? "null");
    return Number.isInteger(value?.id) && typeof value?.email === "string"
      ? {
          id: value.id,
          email: value.email,
          name: typeof value.name === "string" ? value.name : "",
          role: value.role === "admin" ? "admin" : "maestro",
        }
      : null;
  } catch {
    return null;
  }
}

export function leaveTrialView() {
  try {
    window.sessionStorage.removeItem(VIEW_KEY);
    window.sessionStorage.removeItem(SESSION_KEY);
    clearTrialSignup();
  } catch {
    return;
  }
}

export function trialViewUrl(
  path: string,
  view: TrialView,
  sessionId?: string,
) {
  const url = new URL(path, window.location.origin);
  const params = {
    vm_id: String(view.id),
    vm_email: view.email,
    vm_name: view.name,
    vm_role: view.role ?? "maestro",
  };
  Object.entries(params).forEach(([key, value]) =>
    url.searchParams.set(key, value),
  );
  return sessionId ? trialSessionUrl(url.href, sessionId) : url.href;
}

function captureTrialSession() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (["/prueba-guiada", "/pruebas-guiadas"].includes(url.pathname)) {
    leaveTrialView();
    return;
  }
  const sessionId = url.searchParams.get("ensayo");
  if (!sessionId) return;
  try {
    if (readTrialSession() !== sessionId) leaveTrialView();
    window.sessionStorage.setItem(SESSION_KEY, sessionId);
    url.searchParams.delete("ensayo");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  } catch {
    return;
  }
}

export function trialSignupId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(SIGNUP_KEY);
  } catch {
    return null;
  }
}

export function isTrialSignup() {
  return Boolean(trialSignupId());
}

function clearTrialSignup() {
  window.sessionStorage.removeItem(SIGNUP_KEY);
  window.sessionStorage.removeItem("bebras_token");
  window.sessionStorage.removeItem("bebras_user");
  window.sessionStorage.removeItem("bebras_google_profile");
  window.sessionStorage.removeItem("bebras_google_redirect");
}

function captureTrialSignup() {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  if (params.get("prueba") !== "1") return;
  try {
    clearTrialSignup();
    window.sessionStorage.removeItem(VIEW_KEY);
    window.sessionStorage.setItem(SIGNUP_KEY, window.crypto.randomUUID());
  } catch {
    return;
  }
  params.delete("prueba");
  const query = params.toString();
  window.history.replaceState(
    null,
    "",
    window.location.pathname +
      (query ? `?${query}` : "") +
      window.location.hash,
  );
}

function captureTrialView() {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  const id = Number(params.get("vm_id"));
  const email = params.get("vm_email");
  if (!Number.isInteger(id) || id <= 0 || !email) return;
  try {
    clearTrialSignup();
    window.sessionStorage.setItem(
      VIEW_KEY,
      JSON.stringify({
        id,
        email,
        name: params.get("vm_name") ?? "",
        role: params.get("vm_role") === "admin" ? "admin" : "maestro",
      }),
    );
  } catch {
    return;
  }
  ["vm_id", "vm_email", "vm_name", "vm_role"].forEach((key) =>
    params.delete(key),
  );
  const query = params.toString();
  window.history.replaceState(
    null,
    "",
    window.location.pathname +
      (query ? `?${query}` : "") +
      window.location.hash,
  );
}

captureTrialSession();
captureTrialSignup();
captureTrialView();

if (typeof document !== "undefined") {
  document.addEventListener("astro:page-load", () => {
    captureTrialSession();
    captureTrialSignup();
    captureTrialView();
  });
}
