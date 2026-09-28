import { useState, type ReactNode } from "react";

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
