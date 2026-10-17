import { cn } from "@/lib/utils";

const bar = "animate-pulse bg-muted";

export function Bar({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn(bar, className)} />;
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
