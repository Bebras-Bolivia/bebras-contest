"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  DownloadIcon,
  LoaderCircleIcon,
  StarIcon,
} from "lucide-react";
import { toast } from "sonner";
import { getUser } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { copyToClipboard } from "@/lib/clipboard";
import {
  BEBRAS_CATEGORIES,
  CONTEST_STATE_LABELS,
  SCHOOL_GRADES,
  gradeLabel,
  gradesForCategories,
} from "@/lib/contest-schema";
import {
  downloadStudentCodes,
  listGroupContests,
  listGroups,
  listMySchools,
  listPublishedContests,
  prepareCourseGroups,
  type GroupContestSummary,
  type MySchool,
  type PublishedContest,
  type StoredGroup,
} from "@/lib/groups-api";
import { DEPARTMENTS } from "@/lib/departments";
import { categorySoftStyle, categoryStyle } from "@/components/category-logo";
import { FieldHint } from "@/components/field-hint";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Expand } from "@/components/reveal";
import { SearchBox } from "@/components/search-box";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GroupsPageSkeleton } from "@/components/page-skeletons";

type ListedGroup = StoredGroup & { pending?: boolean; canOpen?: boolean };

async function prepareRows(
  rows: ListedGroup[],
  contestId?: string,
  schoolId: string | null = null,
) {
  if (
    !contestId ||
    !rows.some(
      (group) =>
        group.contestId === contestId && group.pending && group.canOpen,
    )
  )
    return rows;
  const prepared = await prepareCourseGroups(contestId, schoolId);
  const isFavorite =
    rows.find((group) => group.contestId === contestId)?.isFavorite ?? false;
  const merged = new Map(
    rows
      .filter((group) => !(group.contestId === contestId && group.pending))
      .map((group) => [group.id, group]),
  );
  for (const group of prepared) merged.set(group.id, { ...group, isFavorite });
  return [...merged.values()];
}

function studentCount(group: StoredGroup) {
  return group.studentCount ?? 0;
}

type Section = Omit<GroupContestSummary, "groups">;

const OWNERS_PAGE = 40;

function departmentName(value: string | null) {
  if (!value) return null;
  const found = DEPARTMENTS.find(
    (item) =>
      item.key === value.toUpperCase() ||
      item.name.toLowerCase() === value.toLowerCase(),
  );
  return found?.name ?? value;
}

function plain(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (terms.length === 0) return <>{text}</>;
  let flat = "";
  const origin: number[] = [];
  Array.from(text).forEach((char, index) => {
    const base = plain(char);
    for (let i = 0; i < base.length; i += 1) origin.push(index);
    flat += base;
  });
  const chars = Array.from(text);
  const marked = new Array<boolean>(chars.length).fill(false);
  for (const term of terms) {
    let at = flat.indexOf(term);
    while (at !== -1) {
      for (let i = at; i < at + term.length; i += 1) marked[origin[i]] = true;
      at = flat.indexOf(term, at + term.length);
    }
  }
  const parts: { text: string; on: boolean }[] = [];
  chars.forEach((char, index) => {
    const last = parts[parts.length - 1];
    if (last && last.on === marked[index]) last.text += char;
    else parts.push({ text: char, on: marked[index] });
  });
  return (
    <>
      {parts.map((part, index) =>
        part.on ? (
          <span key={index} className="font-semibold text-primary">
            {part.text}
          </span>
        ) : (
          part.text
        ),
      )}
    </>
  );
}

function sectionsFrom(
  summaries: GroupContestSummary[],
  published: PublishedContest[],
): Section[] {
  const sections = new Map<string, Section>(
    summaries.map((summary) => [summary.id, summary]),
  );
  for (const contest of published) {
    if (sections.has(contest.id)) continue;
    if (gradesForCategories(contest.categories).length === 0) continue;
    sections.set(contest.id, {
      id: contest.id,
      title: contest.title,
      state: contest.state,
      createdAt: contest.createdAt,
      isFavorite: contest.isFavorite,
      students: 0,
    });
  }
  return [...sections.values()].sort(
    (a, b) =>
      Number(b.isFavorite) - Number(a.isFavorite) ||
      b.createdAt.localeCompare(a.createdAt) ||
      a.title.localeCompare(b.title, "es"),
  );
}

