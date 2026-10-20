import type { CSSProperties } from "react";

import { BEBRAS_CATEGORIES } from "@/lib/contest-schema";
import { cn } from "@/lib/utils";

function slugOf(name: string) {
  return BEBRAS_CATEGORIES.find((item) => item.name === name)?.slug;
}

export function categoryColor(name: string) {
  const slug = slugOf(name);
  return slug ? `var(--category-${slug})` : undefined;
}

export function categoryStyle(name: string): CSSProperties | undefined {
  const slug = slugOf(name);
  if (!slug) return undefined;
  return {
    backgroundColor: `var(--category-${slug})`,
    borderColor: `var(--category-${slug})`,
    color: `var(--category-${slug}-foreground)`,
  };
}

export function categorySoftStyle(name: string): CSSProperties | undefined {
  const slug = slugOf(name);
  if (!slug) return undefined;
  return {
    backgroundColor: `color-mix(in srgb, var(--category-${slug}) 18%, transparent)`,
  };
}

export function CategoryLogo({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const slug = slugOf(name);
  if (!slug) return null;
  return (
    <img
      src={`/categorias/${slug}.png`}
      alt=""
      aria-hidden="true"
      className={cn("shrink-0 object-contain", className)}
    />
  );
}
