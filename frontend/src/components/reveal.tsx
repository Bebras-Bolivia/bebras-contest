import { useEffect, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

const revealClass =
  "grid transition-[grid-template-rows,opacity,margin] duration-300 ease-out motion-reduce:transition-none";

/**
 * Aviso que se abre y se cierra deslizándose, sin empujar el formulario de
 * golpe. Mientras se cierra conserva el último texto para que no desaparezca
 * antes de terminar la animación. El margen negativo compensa el espacio del
 * formulario cuando está cerrado.
 */
export function Reveal({
  message,
  className,
  children,
}: {
  message?: string | null;
  className?: string;
  children: (message: string) => ReactNode;
}) {
  const open = Boolean(message);
  const [shown, setShown] = useState(message ?? null);
  if (message && message !== shown) setShown(message);
  // Si no hay transición (movimiento reducido o se cerró antes de abrirse),
  // `transitionend` no llega: el texto viejo se quita igual al rato.
  useEffect(() => {
    if (open) return;
    const id = window.setTimeout(() => setShown(null), 350);
    return () => window.clearTimeout(id);
  }, [open]);
  return (
    <div
      aria-hidden={!open}
      onTransitionEnd={() => {
        if (!open) setShown(null);
      }}
      className={cn(
        revealClass,
        open
          ? "grid-rows-[1fr] opacity-100"
          : cn("grid-rows-[0fr] opacity-0", className),
      )}
    >
      <div className="min-h-0 overflow-hidden">
        {shown ? children(shown) : null}
      </div>
    </div>
  );
}

export function Expand({
  open,
  className,
  children,
}: {
  open: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      inert={!open}
      className={cn(
        revealClass,
        open
          ? "grid-rows-[1fr] opacity-100"
          : cn("grid-rows-[0fr] opacity-0", className),
      )}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

/**
 * Como `Expand`, pero el contenido solo existe mientras está abierto o
 * cerrándose: al abrir se monta cerrado y en el cuadro siguiente se despliega,
 * así la altura se anima también la primera vez.
 */
export function Unfold({
  open,
  className,
  children,
}: {
  open: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(open);
  if (open && !mounted) setMounted(true);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(open));
    return () => cancelAnimationFrame(frame);
  }, [open]);

  if (!mounted) return null;
  return (
    <div
      inert={!open}
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget && !open) setMounted(false);
      }}
      className={cn(
        revealClass,
        shown ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        className,
      )}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}
