/**
 * Checks or applies the owned Firebase verification-email configuration.
 *
 *   bun scripts/firebase-email-config.ts --project staging
 *   bun scripts/firebase-email-config.ts --project staging --apply
 */
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  customizedStatus,
  desiredFirebaseEmailConfig,
  firebaseEmailConfigDrift,
  firebaseEmailUpdateMask,
  parseFirebaseEmailConfigArgs,
  type FirebaseEmailConfig,
} from "./firebase-email-config-options";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(resolve(root, "package.json"));

function printComparison(
  current: FirebaseEmailConfig,
  desired: FirebaseEmailConfig,
) {
  const drift = firebaseEmailConfigDrift(current, desired);
  const driftByField = new Map(drift.map((item) => [item.field, item]));

  console.log(
    `verifyEmailTemplate.customized: ${customizedStatus(current)} (informativo)`,
  );
  for (const field of [
    "notification.defaultLocale",
    "notification.sendEmail.callbackUri",
    "verifyEmailTemplate.subject",
    "verifyEmailTemplate.body",
    "verifyEmailTemplate.bodyFormat",
  ]) {
    const item = driftByField.get(field);
    if (!item) {
      console.log(`OK    ${field}`);
      continue;
    }

    console.log(`DRIFT ${field}`);
    console.log(`  actual: ${JSON.stringify(item.current ?? "<absent>")}`);
    console.log(`  desired: ${JSON.stringify(item.desired)}`);
  }

  return drift;
}

async function main() {
  const options = parseFirebaseEmailConfigArgs(process.argv.slice(2));
  const { target } = options;
  const desired = desiredFirebaseEmailConfig(target);

  const { requireAuth } = require("firebase-tools/lib/requireAuth");
  const {
    getGlobalDefaultAccount,
    setActiveAccount,
  } = require("firebase-tools/lib/auth");
  const { identityOrigin } = require("firebase-tools/lib/api");
  const { Client } = require("firebase-tools/lib/apiv2");

  const authOptions = {
    project: target.projectId,
    projectId: target.projectId,
  };
  setActiveAccount(authOptions, getGlobalDefaultAccount());
  await requireAuth(authOptions);

  const client = new Client({
    urlPrefix: `${identityOrigin()}/admin`,
    apiVersion: "v2",
    auth: true,
  });
  const path = `projects/${target.projectId}/config`;
  const fetchConfig = async (): Promise<FirebaseEmailConfig> =>
    (
      await client.get(path, {
        headers: { "x-goog-user-project": target.projectId },
      })
    ).body;

  console.log(
    `Firebase email config: ${target.environment} (${target.projectId})`,
  );
  const current = await fetchConfig();
  const initialDrift = printComparison(current, desired);

  if (!options.apply) {
    if (initialDrift.length) process.exitCode = 1;
    return;
  }

  if (!initialDrift.length) {
    console.log("Sin cambios: la configuración ya coincide.");
    return;
  }

  const updateErrors: string[] = [];
  for (const updateMask of firebaseEmailUpdateMask.split(",")) {
    try {
      await client.patch(path, desired, {
        queryParams: { updateMask },
        headers: { "x-goog-user-project": target.projectId },
      });
      console.log(`APPLIED ${updateMask}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      updateErrors.push(`${updateMask}: ${message}`);
      console.error(`BLOCKED ${updateMask}: ${message}`);
    }
  }
  console.log("Cambios permitidos aplicados; verificando el estado remoto...");

  const remainingDrift = printComparison(await fetchConfig(), desired);
  if (remainingDrift.length) {
    if (updateErrors.length) {
      console.error("Firebase rechazó estos campos:");
      for (const error of updateErrors) console.error(`  ${error}`);
    }
    throw new Error(
      "La configuración remota conserva diferencias después de aplicar.",
    );
  }
  console.log("Configuración verificada.");
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
