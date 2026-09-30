"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  ChevronRightIcon,
  CopyIcon,
  LoaderCircleIcon,
  PlusIcon,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { ApiError } from "@/lib/api-client";
import { getUser } from "@/lib/auth";
import { copyToClipboard } from "@/lib/clipboard";
import { formatContestWindow, gradesForCategories } from "@/lib/contest-schema";
import {
  createGroup,
  listGroups,
  listPublishedContests,
  type PublishedContest,
  type StoredGroup,
} from "@/lib/groups-api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

function studentCount(group: StoredGroup) {
  return group.teams.reduce(
    (total, team) => total + (team.participationMode === "pareja" ? 2 : 1),
    0,
  );
}

/** «3.º y 4.º de primaria» */
function categoryGrades(category: string) {
  const grades = gradesForCategories([category]);
  const [, level] = grades[0].label.split(" de ");
  return `${grades.map((grade) => grade.label.split(" de ")[0]).join(" y ")} de ${level}`;
}

export function GroupsHome() {
  const [isMaestro] = useState(() => getUser()?.role === "maestro");
  const [groups, setGroups] = useState<StoredGroup[] | null>(null);
  const [contests, setContests] = useState<PublishedContest[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.all([listGroups(), listPublishedContests()])
      .then(([loadedGroups, loadedContests]) => {
        if (!active) return;
        setGroups(loadedGroups);
        setContests(loadedContests);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setLoadError(
          error instanceof Error
            ? error.message
            : "No se pudieron cargar tus grupos.",
        );
      });
    return () => {
      active = false;
    };
  }, []);

  const copyCode = async (code: string) => {
    if (await copyToClipboard(code)) {
      toast.success(`Código copiado: ${code}`);
    } else {
      toast.error("No se pudo copiar el código.");
    }
  };

  const total =
    groups?.reduce((sum, group) => sum + studentCount(group), 0) ?? 0;

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b pb-5">
        <div className="flex flex-col gap-1">
          <h1 className="font-heading text-3xl font-semibold tracking-tight">
            {isMaestro ? "Mis grupos" : "Grupos"}
          </h1>
          {groups && groups.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {groups.length} {groups.length === 1 ? "grupo" : "grupos"} ·{" "}
              {total} {total === 1 ? "estudiante" : "estudiantes"}
            </p>
          )}
        </div>
        <Button type="button" onClick={() => setCreateOpen(true)}>
          <PlusIcon data-icon="inline-start" />
          Nuevo grupo
        </Button>
      </div>

      {loadError ? (
        <p className="text-sm text-destructive">{loadError}</p>
      ) : groups === null ? (
        <GroupsSkeleton />
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-start gap-2 py-6">
          <p className="font-medium">Todavía no tienes grupos.</p>
          <p className="max-w-xl text-sm text-muted-foreground">
            Un grupo junta a tus estudiantes de una categoría para un desafío.
            Tiene un código con el que entran a inscribirse y a rendir.
          </p>
        </div>
      ) : (
        <ul className="divide-y border-b">
          {groups.map((group, index) => {
            const students = studentCount(group);
            return (
              <li
                key={group.id}
                style={{ animationDelay: `${Math.min(index, 10) * 45}ms` }}
                className="group/row relative flex flex-wrap items-center gap-x-6 gap-y-2 px-3 py-4 transition-colors hover:bg-muted/40 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-300 motion-safe:fill-mode-both"
              >
                <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1">
                  <h2 className="text-lg font-semibold break-words">
                    <a
                      href={`/grupos/ver?id=${group.id}`}
                      className="outline-none after:absolute after:inset-0 focus-visible:underline"
                    >
                      {group.name}
                    </a>
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {group.contestTitle}
                    {group.category && <> · {group.category}</>}
                  </p>
                </div>
                <span className="text-sm text-muted-foreground tabular-nums">
                  {students} {students === 1 ? "estudiante" : "estudiantes"}
                </span>
                <button
                  type="button"
                  title="Copiar código del grupo"
                  aria-label={`Copiar el código ${group.accessCode}`}
                  onClick={() => copyCode(group.accessCode)}
                  className="relative z-10 flex items-center gap-2 px-2 py-1 font-mono text-lg font-semibold tracking-widest transition-colors hover:bg-muted"
                >
                  {group.accessCode}
                  <CopyIcon className="size-4 text-muted-foreground" />
                </button>
                <ChevronRightIcon className="size-5 text-muted-foreground transition-transform group-hover/row:translate-x-0.5 max-sm:hidden" />
              </li>
            );
          })}
        </ul>
      )}

      <CreateGroupDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        contests={contests}
        isMaestro={isMaestro}
      />
    </div>
  );
}

