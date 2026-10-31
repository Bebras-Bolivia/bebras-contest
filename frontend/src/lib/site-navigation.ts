import { REGISTRATION_ONLY } from "./registration-only";
import {
  canAccessSiteNavForMode,
  type SiteNavRole,
} from "./site-navigation-access";

export type { SiteNavRole } from "./site-navigation-access";

export const SITE_NAV_ITEMS = [
  { href: "/practica", label: "Práctica", role: "public" },
  { href: "/tareas", label: "Tareas", role: "admin" },
  { href: "/desafios", label: "Desafíos", role: "admin" },
  { href: "/grupos", label: "Grupos", role: "staff" },
  { href: "/mis-practicas", label: "Mis prácticas", role: "approved-maestro" },
  { href: "/maestros", label: "Maestros", role: "admin" },
] as const satisfies ReadonlyArray<{
  href: string;
  label: string;
  role: SiteNavRole;
}>;

export function canAccessSiteNav(
  itemRole: SiteNavRole,
  userRole?: string,
  userStatus?: string,
  registrationOnly = REGISTRATION_ONLY,
) {
  return canAccessSiteNavForMode(
    itemRole,
    userRole,
    userStatus,
    registrationOnly,
  );
}

/**
 * Devuelve a dónde volver tras editar algo desde otra pantalla. Solo acepta
 * rutas internas: un valor externo aquí sería un redirect abierto.
 */
export function safeReturnTo(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return null;
  }
  return value;
}