function categoryOf(group: StoredGroup) {
  return (
    group.category ??
    SCHOOL_GRADES.find((grade) => grade.value === group.grade)?.category ??
    null
  );
}

function CategoryCounts({ groups }: { groups: ListedGroup[] }) {
  const enabled = new Set(groups.flatMap((group) => group.contestCategories));
  const counts = new Map<string, number>();
  for (const group of groups) {
    const category = categoryOf(group);
    if (category)
      counts.set(category, (counts.get(category) ?? 0) + studentCount(group));
  }
  const rows = BEBRAS_CATEGORIES.filter(
    (category) => enabled.has(category.name) || counts.get(category.name),
  );
  if (rows.length < 2) return null;
  return (
    <ul
      aria-label="Estudiantes por categoría"
      className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6"
    >
      {rows.map((category) => {
        const count = counts.get(category.name) ?? 0;
        return (
          <li
            key={category.slug}
            style={categoryStyle(category.name)}
            className="flex flex-col gap-0.5 px-3 py-2.5"
          >
            <span className="text-sm font-semibold">{category.name}</span>
            <span className="text-xs opacity-85">{category.ageRange} años</span>
            <span className="mt-1 text-2xl font-semibold tabular-nums">
              {count}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function courseOrder(value: string | null) {
  const index = SCHOOL_GRADES.findIndex((grade) => grade.value === value);
  return index < 0 ? SCHOOL_GRADES.length : index;
}

function sectionsFor(groups: ListedGroup[]) {
  const sections = new Map<
    string,
    {
      id: string;
      title: string;
      state: StoredGroup["contestState"];
      createdAt: string;
      isFavorite: boolean;
      groups: ListedGroup[];
    }
  >();
  for (const group of groups) {
    const section = sections.get(group.contestId) ?? {
      id: group.contestId,
      title: group.contestTitle,
      state: group.contestState,
      createdAt: group.contestCreatedAt,
      isFavorite: group.isFavorite,
      groups: [],
    };
    section.groups.push(group);
    sections.set(section.id, section);
  }
  return [...sections.values()]
    .map((section) => ({
      ...section,
      students: section.groups.reduce(
        (sum, group) => sum + studentCount(group),
        0,
      ),
      groups: section.groups.sort(
        (a, b) =>
          courseOrder(a.grade) - courseOrder(b.grade) ||
          Number(b.isDefault) - Number(a.isDefault) ||
          a.name.localeCompare(b.name, "es", { numeric: true }),
      ),
    }))
    .sort(
      (a, b) =>
        Number(b.isFavorite) - Number(a.isFavorite) ||
        b.createdAt.localeCompare(a.createdAt) ||
        a.title.localeCompare(b.title, "es"),
    );
}

async function loadContestRows(
  contestId: string,
  contests: PublishedContest[],
  user: ReturnType<typeof getUser>,
  schoolId: string | null = null,
) {
  const isMaestro = user?.role === "maestro";
  const stored = (await listGroups({ contestId })).filter(
    (group) => !isMaestro || (group.schoolId ?? null) === schoolId,
  );
  const contest = contests.find((item) => item.id === contestId);
  const closedForTeacher = isMaestro && Boolean(contest) && !contest?.canEnroll;
  const rows: ListedGroup[] = stored.filter((group) => {
    if (group.teamCount > 0) return true;
    if (closedForTeacher) return false;
    const categories = group.contestCategories;
    return group.grade
      ? gradesForCategories(categories).some(
          (grade) => grade.value === group.grade,
        )
      : group.category
        ? categories.includes(group.category)
        : categories.length > 0;
  });
  if (user && contest && !closedForTeacher) {
    for (const grade of gradesForCategories(contest.categories)) {
      if (
        stored.some(
          (group) =>
            group.grade === grade.value &&
            group.isDefault &&
            group.ownerId === user.id,
        )
      )
        continue;
      rows.push({
        id: `course:${contest.id}:${grade.value}:${schoolId ?? ""}`,
        schoolId,
        pending: true,
        canOpen: contest.canEnroll,
        name: grade.label,
        grade: grade.value,
        isDefault: true,
        ownerId: user.id,
        ownerName: isMaestro ? (user.name ?? user.email) : null,
        ownerEmail: isMaestro ? user.email : null,
        ownerSchool: null,
        ownerDepartment: null,
        contestId: contest.id,
        contestTitle: contest.title,
        contestState: contest.state,
        contestCreatedAt: contest.createdAt,
        isFavorite: contest.isFavorite,
        category: grade.category,
        contestCategories: contest.categories,
        contestAllowPairs: false,
        accessCode: "",
        firstUsedAt: null,
        expiresAt: null,
        createdAt: "",
        teamCount: 0,
        studentCount: 0,
        teams: [],
      });
    }
  }
  return prepareRows(rows, contestId, schoolId);
}

export function GroupsHome() {
  const [user] = useState(getUser);
  const isMaestro = user?.role === "maestro";
  const [groups, setGroups] = useState<ListedGroup[] | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [published, setPublished] = useState<PublishedContest[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [schools, setSchools] = useState<MySchool[]>([]);
  const [school, setSchool] = useState<string | null>(null);
  const [switchingSchool, setSwitchingSchool] = useState(false);
  const [selected, setSelected] = useState(() =>
    new URLSearchParams(window.location.search).get("desafio"),
  );

  useEffect(() => {
    let active = true;
    void Promise.all([
      listGroupContests(),
      listPublishedContests(),
      isMaestro ? listMySchools().catch(() => []) : Promise.resolve([]),
    ])
      .then(async ([summaries, contests, mine]) => {
        if (!active) return;
        const list = sectionsFrom(summaries, contests);
        const params = new URLSearchParams(window.location.search);
        const requested = params.get("desafio");
        const initial =
          list.find((section) => section.id === requested) ?? list[0];
        const initialSchool =
          mine.find((item) => item.id === params.get("colegio"))?.id ?? null;
        const rows = initial
          ? await loadContestRows(initial.id, contests, user, initialSchool)
          : [];
        if (!active) return;
        setPublished(contests);
        setSections(list);
        setSchools(mine);
        setSchool(initialSchool);
        setSelected(initial?.id ?? null);
        setGroups(rows);
      })
      .catch((error: unknown) => {
        if (active)
          setLoadError(
            error instanceof Error
              ? error.message
              : "No se pudieron cargar los grupos.",
          );
      });
    return () => {
      active = false;
    };
  }, [user, isMaestro]);

  const summary = sections.find((section) => section.id === selected);
  const current = summary && {
    ...summary,
    students: (groups ?? []).reduce(
      (sum, group) => sum + studentCount(group),
      0,
    ),
    groups: sectionsFor(groups ?? [])[0]?.groups ?? [],
  };
  const others = sections.filter((section) => section.id !== current?.id);

  const choose = async (id: string) => {
    if (choosing) return;
    setChoosing(id);
    try {
      setGroups(await loadContestRows(id, published, user, school));
      setSelected(id);
      const url = new URL(window.location.href);
      url.searchParams.set("desafio", id);
      window.history.replaceState(null, "", url);
      window.scrollTo({ top: 0, behavior: "auto" });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudieron cargar los grupos.",
      );
    } finally {
      setChoosing(null);
    }
  };

  const chooseSchool = async (id: string | null) => {
    if (switchingSchool || id === school || !selected) return;
    setSwitchingSchool(true);
    try {
      setGroups(await loadContestRows(selected, published, user, id));
      setSchool(id);
      const url = new URL(window.location.href);
      if (id) url.searchParams.set("colegio", id);
      else url.searchParams.delete("colegio");
      window.history.replaceState(null, "", url);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudieron cargar los cursos.",
      );
    } finally {
      setSwitchingSchool(false);
    }
  };

  const downloadCodes = (id: string) => {
    setDownloading(true);
    downloadStudentCodes(id, schools.length > 1 ? school : undefined)
      .catch((error: unknown) =>
        toast.error(
          error instanceof Error
            ? error.message
            : "No se pudo descargar la lista de estudiantes.",
        ),
      )
      .finally(() => setDownloading(false));
  };

  const copyCode = async (code: string) => {
    if (await copyToClipboard(code)) toast.success(`Código copiado: ${code}`);
    else toast.error("No se pudo copiar el código.");
  };

  const renderRow = (group: ListedGroup, index: number) => {
    const students = studentCount(group);
    const canOpen = !group.pending;
    const showCode = group.contestState === "inscripcion";
    const showResults =
      students > 0 &&
      ["abierta", "suspendida", "cerrada", "consolidada", "publicada"].includes(
        group.contestState,
      );
    return (
      <li
        key={group.id}
        style={{ animationDelay: `${Math.min(index, 10) * 35}ms` }}
        className={cn(
          "group/row relative flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-4 transition-colors motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-300 motion-safe:fill-mode-both sm:gap-x-5",
          canOpen && "hover:bg-muted/40",
        )}
      >
        <div className="flex min-w-0 flex-1 basis-56 flex-col gap-1">
          <h3 className="text-base font-semibold break-words">
            {group.pending ? (
              group.name
            ) : (
              <a
                href={`/grupos/ver?id=${group.id}&vista=estudiantes`}
                className="outline-none after:absolute after:inset-0 focus-visible:underline"
              >
                {group.name}
              </a>
            )}
          </h3>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {group.category && (
              <Badge data-category style={categoryStyle(group.category)}>
                {group.category}
              </Badge>
            )}
            {group.grade && group.name !== gradeLabel(group.grade) && (
              <span className="text-sm text-muted-foreground">
                {gradeLabel(group.grade)}
              </span>
            )}
            {!isMaestro && group.ownerName && (
              <span className="text-sm text-muted-foreground">
                {group.ownerName}
              </span>
            )}
          </div>
        </div>
        <span className="text-sm text-muted-foreground tabular-nums">
          {students} {students === 1 ? "estudiante" : "estudiantes"}
        </span>
        {!group.pending && (
          <>
            {showCode && (
              <div className="relative z-10 flex items-center gap-1.5">
                <button
                  type="button"
                  title="Copiar código del grupo"
                  aria-label={`Copiar el código ${group.accessCode}`}
                  onClick={() => void copyCode(group.accessCode)}
                  className="flex items-center gap-2 px-2 py-1 font-mono text-lg font-semibold tracking-widest transition-colors hover:bg-muted"
                >
                  {group.accessCode}
                  <CopyIcon className="size-4 text-muted-foreground" />
                </button>
                <FieldHint>
                  Comparte este código con tus estudiantes para acceder a este
                  grupo desde «Entrar con código». En un desafío oficial sirve
                  para inscribirse; después, cada estudiante recibe su código
                  personal para rendir.
                </FieldHint>
              </div>
            )}
            {showResults && (
              <Button
                asChild
                size="sm"
                variant="ghost"
                className="relative z-10 max-sm:px-2"
              >
                <a href={`/grupos/ver?id=${group.id}&vista=resultados`}>
                  Resultados
                </a>
              </Button>
            )}
          </>
        )}
        {canOpen && (
          <ChevronRightIcon className="size-5 text-muted-foreground transition-transform group-hover/row:translate-x-0.5 max-sm:hidden" />
        )}
      </li>
    );
  };

  if (groups === null && !loadError) return <GroupsPageSkeleton />;

  return (
    <div className="flex w-full flex-col gap-6 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-300">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b pb-5">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">
          {isMaestro ? "Mis grupos" : "Grupos"}
        </h1>
        {others.length > 0 && (
          <Button asChild variant="ghost" size="sm" className="lg:hidden">
            <a href="#otros-desafios">Otros desafíos ({others.length})</a>
          </Button>
        )}
      </div>
      {loadError ? (
        <p className="text-sm text-destructive">{loadError}</p>
      ) : !current ? (
        <p className="py-6 text-sm text-muted-foreground">
          {isMaestro
            ? "Los grupos aparecerán cuando el desafío tenga categorías asignadas."
            : "Asigna categorías al desafío para habilitar los grupos de cada curso."}
        </p>
      ) : (
        <div
          className={cn(
            "grid min-w-0 gap-10",
            others.length > 0 && "lg:grid-cols-[minmax(0,1fr)_15rem] lg:gap-8",
          )}
        >
          <section
            aria-labelledby="group-current-contest"
            className="flex min-w-0 flex-col gap-3"
          >
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <h2
                    id="group-current-contest"
                    className="text-lg font-semibold break-words"
                  >
                    {current.title}
                  </h2>
                  {current.isFavorite && (
                    <StarIcon
                      aria-label="Desafío favorito"
                      className="size-4 shrink-0 fill-primary text-primary"
                    />
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  <span
                    className={cn(
                      "font-medium",
                      current.state === "abierta"
                        ? "text-primary"
                        : "text-foreground",
                    )}
                  >
                    {CONTEST_STATE_LABELS[current.state]}
                  </span>{" "}
                  · {current.groups.length}{" "}
                  {current.groups.length === 1 ? "grupo" : "grupos"} ·{" "}
                  {current.students}{" "}
                  {current.students === 1 ? "estudiante" : "estudiantes"}
                </p>
              </div>
              {current.students > 0 && (
                <div className="flex items-center gap-1.5">
                  <FieldHint>
                    Un Excel con el código personal de cada estudiante, por
                    curso, listo para imprimir y repartir. Con ese código entran
                    a rendir el desafío en{" "}
                    <a
                      href="/entrar"
                      className="font-semibold text-foreground underline underline-offset-4 hover:text-primary"
                    >
                      Entrar al desafío
                    </a>
                    .
                  </FieldHint>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={downloading}
                    onClick={() => downloadCodes(current.id)}
                  >
                    <DownloadIcon data-icon="inline-start" />
                    {downloading ? "Descargando…" : "Códigos"}
                  </Button>
                </div>
              )}
            </div>
            {!isMaestro && current.students > 0 && (
              <CategoryCounts groups={current.groups} />
            )}
            {isMaestro && schools.length > 1 && (
              <div
                role="tablist"
                aria-label="Colegio"
                className="flex flex-wrap gap-1.5"
              >
                {schools.map((item) => (
                  <button
                    key={item.id ?? "principal"}
                    type="button"
                    role="tab"
                    aria-selected={item.id === school}
                    disabled={switchingSchool}
                    onClick={() => void chooseSchool(item.id)}
                    className="border-2 border-border/20 px-3 py-1.5 text-sm text-muted-foreground transition-colors outline-none hover:border-primary/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/60 aria-selected:border-primary aria-selected:bg-primary/10 aria-selected:font-medium aria-selected:text-foreground"
                  >
                    {item.name}
                  </button>
                ))}
              </div>
            )}
            {isMaestro ? (
              <ul
                key={school ?? "principal"}
                className={cn(
                  "divide-y border-b transition-opacity duration-200",
                  switchingSchool && "opacity-50",
                )}
              >
                {current.groups.length === 0 ? (
                  <li className="py-4 text-sm text-muted-foreground">
                    No tienes estudiantes inscritos en este desafío.
                  </li>
                ) : (
                  current.groups.map(renderRow)
                )}
              </ul>
            ) : (
              <AdminGroups groups={current.groups} renderRow={renderRow} />
            )}
          </section>
          {others.length > 0 && (
            <aside
              id="otros-desafios"
              className="flex min-w-0 scroll-mt-6 flex-col gap-3"
            >
              <h2 className="font-heading text-base font-semibold">
                Otros desafíos
              </h2>
              <ul className="divide-y border-b">
                {others.map((section) => (
                  <li key={section.id}>
                    <button
                      type="button"
                      disabled={choosing !== null}
                      onClick={() => void choose(section.id)}
                      className="flex w-full items-start gap-2 px-2 py-4 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-primary/60"
                    >
                      <span className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="font-semibold break-words">
                          {section.title}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          {CONTEST_STATE_LABELS[section.state]}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          {section.students}{" "}
                          {section.students === 1
                            ? "estudiante"
                            : "estudiantes"}
                        </span>
                      </span>
                      {choosing === section.id ? (
                        <LoaderCircleIcon className="mt-1 size-4 shrink-0 animate-spin text-muted-foreground" />
                      ) : section.isFavorite ? (
                        <StarIcon className="mt-1 size-4 shrink-0 fill-primary text-primary" />
                      ) : (
                        <ChevronRightIcon className="mt-1 size-4 shrink-0 text-muted-foreground" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </aside>
          )}
        </div>
      )}
    </div>
  );
}

type OwnerEntry = {
  key: string;
  name: string;
  email: string | null;
  school: string | null;
  department: string | null;
  teachers: Set<string>;
  groups: ListedGroup[];
  students: number;
};

function AdminGroups({
  groups,
  renderRow,
}: {
  groups: ListedGroup[];
  renderRow: (group: ListedGroup, index: number) => ReactNode;
}) {
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("todos");
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  const [limit, setLimit] = useState(OWNERS_PAGE);

  const owners = useMemo(() => {
    const byOwner = new Map<string, OwnerEntry>();
    for (const group of groups) {
      const school = group.ownerName ? group.ownerSchool : null;
      const key = group.ownerName
        ? `colegio:${plain(school ?? "")}:${group.ownerDepartment ?? ""}`
        : "admin";
      const entry = byOwner.get(key) ?? {
        key,
        name: group.ownerName
          ? (school ?? "Sin colegio")
          : "Creados por administradores",
        email: group.ownerName ? group.ownerEmail : null,
        school,
        department: group.ownerName ? group.ownerDepartment : null,
        teachers: new Set<string>(),
        groups: [],
        students: 0,
      };
      if (group.ownerName) entry.teachers.add(group.ownerName);
      if (key === "admin") {
        const same = entry.groups.findIndex(
          (item) => item.grade === group.grade,
        );
        if (same === -1) entry.groups.push(group);
        else if (
          studentCount(group) > studentCount(entry.groups[same]) ||
          (entry.groups[same].pending && !group.pending)
        )
          entry.groups[same] = group;
      } else if (group.teamCount > 0) entry.groups.push(group);
      entry.students += studentCount(group);
      byOwner.set(key, entry);
    }
    return [...byOwner.values()].sort(
      (a, b) =>
        Number(b.key === "admin") - Number(a.key === "admin") ||
        a.name.localeCompare(b.name, "es"),
    );
  }, [groups]);

  const departments = useMemo(
    () =>
      [
        ...new Set(
          owners
            .map((owner) => owner.department)
            .filter((value): value is string => Boolean(value)),
        ),
      ].sort((a, b) =>
        (departmentName(a) ?? a).localeCompare(departmentName(b) ?? b, "es"),
      ),
    [owners],
  );

  const direct = owners.find((owner) => owner.key === "admin");
  const terms = plain(search).split(/\s+/).filter(Boolean);
  const query = terms.join(" ");
  const filtered = owners
    .filter((owner) => owner.key !== "admin")
    .filter((owner) => {
      if (department !== "todos" && owner.department !== department)
        return false;
      if (terms.length === 0) return true;
      const text = plain(
        [
          owner.name,
          owner.email,
          owner.school,
          owner.department,
          departmentName(owner.department),
          ...owner.teachers,
          ...owner.groups.map((group) => group.accessCode),
        ]
          .filter(Boolean)
          .join(" "),
      );
      return terms.every((term) => text.includes(term));
    });
  const visible = filtered.slice(0, limit);
  const openAll = Boolean(query) && filtered.length <= 3;

  const toggle = (key: string) =>
    setOpened((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="flex flex-col gap-3">
      {direct && direct.groups.length > 0 && (
        <div className="flex flex-col gap-2 pb-4">
          <h3 className="text-sm font-semibold">{direct.name}</h3>
          {(
            [
              ["P", "Primaria"],
              ["S", "Secundaria"],
            ] as const
          ).map(([level, label]) => {
            const ofLevel = direct.groups.filter((group) =>
              group.grade?.startsWith(level),
            );
            if (ofLevel.length === 0) return null;
            return (
              <div
                key={level}
                className="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2"
              >
                <span className="text-sm text-muted-foreground sm:w-24">
                  {label}
                </span>
                <div className="grid grid-cols-6 gap-1.5 sm:flex sm:flex-wrap sm:gap-2">
                  {ofLevel.map((group) => {
                    const chipClass =
                      "flex min-h-10 items-center justify-center px-1 py-1.5 text-sm transition-opacity outline-none hover:opacity-80 focus-visible:ring-2 focus-visible:ring-primary/60 sm:min-h-0 sm:min-w-14 sm:px-3";
                    const style = group.category
                      ? categorySoftStyle(group.category)
                      : undefined;
                    const text = gradeLabel(group.grade).split(" ")[0];
                    const title = `${gradeLabel(group.grade)} · ${studentCount(group)} ${studentCount(group) === 1 ? "estudiante" : "estudiantes"}`;
                    return group.pending ? (
                      <span
                        key={group.id}
                        title={title}
                        style={style}
                        className={cn(chipClass, "opacity-50")}
                      >
                        {text}
                      </span>
                    ) : (
                      <a
                        key={group.id}
                        href={`/grupos/ver?id=${group.id}&vista=estudiantes`}
                        title={title}
                        aria-label={title}
                        style={style}
                        className={chipClass}
                      >
                        {text}
                      </a>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {direct.groups.some((group) => !group.grade) && (
            <ul className="divide-y border-y">
              {direct.groups.filter((group) => !group.grade).map(renderRow)}
            </ul>
          )}
        </div>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <SearchBox
          value={search}
          onChange={(value) => {
            setSearch(value);
            setLimit(OWNERS_PAGE);
          }}
          placeholder="Buscar colegio, maestro o código"
          label="Buscar por colegio, maestro o código"
        />
        {departments.length > 1 && (
          <Select
            value={department}
            onValueChange={(value) => {
              setDepartment(value);
              setLimit(OWNERS_PAGE);
            }}
          >
            <SelectTrigger className="sm:w-56" aria-label="Departamento">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los departamentos</SelectItem>
              {departments.map((value) => (
                <SelectItem key={value} value={value}>
                  {departmentName(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      {visible.length === 0 ? (
        <p className="py-6 text-sm text-muted-foreground">
          Nada coincide con la búsqueda.
        </p>
      ) : (
        <ul className="divide-y border-y">
          {visible.map((owner) => {
            const expanded = openAll || opened.has(owner.key);
            return (
              <li key={owner.key}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => toggle(owner.key)}
                  className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-primary/60"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="font-semibold break-words">
                      <Highlight text={owner.name} terms={terms} />
                    </span>
                    {owner.key !== "admin" && (
                      <span className="text-sm text-muted-foreground">
                        <Highlight
                          text={[
                            departmentName(owner.department),
                            [...owner.teachers].join(", ") || "Sin maestro",
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                          terms={terms}
                        />
                      </span>
                    )}
                  </span>
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {owner.students}{" "}
                    {owner.students === 1 ? "estudiante" : "estudiantes"}
                  </span>
                  <ChevronDownIcon
                    className={cn(
                      "size-4 shrink-0 text-muted-foreground transition-transform duration-300",
                      expanded && "rotate-180",
                    )}
                  />
                </button>
                <Expand open={expanded}>
                  {owner.groups.length === 0 ? (
                    <p className="border-t px-3 py-3 text-sm text-muted-foreground">
                      Todavía no hay estudiantes inscritos.
                    </p>
                  ) : (
                    <ul className="divide-y border-t bg-muted/20">
                      {expanded && owner.groups.map(renderRow)}
                    </ul>
                  )}
                </Expand>
              </li>
            );
          })}
        </ul>
      )}
      {filtered.length > limit && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => setLimit((current) => current + OWNERS_PAGE)}
        >
          Mostrar más ({filtered.length - limit})
        </Button>
      )}
    </div>
  );
}
