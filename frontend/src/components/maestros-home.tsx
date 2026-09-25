"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckIcon,
  FileTextIcon,
  LoaderCircleIcon,
  PauseIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import {
  approveMaestro,
  decideMaestroSchool,
  listMaestros,
  openMaestroDocument,
  openSchoolLetter,
  rejectMaestro,
  suspendMaestro,
  type Maestro,
  type MaestroDoc,
} from "@/lib/users-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<string, string> = {
  pending: "Pendiente",
  approved: "Aprobado",
  suspended: "Suspendido",
  rejected: "Rechazado",
};

const FILTERS = [
  { value: "pending", label: "Pendientes" },
  { value: "approved", label: "Aprobados" },
  { value: "suspended", label: "Suspendidos" },
  { value: "rejected", label: "Rechazados" },
  { value: "all", label: "Todos" },
] as const;

const SORTS = [
  { value: "recent", label: "Más recientes" },
  { value: "oldest", label: "Más antiguos" },
  { value: "name", label: "Nombre (A-Z)" },
] as const;

type FilterValue = (typeof FILTERS)[number]["value"];
type SortValue = (typeof SORTS)[number]["value"];

const VIEW_KEY = "bebras_maestros_vista";

/** Debe coincidir con la duracion de la transicion de salida de cada fila. */
const EXIT_MS = 300;

type ConfirmAction = "reject" | "suspend";

type Confirmation = {
  action: ConfirmAction;
  maestro: Maestro;
};

const CONFIRMATION_COPY: Record<
  ConfirmAction,
  { title: string; description: string; confirm: string }
> = {
  reject: {
    title: "¿Rechazar a este maestro?",
    description:
      "No podrá crear grupos ni inscribir estudiantes, y pasará a la lista de rechazados. Puedes aprobarlo más adelante.",
    confirm: "Rechazar",
  },
  suspend: {
    title: "¿Suspender a este maestro?",
    description:
      "Pierde el acceso a sus grupos y estudiantes mientras esté suspendido. Puedes reactivarlo cuando quieras.",
    confirm: "Suspender",
  },
};

function readView() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return JSON.parse(window.localStorage.getItem(VIEW_KEY) ?? "null") as {
      filter?: FilterValue;
      sort?: SortValue;
    } | null;
  } catch {
    return null;
  }
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

