/**
 * Verifica o ajusta los triggers que despliegan los dos Workers desde GitHub.
 *
 * Requiere que la cuenta de GitHub ya este autorizada en el Dashboard: esa
 * autorizacion es un OAuth que no tiene API y sin ella la creacion de la
 * conexion responde 8000008 ("This project is disconnected from your Git
 * account"). Todo lo demas si se hace por API.
 *
 *   $env:CLOUDFLARE_API_TOKEN = '<token con Workers Builds Configuration: Edit>'
 *   bun scripts/cloudflare-builds-setup.ts --check
 *   bun scripts/cloudflare-builds-setup.ts
 *
 * El token debe ser de usuario (los de cuenta no sirven) y necesita ademas
 * Workers Scripts: Read para resolver el tag de cada Worker. El script actualiza
 * el trigger existente y falla ante duplicados; nunca crea un segundo trigger.
 */
const ACCOUNT = "a9ca7f3bfd5ff492721f722856ac79b6";
const API = "https://api.cloudflare.com/client/v4";

const REPO = {
  provider_type: "github",
  provider_account_id: "295968330",
  provider_account_name: "Bebras-Bolivia",
  repo_id: "1195777825",
  repo_name: "bebras-contest",
};

/** Mismos comandos que el despliegue manual; ver docs/workers-builds.md. */
const TRIGGERS = [
  {
    worker: "bebras-contest",
    trigger_name: "production",
    branch: "master",
    build_command: "bun run setup && bun run db:migrations:apply:production && bun run db:migrations:check:production && bun run build:production",
    deploy_command: "bunx wrangler deploy --env production",
  },
];

type BuildTrigger = {
  trigger_uuid: string;
  trigger_name?: string;
  build_command?: string;
  deploy_command?: string;
  root_directory?: string;
  branch_includes?: string[];
  branch_excludes?: string[];
  path_includes?: string[];
  path_excludes?: string[];
  deleted_on?: string | null;
  repo_connection?: { repo_id?: string; repo_name?: string };
};

const check = process.argv.includes("--check");
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!token) {
  throw new Error(
    "Falta CLOUDFLARE_API_TOKEN. No lo guardes en el repositorio: pasalo por entorno.",
  );
}

async function cf(path: string, init: RequestInit = {}) {
  const response = await fetch(`${API}/accounts/${ACCOUNT}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const body = (await response.json()) as {
    success: boolean;
    result: any;
    errors: { code: number; message: string }[];
  };
  if (!body.success) {
    const detalle = body.errors?.map((e) => `${e.code}: ${e.message}`).join("; ");
    if (body.errors?.some((e) => e.code === 8000008)) {
      throw new Error(
        `${detalle}\n\n` +
          "La cuenta de GitHub no esta autorizada para esta cuenta de Cloudflare.\n" +
          "Autorizala una vez en el Dashboard (Workers & Pages > bebras-contest >\n" +
          "Settings > Builds > Connect) y vuelve a ejecutar este script.",
      );
    }
    throw new Error(`${path}: ${detalle}`);
  }
  return body.result;
}

const scripts: { id: string; tag: string }[] = await cf("workers/scripts");
const tags = new Map(scripts.map((s) => [s.id, s.tag]));
for (const t of TRIGGERS) {
  if (!tags.has(t.worker)) throw new Error(`No existe el Worker ${t.worker}.`);
}

console.log("Workers:");
for (const t of TRIGGERS) console.log(`  ${t.worker}  tag=${tags.get(t.worker)}`);

let connectionUuid: string | undefined;
let buildTokenUuid: string | undefined;
let invalid = false;

async function creationResources() {
  if (!connectionUuid) {
    const connection = await cf("builds/repos/connections", {
      method: "PUT",
      body: JSON.stringify(REPO),
    });
    connectionUuid = connection.repo_connection_uuid;
  }
  if (!buildTokenUuid) {
    const tokens: { build_token_uuid: string }[] = await cf("builds/tokens");
    if (!tokens.length) {
      throw new Error(
        "No hay build tokens. Conecta primero el repositorio desde el Dashboard.",
      );
    }
    buildTokenUuid = tokens[0].build_token_uuid;
  }
  return { connectionUuid, buildTokenUuid };
}

for (const t of TRIGGERS) {
  const tag = tags.get(t.worker)!;
  const triggers = (await cf(`builds/workers/${tag}/triggers`)) as BuildTrigger[];
  const active = triggers.filter((trigger) => !trigger.deleted_on);
  if (active.length > 1) {
    throw new Error(
      `${t.worker} tiene ${active.length} triggers activos. Elimina los duplicados ` +
        "desde el Dashboard antes de continuar.",
    );
  }

  const desired = {
    trigger_name: t.trigger_name,
    build_command: t.build_command,
    deploy_command: t.deploy_command,
    root_directory: "/",
    branch_includes: [t.branch],
    branch_excludes: [],
    path_includes: ["*"],
    path_excludes: [],
  };
  const current = active[0];
  if (!current) {
    if (check) {
      console.error(`FALTA ${t.worker}: no tiene trigger activo.`);
      invalid = true;
      continue;
    }
    const resources = await creationResources();
    const created = await cf("builds/triggers", {
      method: "POST",
      body: JSON.stringify({
        external_script_id: tag,
        repo_connection_uuid: resources.connectionUuid,
        build_token_uuid: resources.buildTokenUuid,
        ...desired,
      }),
    });
    console.log(`CREADO ${t.worker} <- ${t.branch}: ${created.trigger_uuid}`);
    continue;
  }

  const differences = Object.entries(desired).filter(([key, value]) =>
    JSON.stringify(current[key as keyof BuildTrigger]) !== JSON.stringify(value),
  );
  if (current.repo_connection?.repo_id !== REPO.repo_id) {
    throw new Error(
      `${t.worker} esta conectado a otro repositorio. Reconectalo desde el Dashboard.`,
    );
  }
  if (!differences.length) {
    console.log(`OK ${t.worker} <- ${t.branch}: ${current.trigger_uuid}`);
    continue;
  }
  if (check) {
    console.error(
      `DESAJUSTADO ${t.worker}: ${differences.map(([field]) => field).join(", ")}`,
    );
    invalid = true;
    continue;
  }
  await cf(`builds/triggers/${current.trigger_uuid}`, {
    method: "PATCH",
    body: JSON.stringify(desired),
  });
  console.log(`ACTUALIZADO ${t.worker} <- ${t.branch}: ${current.trigger_uuid}`);
}

if (invalid) process.exit(1);
console.log(check ? "\nConfiguracion correcta; no se modifico nada." : "\nConfiguracion ajustada sin crear duplicados.");
