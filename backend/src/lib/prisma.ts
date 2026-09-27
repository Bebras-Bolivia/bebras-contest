import { AsyncLocalStorage } from "node:async_hooks";
import { env } from "cloudflare:workers";
import { PrismaD1 } from "@prisma/adapter-d1";
import { PrismaClient } from "../generated/prisma/client";

function createClient() {
  return new PrismaClient({
    adapter: new PrismaD1(env.DB),
    log: ["warn", "error"],
  });
}

// Un cliente por petición: Workers corta una petición que espera I/O iniciado
// por otra, y un cliente compartido encola las consultas de peticiones
// simultáneas (p. ej. /api/tasks y /api/contests/:id a la vez daban 500).
const requestClient = new AsyncLocalStorage<PrismaClient>();
let sharedClient: PrismaClient | null = null;

export function withRequestPrisma<T>(run: () => T) {
  return requestClient.run(createClient(), run);
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client =
      requestClient.getStore() ?? (sharedClient ??= createClient());
    const value = Reflect.get(client, property, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
