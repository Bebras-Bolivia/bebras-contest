export type FirebaseEmailEnvironment = "staging" | "production";

export interface FirebaseEmailTarget {
  environment: FirebaseEmailEnvironment;
  projectId: string;
  callbackUri: string;
}

export interface FirebaseEmailConfigOptions {
  target: FirebaseEmailTarget;
  apply: boolean;
}

export interface FirebaseEmailConfig {
  notification?: {
    defaultLocale?: string;
    sendEmail?: {
      callbackUri?: string;
      verifyEmailTemplate?: {
        subject?: string;
        body?: string;
        bodyFormat?: string;
        customized?: boolean;
        replyTo?: string;
      };
    };
  };
}

export interface FirebaseEmailConfigDrift {
  field: string;
  current: string | undefined;
  desired: string;
}

const targets: Record<FirebaseEmailEnvironment, FirebaseEmailTarget> = {
  staging: {
    environment: "staging",
    projectId: "bebras-bo-staging",
    callbackUri:
      "https://bebras-contest-staging.bebrasbolivia.workers.dev/auth/action",
  },
  production: {
    environment: "production",
    projectId: "bebras-bo",
    callbackUri: "https://bebras-contest.bebrasbolivia.workers.dev/auth/action",
  },
};

export const firebaseEmailUpdateMask = "notification.defaultLocale";

export function firebaseEmailTarget(
  environment: FirebaseEmailEnvironment,
): FirebaseEmailTarget {
  return targets[environment];
}

export function parseFirebaseEmailConfigArgs(
  args: string[],
): FirebaseEmailConfigOptions {
  let environment: FirebaseEmailEnvironment | undefined;
  let operation: "apply" | "check" | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === "--project") {
      if (environment) throw new Error("--project no puede repetirse.");

      const value = args[index + 1];
      if (value !== "staging" && value !== "production") {
        throw new Error("--project requiere staging o production.");
      }
      environment = value;
      index += 1;
      continue;
    }

    if (argument === "--apply" || argument === "--check") {
      const nextOperation = argument.slice(2) as "apply" | "check";
      if (operation) {
        throw new Error("Usa como máximo una vez --check o --apply, no ambos.");
      }
      operation = nextOperation;
      continue;
    }

    throw new Error(`Argumento desconocido: ${argument}`);
  }

  if (!environment) {
    throw new Error("Debes indicar --project staging o --project production.");
  }

  return {
    target: firebaseEmailTarget(environment),
    apply: operation === "apply",
  };
}

export function desiredFirebaseEmailConfig(
  target: FirebaseEmailTarget,
): FirebaseEmailConfig {
  return {
    notification: {
      defaultLocale: "es",
    },
  };
}

export function firebaseEmailConfigDrift(
  current: FirebaseEmailConfig,
  desired: FirebaseEmailConfig,
): FirebaseEmailConfigDrift[] {
  const fields = [
    [
      "notification.defaultLocale",
      current.notification?.defaultLocale,
      desired.notification?.defaultLocale,
    ],
  ] as const;

  return fields.flatMap(([field, currentValue, desiredValue]) =>
    currentValue === desiredValue
      ? []
      : [{ field, current: currentValue, desired: desiredValue ?? "" }],
  );
}

export function customizedStatus(config: FirebaseEmailConfig) {
  const customized =
    config.notification?.sendEmail?.verifyEmailTemplate?.customized;
  return customized === undefined ? "absent" : String(customized);
}
