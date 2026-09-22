export type CloudflareRemoteEnvironment = "staging" | "production";
export type CloudflareBuildEnvironment = "local" | CloudflareRemoteEnvironment;
export type CloudflareRemoteOperation = "bootstrap" | "migrations" | "deploy";

export interface CloudflareRemoteOptions {
  environment: CloudflareRemoteEnvironment;
  operation: CloudflareRemoteOperation;
}

export function parseCloudflareRemoteArgs(
  args: string[],
): CloudflareRemoteOptions {
  if (args.length !== 2) {
    throw new Error(
      "Uso: bun scripts/cloudflare-remote.ts bootstrap|migrations|deploy staging|production",
    );
  }

  const [operation, environment] = args;
  if (
    operation !== "bootstrap" &&
    operation !== "migrations" &&
    operation !== "deploy"
  ) {
    throw new Error("Operación remota inválida.");
  }
  if (environment !== "staging" && environment !== "production") {
    throw new Error("Entorno remoto inválido.");
  }

  return { operation, environment };
}

export function expectedRemoteBranch(
  environment: CloudflareRemoteEnvironment,
): "staging" | "master" {
  return expectedBuildBranch(environment) as "staging" | "master";
}

export function expectedBuildBranch(
  environment: CloudflareBuildEnvironment,
): "develop" | "staging" | "master" {
  return {
    local: "develop",
    staging: "staging",
    production: "master",
  }[environment];
}

export function remoteBranch(
  workersCi: string | undefined,
  workersCiBranch: string | undefined,
  gitBranch: string,
): string {
  const checkedOutBranch = gitBranch.trim();
  if (checkedOutBranch) return checkedOutBranch;
  const ciBranch = workersCiBranch?.trim();
  return workersCi === "1" && ciBranch ? ciBranch : "";
}

export function assertCloudflareRemoteContext(
  environment: CloudflareRemoteEnvironment,
  branch: string,
  dirty: boolean,
): void {
  const expected = expectedRemoteBranch(environment);
  if (branch !== expected) {
    throw new Error(
      `La rama ${branch || "desconocida"} no puede modificar ${environment}; usa ${expected}.`,
    );
  }
  if (dirty) {
    throw new Error(
      "El worktree debe estar limpio antes de modificar un entorno remoto.",
    );
  }
}
