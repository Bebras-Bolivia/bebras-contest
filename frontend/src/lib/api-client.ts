import { authorizationHeaders, endRejectedSession } from "@/lib/firebase-auth";

export const API_BASE_URL =
  import.meta.env.PUBLIC_API_BASE_URL?.replace(/\/$/, "") ??
  "http://localhost:3000";

export type ApiRequestOptions = RequestInit & {
  /**
   * `true` exige sesion y un 401 la cierra. `"optional"` manda el token si lo
   * hay pero no cierra nada: es para lo que normalmente es publico y solo a
   * veces queda restringido, como practicar durante la fase de inscripcion.
   */
  auth?: boolean | "optional";
  fallbackMessage?: string;
};

type ApiErrorBody = {
  message?: string;
  code?: string;
  field?: string;
  fields?: string[];
  details?: unknown;
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly field?: string,
    readonly fields?: string[],
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function readError(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as ApiErrorBody;
    return {
      message: body.message || fallback,
      code: body.code,
      field: body.field,
      fields: body.fields,
      details: body.details,
    };
  } catch {
    return { message: fallback };
  }
}

export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const { auth = true, fallbackMessage, headers, ...init } = options;
  // El SDK renueva el ID Token por su cuenta; pedirselo a el evita mandar una
  // copia vencida de localStorage.
  // En lo que es publico, una restauracion de sesion lenta (celular, red
  // inestable) no debe dejar la peticion colgada: se sigue sin cabecera.
  const requestHeaders = new Headers(
    auth === false
      ? undefined
      : auth === "optional"
        ? await Promise.race([
            authorizationHeaders().catch(() => ({})),
            new Promise<Record<string, string>>((resolve) =>
              setTimeout(() => resolve({}), 4000),
            ),
          ])
        : await authorizationHeaders(),
  );

  new Headers(headers).forEach((value, key) => {
    requestHeaders.set(key, value);
  });

  if (typeof init.body === "string" && !requestHeaders.has("Content-Type")) {
    requestHeaders.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: requestHeaders,
    ...init,
  });

  if (auth === true && response.status === 401) {
    void endRejectedSession();
    throw new ApiError(
      "Sesión expirada. Inicia sesión de nuevo.",
      response.status,
      "UNAUTHORIZED",
    );
  }

  if (!response.ok) {
    const error = await readError(
      response,
      fallbackMessage ?? `Request failed with status ${response.status}`,
    );
    throw new ApiError(
      error.message,
      response.status,
      error.code,
      error.field,
      error.fields,
      error.details,
    );
  }

  if (response.status === 204) {
    return null as T;
  }

  return (await response.json()) as T;
}

export function publicRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
) {
  return apiRequest<T>(path, { ...options, auth: false });
}

/** Publico, pero aprovecha la sesion si existe. Ver `auth: "optional"`. */
export function optionalAuthRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
) {
  return apiRequest<T>(path, { ...options, auth: "optional" });
}
