"use client";

import { useRef, useState, type PointerEvent, type KeyboardEvent } from "react";
import {
  CheckIcon,
  CircleDotIcon,
  ImagePlusIcon,
  PenLineIcon,
  PlusIcon,
  Trash2Icon,
  Undo2Icon,
} from "lucide-react";
import { toast } from "sonner";
import { HotspotShapeView } from "@/components/image-hotspot-player";
import { Button } from "@/components/ui/button";
import { createContentImages } from "@/lib/task-schema";
import { cn } from "@/lib/utils";
import {
  parseHotspotConfig,
  parseHotspotKey,
  type HotspotConfig,
  type HotspotKey,
  type HotspotPoint,
  type HotspotShape,
} from "@/lib/image-hotspot";

export function ImageHotspotEditor({
  config,
  answerKey,
  onChange,
}: {
  config: HotspotConfig | null;
  answerKey: HotspotKey;
  onChange: (config: HotspotConfig, key: HotspotKey) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [selection, setSelection] = useState({ id: "", shape: 0 });
  const [drawing, setDrawing] = useState<"circle" | "polygon" | null>(null);
  const [append, setAppend] = useState(false);
  const [points, setPoints] = useState<HotspotPoint[]>([]);
  const drag = useRef<{
    id: string;
    index: number;
    point: HotspotPoint;
    shape: HotspotShape;
    vertex?: number;
    radius?: boolean;
  } | null>(null);
  const region = config?.regions.find((r) => r.id === selection.id);
  const selectedShape = region?.shapes[selection.shape];
  let error = "";
  if (config) {
    try {
      parseHotspotKey(answerKey, parseHotspotConfig(config));
    } catch (failure) {
      error = failure instanceof Error ? failure.message : "Revisa las zonas.";
    }
  }
  const position = (event: {
    clientX: number;
    clientY: number;
  }): HotspotPoint => {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix || !config) return { x: 0, y: 0 };
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      matrix.inverse(),
    );
    return {
      x: Math.max(0, Math.min(100, (p.x / config.imageWidth) * 100)),
      y: Math.max(0, Math.min(100, (p.y / config.imageHeight) * 100)),
    };
  };
  const updateShape = (id: string, index: number, shape: HotspotShape) => {
    if (config)
      onChange(
        {
          ...config,
          regions: config.regions.map((r) =>
            r.id === id
              ? {
                  ...r,
                  shapes: r.shapes.map((s, i) => (i === index ? shape : s)),
                }
              : r,
          ),
        },
        answerKey,
      );
  };
  const addShape = (shape: HotspotShape) => {
    if (!config) return;
    const id = append && region ? region.id : crypto.randomUUID();
    const index = append && region ? region.shapes.length : 0;
    const regions =
      append && region
        ? config.regions.map((r) =>
            r.id === id ? { ...r, shapes: [...r.shapes, shape] } : r,
          )
        : [
            ...config.regions,
            { id, label: `Zona ${config.regions.length + 1}`, shapes: [shape] },
          ];
    onChange({ ...config, regions }, answerKey);
    setSelection({ id, shape: index });
    setDrawing(null);
    setPoints([]);
    setAppend(false);
  };
  const finishPolygon = () => {
    if (points.length >= 3) addShape({ type: "polygon", points });
  };
  const startDrag = (
    event: PointerEvent<SVGElement>,
    id: string,
    index: number,
    shape: HotspotShape,
    vertex?: number,
    radius = false,
  ) => {
    if (drawing) return;
    event.preventDefault();
    event.stopPropagation();
    setSelection({ id, shape: index });
    drag.current = { id, index, shape, point: position(event), vertex, radius };
    svg.current?.setPointerCapture(event.pointerId);
  };
  const moveShape = (
    shape: HotspotShape,
    dx: number,
    dy: number,
    vertex?: number,
  ): HotspotShape => {
    const clamp = (v: number) => Math.max(0, Math.min(100, v));
    if (shape.type === "circle")
      return { ...shape, x: clamp(shape.x + dx), y: clamp(shape.y + dy) };
    return {
      ...shape,
      points: shape.points.map((p, i) =>
        vertex === undefined || vertex === i
          ? { x: clamp(p.x + dx), y: clamp(p.y + dy) }
          : p,
      ),
    };
  };
  const keyMove = (
    event: KeyboardEvent<SVGElement>,
    shape: HotspotShape,
    vertex?: number,
  ) => {
    const step = event.shiftKey ? 0.1 : 0.5;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    if (delta[event.key] && region) {
      event.preventDefault();
      event.stopPropagation();
      updateShape(
        region.id,
        selection.shape,
        moveShape(shape, ...delta[event.key], vertex),
      );
    }
  };
  const upload = async (files: FileList | null) => {
    try {
      const image = (await createContentImages(files))[0];
      if (!image) return;
      const loaded = new Image();
      loaded.src = image.url;
      await loaded.decode();
      onChange(
        {
          version: 1,
          image,
          imageWidth: loaded.naturalWidth,
          imageHeight: loaded.naturalHeight,
          regions: config?.regions ?? [],
        },
        answerKey,
      );
      setDrawing(null);
      setPoints([]);
    } catch {
      toast.error("No se pudo abrir esa imagen.");
    }
  };

  const fileInput = useRef<HTMLInputElement>(null);
  const pickImage = () => fileInput.current?.click();
  const accepted = (id: string) => answerKey.acceptedRegionIds.includes(id);

  return (
    <div className="flex flex-col gap-3" aria-label="Editor de zonas activas">
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          void upload(event.target.files);
          event.target.value = "";
        }}
      />
      {!config && (
        <button
          type="button"
          onClick={pickImage}
          className="flex h-40 flex-col items-center justify-center gap-2 border-2 border-dashed border-border/30 text-sm text-muted-foreground transition-colors outline-none hover:border-primary hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/60"
        >
          <ImagePlusIcon className="size-6" />
          Subir la imagen donde se marca la respuesta
        </button>
      )}
      {config && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1">
              {drawing ? (
                <>
                  {drawing === "polygon" && (
                    <Button
                      size="sm"
                      type="button"
                      disabled={points.length < 3}
                      onClick={finishPolygon}
                    >
                      <CheckIcon data-icon="inline-start" />
                      Cerrar zona
                    </Button>
                  )}
                  {points.length > 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      type="button"
                      onClick={() => setPoints(points.slice(0, -1))}
                    >
                      <Undo2Icon data-icon="inline-start" />
                      Deshacer
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    type="button"
                    onClick={() => {
                      setDrawing(null);
                      setPoints([]);
                    }}
                  >
                    Cancelar
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    type="button"
                    onClick={() => {
                      setDrawing("circle");
                      setAppend(false);
                      setPoints([]);
                    }}
                  >
                    <CircleDotIcon data-icon="inline-start" />
                    Marcar punto
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    type="button"
                    onClick={() => {
                      setDrawing("polygon");
                      setAppend(false);
                      setPoints([]);
                    }}
                  >
                    <PenLineIcon data-icon="inline-start" />
                    Dibujar zona
                  </Button>
                </>
              )}
            </div>
            {!drawing && (
              <Button
                size="sm"
                variant="ghost"
                type="button"
                className="text-muted-foreground"
                onClick={pickImage}
              >
                <ImagePlusIcon data-icon="inline-start" />
                Cambiar imagen
              </Button>
            )}
          </div>
          <p className="text-sm text-muted-foreground" role="status">
            {drawing === "circle"
              ? "Toca la imagen donde va el punto."
              : drawing === "polygon"
                ? "Toca alrededor de la zona y ciérrala tocando el primer punto."
                : config.regions.length
                  ? "Toca una zona para elegirla y arrastra sus puntos para ajustarla. La verde es la correcta."
                  : "Marca un punto o dibuja una zona sobre la imagen."}
          </p>
          <svg
            ref={svg}
            viewBox={`0 0 ${config.imageWidth} ${config.imageHeight}`}
            width={config.imageWidth}
            height={config.imageHeight}
            style={{ height: "auto", maxHeight: "min(52vh, 480px)" }}
            className="w-full touch-none"
            preserveAspectRatio="xMidYMid meet"
            role="group"
            aria-label="Dibujar zonas sobre la imagen"
            onClick={(event) => {
              if (drawing === "circle")
                addShape({ type: "circle", ...position(event), radius: 3 });
              if (drawing === "polygon") {
                const p = position(event);
                if (
                  !points.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 0.01)
                )
                  setPoints([...points, p]);
              }
            }}
            onPointerMove={(event) => {
              const d = drag.current;
              if (!d) return;
              const p = position(event);
              const shape =
                d.radius && d.shape.type === "circle"
                  ? {
                      ...d.shape,
                      radius: Math.max(
                        0.1,
                        Math.min(
                          50,
                          Math.hypot(
                            (p.x - d.shape.x) * config.imageWidth,
                            (p.y - d.shape.y) * config.imageHeight,
                          ) / Math.min(config.imageWidth, config.imageHeight),
                        ),
                      ),
                    }
                  : moveShape(
                      d.shape,
                      p.x - d.point.x,
                      p.y - d.point.y,
                      d.vertex,
                    );
              updateShape(d.id, d.index, shape);
            }}
            onPointerUp={() => {
              drag.current = null;
            }}
            onPointerCancel={() => {
              drag.current = null;
            }}
          >
            <image
              href={config.image.url}
              width={config.imageWidth}
              height={config.imageHeight}
            />
            {config.regions.map((r, index) =>
              r.shapes.map((shape, i) => (
                <g
                  key={`${r.id}:${i}`}
                  role="button"
                  tabIndex={drawing ? -1 : 0}
                  aria-label={`Zona ${index + 1}, parte ${i + 1}`}
                  aria-pressed={r.id === selection.id && i === selection.shape}
                  className={cn(
                    "cursor-move outline-none",
                    accepted(r.id) ? "text-difficulty-easy" : "text-primary",
                  )}
                  onFocus={() => setSelection({ id: r.id, shape: i })}
                  onPointerDown={(e) => startDrag(e, r.id, i, shape)}
                  onKeyDown={(e) => keyMove(e, shape)}
                >
                  <HotspotShapeView
                    shape={shape}
                    config={config}
                    fill="currentColor"
                    fillOpacity={r.id === selection.id ? 0.18 : 0.05}
                    stroke="currentColor"
                    strokeWidth={r.id === selection.id ? 3 : 1}
                    strokeDasharray={r.id === selection.id ? undefined : "5 3"}
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              )),
            )}
            {!drawing &&
              region &&
              selectedShape &&
              (selectedShape.type === "polygon"
                ? selectedShape.points
                : [
                    selectedShape,
                    {
                      x:
                        selectedShape.x +
                        (selectedShape.radius *
                          Math.min(config.imageWidth, config.imageHeight)) /
                          config.imageWidth,
                      y: selectedShape.y,
                    },
                  ]
              ).map((p, i) => (
                <circle
                  key={i}
                  cx={(p.x * config.imageWidth) / 100}
                  cy={(p.y * config.imageHeight) / 100}
                  r={Math.min(config.imageWidth, config.imageHeight) * 0.018}
                  className="fill-background stroke-primary"
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                  role="button"
                  tabIndex={0}
                  aria-label={
                    selectedShape.type === "polygon"
                      ? `Vértice ${i + 1}`
                      : i
                        ? "Ajustar radio"
                        : "Mover centro"
                  }
                  onPointerDown={(e) =>
                    startDrag(
                      e,
                      region.id,
                      selection.shape,
                      selectedShape,
                      selectedShape.type === "polygon" ? i : undefined,
                      selectedShape.type === "circle" && i === 1,
                    )
                  }
                  onKeyDown={(e) => {
                    if (
                      selectedShape.type === "circle" &&
                      i === 1 &&
                      [
                        "ArrowLeft",
                        "ArrowRight",
                        "ArrowUp",
                        "ArrowDown",
                      ].includes(e.key)
                    ) {
                      e.preventDefault();
                      updateShape(region.id, selection.shape, {
                        ...selectedShape,
                        radius: Math.max(
                          0.1,
                          selectedShape.radius +
                            (["ArrowLeft", "ArrowDown"].includes(e.key)
                              ? -0.2
                              : 0.2),
                        ),
                      });
                    } else
                      keyMove(
                        e,
                        selectedShape,
                        selectedShape.type === "polygon" ? i : undefined,
                      );
                  }}
                />
              ))}
            {drawing === "polygon" && points.length > 0 && (
              <>
                <polyline
                  points={points
                    .map(
                      (p) =>
                        `${(p.x * config.imageWidth) / 100},${(p.y * config.imageHeight) / 100}`,
                    )
                    .join(" ")}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                  pointerEvents="none"
                  className="text-primary"
                />
                {points.map((p, i) => (
                  <circle
                    key={i}
                    cx={(p.x * config.imageWidth) / 100}
                    cy={(p.y * config.imageHeight) / 100}
                    r={Math.min(config.imageWidth, config.imageHeight) * 0.018}
                    className="fill-primary"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (i === 0) finishPolygon();
                    }}
                  />
                ))}
              </>
            )}
          </svg>
          {!drawing && config.regions.length > 0 && (
            <div className="flex flex-col gap-2">
              <div
                role="group"
                aria-label="Zonas"
                className="flex flex-wrap items-center gap-1"
              >
                {config.regions.map((r, index) => (
                  <button
                    key={r.id}
                    type="button"
                    aria-pressed={r.id === region?.id}
                    onClick={() => setSelection({ id: r.id, shape: 0 })}
                    className="flex h-7 items-center gap-1.5 px-2.5 text-xs text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/60 aria-pressed:bg-primary/10 aria-pressed:font-semibold aria-pressed:text-foreground"
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "size-2.5",
                        accepted(r.id) ? "bg-difficulty-easy" : "bg-primary/60",
                      )}
                    />
                    Zona {index + 1}
                  </button>
                ))}
              </div>
              {region && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    aria-pressed={accepted(region.id)}
                    onClick={() =>
                      onChange(config, {
                        version: 1,
                        acceptedRegionIds: accepted(region.id)
                          ? answerKey.acceptedRegionIds.filter(
                              (id) => id !== region.id,
                            )
                          : [...answerKey.acceptedRegionIds, region.id],
                      })
                    }
                    className="flex h-9 items-center gap-1.5 border-2 border-border/30 px-3 text-sm transition-colors outline-none hover:border-difficulty-easy focus-visible:ring-2 focus-visible:ring-primary/60 aria-pressed:border-difficulty-easy aria-pressed:bg-difficulty-easy aria-pressed:font-semibold aria-pressed:text-difficulty-easy-foreground"
                  >
                    <CheckIcon className="size-4" />
                    Es correcta
                  </button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setAppend(true);
                      setDrawing("polygon");
                      setPoints([]);
                    }}
                  >
                    <PlusIcon data-icon="inline-start" />
                    Otra parte
                  </Button>
                  {region.shapes.length > 1 && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        onChange(
                          {
                            ...config,
                            regions: config.regions.map((r) =>
                              r.id === region.id
                                ? {
                                    ...r,
                                    shapes: r.shapes.filter(
                                      (_, i) => i !== selection.shape,
                                    ),
                                  }
                                : r,
                            ),
                          },
                          answerKey,
                        );
                        setSelection({ id: region.id, shape: 0 });
                      }}
                    >
                      Quitar esta parte
                    </Button>
                  )}
                  <button
                    type="button"
                    aria-label="Quitar zona"
                    title="Quitar zona"
                    onClick={() => {
                      onChange(
                        {
                          ...config,
                          regions: config.regions.filter(
                            (r) => r.id !== region.id,
                          ),
                        },
                        {
                          ...answerKey,
                          acceptedRegionIds: answerKey.acceptedRegionIds.filter(
                            (id) => id !== region.id,
                          ),
                        },
                      );
                      setSelection({ id: "", shape: 0 });
                    }}
                    className="grid size-8 place-items-center text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/60"
                  >
                    <Trash2Icon className="size-4" />
                  </button>
                </div>
              )}
            </div>
          )}
          {error && !drawing && (
            <p
              role="alert"
              className="text-sm font-medium text-destructive motion-safe:animate-in motion-safe:fade-in-0"
            >
              {error}
            </p>
          )}
        </>
      )}
    </div>
  );
}
