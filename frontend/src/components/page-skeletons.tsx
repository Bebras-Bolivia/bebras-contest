import type React from "react";
import { cn } from "@/lib/utils";

const bar = "animate-pulse bg-muted";

export function Bar({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div aria-hidden="true" className={cn(bar, className)} style={style} />
  );
}

/** Título, barra de filtros y una lista de filas: Desafíos, Prácticas, Resultados… */
export function ListPageSkeleton({
  label = "Cargando...",
  rows = 6,
}: {
  label?: string;
  rows?: number;
}) {
  return (
    <div aria-busy className="flex w-full flex-col gap-6">
      <span className="sr-only">{label}</span>
      <div className="flex flex-col gap-2 border-b pb-5">
        <Bar className="h-8 w-56" />
        <Bar className="h-4 w-80 max-w-full opacity-70" />
      </div>
      <div className="flex gap-2">
        <Bar className="h-9 w-full max-w-xs" />
        <Bar className="h-9 w-24" />
      </div>
      <div className="flex flex-col">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="flex items-center gap-3 border-b py-3">
            <Bar className="h-5 w-5 shrink-0" />
            <Bar className="h-5 flex-1" />
            <Bar className="h-5 w-16 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Título y campos: editores y formularios largos. */
export function FormPageSkeleton({
  label = "Cargando...",
}: {
  label?: string;
}) {
  return (
    <div aria-busy className="flex w-full flex-col gap-8">
      <span className="sr-only">{label}</span>
      <div className="flex flex-col gap-2 border-b pb-5">
        <Bar className="h-4 w-32 opacity-70" />
        <Bar className="h-9 w-72 max-w-full" />
      </div>
      {Array.from({ length: 3 }, (_, section) => (
        <div key={section} className="flex flex-col gap-4">
          <Bar className="h-5 w-40" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Bar className="h-10" />
            <Bar className="h-10" />
          </div>
          <Bar className="h-10" />
        </div>
      ))}
    </div>
  );
}

/** Enunciado y opciones: una pregunta de práctica o de la prueba. */
export function QuestionSkeleton({
  label = "Cargando la pregunta...",
}: {
  label?: string;
}) {
  return (
    <div aria-busy className="flex w-full flex-col gap-5">
      <span className="sr-only">{label}</span>
      <Bar className="h-7 w-64 max-w-full" />
      <div className="flex flex-col gap-2">
        <Bar className="h-4 w-full" />
        <Bar className="h-4 w-11/12" />
        <Bar className="h-4 w-2/3" />
      </div>
      <Bar className="h-40 w-full" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: 4 }, (_, index) => (
          <Bar key={index} className="h-12 w-full" />
        ))}
      </div>
    </div>
  );
}

export function RowsSkeleton({
  rows = 3,
  label = "Cargando...",
}: {
  rows?: number;
  label?: string;
}) {
  return (
    <div aria-busy className="flex flex-col gap-2">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <Bar key={index} className="h-10 w-full" />
      ))}
    </div>
  );
}

/** Portada de un desafío: categoría, título, datos y botón de empezar. */
export function IntroSkeleton() {
  return (
    <div aria-busy className="flex w-full flex-col gap-6">
      <span className="sr-only">Cargando la categoría...</span>
      <Bar className="h-4 w-40 opacity-70" />
      <Bar className="h-12 w-96 max-w-full" />
      <div className="flex flex-col gap-2">
        <Bar className="h-4 w-full max-w-xl" />
        <Bar className="h-4 w-4/5 max-w-lg" />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <Bar key={index} className="h-20" />
        ))}
      </div>
      <Bar className="h-11 w-44" />
    </div>
  );
}

