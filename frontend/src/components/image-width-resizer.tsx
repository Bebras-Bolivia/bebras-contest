"use client";

import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { cn } from "@/lib/utils";

type ResizeState = {
  pointerId: number;
  side: "left" | "right";
  startX: number;
  startWidthPx: number;
  containerWidth: number;
  widthPercent: number;
};

/**
 * Imagen con dos tiradores para achicarla o agrandarla. La usan los bloques de
 * contenido y las opciones de respuesta, con el mismo gesto que el fondo del
 * arrastre: mientras se tira solo cambia el ancho de esta imagen en el DOM, y
 * se guarda una vez al soltar (guardar en cada movimiento redibujaba todo el
 * formulario y se sentía pesado).
 */
export function ImageWidthResizer({
  src,
  alt,
  widthPercent,
  minPercent = 20,
  className,
  onChange,
}: {
  src: string;
  alt: string;
  widthPercent: number;
  minPercent?: number;
  className?: string;
  onChange: (widthPercent: number) => void;
}) {
  const areaRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const resizeRef = useRef<ResizeState | null>(null);
  const [resizing, setResizing] = useState(false);

  const startResize = (
    event: ReactPointerEvent<HTMLButtonElement>,
    side: "left" | "right",
  ) => {
    const area = areaRef.current;

    if (!event.isPrimary || event.button !== 0 || !area) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const containerWidth = area.getBoundingClientRect().width;
    resizeRef.current = {
      pointerId: event.pointerId,
      side,
      startX: event.clientX,
      startWidthPx: (containerWidth * widthPercent) / 100,
      containerWidth,
      widthPercent,
    };
    setResizing(true);
  };

  const handleResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const state = resizeRef.current;

    if (!state || state.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    const deltaX = event.clientX - state.startX;
    const nextWidthPx =
      state.startWidthPx + (state.side === "right" ? deltaX * 2 : -deltaX * 2);
    state.widthPercent = Math.round(
      Math.max(
        minPercent,
        Math.min(100, (nextWidthPx / state.containerWidth) * 100),
      ),
    );
    if (frameRef.current) {
      frameRef.current.style.width = `${state.widthPercent}%`;
    }
  };

  const finishResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const state = resizeRef.current;

    if (state?.pointerId !== event.pointerId) {
      return;
    }

    resizeRef.current = null;
    setResizing(false);

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (event.type === "pointerup" && state.widthPercent !== widthPercent) {
      onChange(state.widthPercent);
    } else if (frameRef.current) {
      frameRef.current.style.width = `${widthPercent}%`;
    }
  };

  const handle = (side: "left" | "right") => (
    <button
      aria-label={`Reducir o ampliar imagen desde la ${
        side === "left" ? "izquierda" : "derecha"
      }`}
      className={cn(
        "group/handle absolute inset-y-0 z-10 flex w-5 cursor-ew-resize touch-none items-center justify-center outline-none transition-opacity",
        side === "left" ? "left-0 -translate-x-1/2" : "right-0 translate-x-1/2",
        !resizing &&
          "opacity-0 group-hover/image:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100",
      )}
      type="button"
      onPointerCancel={finishResize}
      onPointerDown={(event) => startResize(event, side)}
      onPointerMove={handleResize}
      onPointerUp={finishResize}
      onKeyDown={(event) => {
        const step = { ArrowLeft: -5, ArrowRight: 5 }[event.key];
        if (!step) return;
        event.preventDefault();
        onChange(
          Math.max(
            minPercent,
            Math.min(100, widthPercent + (side === "right" ? step : -step)),
          ),
        );
      }}
    >
      <span
        className={cn(
          "block h-10 max-h-[80%] w-1 rounded-full bg-foreground/50 shadow-[0_0_0_2px_var(--background)] transition-colors group-hover/handle:bg-primary group-focus-visible/handle:bg-primary",
          resizing && "bg-primary",
        )}
      />
    </button>
  );

  return (
    <div
      className={cn("group/image flex justify-center", className)}
      ref={areaRef}
    >
      <div
        className="relative"
        ref={frameRef}
        style={{ width: `${widthPercent}%`, maxWidth: "100%" }}
      >
        <img
          alt={alt}
          className="block h-auto w-full"
          draggable={false}
          src={src}
        />
        {handle("left")}
        {handle("right")}
      </div>
    </div>
  );
}
