"use client";

import { useEffect, useState } from "react";
import { TrophyIcon } from "lucide-react";

import { CategoryLogo, categoryColor } from "@/components/category-logo";
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
      <div className="grid grid-cols-3 gap-1.5 sm:flex sm:flex-wrap">
        {[24, 20, 14, 22, 24, 18].map((width, index) => (
          <div
            key={index}
            className="flex flex-col items-center gap-1 px-1 py-1 sm:flex-row sm:gap-2 sm:pr-3 sm:pl-1.5"
          >
            <Skeleton className="h-7 w-8 rounded-none sm:h-8 sm:w-10" />
            <Skeleton
              className="h-3.5 rounded-none"
              style={{ width: `${width * 0.25}rem` }}
            />
          </div>
        ))}
      </div>
      <div className="mx-auto grid w-full max-w-2xl grid-cols-3 items-end gap-2 sm:gap-3">
        {[
          { castor: "h-20 sm:h-24", step: "h-14" },
          { castor: "h-28 sm:h-32", step: "h-20" },
          { castor: "h-20 sm:h-24", step: "h-10" },
        ].map((size, index) => (
          <div key={index} className="flex flex-col items-center gap-1.5">
            <Skeleton className="h-4 w-3/4 rounded-none" />
            <Skeleton className="h-3 w-2/3 rounded-none" />
            <Skeleton className="h-5 w-12 rounded-none" />
            <Skeleton className={cn("w-16 rounded-none", size.castor)} />
            <Skeleton className={cn("w-full rounded-none", size.step)} />
          </div>
        ))}
      </div>
      <div className="flex flex-col divide-y border-t">
        {[48, 40, 56, 36, 44, 52, 38].map((width, index) => (
          <div key={index} className="flex items-center gap-3 py-2.5 sm:gap-4">
            <Skeleton className="h-5 w-7 shrink-0 rounded-none" />
            <Skeleton className="size-9 shrink-0 rounded-none" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton
                className="h-4 rounded-none"
                style={{ width: `${width}%` }}
              />
              <Skeleton className="h-3.5 w-1/3 rounded-none" />
            </div>
            <Skeleton className="h-5 w-14 shrink-0 rounded-none" />
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

  const color = categoryColor(current.name);
  const podium = current.rows.slice(0, 3);
  const rest = current.rows.slice(3);

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
          className="grid grid-cols-3 gap-1.5 sm:flex sm:flex-wrap"
        >
          {contest.categories.map((item) => {
            const selected = item.name === current.name;
            const itemColor = categoryColor(item.name);
            return (
              <button
                key={item.name}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => onCategory(item.name)}
                style={
                  selected && itemColor
                    ? {
                        borderColor: itemColor,
                        backgroundColor: `color-mix(in srgb, ${itemColor} 12%, transparent)`,
                      }
                    : undefined
                }
                className={cn(
                  "flex min-w-0 flex-col items-center gap-0.5 border-2 px-1 py-1 text-xs sm:flex-row transition-colors sm:gap-2 sm:pr-3 sm:pl-1.5 sm:text-sm",
                  selected
                    ? "font-semibold text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <CategoryLogo
                  name={item.name}
                  className={cn(
                    "h-7 w-8 sm:h-8 sm:w-10",
                    !selected && "opacity-50",
                  )}
                />
                {item.name}
              </button>
            );
          })}
        </div>
      )}

      <div
        key={`${contest.id}-${current.name}`}
        className="flex flex-col gap-4"
      >
        {podium.length > 0 && (
          <div className="mx-auto grid w-full max-w-2xl grid-cols-3 items-end gap-2 sm:gap-3">
            {[podium[1], podium[0], podium[2]].map((row, slot) => {
              if (!row) return <div key={`empty-${slot}`} />;
              const first = row.rank === 1;
              return (
                <div
                  key={`${row.rank}-${slot}`}
                  className={cn(
                    enter,
                    "flex min-w-0 flex-col items-center gap-1.5 text-center",
                  )}
                  style={{ animationDelay: `${slot * 60}ms` }}
                >
                  <span
                    className={cn(
                      "line-clamp-3 leading-tight break-words",
                      first
                        ? "text-base font-semibold sm:text-lg"
                        : "text-sm font-medium",
                    )}
                  >
                    {row.name}
                  </span>
                  {(row.place || row.school) && (
                    <span className="line-clamp-2 text-xs leading-snug text-muted-foreground">
                      {[row.place, row.school].filter(Boolean).join(" · ")}
                    </span>
                  )}
                  <span
                    className={cn(
                      "font-semibold tabular-nums",
                      first ? "text-xl sm:text-2xl" : "text-base",
                    )}
                    style={first ? { color } : undefined}
                  >
                    {row.score}
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      pts
                    </span>
                  </span>
                  <img
                    src={`/castores/${row.department ?? "estandar"}.webp`}
                    alt=""
                    title={row.place ?? undefined}
                    className={cn(
                      "-mb-1.5 object-contain object-bottom",
                      first ? "h-28 sm:h-32" : "h-20 sm:h-24",
                    )}
                  />
                  <div
                    className={cn(
                      "relative -mt-1.5 flex w-full items-center justify-center font-heading font-semibold",
                      first
                        ? "h-20 text-5xl text-white sm:text-6xl"
                        : row.rank === 2
                          ? "h-14 text-3xl sm:text-4xl"
                          : "h-10 text-3xl sm:text-4xl",
                    )}
                    style={
                      first
                        ? { backgroundColor: color }
                        : {
                            color,
                            backgroundColor: color
                              ? `color-mix(in srgb, ${color} ${row.rank === 2 ? 30 : 18}%, transparent)`
                              : undefined,
                          }
                    }
                  >
                    <span
                      className={cn(
                        "relative",
                        first && "[text-shadow:0_2px_6px_rgb(0_0_0/0.3)]",
                      )}
                      style={
                        first || !color
                          ? undefined
                          : { color: `color-mix(in srgb, ${color} 75%, black)` }
                      }
                    >
                      {row.rank}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {rest.length > 0 && (
          <ol className="flex flex-col divide-y border-t">
            {rest.map((row, index) => (
              <li
                key={`${row.rank}-${index}`}
                style={{ animationDelay: `${Math.min(index, 9) * 45}ms` }}
                className={cn(
                  enter,
                  "flex items-center gap-3 py-2.5 transition-colors hover:bg-muted/40 sm:gap-4",
                )}
              >
                <span className="w-7 shrink-0 text-center font-heading font-semibold text-muted-foreground tabular-nums">
                  {row.rank}
                </span>
                <img
                  src={`/castores/${row.department ?? "estandar"}-cabeza.webp`}
                  alt=""
                  title={row.place ?? undefined}
                  className="size-9 shrink-0 object-contain"
                />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium break-words">{row.name}</span>
                  {(row.school || row.place) && (
                    <span className="line-clamp-1 text-sm text-muted-foreground">
                      {[row.place, row.school].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </div>
                <span className="shrink-0 font-semibold tabular-nums">
                  {row.score}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    pts
                  </span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
