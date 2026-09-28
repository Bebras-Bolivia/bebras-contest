"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckIcon,
  EyeIcon,
  FileXIcon,
  HouseIcon,
  PauseIcon,
  SchoolIcon,
  SearchIcon,
  PencilIcon,
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
  type MaestroSchool,
} from "@/lib/users-api";
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
import { EditMaestroDialog } from "@/components/edit-maestro-dialog";
import { displayPhone } from "@/lib/phone-display";
import { surface } from "@/lib/surface";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<string, string> = {
  pending: "Pendiente",
  approved: "Aprobado",
  suspended: "Suspendido",
  rejected: "Rechazado",
};

/** Los mismos colores del tema que las dificultades: amarillo, verde y rojo. */
const STATUS_STYLE: Record<string, string> = {
  pending: "bg-difficulty-medium text-difficulty-medium-foreground",
  approved: "bg-difficulty-easy text-difficulty-easy-foreground",
  suspended: "bg-muted text-muted-foreground",
  rejected: "bg-difficulty-hard text-difficulty-hard-foreground",
};

const FILTERS = [
  { value: "all", label: "Todos" },
  { value: "approved", label: "Aprobados" },
  { value: "pending", label: "Pendientes" },
  { value: "suspended", label: "Suspendidos" },
  { value: "rejected", label: "Rechazados" },
] as const;

const SORTS = [
  { value: "recent", label: "Más recientes" },
  { value: "oldest", label: "Más antiguos" },
  { value: "name", label: "Nombre (A-Z)" },
] as const;

type Tab = "review" | "all";
type FilterValue = (typeof FILTERS)[number]["value"];
type SortValue = (typeof SORTS)[number]["value"];

const VIEW_KEY = "bebras_maestros_vista";

/** Debe coincidir con la duracion de la transicion de salida de cada fila. */
const EXIT_MS = 300;

/** Un caso por revisar: la cuenta del maestro (su colegio principal o su carnet) o un colegio más. */
type Request = {
  key: string;
  maestro: Maestro;
  school: MaestroSchool | null;
  createdAt: string;
};

type Confirmation =
  | { action: "suspend" | "reject"; maestro: Maestro }
  | { action: "reject-school"; maestro: Maestro; school: MaestroSchool };

const CONFIRMATION_COPY = {
  reject: {
    title: "¿Rechazar a este maestro?",
    description:
      "No podrá crear grupos ni inscribir estudiantes. Puedes aprobarlo más adelante desde «Todos los maestros».",
    confirm: "Rechazar",
  },
  "reject-school": {
    title: "¿Rechazar este colegio?",
    description:
      "El maestro no podrá administrar este colegio. Su cuenta y sus otros colegios no cambian.",
    confirm: "Rechazar",
  },
  suspend: {
    title: "¿Suspender a este maestro?",
    description:
      "Pierde el acceso a sus grupos y estudiantes mientras esté suspendido. Puedes reactivarlo cuando quieras.",
    confirm: "Suspender",
  },
} as const;

