"use client";

import { useEffect, useRef, useState } from "react";

import { DEPARTMENTS } from "@/lib/departments";
import { cn } from "@/lib/utils";

const ROTATE_MS = 3500;
const PAUSE_AFTER_PICK_MS = 9000;

/** El castor de la portada: recorre los 9 departamentos y se puede elegir uno. */
export function DepartmentBeavers() {
  const [index, setIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const pausedUntil = useRef(0);
  const current = DEPARTMENTS[index];

  useEffect(() => {
    if (hovered) return;
    const timer = window.setInterval(() => {
      if (Date.now() < pausedUntil.current) return;
      setIndex((value) => (value + 1) % DEPARTMENTS.length);
    }, ROTATE_MS);
    return () => window.clearInterval(timer);
  }, [hovered]);

  useEffect(() => {
    const next = DEPARTMENTS[(index + 1) % DEPARTMENTS.length];
    const image = new Image();
    image.src = `/castores/${next.slug}.webp`;
  }, [index]);

  const pick = (value: number) => {
    pausedUntil.current = Date.now() + PAUSE_AFTER_PICK_MS;
    setIndex(value);
  };

  return (
    <div
      className="flex w-full flex-col items-center gap-4 md:w-80 lg:w-96"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        aria-label={`Castor de ${current.name}. Toca para ver otro departamento.`}
        onClick={() => pick((index + 1) % DEPARTMENTS.length)}
        className="group relative flex h-52 w-full items-end justify-center outline-none focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-60 lg:h-72"
      >
        <span
          aria-hidden="true"
          className="absolute bottom-1 h-5 w-2/3 rounded-[50%] bg-foreground/10 blur-[2px]"
        />
        <img
          key={current.slug}
          src={`/castores/${current.slug}.webp`}
          alt=""
          draggable={false}
          className="beaver-pop relative h-full w-auto object-contain transition-transform duration-300 group-hover:-rotate-3 group-active:scale-95"
        />
      </button>
      <p
        className="text-center text-sm text-muted-foreground"
        aria-live="polite"
      >
        Castor de{" "}
        <span
          key={current.slug}
          className="beaver-name inline-block font-heading text-lg font-semibold text-foreground"
        >
          {current.name}
        </span>
      </p>
      <div
        role="group"
        aria-label="Castores de los 9 departamentos"
        className="grid grid-cols-9 gap-1"
      >
        {DEPARTMENTS.map((department, position) => {
          const selected = position === index;
          return (
            <button
              key={department.slug}
              type="button"
              aria-label={department.name}
              aria-pressed={selected}
              title={department.name}
              onClick={() => pick(position)}
              className={cn(
                "flex size-9 items-end justify-center border-b-[3px] pb-0.5 transition-all duration-200 outline-none hover:-translate-y-1 focus-visible:ring-2 focus-visible:ring-ring/50 sm:size-10",
                selected
                  ? "-translate-y-1 border-primary"
                  : "border-transparent opacity-60 hover:opacity-100",
              )}
            >
              <img
                src={`/castores/${department.slug}-cabeza.webp`}
                alt=""
                draggable={false}
                className="max-h-full w-auto"
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
