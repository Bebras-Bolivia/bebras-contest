import { fileURLToPath } from "node:url";
import { firebaseWebConfig } from "./firebase-config";

const root = fileURLToPath(new URL("../", import.meta.url));
const target = process.argv[2];
if (!["local", "staging", "production"].includes(target ?? "")) {
  throw new Error("Uso: bun scripts/cloudflare-build.ts local|staging|production");
}
const branch = process.env.WORKERS_CI_BRANCH;
if (branch && branch !== (target === "production" ? "master" : "staging")) {
  throw new Error(`La rama ${branch} no puede publicar el entorno ${target}.`);
}
// La configuracion Web es publica. Local comparte identidades con staging, pero
// conserva perfiles, documentos y el resto de datos en D1/R2 locales.
const firebase =
  target === "production"
    ? firebaseWebConfig.production
    : firebaseWebConfig.staging;
const firebaseEnv = Object.fromEntries(
  Object.entries(firebase).filter(([key]) => !process.env[key]),
);
const env = {
  ...process.env,
  ...firebaseEnv,
  PUBLIC_REGISTRATION_ONLY: "false",
  PUBLIC_API_BASE_URL: "",
};
for (const command of [
  ["bun", "run", "--cwd", "backend", "prisma:generate"],
  ["bun", "run", "--cwd", "frontend", "build"],
]) {
  const child = Bun.spawn(command, {
    cwd: root,
    env,
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await child.exited;
  if (code) process.exit(code);
}
