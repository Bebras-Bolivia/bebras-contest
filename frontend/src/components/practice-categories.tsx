"use client";

import { useEffect, useState } from "react";
import { ArrowRightIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  cachedPracticeCategories,
  listPracticeCategories,
  type PracticeCategory,
} from "@/lib/practice-api";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { surface, surfaceLink } from "@/lib/surface";
import {
  practiceCategoryHref,
  practiceOrigin,
} from "@/lib/practice-navigation";

export function PracticeCategories() {
  const [instant] = useState(() => cachedPracticeCategories() !== null);
  const [categories, setCategories] = useState<PracticeCategory[] | null>(
    cachedPracticeCategories,
  );
  const [failed, setFailed] = useState(false);
  // Durante la inscripción la práctica queda cerrada: es un estado previsto, no
  // un error, y reintentar no cambiaría nada.
  const [closed, setClosed] = useState(false);
  const [requestVersion, setRequestVersion] = useState(0);
  const [origin] = useState(() =>
    typeof window === "undefined"
      ? "/practica"
      : practiceOrigin(window.location.pathname),
  );

  useEffect(() => {
    let active = true;
    listPracticeCategories()
      .then((data) => {
        if (active) {
          setCategories(data);
          setFailed(false);
        }
      })
      .catch((error: unknown) => {
        if (!active) return;
        const restricted =
          error instanceof ApiError &&
          (error.status === 401 || error.status === 403);
        setClosed(restricted);
        setFailed(!restricted);
      });
    return () => {
      active = false;
    };
  }, [requestVersion]);

  if (closed) {
    return (
      <p
        className={cn(
          surface,
          "px-4 py-6 text-center text-sm text-muted-foreground",
        )}
      >
        Los desafíos de práctica no están disponibles por ahora. Mientras tanto
        está abierta la inscripción de maestros.
      </p>
    );
  }

  if (failed) {
    return (
      <div
        className={cn(
          surface,
          "flex flex-col items-center gap-3 px-4 py-6 text-center",
        )}
      >
        <p className="text-sm text-muted-foreground">
          No pudimos cargar los desafíos de práctica.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setCategories(null);
            setFailed(false);
            setClosed(false);
            setRequestVersion((version) => version + 1);
          }}
        >
          Reintentar
        </Button>
      </div>
    );
  }

  if (categories === null) {
    return (
      <div aria-busy className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <span className="sr-only">Cargando categorías...</span>
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className={cn(surface, "h-24 animate-pulse")} />
        ))}
      </div>
    );
  }

  if (categories.length === 0) {
    return (
      <p
        className={cn(
          surface,
          "px-4 py-6 text-center text-sm text-muted-foreground",
        )}
      >
        Aún no hay desafíos de práctica disponibles. Vuelve pronto.
      </p>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {categories.map((category, index) => (
        <a
          key={category.name}
          href={practiceCategoryHref(category.name, origin)}
          style={instant ? undefined : { animationDelay: `${index * 60}ms` }}
          className={cn(
            surfaceLink,
            "group flex items-center gap-4 p-3 pr-4",
            !instant &&
              "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-300 motion-safe:fill-mode-both",
          )}
        >
          <span className="flex size-16 shrink-0 flex-col items-center justify-center bg-background transition-colors duration-200 group-hover:text-primary">
            <span className="text-lg leading-none font-bold tabular-nums">
              {category.age.replace(/\s*años?$/i, "").replace("-", "–")}
            </span>
            <span className="mt-1 text-[0.7rem] text-muted-foreground">
              años
            </span>
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-lg font-semibold">{category.name}</span>
            <span className="text-sm text-muted-foreground">
              {category.count} {category.count === 1 ? "desafío" : "desafíos"}
            </span>
          </span>
          <ArrowRightIcon className="size-5 shrink-0 text-muted-foreground transition-[color,transform] duration-200 group-hover:translate-x-1 group-hover:text-primary motion-reduce:transition-none" />
        </a>
      ))}
    </div>
  );
}
