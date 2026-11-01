"use client";

import { TaskPickSkeleton } from "@/components/page-skeletons";
import { useEffect, useMemo, useState } from "react";
import {
  CheckIcon,
  ChevronLeftIcon,
  PlayCircleIcon,
  PlusIcon,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { enter } from "@/lib/surface";
import {
  CONTEST_CATEGORIES,
  fromDatetimeLocalValue,
  toDatetimeLocalValue,
} from "@/lib/contest-schema";
import {
  createPractice,
  listPracticeTasks,
  type PracticeTask,
} from "@/lib/practices-api";
import { categoryStyle } from "@/components/category-logo";
import { DifficultyTag } from "@/components/contest-task-parts";
import { DateTimeField, parseDateTimeLocal } from "@/components/datetime-field";
import { FormSection } from "@/components/form-section";
import { PracticeTaskTester } from "@/components/practice-task-tester";
import { Button } from "@/components/ui/button";

const pillClass =
  "flex h-8 items-center gap-1.5 border-2 border-border/20 px-3 text-sm text-muted-foreground transition-colors outline-none hover:border-primary/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/60 aria-pressed:font-medium aria-pressed:text-foreground";

function defaultWindow() {
  const start = new Date();
  start.setMinutes(Math.ceil(start.getMinutes() / 5) * 5, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  end.setHours(18, 0, 0, 0);
  return {
    startsAt: toDatetimeLocalValue(start.toISOString()),
    endsAt: toDatetimeLocalValue(end.toISOString()),
  };
}

export function PracticeEditor() {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [dates, setDates] = useState(defaultWindow);
  const [pool, setPool] = useState<PracticeTask[]>([]);
  const [poolLoading, setPoolLoading] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  useEffect(() => {
    if (!category) return;
    let active = true;
    void listPracticeTasks(category)
      .then((data) => {
        if (active) setPool(data.tasks);
      })
      .catch((error: unknown) => {
        if (active) setPool([]);
        toast.error(
          error instanceof Error
            ? error.message
            : "No se pudieron cargar las preguntas.",
        );
      })
      .finally(() => {
        if (active) setPoolLoading(false);
      });
    return () => {
      active = false;
    };
  }, [category]);

  const problems = useMemo(() => {
    const list: string[] = [];
    if (!title.trim()) list.push("Falta el nombre de la práctica.");
    if (!category) list.push("Falta elegir la categoría.");
    else if (picked.length === 0) list.push("Elige al menos una pregunta.");
    const start = parseDateTimeLocal(dates.startsAt);
    const end = parseDateTimeLocal(dates.endsAt);
    if (!start || !end) list.push("Faltan el inicio o el cierre.");
    else if (end <= start)
      list.push("El cierre tiene que ser después del inicio.");
    else if ((end.getTime() - start.getTime()) / 60_000 < durationMinutes)
      list.push("El horario dura menos que el tiempo de cada estudiante.");
    if (!Number.isInteger(durationMinutes) || durationMinutes <= 0)
      list.push("Faltan los minutos de cada estudiante.");
    return list;
  }, [title, category, picked, dates, durationMinutes]);

  const toggle = (taskId: string) =>
    setPicked((current) =>
      current.includes(taskId)
        ? current.filter((id) => id !== taskId)
        : [...current, taskId],
    );

  const save = async () => {
    setTried(true);
    if (problems.length > 0) return;
    setSaving(true);
    try {
      await createPractice({
        title: title.trim(),
        category,
        durationMinutes,
        startsAt: fromDatetimeLocalValue(dates.startsAt),
        endsAt: fromDatetimeLocalValue(dates.endsAt),
        tasks: picked,
      });
      toast.success(
        "Práctica creada. Tus estudiantes la ven al entrar con su código personal.",
      );
      window.location.href = "/mis-practicas";
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "No se pudo crear.",
      );
      setSaving(false);
    }
  };

  const message = tried ? (problems[0] ?? saveError) : saveError;

  const closeTester = () => {
    const taskId = testing;
    setTesting(null);
    requestAnimationFrame(() =>
      document
        .getElementById(`practice-task-${taskId}`)
        ?.scrollIntoView({ block: "center" }),
    );
  };

  if (testing) {
    return (
      <PracticeTaskTester
        tasks={pool}
        startId={testing}
        picked={picked}
        onToggle={toggle}
        onClose={closeTester}
      />
    );
  }

  return (
    <div className="flex flex-col gap-10 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-300">
      <input
        aria-label="Nombre de la práctica"
        placeholder="Nombre de la práctica"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        className="w-full border-b-2 border-border/20 bg-transparent py-2 font-heading text-2xl font-semibold transition-colors outline-none placeholder:text-muted-foreground/60 focus-visible:border-primary"
      />

      <FormSection title="Categoría">
        <div className="flex flex-wrap gap-1.5">
          {CONTEST_CATEGORIES.map((item) => {
            const selected = category === item.name;
            return (
              <button
                key={item.name}
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  if (selected) return;
                  setCategory(item.name);
                  setPicked([]);
                  setPoolLoading(true);
                }}
                style={selected ? categoryStyle(item.name) : undefined}
                className={pillClass}
              >
                {selected && <CheckIcon className="size-3.5" />}
                {item.name}
                <span className="text-xs opacity-70">{item.age}</span>
              </button>
            );
          })}
        </div>
      </FormSection>

      {category && (
        <div key={category} className={enter}>
          <FormSection
            title={`Preguntas${picked.length > 0 ? ` · ${picked.length}` : ""}`}
          >
            {poolLoading ? (
              <TaskPickSkeleton />
            ) : pool.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Todavía no hay preguntas para esta categoría.
              </p>
            ) : (
              <ul className="flex flex-col border-b">
                {pool.map((task, index) => {
                  const active = picked.includes(task.id);
                  return (
                    <li
                      key={task.id}
                      id={`practice-task-${task.id}`}
                      style={{
                        animationDelay: `${Math.min(index, 12) * 30}ms`,
                      }}
                      className={cn(
                        enter,
                        "flex items-center gap-3 border-t px-2 py-2.5 transition-colors first:border-t-0",
                        active && "bg-difficulty-easy/10",
                      )}
                    >
                      <button
                        type="button"
                        aria-pressed={active}
                        onClick={() => toggle(task.id)}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                      >
                        <span
                          className={cn(
                            "flex size-5 shrink-0 items-center justify-center border-2 transition-colors",
                            active
                              ? "border-difficulty-easy bg-difficulty-easy text-white"
                              : "border-border/30",
                          )}
                        >
                          {active ? (
                            <CheckIcon className="size-3.5" />
                          ) : (
                            <PlusIcon className="size-3.5 text-muted-foreground" />
                          )}
                        </span>
                        <span className="min-w-0 break-words">
                          {task.title}
                        </span>
                      </button>
                      <DifficultyTag difficulty={task.difficulty} />
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label={`Probar ${task.title}`}
                        onClick={() => setTesting(task.id)}
                      >
                        <PlayCircleIcon data-icon="inline-start" />
                        Probar
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </FormSection>
        </div>
      )}

      <FormSection title="Fechas">
        <div className="grid max-w-3xl min-w-0 gap-4 sm:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-1.5">
            <label
              htmlFor="practice-start"
              className="text-sm text-muted-foreground"
            >
              Inicio
            </label>
            <DateTimeField
              id="practice-start"
              label="Práctica, inicio"
              value={dates.startsAt}
              onChange={(startsAt) => setDates({ ...dates, startsAt })}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <label
              htmlFor="practice-end"
              className="text-sm text-muted-foreground"
            >
              Cierre
            </label>
            <DateTimeField
              id="practice-end"
              label="Práctica, cierre"
              value={dates.endsAt}
              fallbackHour={18}
              minDate={parseDateTimeLocal(dates.startsAt)}
              onChange={(endsAt) => setDates({ ...dates, endsAt })}
            />
          </div>
        </div>
        <label className="flex flex-wrap items-center gap-3 text-sm">
          Cada estudiante tiene
          <input
            type="number"
            min={1}
            value={durationMinutes || ""}
            onChange={(event) =>
              setDurationMinutes(Number(event.target.value || 0))
            }
            className="h-8 w-16 border-2 border-border/20 bg-transparent px-2 text-sm tabular-nums outline-none focus-visible:border-primary"
          />
          minutos.
        </label>
      </FormSection>

      <div className="sticky bottom-0 z-10 -mx-4 flex items-center justify-end gap-3 border-t bg-background px-4 py-3 sm:mx-0 sm:px-0">
        {message && (
          <p
            key={message}
            role="alert"
            className="mr-auto min-w-0 truncate text-sm font-medium text-destructive duration-300 animate-in fade-in slide-in-from-bottom-1 motion-reduce:animate-none"
          >
            {message}
          </p>
        )}
        <Button asChild variant="outline">
          <a href="/mis-practicas">
            <ChevronLeftIcon data-icon="inline-start" />
            Volver
          </a>
        </Button>
        <Button type="button" disabled={saving} onClick={() => void save()}>
          {saving ? "Creando…" : "Crear práctica"}
        </Button>
      </div>
    </div>
  );
}
