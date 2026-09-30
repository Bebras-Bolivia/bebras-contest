import { AsyncLocalStorage } from "node:async_hooks";
import { env } from "cloudflare:workers";
import { PrismaD1 } from "@prisma/adapter-d1";
import { PrismaClient } from "../generated/prisma/client";

type RequestContext = {
  client: PrismaClient;
  database: D1Database;
  queries: number;
};

/**
 * Cuenta cada sentencia que llega a D1 (las de un lote cuentan una por una,
 * como las cuenta Cloudflare contra su límite por invocación).
 */
function countingDatabase(context: { queries: number }): D1Database {
  const countStatement = (statement: D1PreparedStatement): D1PreparedStatement =>
    new Proxy(statement, {
      get(target, property) {
        const value = Reflect.get(target, property, target);
        if (typeof value !== "function") return value;
        if (property === "bind") {
          return (...args: unknown[]) =>
            countStatement(value.apply(target, args) as D1PreparedStatement);
        }
        if (["first", "all", "run", "raw"].includes(String(property))) {
          return (...args: unknown[]) => {
            context.queries += 1;
            return value.apply(target, args);
          };
        }
        return value.bind(target);
      },
    });

  return new Proxy(env.DB, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      if (property === "prepare") {
        return (query: string) => countStatement(target.prepare(query));
      }
      if (property === "batch") {
        return (statements: D1PreparedStatement[]) => {
          context.queries += statements.length;
          return target.batch(statements);
        };
      }
      if (property === "exec") {
        return (query: string) => {
          context.queries += 1;
          return target.exec(query);
        };
      }
      return value.bind(target);
    },
  });
}

function createContext(counting: boolean): RequestContext {
  const context = { queries: 0 } as RequestContext;
  context.database = counting ? countingDatabase(context) : env.DB;
  context.client = new PrismaClient({
    adapter: new PrismaD1(context.database),
    log: ["warn", "error"],
  });
  return context;
}

// Un cliente por petición: Workers corta una petición que espera I/O iniciado
// por otra, y un cliente compartido encola las consultas de peticiones
// simultáneas (p. ej. /api/tasks y /api/contests/:id a la vez daban 500).
const requestContext = new AsyncLocalStorage<RequestContext>();
let sharedContext: RequestContext | null = null;

export function withRequestPrisma<T>(run: () => T, counting = false) {
  return requestContext.run(createContext(counting), run);
}

function currentContext() {
  return requestContext.getStore() ?? (sharedContext ??= createContext(false));
}

/** La base de la petición en curso, para las consultas SQL escritas a mano. */
export function db() {
  return currentContext().database;
}

/** Sentencias enviadas a D1 en la petición en curso (solo si se cuentan). */
export function queryCount() {
  return currentContext().queries;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = currentContext().client;
    const value = Reflect.get(client, property, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
