"use client";

import { SearchIcon, XIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export function SearchBox({
  value,
  onChange,
  placeholder,
  label,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "relative flex h-9 min-w-0 flex-1 items-center sm:max-w-xs",
        className,
      )}
    >
      <SearchIcon
        aria-hidden="true"
        className="pointer-events-none absolute left-2.5 size-4 text-muted-foreground"
      />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="h-full w-full bg-muted/60 pr-8 pl-8 text-sm outline-none placeholder:text-muted-foreground focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-primary/60 [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          aria-label="Borrar búsqueda"
          onClick={() => onChange("")}
          className="absolute right-1.5 grid size-6 place-items-center text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/60"
        >
          <XIcon className="size-4" />
        </button>
      )}
    </label>
  );
}