function CreateGroupDialog({
  open,
  onOpenChange,
  contests,
  isMaestro,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contests: PublishedContest[];
  isMaestro: boolean;
}) {
  const [contestId, setContestId] = useState("");
  const [category, setCategory] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const chosenContestId = contests.length === 1 ? contests[0].id : contestId;
  const contest = contests.find((item) => item.id === chosenContestId);
  const categories = contest?.categories ?? [];
  const chosenCategory =
    categories.length === 1
      ? categories[0]
      : categories.includes(category)
        ? category
        : "";

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const missing = !contest
      ? "Elige el desafío."
      : !chosenCategory
        ? "Elige la categoría de tus estudiantes."
        : !name.trim()
          ? "Ponle un nombre al grupo."
          : null;
    if (missing) {
      setError(missing);
      return;
    }
    setError(null);
    setCreating(true);
    try {
      const group = await createGroup({
        contestId: chosenContestId,
        category: chosenCategory,
        name: name.trim(),
      });
      window.location.assign(`/grupos/ver?id=${group.id}&vista=estudiantes`);
    } catch (caught) {
      setError(
        caught instanceof ApiError || caught instanceof Error
          ? caught.message
          : "No se pudo crear el grupo.",
      );
      setCreating(false);
    }
  };

  const option = (selected: boolean) =>
    cn(
      "flex flex-col items-start gap-0.5 border-2 px-3 py-2 text-left text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
      selected
        ? "border-primary bg-primary/10 font-semibold"
        : "border-border/30 hover:border-primary/60",
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nuevo grupo</DialogTitle>
          <DialogDescription>
            Después inscribes a tus estudiantes y les das su código.
          </DialogDescription>
        </DialogHeader>
        {contests.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {isMaestro
              ? "Ahora no hay desafíos con inscripción abierta. Podrás crear un grupo cuando el organizador publique uno."
              : "No hay desafíos publicados con inscripción abierta."}
          </p>
        ) : (
          <form noValidate onSubmit={submit} className="flex flex-col gap-5">
            {contests.length > 1 && (
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-2 text-sm font-medium">Desafío</legend>
                <div
                  role="radiogroup"
                  aria-label="Desafío"
                  className="grid gap-2"
                >
                  {contests.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      role="radio"
                      aria-checked={item.id === chosenContestId}
                      onClick={() => {
                        setContestId(item.id);
                        setError(null);
                      }}
                      className={option(item.id === chosenContestId)}
                    >
                      {item.title}
                      {item.startsAt && (
                        <span className="text-xs font-normal text-muted-foreground">
                          Rendición{" "}
                          {formatContestWindow(item.startsAt, item.endsAt)}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </fieldset>
            )}
            {contests.length === 1 && contest && (
              <p className="text-sm">
                Desafío: <span className="font-semibold">{contest.title}</span>
              </p>
            )}
            {categories.length > 1 && (
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-2 text-sm font-medium">
                  Categoría de tus estudiantes
                </legend>
                <div
                  role="radiogroup"
                  aria-label="Categoría"
                  className="grid grid-cols-2 gap-2 sm:grid-cols-3"
                >
                  {categories.map((item) => (
                    <button
                      key={item}
                      type="button"
                      role="radio"
                      aria-checked={item === chosenCategory}
                      onClick={() => {
                        setCategory(item);
                        setError(null);
                      }}
                      className={option(item === chosenCategory)}
                    >
                      {item}
                      <span className="text-xs font-normal text-muted-foreground">
                        {categoryGrades(item)}
                      </span>
                    </button>
                  ))}
                </div>
              </fieldset>
            )}
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium">Nombre del grupo</span>
              <Input
                value={name}
                disabled={creating}
                placeholder="Ej. 6.º A"
                onChange={(event) => {
                  setName(event.target.value);
                  setError(null);
                }}
              />
            </label>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button type="submit" disabled={creating}>
                {creating ? (
                  <LoaderCircleIcon
                    data-icon="inline-start"
                    className="animate-spin"
                  />
                ) : (
                  <PlusIcon data-icon="inline-start" />
                )}
                Crear grupo
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** La silueta de la lista mientras cargan los grupos. */
function GroupsSkeleton() {
  return (
    <div aria-busy>
      <span className="sr-only">Cargando grupos...</span>
      <ul className="divide-y border-b">
        {[40, 32, 48].map((width, index) => (
          <li
            key={index}
            className="flex flex-wrap items-center gap-x-6 gap-y-2 px-3 py-4"
          >
            <div className="flex min-w-0 flex-1 basis-64 flex-col gap-2">
              <Skeleton
                className="h-6 rounded-none"
                style={{ width: `${width}%` }}
              />
              <Skeleton className="h-4 w-3/5 rounded-none" />
            </div>
            <Skeleton className="h-4 w-24 rounded-none" />
            <Skeleton className="h-7 w-28 rounded-none" />
          </li>
        ))}
      </ul>
    </div>
  );
}
