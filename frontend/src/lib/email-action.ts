export const DEFAULT_VERIFICATION_DESTINATION = "/login?verified=1";
export const EMAIL_VERIFICATION_CHANNEL = "bebras:email-verification";

export type VerifyEmailAction = {
  mode: "verifyEmail";
  oobCode: string;
  continueUrl: string | null;
  lang: string | null;
};

/** Parses only the Firebase action this application handles. */
export function parseVerifyEmailAction(url: string): VerifyEmailAction | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const mode = parsed.searchParams.get("mode");
  const oobCode = parsed.searchParams.get("oobCode")?.trim() ?? "";
  if (mode !== "verifyEmail" || !oobCode) return null;

  return {
    mode,
    oobCode,
    continueUrl: parsed.searchParams.get("continueUrl"),
    lang: parsed.searchParams.get("lang"),
  };
}

/** Removes Firebase action data while retaining unrelated query parameters. */
export function sanitizedEmailActionPath(url: string): string {
  const parsed = new URL(url);
  for (const parameter of ["mode", "oobCode", "continueUrl", "lang", "apiKey"]) {
    parsed.searchParams.delete(parameter);
  }
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

/**
 * The only continuation is the verification return route. Production may stay
 * on the current Worker; local continuations must use an explicit loopback host.
 */
export function verificationDestination(
  candidate: string | null | undefined,
  currentOrigin: string,
): string {
  if (!candidate) return DEFAULT_VERIFICATION_DESTINATION;

  try {
    const current = new URL(currentOrigin);
    const destination = new URL(candidate, current);
    const isCurrentOrigin = destination.origin === current.origin;
    const isLocalHttp =
      destination.protocol === "http:" &&
      (destination.hostname === "localhost" ||
        destination.hostname === "127.0.0.1");
    const hasExactRoute =
      destination.pathname === "/login" &&
      destination.search === "?verified=1" &&
      !destination.hash &&
      !destination.username &&
      !destination.password;

    if (!hasExactRoute || (!isCurrentOrigin && !isLocalHttp)) {
      return DEFAULT_VERIFICATION_DESTINATION;
    }
    return isCurrentOrigin
      ? DEFAULT_VERIFICATION_DESTINATION
      : destination.toString();
  } catch {
    return DEFAULT_VERIFICATION_DESTINATION;
  }
}
