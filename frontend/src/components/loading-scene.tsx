"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

const HINTS = [
  "Preparando las preguntas…",
  "Acomodando las imágenes…",
  "Revisando que todo esté listo…",
  "Ya casi…",
];

export function LoadingScene({
  label = "Cargando el desafío",
  compact = false,
}: {
  label?: string;
  compact?: boolean;
}) {
  const [hint, setHint] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(
      () => setHint((current) => Math.min(current + 1, HINTS.length - 1)),
      2600,
    );
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy
      className={cn(
        "mx-auto flex w-full max-w-sm flex-col items-center gap-5 text-center",
        compact ? "py-10" : "py-[12vh]",
      )}
    >
      <div className="loading-scene-beaver relative">
        <span aria-hidden="true" className="loading-scene-shadow" />
        <img
          src="/castores/laptop.webp"
          alt=""
          draggable={false}
          className="relative h-36 w-auto select-none"
        />
      </div>
      <div className="flex flex-col items-center gap-1">
        <p className="text-lg font-semibold">
          {label}
          <span aria-hidden="true" className="loading-scene-dots">
            <span>.</span>
            <span>.</span>
            <span>.</span>
          </span>
        </p>
        <p
          key={hint}
          className="beaver-name text-sm text-muted-foreground"
        >
          {HINTS[hint]}
        </p>
      </div>
      <div
        aria-hidden="true"
        className="loading-scene-bar h-1.5 w-56 max-w-full overflow-hidden bg-muted"
      >
        <span className="loading-scene-bar-fill block h-full w-1/3 bg-primary" />
      </div>
    </div>
  );
}
