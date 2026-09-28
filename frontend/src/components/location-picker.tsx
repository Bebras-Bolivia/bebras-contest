"use client";

import { useState, type RefObject } from "react";

import { Expand, Reveal } from "@/components/reveal";
import { Input } from "@/components/ui/input";
import { DEPARTMENTS } from "@/lib/departments";
import { cn } from "@/lib/utils";

export type LocationValue = {
  department: string | null;
  city: string;
};

export const EMPTY_LOCATION: LocationValue = { department: null, city: "" };

export const CITY_MAX_LENGTH = 60;

const optionClass = cn(
  "bg-muted/50 text-sm transition-[background-color,color,box-shadow,transform] duration-200 ease-out outline-none",
  "hover:-translate-y-0.5 hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary/60 active:translate-y-0 active:scale-[0.97]",
  "motion-reduce:transition-none motion-reduce:hover:translate-y-0",
  "aria-pressed:bg-primary/10 aria-pressed:font-semibold aria-pressed:text-primary aria-pressed:ring-2 aria-pressed:ring-primary aria-pressed:ring-inset aria-pressed:hover:bg-primary/15",
);

export function LocationPicker({
  value,
  onChange,
  departmentError,
  cityError,
  departmentRef,
  cityRef,
}: {
  value: LocationValue;
  onChange: (next: LocationValue) => void;
  departmentError?: string;
  cityError?: string;
  departmentRef?: RefObject<HTMLButtonElement | null>;
  cityRef?: RefObject<HTMLElement | null>;
}) {
  const department = DEPARTMENTS.find((item) => item.key === value.department);
  const cities: readonly string[] = department?.cities ?? [];
  const [other, setOther] = useState(
    Boolean(value.city) && !cities.includes(value.city),
  );

  return (
    <div className="flex flex-col gap-5 pt-2">
      <div className="flex flex-col gap-2">
        <p id="location-department" className="text-sm font-medium">
          Departamento
        </p>
        <div
          role="group"
          aria-labelledby="location-department"
          className="grid grid-cols-3 gap-2"
        >
          {DEPARTMENTS.map((item, index) => {
            const selected = value.department === item.key;
            return (
              <button
                key={item.key}
                ref={index === 0 ? departmentRef : undefined}
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  if (selected) return;
                  setOther(false);
                  onChange({ department: item.key, city: "" });
                }}
                className={cn(
                  optionClass,
                  "group flex min-w-0 flex-col items-center gap-1 px-1.5 py-2 text-center text-xs sm:flex-row sm:gap-2 sm:px-2 sm:text-left sm:text-sm",
                )}
              >
                <img
                  src={`/castores/${item.slug}-cabeza.webp`}
                  alt=""
                  className={cn(
                    "size-8 shrink-0 object-contain transition-transform duration-300 ease-out group-hover:-rotate-8 motion-reduce:transition-none",
                    selected && "scale-110 -rotate-6",
                  )}
                />
                <span className="leading-tight">{item.name}</span>
              </button>
            );
          })}
        </div>
        <Reveal className="-mt-2" message={departmentError}>
          {(message) => (
            <p role="alert" className="text-sm text-destructive">
              {message}
            </p>
          )}
        </Reveal>
      </div>

      <Expand open={Boolean(department)} className="-mt-5">
        <div className="flex flex-col gap-2 pb-1">
          <p id="location-city" className="text-sm font-medium">
            Ciudad
          </p>
          <div
            key={value.department}
            role="group"
            aria-labelledby="location-city"
            className="flex flex-wrap gap-2"
          >
            {[...cities, null].map((city, index) => {
              const selected =
                city === null ? other : !other && value.city === city;
              return (
                <button
                  key={city ?? "otra"}
                  ref={
                    index === 0 && !other
                      ? (cityRef as RefObject<HTMLButtonElement | null>)
                      : undefined
                  }
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    if (city === null) {
                      setOther(true);
                      onChange({ ...value, city: "" });
                      requestAnimationFrame(() => cityRef?.current?.focus());
                    } else {
                      setOther(false);
                      onChange({ ...value, city });
                    }
                  }}
                  className={cn(
                    optionClass,
                    "px-3 py-1.5 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-300 motion-safe:fill-mode-both",
                    city === null && "text-muted-foreground",
                  )}
                  style={{ animationDelay: `${index * 40}ms` }}
                >
                  {city ?? "Otra"}
                </button>
              );
            })}
          </div>
          <Expand open={other} className="-mt-2">
            <Input
              ref={
                other
                  ? (cityRef as RefObject<HTMLInputElement | null>)
                  : undefined
              }
              aria-labelledby="location-city"
              maxLength={CITY_MAX_LENGTH}
              value={other ? value.city : ""}
              onChange={(event) =>
                onChange({ ...value, city: event.target.value })
              }
              placeholder="Escribe tu ciudad"
              autoComplete="address-level2"
              aria-invalid={Boolean(cityError)}
            />
          </Expand>
          <Reveal className="-mt-2" message={cityError}>
            {(message) => (
              <p role="alert" className="text-sm text-destructive">
                {message}
              </p>
            )}
          </Reveal>
        </div>
      </Expand>
    </div>
  );
}