export function MaestrosHome() {
  const [maestros, setMaestros] = useState<Maestro[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [confirming, setConfirming] = useState<Confirmation | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterValue>(
    () => readView()?.filter ?? "pending",
  );
  const [sort, setSort] = useState<SortValue>(
    () => readView()?.sort ?? "recent",
  );
  const [leaving, setLeaving] = useState<number[]>([]);
  const leaveTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const clearLeaveTimers = () => {
    for (const timer of leaveTimers.current.values()) {
      clearTimeout(timer);
    }
    leaveTimers.current.clear();
  };

  useEffect(() => clearLeaveTimers, []);

  // Cambiar de filtro rearma la lista: no tiene sentido seguir animando salidas.
  const selectFilter = (value: FilterValue) => {
    clearLeaveTimers();
    setLeaving([]);
    setFilter(value);
  };

  useEffect(() => {
    try {
      window.localStorage.setItem(VIEW_KEY, JSON.stringify({ filter, sort }));
    } catch {
      return;
    }
  }, [filter, sort]);

  useEffect(() => {
    let active = true;

    void listMaestros()
      .then((loaded) => {
        if (active) {
          setMaestros(loaded);
        }
      })
      .catch((error: unknown) => {
        toast.error(
          error instanceof Error
            ? error.message
            : "No se pudieron cargar los maestros.",
        );
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const counts = useMemo(() => {
    const totals: Record<string, number> = { all: maestros.length };

    for (const maestro of maestros) {
      totals[maestro.status] = (totals[maestro.status] ?? 0) + 1;
    }

    return totals;
  }, [maestros]);

  const visible = useMemo(() => {
    const term = normalize(search.trim());
    const filtered = maestros.filter((maestro) => {
      if (
        filter !== "all" &&
        maestro.status !== filter &&
        !leaving.includes(maestro.id)
      ) {
        return false;
      }

      if (!term) {
        return true;
      }

      const haystack = normalize(
        [maestro.name ?? "", maestro.email, maestro.schoolName ?? ""].join(" "),
      );
      return haystack.includes(term);
    });

    return filtered.sort((a, b) => {
      if (sort === "name") {
        return (a.name ?? a.email).localeCompare(b.name ?? b.email, "es");
      }

      const left = new Date(a.createdAt).getTime();
      const right = new Date(b.createdAt).getTime();
      return sort === "oldest" ? left - right : right - left;
    });
  }, [maestros, filter, leaving, search, sort]);

  const showDocument = (open: () => Promise<void>) => {
    open().catch((error) =>
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo abrir el documento.",
      ),
    );
  };

  const openDoc = (id: number, doc: MaestroDoc) =>
    showDocument(() => openMaestroDocument(id, doc));

  const updateStatus = (maestro: Maestro, status: string) => {
    const action =
      status === "approved"
        ? approveMaestro
        : status === "suspended"
          ? suspendMaestro
          : rejectMaestro;
    const successMessage =
      status === "approved"
        ? maestro.status === "pending"
          ? "Maestro aprobado."
          : "Maestro reactivado."
        : status === "suspended"
          ? "Maestro suspendido."
          : "Maestro rechazado.";

    setBusyId(maestro.id);
    void action(maestro.id)
      .then(() => {
        setMaestros((current) =>
          current.map((item) =>
            item.id === maestro.id ? { ...item, status } : item,
          ),
        );

        if (filter !== "all" && status !== filter) {
          setLeaving((current) =>
            current.includes(maestro.id) ? current : [...current, maestro.id],
          );
          leaveTimers.current.set(
            maestro.id,
            setTimeout(() => {
              leaveTimers.current.delete(maestro.id);
              setLeaving((current) =>
                current.filter((id) => id !== maestro.id),
              );
            }, EXIT_MS),
          );
        }

        toast.success(successMessage);
      })
      .catch((error) => {
        toast.error(
          error instanceof Error ? error.message : "No se pudo actualizar.",
        );
      })
      .finally(() => setBusyId(null));
  };

  const decideSchool = (
    maestro: Maestro,
    schoolId: string,
    decision: "approve" | "reject",
  ) => {
    setBusyId(maestro.id);
    void decideMaestroSchool(schoolId, decision)
      .then((updated) => {
        setMaestros((current) =>
          current.map((item) =>
            item.id === maestro.id
              ? {
                  ...item,
                  schools: (item.schools ?? []).map((school) =>
                    school.id === schoolId ? updated : school,
                  ),
                }
              : item,
          ),
        );
        toast.success(
          decision === "approve" ? "Colegio aprobado." : "Colegio rechazado.",
        );
      })
      .catch((error) => {
        toast.error(
          error instanceof Error ? error.message : "No se pudo actualizar.",
        );
      })
      .finally(() => setBusyId(null));
  };

  const confirmAction = () => {
    if (!confirming) {
      return;
    }

    const { action, maestro } = confirming;
    setConfirming(null);
    updateStatus(maestro, action === "reject" ? "rejected" : "suspended");
  };

  if (loading) {
    return (
      <div className="flex min-h-72 items-center justify-center">
        <LoaderCircleIcon className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      <div className="flex w-full flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Maestros</h1>
          <p className="text-sm text-muted-foreground">
            Revisa sus documentos, apruébalos y controla su acceso.
          </p>
        </header>

        <div className="flex flex-col gap-3 border-y border-border py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-1.5">
            {FILTERS.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => selectFilter(item.value)}
                aria-pressed={filter === item.value}
                className={cn(
                  "rounded-full px-3 py-1.5 text-sm font-medium transition",
                  filter === item.value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {item.label}
                <span className="pl-1.5 text-xs opacity-80">
                  {counts[item.value] ?? 0}
                </span>
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative sm:w-64">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar por nombre, correo o colegio"
                className="pl-9"
                aria-label="Buscar maestros"
              />
            </div>
            <Select
              value={sort}
              onValueChange={(value) => setSort(value as SortValue)}
            >
              <SelectTrigger className="sm:w-48" aria-label="Ordenar por">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORTS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {visible.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">
            {maestros.length === 0
              ? "Cuando un maestro se registre, aparecerá aquí para que lo apruebes."
              : "Ningún maestro coincide con este filtro."}
          </p>
        ) : (
          <div className="flex flex-col">
            {visible.map((maestro) => {
              const schools = maestro.schools ?? [];
              const noDocuments =
                !maestro.hasLetter && !maestro.hasIdFront && !maestro.hasIdBack;

              const isLeaving = leaving.includes(maestro.id);

              return (
                <article
                  key={maestro.id}
                  aria-hidden={isLeaving || undefined}
                  className={cn(
                    "grid grid-rows-[1fr] motion-safe:transition-all motion-safe:duration-300 motion-safe:ease-out",
                    isLeaving &&
                      "pointer-events-none grid-rows-[0fr] opacity-0",
                  )}
                >
                  <div className="overflow-hidden">
                    {/* El separador vive aqui dentro y no en el <article>: un
                        borde no encoge por debajo de su grosor, asi que puesto
                        afuera la fila colapsada dejaba 1px pegado a la linea de
                        la siguiente. Va abajo para que cada fila se lleve su
                        propio separador al salir; el de la ultima cierra la
                        lista. */}
                    <div className="border-b border-border">
                      <div
                        className={cn(
                          "flex flex-col gap-3 py-4 motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-out",
                          isLeaving && "translate-x-3",
                        )}
                      >
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div className="flex min-w-0 flex-col gap-0.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <h2 className="text-base font-semibold">
                                {maestro.name ?? maestro.email}
                              </h2>
                              <Badge
                                variant={
                                  maestro.status === "approved"
                                    ? "secondary"
                                    : "outline"
                                }
                              >
                                {STATUS_LABEL[maestro.status] ?? maestro.status}
                              </Badge>
                            </div>
                            <p className="text-sm break-all text-muted-foreground">
                              {maestro.email}
                              {maestro.phone ? ` · ${maestro.phone}` : ""}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {maestro.isHomeschool
                                ? "Educación en casa"
                                : (maestro.schoolName ?? "Sin colegio")}
                              {noDocuments ? " · sin documentos" : ""}
                            </p>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            {maestro.hasLetter && (
                              <Button
                                size="sm"
                                type="button"
                                variant="outline"
                                onClick={() => openDoc(maestro.id, "letter")}
                              >
                                <FileTextIcon data-icon="inline-start" />
                                Carta
                              </Button>
                            )}
                            {maestro.hasIdFront && (
                              <Button
                                size="sm"
                                type="button"
                                variant="outline"
                                onClick={() => openDoc(maestro.id, "idFront")}
                              >
                                <FileTextIcon data-icon="inline-start" />
                                Carnet anverso
                              </Button>
                            )}
                            {maestro.hasIdBack && (
                              <Button
                                size="sm"
                                type="button"
                                variant="outline"
                                onClick={() => openDoc(maestro.id, "idBack")}
                              >
                                <FileTextIcon data-icon="inline-start" />
                                Carnet reverso
                              </Button>
                            )}
                            {maestro.status !== "approved" && (
                              <Button
                                size="sm"
                                type="button"
                                disabled={busyId === maestro.id}
                                onClick={() =>
                                  updateStatus(maestro, "approved")
                                }
                              >
                                <CheckIcon data-icon="inline-start" />
                                {maestro.status === "pending"
                                  ? "Aprobar"
                                  : "Reactivar"}
                              </Button>
                            )}
                            {maestro.status === "approved" && (
                              <Button
                                size="sm"
                                type="button"
                                variant="outline"
                                disabled={busyId === maestro.id}
                                onClick={() =>
                                  setConfirming({ action: "suspend", maestro })
                                }
                              >
                                <PauseIcon data-icon="inline-start" />
                                Suspender
                              </Button>
                            )}
                            {maestro.status !== "rejected" && (
                              <Button
                                size="icon-sm"
                                type="button"
                                variant="ghost"
                                title={`Rechazar a ${maestro.name ?? maestro.email}`}
                                aria-label={`Rechazar a ${maestro.name ?? maestro.email}`}
                                disabled={busyId === maestro.id}
                                onClick={() =>
                                  setConfirming({ action: "reject", maestro })
                                }
                              >
                                <XIcon />
                              </Button>
                            )}
                          </div>
                        </div>

                        {schools.length > 0 && (
                          <ul className="flex flex-col gap-2 border-l-2 border-border pl-4">
                            {schools.map((school) => (
                              <li
                                key={school.id}
                                className="flex flex-wrap items-center justify-between gap-2"
                              >
                                <div className="flex min-w-0 flex-col">
                                  <span className="text-sm">
                                    {school.schoolName}
                                  </span>
                                  <span className="text-xs text-muted-foreground">
                                    Otro colegio ·{" "}
                                    {STATUS_LABEL[school.status] ??
                                      school.status}{" "}
                                    ·{" "}
                                    {school.hasLetter
                                      ? "carta enviada"
                                      : "sin carta"}
                                  </span>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                  {school.hasLetter && (
                                    <Button
                                      size="sm"
                                      type="button"
                                      variant="outline"
                                      onClick={() =>
                                        showDocument(() =>
                                          openSchoolLetter(school.id),
                                        )
                                      }
                                    >
                                      <FileTextIcon data-icon="inline-start" />
                                      Carta
                                    </Button>
                                  )}
                                  {school.status !== "approved" && (
                                    <Button
                                      size="sm"
                                      type="button"
                                      disabled={busyId === maestro.id}
                                      onClick={() =>
                                        decideSchool(
                                          maestro,
                                          school.id,
                                          "approve",
                                        )
                                      }
                                    >
                                      <CheckIcon data-icon="inline-start" />
                                      Aprobar
                                    </Button>
                                  )}
                                  {school.status !== "rejected" && (
                                    <Button
                                      size="icon-sm"
                                      type="button"
                                      variant="ghost"
                                      title={`Rechazar ${school.schoolName}`}
                                      aria-label={`Rechazar ${school.schoolName}`}
                                      disabled={busyId === maestro.id}
                                      onClick={() =>
                                        decideSchool(
                                          maestro,
                                          school.id,
                                          "reject",
                                        )
                                      }
                                    >
                                      <XIcon />
                                    </Button>
                                  )}
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) {
            setConfirming(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirming ? CONFIRMATION_COPY[confirming.action].title : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirming
                ? `${confirming.maestro.name ?? confirming.maestro.email}: ${
                    CONFIRMATION_COPY[confirming.action].description
                  }`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmAction}>
              {confirming ? CONFIRMATION_COPY[confirming.action].confirm : ""}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
