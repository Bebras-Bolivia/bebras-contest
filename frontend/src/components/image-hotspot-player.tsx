"use client";

import { useState, type SVGProps } from "react";
import { Button } from "@/components/ui/button";
import {
  physicalShape,
  type HotspotConfig,
  type HotspotShape,
} from "@/lib/image-hotspot";

export function HotspotShapeView({
  shape,
  config,
  ...props
}: {
  shape: HotspotShape;
  config: Pick<HotspotConfig, "imageWidth" | "imageHeight">;
} & SVGProps<SVGElement>) {
  const scaled = physicalShape(shape, config.imageWidth, config.imageHeight);
  return scaled.type === "circle" ? (
    <circle
      cx={scaled.x}
      cy={scaled.y}
      r={scaled.radius}
      {...(props as SVGProps<SVGCircleElement>)}
    />
  ) : (
    <polygon
      points={scaled.points.map((p) => `${p.x},${p.y}`).join(" ")}
      {...(props as SVGProps<SVGPolygonElement>)}
    />
  );
}

export function ImageHotspotPlayer({
  config,
  regionId,
  onChange,
  disabled = false,
}: {
  config: HotspotConfig;
  regionId: string | null;
  onChange: (regionId: string | null) => void;
  disabled?: boolean;
}) {
  const [focused, setFocused] = useState<string | null>(null);
  const selected = config.regions.find((r) => r.id === regionId);
  return (
    <div className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${config.imageWidth} ${config.imageHeight}`}
        width={config.imageWidth}
        height={config.imageHeight}
        className="w-full text-primary"
        style={{ height: "auto", maxHeight: "min(60vh, 520px)" }}
        role="group"
        aria-label="Imagen con zonas seleccionables"
        preserveAspectRatio="xMidYMid meet"
      >
        <image
          href={config.image.url}
          width={config.imageWidth}
          height={config.imageHeight}
        />
        {config.regions.map((region, index) => (
          <g
            key={region.id}
            role="button"
            tabIndex={disabled ? -1 : 0}
            aria-label={`Zona ${index + 1}`}
            aria-pressed={region.id === regionId}
            aria-disabled={disabled}
            className={
              disabled ? "outline-none" : "cursor-pointer outline-none"
            }
            onFocus={() => setFocused(region.id)}
            onBlur={() => setFocused(null)}
            onClick={() => {
              if (!disabled) onChange(region.id);
            }}
            onKeyDown={(event) => {
              if (!disabled && (event.key === "Enter" || event.key === " ")) {
                event.preventDefault();
                onChange(region.id);
              }
            }}
          >
            {region.shapes.map((shape, index) => (
              <HotspotShapeView
                key={index}
                config={config}
                shape={shape}
                fill="currentColor"
                fillOpacity={region.id === regionId ? 0.2 : 0}
                stroke="currentColor"
                strokeWidth={
                  region.id === regionId || focused === region.id ? 3 : 0
                }
                strokeDasharray={region.id === regionId ? "7 3" : undefined}
                vectorEffect="non-scaling-stroke"
                pointerEvents="fill"
              />
            ))}
          </g>
        ))}
      </svg>
      <div className="flex items-center justify-between gap-2">
        <p
          className="text-sm text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          {selected
            ? "Toca otra zona si quieres cambiarla."
            : "Toca una zona de la imagen. También puedes usar Tab y Enter."}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || !selected}
          onClick={() => onChange(null)}
        >
          Borrar
        </Button>
      </div>
    </div>
  );
}
