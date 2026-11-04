const VIEW_KEY = "bebras_trial_view";

export type TrialView = { id: number; email: string; name: string };

export function readTrialView(): TrialView | null {
  if (typeof window === "undefined") return null;
  try {
    const value = JSON.parse(window.sessionStorage.getItem(VIEW_KEY) ?? "null");
    return Number.isInteger(value?.id) && typeof value?.email === "string"
      ? {
          id: value.id,
          email: value.email,
          name: typeof value.name === "string" ? value.name : "",
        }
      : null;
  } catch {
    return null;
  }
}

export function leaveTrialView() {
  try {
    window.sessionStorage.removeItem(VIEW_KEY);
  } catch {
    return;
  }
}

export function trialViewUrl(path: string, view: TrialView) {
  const params = new URLSearchParams({
    vm_id: String(view.id),
    vm_email: view.email,
    vm_name: view.name,
  });
  return `${path}?${params.toString()}`;
}

function captureTrialView() {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  const id = Number(params.get("vm_id"));
  const email = params.get("vm_email");
  if (!Number.isInteger(id) || id <= 0 || !email) return;
  try {
    window.sessionStorage.setItem(
      VIEW_KEY,
      JSON.stringify({ id, email, name: params.get("vm_name") ?? "" }),
    );
  } catch {
    return;
  }
  ["vm_id", "vm_email", "vm_name"].forEach((key) => params.delete(key));
  const query = params.toString();
  window.history.replaceState(
    null,
    "",
    window.location.pathname +
      (query ? `?${query}` : "") +
      window.location.hash,
  );
}

captureTrialView();
