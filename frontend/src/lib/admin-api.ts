import { apiRequest as request, publicRequest } from "@/lib/api-client";

export type AdminAccount = {
  id: number;
  email: string;
  name: string | null;
  isSelf: boolean;
};

export type SiteSettings = { infoSiteUrl: string | null };

export function listAdmins() {
  return request<AdminAccount[]>("/api/admin/admins");
}

export function addAdmin(email: string) {
  return request<AdminAccount>("/api/admin/admins", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export function getSiteSettings() {
  return publicRequest<SiteSettings>("/api/site-settings");
}

export function saveSiteSettings(settings: SiteSettings) {
  return request<SiteSettings>("/api/admin/site-settings", {
    method: "PUT",
    body: JSON.stringify(settings),
  });
}
