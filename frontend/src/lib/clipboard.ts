/**
 * Copia al portapapeles con plan B: la API moderna solo existe en contextos
 * seguros, así que al abrir la app por la IP de la red no está disponible y sin
 * esto el aviso de "copiado" nunca llegaba a mostrarse.
 */
export async function copyToClipboard(value: string) {
  try {
    if (window.isSecureContext && navigator.clipboard) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Cae al plan B.
  }

  try {
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "0";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(area);
    return copied;
  } catch {
    return false;
  }
}

export function groupJoinLink(code: string) {
  return `${window.location.origin}/entrar?code=${code}`;
}
