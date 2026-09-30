"use client";

import { useEffect, useState } from "react";
import { ArrowUpRightIcon } from "lucide-react";

import { Expand } from "@/components/reveal";
import { Button } from "@/components/ui/button";
import { getSiteSettings } from "@/lib/admin-api";
import { enter, notice } from "@/lib/surface";
import { cn } from "@/lib/utils";

/** El enlace al sitio informativo que guarda el administrador; sin enlace no se muestra. */
export function InfoSiteBanner() {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    void getSiteSettings()
      .then(({ infoSiteUrl }) => setUrl(infoSiteUrl))
      .catch(() => undefined);
  }, []);

  return (
    <Expand open={Boolean(url)} className="-mt-16">
      {url && <Banner url={url} />}
    </Expand>
  );
}

function Banner({ url }: { url: string }) {
  return (
    <section
      className={cn(
        notice,
        enter,
        "group flex flex-col items-center gap-6 p-5 sm:flex-row sm:p-6",
      )}
    >
      <img
        src="/castores/estandar.webp"
        alt=""
        className="h-28 w-auto shrink-0 transition-transform duration-300 group-hover:-rotate-6 motion-reduce:transition-none"
      />
      <div className="flex flex-1 flex-col gap-1 text-center sm:text-left">
        <h2 className="text-lg font-semibold tracking-tight">
          ¿Quieres saber más sobre Bebras Bolivia?
        </h2>
        <p className="text-sm leading-6 text-muted-foreground">
          Qué es Bebras, quiénes lo organizan, cómo participar y las novedades
          del desafío en todo el país.
        </p>
      </div>
      <Button asChild className="shrink-0">
        <a href={url} target="_blank" rel="noreferrer">
          Visitar el sitio
          <ArrowUpRightIcon
            data-icon="inline-end"
            className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
          />
        </a>
      </Button>
    </section>
  );
}
