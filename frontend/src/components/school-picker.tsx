"use client";

import { useEffect, useRef, useState, type Ref } from "react";
import {
  CheckCircle2Icon,
  HouseIcon,
  LoaderCircleIcon,
  SearchIcon,
  SquarePenIcon,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import { REGISTRATION_LIMITS } from "@/lib/registration-limits";
import { searchSchools, type SchoolResult } from "@/lib/schools-api";
import { cn } from "@/lib/utils";

export type SchoolValue = {
  codUe: string | null;
  name: string;
  institutionType: "school" | "homeschool";
};

const transitionClass =
  "flex flex-col gap-2 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-2 motion-safe:duration-200";

export function SchoolPicker({
  value,
  onChange,
  inputRef,
  invalid,
  describedBy,
  allowHomeschool = true,
  onManualChange,
}: {
  value: SchoolValue;
  onChange: (next: SchoolValue) => void;
  inputRef?: Ref<HTMLInputElement>;
  invalid?: boolean;
  describedBy?: string;
  allowHomeschool?: boolean;
  onManualChange?: (manual: boolean) => void;
}) {
  const [manual, setManualState] = useState(
    value.institutionType === "school" && !value.codUe && Boolean(value.name),
  );
  const setManual = (next: boolean) => {
    setManualState(next);
    onManualChange?.(next);
  };
  const [query, setQuery] = useState(value.codUe ? value.name : "");
  const [results, setResults] = useState<SchoolResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const [requestVersion, setRequestVersion] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (manual || value.codUe) {
      return;
    }

    if (query.trim().length < 2) {
      return;
    }

    if (timer.current) {
      clearTimeout(timer.current);
    }

    timer.current = setTimeout(() => {
      setLoading(true);
      setFailed(false);
      void searchSchools(query)
        .then((found) => {
          setResults(found);
          setOpen(true);
        })
        .catch(() => {
          setResults([]);
          setFailed(true);
          setOpen(true);
        })
        .finally(() => setLoading(false));
    }, 300);

    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    };
  }, [query, manual, value.codUe, requestVersion]);

  if (manual) {
    return (
      <div key="manual" className={transitionClass}>
        <Input
          ref={inputRef}
          id="school-search"
          maxLength={REGISTRATION_LIMITS.schoolName}
          value={value.name}
          onChange={(event) =>
            onChange({
              codUe: null,
              name: event.target.value,
              institutionType: "school",
            })
          }
          placeholder="Nombre de tu unidad educativa"
          aria-invalid={invalid}
          aria-describedby={describedBy}
        />
        <button
          type="button"
          onClick={() => {
            setManual(false);
            onChange({ codUe: null, name: "", institutionType: "school" });
            setQuery("");
          }}
          className="self-start text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Buscar mi colegio en la lista
        </button>
      </div>
    );
  }

  if (value.institutionType === "homeschool") {
    return (
      <div key="homeschool" className={transitionClass}>
        <div className="flex items-center gap-2 rounded-md border bg-secondary/30 px-3 py-2 text-sm">
          <CheckCircle2Icon className="size-4 shrink-0 text-primary" />
          <span className="font-medium">Educación en casa</span>
        </div>
        <button
          type="button"
          onClick={() => {
            onChange({ codUe: null, name: "", institutionType: "school" });
            setQuery("");
            setResults([]);
          }}
          className="self-start text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Buscar un colegio
        </button>
      </div>
    );
  }

  if (value.codUe) {
    return (
      <div key="selected" className={transitionClass}>
        <div className="flex items-center gap-2 rounded-md border bg-secondary/30 px-3 py-2 text-sm">
          <CheckCircle2Icon className="size-4 shrink-0 text-primary" />
          <span className="font-medium">{value.name}</span>
        </div>
        <button
          type="button"
          onClick={() => {
            onChange({ codUe: null, name: "", institutionType: "school" });
            setQuery("");
            setResults([]);
          }}
          className="self-start text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Cambiar colegio
        </button>
      </div>
    );
  }

  return (
    <div key="search" className={transitionClass}>
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute inset-y-0 left-3 my-auto size-4 text-muted-foreground" />
        <Input
          ref={inputRef}
          id="school-search"
          className="pl-9"
          maxLength={REGISTRATION_LIMITS.schoolName}
          value={query}
          onChange={(event) => {
            const nextQuery = event.target.value;
            setQuery(nextQuery);
            setFailed(false);
            if (nextQuery.trim().length < 2) {
              setResults([]);
              setLoading(false);
            } else {
              setLoading(true);
            }
          }}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="Escribe el nombre de tu colegio"
          autoComplete="off"
          aria-invalid={invalid}
          aria-describedby={describedBy}
        />
        {loading && (
          <LoaderCircleIcon className="absolute inset-y-0 right-3 my-auto size-4 animate-spin text-muted-foreground" />
        )}
      </div>

      {open && query.trim().length >= 2 && (
        <div className="flex flex-col overflow-hidden rounded-md border bg-background motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 motion-safe:duration-200">
          {failed && !loading ? (
            <div className="flex flex-col items-start gap-2 px-3 py-3">
              <p className="text-sm text-muted-foreground">
                No se pudo buscar colegios. Intenta nuevamente.
              </p>
              <button
                type="button"
                className="text-sm font-medium underline underline-offset-2"
                onClick={() => {
                  setFailed(false);
                  setLoading(true);
                  setRequestVersion((version) => version + 1);
                }}
              >
                Reintentar
              </button>
            </div>
          ) : results.length === 0 && !loading ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">
              No se encontraron colegios con ese nombre.
            </p>
          ) : (
            results.map((school) => (
              <button
                key={school.codUe}
                type="button"
                onClick={() => {
                  onChange({
                    codUe: school.codUe,
                    name: school.name,
                    institutionType: "school",
                  });
                  setOpen(false);
                }}
                className={cn(
                  "flex flex-col gap-0.5 border-b px-3 py-2 text-left transition-colors duration-150 last:border-b-0 hover:bg-muted",
                )}
              >
                <span className="text-sm font-medium">{school.name}</span>
                <span className="text-xs text-muted-foreground">
                  {[school.sec, school.dep].filter(Boolean).join(" · ")}
                </span>
              </button>
            ))
          )}
        </div>
      )}

      <div className="flex flex-col gap-2 pt-1">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <button
            type="button"
            onClick={() => {
              setManual(true);
              onChange({ codUe: null, name: "", institutionType: "school" });
            }}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground underline underline-offset-4 transition hover:text-foreground"
          >
            <SquarePenIcon className="size-4" />
            Mi colegio no está en la lista
          </button>
          {allowHomeschool && (
            <button
              type="button"
              onClick={() => {
                setManual(false);
                onChange({
                  codUe: null,
                  name: "Educación en casa",
                  institutionType: "homeschool",
                });
              }}
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground underline underline-offset-4 transition hover:text-foreground"
            >
              <HouseIcon className="size-4" />
              Enseño en casa
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
