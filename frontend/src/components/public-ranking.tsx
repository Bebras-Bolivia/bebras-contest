"use client";

import { useEffect, useState } from "react";
import { TrophyIcon } from "lucide-react";

import { Expand } from "@/components/reveal";
import { Skeleton } from "@/components/ui/skeleton";
import { API_BASE_URL } from "@/lib/api-client";
import { rememberCount, rememberedCount } from "@/lib/remembered-count";
import { enter } from "@/lib/surface";
import { cn } from "@/lib/utils";

const SHOWN_KEY = "portada:ranking";

type RankingRow = {
  rank: number;
  name: string;
  school: string | null;
  place: string | null;
  department: string | null;
  score: number;
};

type ContestRanking = {
  id: string;
  title: string;
  categories: Array<{ name: string; rows: RankingRow[] }>;
};

const PODIUM = [
  "bg-secondary text-secondary-foreground border-foreground",
  "bg-muted text-foreground border-foreground/60",
  "bg-primary/15 text-foreground border-primary/60",
];

/** Los mejores de cada categoría en los desafíos con resultados publicados. */
export function PublicRanking() {
  const [ranking, setRanking] = useState<ContestRanking[] | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [expected] = useState(() => rememberedCount(SHOWN_KEY, 0) > 0);

  useEffect(() => {
    void fetch(`${API_BASE_URL}/api/public-ranking`)
      .then((response) =>
        response.ok
          ? (response.json() as Promise<ContestRanking[]>)
          : Promise.reject(new Error("no disponible")),
      )
      .then((data) => {
        setRanking(data);
        rememberCount(SHOWN_KEY, data.length > 0 ? 1 : 0);
      })
      .catch(() => setRanking([]));
  }, []);

  const open = ranking === null ? expected : ranking.length > 0;

  return (
    // Cerrado, el margen negativo descuenta el espacio entre secciones de la portada.
    <Expand open={open} className="-mt-16">
      {ranking && ranking.length > 0 ? (
        <RankingBoard
          ranking={ranking}
          category={category}
          onCategory={setCategory}
        />
      ) : (
        <RankingSkeleton />
      )}
    </Expand>
  );
}

function RankingSkeleton() {
  return (
    <div aria-busy className="flex flex-col gap-5">
      <span className="sr-only">Cargando ranking...</span>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-36 rounded-none" />
        <Skeleton className="h-4 w-56 rounded-none" />
      </div>
      <div className="flex gap-1.5">
        {[16, 12, 18, 14].map((width, index) => (
          <Skeleton
            key={index}
            className="h-8 rounded-none"
            style={{ width: `${width * 0.25}rem` }}
          />
        ))}
      </div>
      <div className="flex flex-col divide-y border-y">
        {[48, 40, 56, 36, 44].map((width, index) => (
          <div key={index} className="flex items-center gap-3 py-3 sm:gap-4">
            <Skeleton className="size-9 shrink-0 rounded-none" />
            <Skeleton className="size-10 shrink-0 rounded-none" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton
                className="h-4 rounded-none"
                style={{ width: `${width}%` }}
              />
              <Skeleton className="h-3.5 w-1/3 rounded-none" />
            </div>
            <Skeleton className="h-6 w-14 shrink-0 rounded-none" />
          </div>
        ))}
      </div>
    </div>
  );
}

function RankingBoard({
  ranking,
  category,
  onCategory,
}: {
  ranking: ContestRanking[];
  category: string | null;
  onCategory: (category: string) => void;
}) {
  // Normalmente hay un solo desafío con resultados: se muestra el más reciente.
  const contest = ranking[0];
  const current =
    contest.categories.find((item) => item.name === category) ??
    contest.categories[0];

  return (
    <section id="ranking" className="flex scroll-mt-6 flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 font-heading text-2xl font-semibold tracking-tight">
          <TrophyIcon className="size-6 text-primary" />
          Ranking
        </h2>
        <p className="text-sm text-muted-foreground">{contest.title}</p>
      </div>

      {contest.categories.length > 1 && (
        <div
          role="tablist"
          aria-label="Categoría"
          className="flex flex-wrap gap-1.5"
        >
          {contest.categories.map((item) => (
            <button
              key={item.name}
              type="button"
              role="tab"
              aria-selected={item.name === current.name}
              onClick={() => onCategory(item.name)}
              className="px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground aria-selected:bg-primary/10 aria-selected:font-medium aria-selected:text-foreground"
            >
              {item.name}
            </button>
          ))}
        </div>
      )}

      <ol
        key={`${contest.id}-${current.name}`}
        className="flex flex-col divide-y border-y"
      >
        {current.rows.map((row, index) => (
          <li
            key={`${row.rank}-${index}`}
            style={{ animationDelay: `${Math.min(index, 9) * 45}ms` }}
            className={cn(
              enter,
              "group/row flex items-center gap-3 py-3 transition-colors hover:bg-muted/40 sm:gap-4",
            )}
          >
            <span
              className={cn(
                "flex size-9 shrink-0 items-center justify-center border-2 font-heading font-semibold tabular-nums",
                PODIUM[row.rank - 1] ??
                  "border-transparent text-muted-foreground",
              )}
            >
              {row.rank}
            </span>
            <img
              src={`/castores/${row.department ?? "estandar"}-cabeza.webp`}
              alt=""
              title={row.place ?? undefined}
              className="h-10 w-10 shrink-0 object-contain transition-transform duration-200 group-hover/row:-translate-y-0.5 group-hover/row:-rotate-6"
            />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-medium">{row.name}</span>
              {(row.school || row.place) && (
                <span className="truncate text-sm text-muted-foreground">
                  {[row.place, row.school].filter(Boolean).join(" · ")}
                </span>
              )}
            </div>
            <span className="shrink-0 text-lg font-semibold tabular-nums">
              {row.score}
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                pts
              </span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