/** Mis grupos: el desafío elegido con sus cursos y, al lado, los otros desafíos. */
export function GroupsPageSkeleton() {
  return (
    <div aria-busy className="flex w-full flex-col gap-6">
      <span className="sr-only">Cargando grupos...</span>
      <div className="border-b pb-5">
        <Bar className="h-9 w-48" />
      </div>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_15rem] lg:gap-8">
        <div className="flex flex-col gap-3">
          <Bar className="h-6 w-64 max-w-full" />
          <Bar className="h-4 w-52 opacity-70" />
          <div className="flex flex-col divide-y border-b">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="flex items-center gap-4 px-3 py-4">
                <div className="flex flex-1 flex-col gap-2">
                  <Bar className="h-5 w-40" />
                  <Bar className="h-5 w-24 opacity-70" />
                </div>
                <Bar className="h-4 w-24" />
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-3 max-lg:hidden">
          <Bar className="h-5 w-32" />
          {Array.from({ length: 2 }, (_, index) => (
            <div key={index} className="flex flex-col gap-2 border-b py-4">
              <Bar className="h-5 w-40" />
              <Bar className="h-4 w-20 opacity-70" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Un grupo: animal de la categoría, nombre, pestañas y estudiantes con su código. */
export function GroupPageSkeleton() {
  return (
    <div aria-busy className="flex w-full flex-col gap-6">
      <span className="sr-only">Cargando grupo...</span>
      <div className="flex items-center gap-4 border-b pb-6">
        <Bar className="size-20 shrink-0 sm:size-24" />
        <div className="flex flex-col gap-2.5">
          <Bar className="h-8 w-56" />
          <Bar className="h-4 w-72 max-w-full opacity-70" />
        </div>
      </div>
      <div className="flex gap-6">
        <Bar className="h-6 w-28" />
        <Bar className="h-6 w-24" />
      </div>
      <div className="flex flex-col divide-y border-y">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="flex items-center gap-4 py-3">
            <div className="flex flex-1 flex-col gap-2">
              <Bar className="h-5 w-48" />
              <Bar className="h-4 w-24 opacity-70" />
            </div>
            <Bar className="h-6 w-28" />
            <Bar className="size-6" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Mis prácticas: título con su botón y cada práctica con sus datos. */
export function PracticesSkeleton() {
  return (
    <div aria-busy className="flex w-full flex-col gap-8">
      <span className="sr-only">Cargando prácticas...</span>
      <div className="flex items-end justify-between gap-4 border-b pb-5">
        <Bar className="h-9 w-56" />
        <Bar className="h-9 w-40" />
      </div>
      <div className="flex flex-col divide-y border-b">
        {Array.from({ length: 3 }, (_, index) => (
          <div
            key={index}
            className="flex flex-col gap-3 py-4 lg:flex-row lg:justify-between"
          >
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <Bar className="h-5 w-20" />
                <Bar className="h-5 w-24 opacity-70" />
              </div>
              <Bar className="h-6 w-64 max-w-full" />
              <Bar className="h-4 w-56 opacity-70" />
            </div>
            <div className="flex gap-2">
              <Bar className="h-8 w-32" />
              <Bar className="h-8 w-32" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Resultados de una práctica: encabezado, cuatro cifras y los puntajes. */
export function PracticeResultsSkeleton() {
  return (
    <div aria-busy className="flex w-full flex-col gap-8">
      <span className="sr-only">Cargando resultados...</span>
      <div className="flex items-center gap-4 border-b pb-6">
        <Bar className="size-20 shrink-0 sm:size-24" />
        <div className="flex flex-col gap-2">
          <Bar className="h-5 w-40" />
          <Bar className="h-8 w-72 max-w-full" />
          <Bar className="h-4 w-56 opacity-70" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="flex flex-col gap-2">
            <Bar className="h-4 w-24 opacity-70" />
            <Bar className="h-8 w-16" />
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <Bar className="h-6 w-28" />
          <Bar className="h-8 w-36" />
        </div>
        <div className="flex flex-col divide-y border-y">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="flex items-center gap-4 py-3">
              <Bar className="h-4 w-6" />
              <div className="flex flex-1 flex-col gap-2">
                <Bar className="h-5 w-44" />
                <Bar className="h-4 w-24 opacity-70" />
              </div>
              <Bar className="h-3.5 w-28 max-sm:hidden" />
              <Bar className="h-7 w-20" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Nueva práctica: nombre, categorías y fechas. */
export function PracticeEditorSkeleton() {
  return (
    <div aria-busy className="flex w-full flex-col gap-10">
      <span className="sr-only">Cargando...</span>
      <Bar className="h-11 w-full" />
      <div className="flex flex-col gap-4">
        <Bar className="h-5 w-28" />
        <div className="flex flex-wrap gap-1.5">
          {[28, 24, 18, 26, 30, 22].map((width, index) => (
            <Bar
              key={index}
              className="h-8"
              style={{ width: `${width * 0.25}rem` }}
            />
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-4">
        <Bar className="h-5 w-24" />
        <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
          <Bar className="h-10" />
          <Bar className="h-10" />
        </div>
      </div>
    </div>
  );
}

/** Preguntas para elegir: casilla, título, dificultad y probar. */
export function TaskPickSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-busy className="flex flex-col divide-y border-b">
      <span className="sr-only">Cargando preguntas...</span>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3 px-2 py-2.5">
          <Bar className="size-5 shrink-0" />
          <Bar className="h-4 flex-1" />
          <Bar className="h-5 w-12" />
          <Bar className="h-7 w-20" />
        </div>
      ))}
    </div>
  );
}

/** Mi cuenta: avatar, nombre y los datos de la cuenta. */
export function ProfileSkeleton() {
  return (
    <div aria-busy className="flex w-full flex-col gap-8">
      <span className="sr-only">Cargando tu cuenta...</span>
      <div className="flex items-center gap-5">
        <div className="size-16 shrink-0 animate-pulse rounded-full bg-muted" />
        <div className="flex flex-col gap-2">
          <div className="h-7 w-56 animate-pulse bg-muted" />
          <div className="h-4 w-72 max-w-full animate-pulse bg-muted/70" />
        </div>
      </div>
      <div className="h-36 animate-pulse bg-muted/60" />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="h-20 animate-pulse bg-muted/50" />
        <div className="h-20 animate-pulse bg-muted/50" />
      </div>
    </div>
  );
}