function readView() {
  try {
    return JSON.parse(window.localStorage.getItem(VIEW_KEY) ?? "null") as {
      tab?: Tab;
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

function requestsOf(maestros: Maestro[]): Request[] {
  return maestros
    .flatMap((maestro) => [
      ...(maestro.status === "pending"
        ? [
            {
              key: `cuenta-${maestro.id}`,
              maestro,
              school: null,
              createdAt: maestro.createdAt,
            },
          ]
        : []),
      ...(maestro.schools ?? [])
        .filter((school) => school.status === "pending")
        .map((school) => ({
          key: `colegio-${school.id}`,
          maestro,
          school,
          createdAt: school.createdAt,
        })),
    ])
    .sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
}

const dateFormat = new Intl.DateTimeFormat("es-BO", {
  day: "numeric",
  month: "short",
});

const chipClass =
  "px-3 py-1.5 text-sm text-muted-foreground transition-colors duration-200 hover:bg-muted/60 hover:text-foreground aria-pressed:bg-muted aria-pressed:font-semibold aria-pressed:text-foreground";

const enter =
  "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-300 motion-safe:ease-out motion-safe:fill-mode-both";

function StatusLabel({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "px-2 py-0.5 text-xs font-semibold transition-colors duration-300",
        STATUS_STYLE[status],
      )}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function MaestrosHome() {
  const [maestros, setMaestros] = useState<Maestro[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Confirmation | null>(null);
  const [editing, setEditing] = useState<Maestro | null>(null);
  const [tab, setTab] = useState<Tab>(() => readView()?.tab ?? "review");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterValue>(
    () => readView()?.filter ?? "all",
  );
  const [sort, setSort] = useState<SortValue>(
    () => readView()?.sort ?? "recent",
  );
  const [leaving, setLeaving] = useState<Record<string, Request>>({});
  const leaveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const timers = leaveTimers.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        VIEW_KEY,
        JSON.stringify({ tab, filter, sort }),
      );
    } catch {
      return;
    }
  }, [tab, filter, sort]);

  useEffect(() => {
    let active = true;
    void listMaestros()
      .then((loaded) => {
        if (active) setMaestros(loaded);
      })
      .catch((error: unknown) => {
        toast.error(
          error instanceof Error
            ? error.message
            : "No se pudieron cargar los maestros.",
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const requests = useMemo(() => requestsOf(maestros), [maestros]);

  const shownRequests = useMemo(() => {
    const extra = Object.values(leaving).filter(
      (request) => !requests.some((item) => item.key === request.key),
    );
    return [...requests, ...extra].sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  }, [requests, leaving]);

  const counts = useMemo(() => {
    const totals: Record<string, number> = { all: maestros.length };
    for (const maestro of maestros) {
      totals[maestro.status] = (totals[maestro.status] ?? 0) + 1;
    }
    return totals;
  }, [maestros]);

  const visible = useMemo(() => {
    const term = normalize(search.trim());
    return maestros
      .filter((maestro) => filter === "all" || maestro.status === filter)
      .filter(
        (maestro) =>
          !term ||
          normalize(
            [
              maestro.name ?? "",
              maestro.email,
              maestro.schoolName ?? "",
              maestro.place ?? "",
              ...(maestro.schools ?? []).map((school) => school.schoolName),
            ].join(" "),
          ).includes(term),
      )
      .sort((a, b) => {
        if (sort === "name") {
          return (a.name ?? a.email).localeCompare(b.name ?? b.email, "es");
        }
        const left = new Date(a.createdAt).getTime();
        const right = new Date(b.createdAt).getTime();
        return sort === "oldest" ? left - right : right - left;
      });
  }, [maestros, filter, search, sort]);

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

  const leave = (request: Request | undefined) => {
    if (!request) return;
    setLeaving((current) => ({ ...current, [request.key]: request }));
    leaveTimers.current.set(
      request.key,
      setTimeout(() => {
        leaveTimers.current.delete(request.key);
        setLeaving((current) => {
          const next = { ...current };
          delete next[request.key];
          return next;
        });
      }, EXIT_MS),
    );
  };

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
          ? "Cuenta aprobada."
          : "Maestro reactivado."
        : status === "suspended"
          ? "Maestro suspendido."
          : "Maestro rechazado.";
    const request = requests.find(
      (item) => item.key === `cuenta-${maestro.id}`,
    );

    setBusy(`cuenta-${maestro.id}`);
    void action(maestro.id)
      .then(() => {
        leave(request);
        setMaestros((current) =>
          current.map((item) =>
            item.id === maestro.id ? { ...item, status } : item,
          ),
        );
        toast.success(successMessage);
      })
      .catch((error) => {
        toast.error(
          error instanceof Error ? error.message : "No se pudo actualizar.",
        );
      })
      .finally(() => setBusy(null));
  };

  const decideSchool = (
    maestro: Maestro,
    school: MaestroSchool,
    decision: "approve" | "reject",
  ) => {
    const request = requests.find(
      (item) => item.key === `colegio-${school.id}`,
    );
    setBusy(`colegio-${school.id}`);
    void decideMaestroSchool(school.id, decision)
      .then((updated) => {
        leave(request);
        setMaestros((current) =>
          current.map((item) =>
            item.id === maestro.id
              ? {
                  ...item,
                  schools: (item.schools ?? []).map((entry) =>
                    entry.id === school.id ? updated : entry,
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
      .finally(() => setBusy(null));
  };

  const confirmAction = () => {
    if (!confirming) return;
    setConfirming(null);
    if (confirming.action === "reject-school") {
      decideSchool(confirming.maestro, confirming.school, "reject");
    } else {
      updateStatus(
        confirming.maestro,
        confirming.action === "reject" ? "rejected" : "suspended",
      );
    }
  };

  if (loading) {
    return (
      <div aria-busy className="flex w-full flex-col gap-6">
        <span className="sr-only">Cargando maestros...</span>
        <div className="h-8 w-40 animate-pulse bg-muted" />
        <div className="h-9 w-72 animate-pulse bg-muted/70" />
        {[0, 1, 2].map((index) => (
          <div key={index} className={cn(surface, "h-24 animate-pulse")} />
        ))}
      </div>
    );
  }

  const confirmCopy = confirming ? CONFIRMATION_COPY[confirming.action] : null;

  return (
    <>
      <div className="flex w-full flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Maestros</h1>
          <p className="text-sm text-muted-foreground">
            Revisa los documentos y aprueba cada solicitud por separado.
          </p>
        </header>

        <div role="tablist" className="flex gap-1 border-b border-border">
          {(
            [
              ["review", "Por revisar", requests.length],
              ["all", "Todos los maestros", maestros.length],
            ] as const
          ).map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={cn(
                "relative -mb-px inline-flex items-center gap-2 px-3 py-2.5 text-sm transition-colors",
                tab === value
                  ? "tab-underline font-semibold text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
              <span className="min-w-6 bg-muted px-1.5 text-xs text-muted-foreground tabular-nums">
                {count}
              </span>
            </button>
          ))}
        </div>

        <div
          key={tab}
          className="flex flex-col gap-6 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-300"
        >
          {tab === "review" ? (
            shownRequests.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-12 text-center motion-safe:animate-in motion-safe:fade-in-0">
                <img
                  src="/castores/idea.webp"
                  alt=""
                  className="h-24 w-auto opacity-90"
                />
                <p className="font-semibold">Todo al día</p>
                <p className="text-sm text-muted-foreground">
                  No hay solicitudes por revisar.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {shownRequests.map((request, index) => (
                  <RequestCard
                    key={request.key}
                    request={request}
                    index={index}
                    leaving={
                      request.key in leaving &&
                      !requests.some((item) => item.key === request.key)
                    }
                    busy={busy === request.key}
                    onOpenDoc={openDoc}
                    onOpenLetter={(school) =>
                      showDocument(() => openSchoolLetter(school.id))
                    }
                    onApprove={() =>
                      request.school
                        ? decideSchool(
                            request.maestro,
                            request.school,
                            "approve",
                          )
                        : updateStatus(request.maestro, "approved")
                    }
                    onEdit={() => setEditing(request.maestro)}
                    onReject={() =>
                      setConfirming(
                        request.school
                          ? {
                              action: "reject-school",
                              maestro: request.maestro,
                              school: request.school,
                            }
                          : { action: "reject", maestro: request.maestro },
                      )
                    }
                  />
                ))}
              </div>
            )
          ) : (
            <>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap items-center gap-1">
                  {FILTERS.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setFilter(item.value)}
                      aria-pressed={filter === item.value}
                      className={chipClass}
                    >
                      {item.label}
                      <span className="pl-1.5 text-xs opacity-70">
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
                      placeholder="Nombre, correo, colegio o ciudad"
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
                    ? "Cuando un maestro se registre, aparecerá aquí."
                    : "Ningún maestro coincide con este filtro."}
                </p>
              ) : (
                <div
                  key={filter}
                  className="flex flex-col divide-y divide-border/60 border-y border-border/60"
                >
                  {visible.map((maestro, index) => (
                    <MaestroRow
                      key={maestro.id}
                      maestro={maestro}
                      index={index}
                      busy={busy === `cuenta-${maestro.id}`}
                      onOpenDoc={openDoc}
                      onOpenLetter={(school) =>
                        showDocument(() => openSchoolLetter(school.id))
                      }
                      onReactivate={() => updateStatus(maestro, "approved")}
                      onSuspend={() =>
                        setConfirming({ action: "suspend", maestro })
                      }
                      onEdit={() => setEditing(maestro)}
                      onReject={() =>
                        setConfirming({ action: "reject", maestro })
                      }
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <EditMaestroDialog
        maestro={editing}
        onClose={() => setEditing(null)}
        onSaved={(saved) =>
          setMaestros((current) =>
            current.map((item) => (item.id === saved.id ? saved : item)),
          )
        }
      />

      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmCopy?.title ?? ""}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirming && confirmCopy
                ? `${
                    confirming.action === "reject-school"
                      ? `${confirming.school.schoolName} (${confirming.maestro.name ?? confirming.maestro.email})`
                      : (confirming.maestro.name ?? confirming.maestro.email)
                  }: ${confirmCopy.description}`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmAction}>
              {confirmCopy?.confirm ?? ""}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function DocButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-1 text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-primary hover:underline focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:outline-none"
    >
      <EyeIcon className="size-4" />
      {label}
    </button>
  );
}

function Missing({ children }: { children: string }) {
  return (
    <span className="inline-flex items-center gap-1 px-1 text-xs text-muted-foreground">
      <FileXIcon className="size-3.5" />
      {children}
    </span>
  );
}

function RequestCard({
  request,
  index,
  leaving,
  busy,
  onOpenDoc,
  onOpenLetter,
  onApprove,
  onEdit,
  onReject,
}: {
  request: Request;
  index: number;
  leaving: boolean;
  busy: boolean;
  onOpenDoc: (id: number, doc: MaestroDoc) => void;
  onOpenLetter: (school: MaestroSchool) => void;
  onApprove: () => void;
  onEdit: () => void;
  onReject: () => void;
}) {
  const { maestro, school } = request;
  const homeschool = !school && maestro.isHomeschool;
  const documents = school ? (
    school.hasLetter ? (
      <DocButton label="Carta" onClick={() => onOpenLetter(school)} />
    ) : (
      <Missing>Falta la carta</Missing>
    )
  ) : homeschool ? (
    <>
      {maestro.hasIdFront ? (
        <DocButton
          label="Carnet anverso"
          onClick={() => onOpenDoc(maestro.id, "idFront")}
        />
      ) : (
        <Missing>Falta el anverso</Missing>
      )}
      {maestro.hasIdBack ? (
        <DocButton
          label="Carnet reverso"
          onClick={() => onOpenDoc(maestro.id, "idBack")}
        />
      ) : (
        <Missing>Falta el reverso</Missing>
      )}
    </>
  ) : maestro.hasLetter ? (
    <DocButton label="Carta" onClick={() => onOpenDoc(maestro.id, "letter")} />
  ) : (
    <Missing>Falta la carta</Missing>
  );

  return (
    <article
      aria-hidden={leaving || undefined}
      style={{ animationDelay: `${Math.min(index, 8) * 50}ms` }}
      className={cn(
        "grid grid-rows-[1fr] motion-safe:transition-all motion-safe:duration-300 motion-safe:ease-out",
        enter,
        leaving && "pointer-events-none -mb-3 grid-rows-[0fr] opacity-0",
      )}
    >
      <div className="overflow-hidden">
        <div
          className={cn(
            surface,
            "flex flex-col gap-3 p-4 transition-[background-color,transform] duration-300 ease-out hover:bg-muted/60 lg:flex-row lg:items-center",
            leaving && "translate-x-3",
          )}
        >
          <span className="hidden size-10 shrink-0 items-center justify-center bg-background text-muted-foreground sm:flex">
            {homeschool ? (
              <HouseIcon className="size-5" />
            ) : (
              <SchoolIcon className="size-5" />
            )}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <p className="text-xs text-muted-foreground">
              {school
                ? "Otro colegio"
                : homeschool
                  ? "Cuenta nueva · educación en casa"
                  : "Cuenta nueva · colegio principal"}{" "}
              · {dateFormat.format(new Date(request.createdAt))}
            </p>
            <h2 className="font-semibold">
              {school?.schoolName ??
                (homeschool ? "Educación en casa" : maestro.schoolName) ??
                "Sin colegio"}
              {!school && maestro.place && (
                <span className="font-normal text-muted-foreground">
                  {" "}
                  · {maestro.place}
                </span>
              )}
            </h2>
            <p className="text-sm break-words text-muted-foreground">
              {maestro.name ?? maestro.email}
              {maestro.name ? ` · ${maestro.email}` : ""}
              {maestro.phone ? ` · ${displayPhone(maestro.phone)}` : ""}
            </p>
            {school && maestro.status !== "approved" && (
              <p className="text-xs text-muted-foreground">
                La cuenta de este maestro también está por revisar.
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {documents}
            <Button
              size="icon-sm"
              type="button"
              variant="ghost"
              title="Editar datos"
              aria-label={`Editar datos de ${maestro.name ?? maestro.email}`}
              onClick={onEdit}
            >
              <PencilIcon />
            </Button>
            <Button size="sm" type="button" disabled={busy} onClick={onApprove}>
              <CheckIcon data-icon="inline-start" />
              Aprobar
            </Button>
            <Button
              size="icon-sm"
              type="button"
              variant="ghost"
              title="Rechazar"
              aria-label="Rechazar"
              disabled={busy}
              onClick={onReject}
            >
              <XIcon />
            </Button>
          </div>
        </div>
      </div>
    </article>
  );
}

function MaestroRow({
  maestro,
  index,
  busy,
  onOpenDoc,
  onOpenLetter,
  onReactivate,
  onSuspend,
  onEdit,
  onReject,
}: {
  maestro: Maestro;
  index: number;
  busy: boolean;
  onOpenDoc: (id: number, doc: MaestroDoc) => void;
  onOpenLetter: (school: MaestroSchool) => void;
  onReactivate: () => void;
  onSuspend: () => void;
  onEdit: () => void;
  onReject: () => void;
}) {
  const schools = maestro.schools ?? [];
  return (
    <article
      style={{ animationDelay: `${Math.min(index, 10) * 35}ms` }}
      className={cn("flex flex-col gap-3 py-4", enter)}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold">{maestro.name ?? maestro.email}</h2>
            <StatusLabel status={maestro.status} />
          </div>
          <p className="text-sm break-words text-muted-foreground">
            {maestro.email}
            {maestro.phone ? ` · ${displayPhone(maestro.phone)}` : ""}
          </p>
          <p className="text-sm text-muted-foreground">
            {maestro.isHomeschool
              ? "Educación en casa"
              : (maestro.schoolName ?? "Sin colegio")}
            {maestro.place ? ` · ${maestro.place}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {maestro.hasLetter && (
            <DocButton
              label="Carta"
              onClick={() => onOpenDoc(maestro.id, "letter")}
            />
          )}
          {maestro.hasIdFront && (
            <DocButton
              label="Carnet anverso"
              onClick={() => onOpenDoc(maestro.id, "idFront")}
            />
          )}
          {maestro.hasIdBack && (
            <DocButton
              label="Carnet reverso"
              onClick={() => onOpenDoc(maestro.id, "idBack")}
            />
          )}
          {(maestro.status === "suspended" ||
            maestro.status === "rejected") && (
            <Button
              size="sm"
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onReactivate}
            >
              <CheckIcon data-icon="inline-start" />
              {maestro.status === "rejected" ? "Aprobar" : "Reactivar"}
            </Button>
          )}
          {maestro.status === "approved" && (
            <Button
              size="sm"
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onSuspend}
            >
              <PauseIcon data-icon="inline-start" />
              Suspender
            </Button>
          )}
          <Button
            size="icon-sm"
            type="button"
            variant="ghost"
            title="Editar datos"
            aria-label={`Editar datos de ${maestro.name ?? maestro.email}`}
            onClick={onEdit}
          >
            <PencilIcon />
          </Button>
          {maestro.status !== "rejected" && maestro.status !== "pending" && (
            <Button
              size="icon-sm"
              type="button"
              variant="ghost"
              title={`Rechazar a ${maestro.name ?? maestro.email}`}
              aria-label={`Rechazar a ${maestro.name ?? maestro.email}`}
              disabled={busy}
              onClick={onReject}
            >
              <XIcon />
            </Button>
          )}
        </div>
      </div>

      {schools.length > 0 && (
        <ul className="flex flex-col gap-1.5 pl-4">
          {schools.map((school) => (
            <li
              key={school.id}
              className="flex flex-wrap items-center justify-between gap-2 text-sm"
            >
              <span className="flex min-w-0 items-center gap-2">
                <SchoolIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{school.schoolName}</span>
                <StatusLabel status={school.status} />
              </span>
              {school.hasLetter && (
                <DocButton label="Carta" onClick={() => onOpenLetter(school)} />
              )}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
