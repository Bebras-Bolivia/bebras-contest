import { fileURLToPath } from "node:url";
import { firebaseWebConfig } from "./firebase-config";

const root = fileURLToPath(new URL("../", import.meta.url));
const firebase = firebaseWebConfig.staging;
const env = {
  ...process.env,
  ...firebase,
  PUBLIC_API_BASE_URL: "http://localhost:3000",
  PUBLIC_REGISTRATION_ONLY: "false",
};

console.log("Desarrollo local: Firebase Auth staging + Worker/D1/R2 locales.");
const child = Bun.spawn(
  [
    "bun",
    "x",
    "--no-install",
    "concurrently",
    "-k",
    "-n",
    "backend,frontend",
    "-c",
    "blue,magenta",
    "bun x --no-install wrangler dev --local " +
      "--var FIREBASE_PROJECT_ID:bebras-bo-staging --config wrangler.jsonc",
    "bun run --cwd frontend dev",
  ],
  { cwd: root, env, stdin: "inherit", stdout: "inherit", stderr: "inherit" },
);

process.exit(await child.exited);
