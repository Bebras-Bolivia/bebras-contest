import { authorizationHeaders, endRejectedSession } from "@/lib/firebase-auth";
import { API_BASE_URL, apiRequest as request } from "@/lib/api-client";

export type MaestroSchool = {
  id: string;
  schoolCodUe: string | null;
  schoolName: string;
  status: string;
  hasLetter: boolean;
  createdAt: string;
};

export type Maestro = {
  id: number;
  name: string | null;
  email: string;
  status: string;
  schoolName: string | null;
  institutionType: "school" | "homeschool";
  phone: string | null;
  isHomeschool: boolean;
  hasLetter: boolean;
  hasIdFront: boolean;
  hasIdBack: boolean;
  createdAt: string;
  schools: MaestroSchool[];
};

export function listMaestros() {
  return request<Maestro[]>("/api/users/maestros");
}

export function approveMaestro(id: number) {
  return request<{ id: number; status: string }>(`/api/users/${id}/approve`, {
    method: "POST",
  });
}

export function rejectMaestro(id: number) {
  return request<{ id: number; status: string }>(`/api/users/${id}/reject`, {
    method: "POST",
  });
}

export function suspendMaestro(id: number) {
  return request<{ id: number; status: string }>(`/api/users/${id}/suspend`, {
    method: "POST",
  });
}

export function decideMaestroSchool(
  schoolId: string,
  decision: "approve" | "reject",
) {
  return request<MaestroSchool>(`/api/users/schools/${schoolId}/${decision}`, {
    method: "POST",
  });
}

export type MaestroDoc = "letter" | "idFront" | "idBack";

export function openMaestroDocument(id: number, doc: MaestroDoc) {
  return openPrivateDocument(`/api/users/${id}/documents/${doc}`);
}

export function openSchoolLetter(schoolId: string) {
  return openPrivateDocument(`/api/users/schools/${schoolId}/letter`);
}

/**
 * Los documentos exigen el token de Firebase en la cabecera, así que no se
 * pueden abrir con un enlace: se descargan con sesión y se muestran como blob.
 */
async function openPrivateDocument(path: string) {
  const tab = window.open("", "_blank");

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      headers: await authorizationHeaders(),
    });

    if (response.status === 401) {
      void endRejectedSession();
      throw new Error("Sesión expirada. Inicia sesión de nuevo.");
    }

    if (!response.ok) {
      let message = "No se pudo abrir el documento.";

      try {
        const body = (await response.json()) as { message?: string };
        message = body.message || message;
      } catch {
        // The response may not contain JSON.
      }

      throw new Error(message);
    }

    const type = response.headers.get("content-type") ?? "application/pdf";
    const blob = new Blob([await response.arrayBuffer()], { type });
    const url = URL.createObjectURL(blob);

    if (tab && !tab.closed) {
      tab.location.href = url;
    } else {
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener";
      link.click();
    }

    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) {
    tab?.close();
    throw error;
  }
}
