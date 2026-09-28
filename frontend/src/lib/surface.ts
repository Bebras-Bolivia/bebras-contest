/** Estilo común de las tarjetas livianas: fondo gris claro, sin borde. */
export const surface = "bg-muted/40";

/** Avisos (cuenta pendiente, código del desafío, sitio informativo): igual, en amarillo suave. */
export const notice = "bg-secondary/20";

const interactive =
  "transition-[background-color,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] outline-none hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-primary/60 active:translate-y-0 active:scale-[0.99] motion-reduce:transition-none motion-reduce:hover:translate-y-0";

/** Entrada suave al aparecer; el retraso se pone con `animation-delay`. */
export const enter =
  "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-500 motion-safe:ease-out motion-safe:fill-mode-both";

export const surfaceLink = `${surface} ${interactive} hover:bg-muted/70`;

export const noticeLink = `${notice} ${interactive} hover:bg-secondary/30`;
