import { useEffect, useState } from "react";

/** «2 d 3 h 05 min 04 s», sin las unidades grandes que valen cero. */
export function formatCountdown(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const two = (value: number) => String(value).padStart(2, "0");
  return [
    days > 0 && `${days} d`,
    (days > 0 || hours > 0) && `${hours} h`,
    `${two(minutes)} min`,
    `${two(seconds)} s`,
  ]
    .filter(Boolean)
    .join(" ");
}

/** La hora actual, actualizada cada segundo mientras `active`. */
export function useNow(active = true) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);

  return now;
}

export function formatDateTime(value: string) {
  return new Date(value).toLocaleString("es-BO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}
