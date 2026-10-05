"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowLeftIcon,
  DownloadIcon,
  LoaderCircleIcon,
  PencilLineIcon,
  PrinterIcon,
} from "lucide-react";

import { TaskContentRenderer } from "@/components/task-content-renderer";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CONTEST_CATEGORIES,
  difficultyLabel,
  gradeLabel,
} from "@/lib/contest-schema";
import { formatDateTime } from "@/lib/countdown";
import {
  beaverFor,
  choiceLetter,
  clozeConfig,
  dateAtEnd,
  getPaperBundle,
  gridCellLabels,
  gridConfig,
  letter,
  markKind,
  paperPieces,
  paperTargets,
  usable,
  type MarkKind,
  type PaperBundle,
  type PaperTask,
  type PaperTeam,
} from "@/lib/paper";
import { sheetsToPdf } from "@/lib/paper-pdf";
import { cn } from "@/lib/utils";

type Part = "booklet" | "sheets";

function teamName(team: PaperTeam) {
  const one = `${team.memberOneFirstName} ${team.memberOneLastName}`.trim();
  if (team.participationMode === "pareja" && team.memberTwoFirstName) {
    return `${one} y ${team.memberTwoFirstName} ${team.memberTwoLastName ?? ""}`.trim();
  }
  return one;
}

function ageOf(category: string) {
  return CONTEST_CATEGORIES.find((item) => item.name === category)?.age ?? "";
}

function signed(value: number) {
  return value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : "0";
}

export function PaperPrint() {
  const [groupId] = useState(
    () => new URLSearchParams(window.location.search).get("id") ?? "",
  );
  const [bundle, setBundle] = useState<PaperBundle | null>(null);
  const [error, setError] = useState<string | null>(
    groupId ? null : "Falta el grupo.",
  );
  const [category, setCategory] = useState("");
  const [parts, setParts] = useState<Record<Part, boolean>>({
    booklet: true,
    sheets: true,
  });
  const [pdf, setPdf] = useState<{ done: number; total: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!groupId) return;
    let active = true;
    getPaperBundle(groupId)
      .then((loaded) => {
        if (!active) return;
        setBundle(loaded);
        const withStudents = loaded.categories.find((item) =>
          loaded.teams.some((team) => team.category === item.name),
        );
        setCategory((withStudents ?? loaded.categories[0])?.name ?? "");
      })
      .catch((caught: unknown) => {
        if (active)
          setError(
            caught instanceof Error
              ? caught.message
              : "No se pudo cargar la prueba.",
          );
      });
    return () => {
      active = false;
    };
  }, [groupId]);

  if (error) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col items-start gap-3 px-4 py-10">
        <p className="text-muted-foreground">{error}</p>
        <Button asChild variant="outline">
          <a href="/grupos">Volver a mis grupos</a>
        </Button>
      </div>
    );
  }

  if (!bundle) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-10">
        <Skeleton className="h-8 w-64 rounded-none" />
        <Skeleton className="h-4 w-96 max-w-full rounded-none" />
        <Skeleton className="mt-6 h-96 w-full rounded-none" />
      </div>
    );
  }

  const current = bundle.categories.find((item) => item.name === category);
  const tasks = current?.tasks ?? [];
  const students = bundle.teams.filter((team) => team.category === category);
  const downloadPdf = async () => {
    const sheets = [
      ...(root.current?.querySelectorAll<HTMLElement>(".pp-sheet") ?? []),
    ];
    if (sheets.length === 0 || !bundle) return;
    setPdf({ done: 0, total: sheets.length });
    try {
      const blob = await sheetsToPdf(sheets, (done, total) =>
        setPdf({ done, total }),
      );
      const contents = [
        parts.booklet && "cuadernillo",
        parts.sheets && "hojas",
      ].filter(Boolean);
      const name = `${contents.join("-y-")}-${bundle.group.name}-${category}`
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${name}.pdf`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (caught) {
      toast.error(
        caught instanceof Error ? caught.message : "No se pudo armar el PDF.",
      );
    } finally {
      setPdf(null);
    }
  };

  const sheetCount =
    (parts.sheets ? students.length : 0) +
    (parts.booklet ? tasks.length + 1 : 0);

  return (
    <div ref={root} className="pp-root">
      <style>{PRINT_CSS}</style>
      <section className="pp-toolbar mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pt-8 pb-10 sm:px-6">
        <a
          href={`/grupos/ver?id=${bundle.group.id}`}
          className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" />
          {bundle.group.name}
        </a>
        <div className="flex flex-col gap-2">
          <h1 className="font-heading text-3xl font-semibold tracking-tight">
            Imprimir la prueba
          </h1>
          <p className="text-muted-foreground">
            Para rendir sin internet. Los estudiantes leen el cuadernillo y
            marcan en su hoja de respuestas; después cargas lo que marcaron.
          </p>
        </div>

        {!bundle.canPrint ? (
          <p className="bg-secondary/20 px-4 py-3 text-sm leading-6">
            {bundle.printFrom
              ? `La prueba se puede imprimir desde el ${formatDateTime(bundle.printFrom)}, dos días antes de que empiece.`
              : "La prueba todavía no tiene fecha. Se puede imprimir dos días antes de que empiece."}
          </p>
        ) : (
          <>
            <ol className="grid gap-3 text-sm leading-6 sm:grid-cols-3">
              {[
                [
                  "Imprime un cuadernillo",
                  "y fotocópialo. Nadie escribe en él, así que se puede volver a usar.",
                ],
                [
                  "Una hoja por estudiante",
                  "con su nombre y su código. Ahí marca sus respuestas.",
                ],
                [
                  "Carga las hojas",
                  bundle.entryUntil
                    ? `desde la pantalla del grupo, hasta el ${dateAtEnd(bundle.entryUntil)}`
                    : "desde la pantalla del grupo, cuando empiece la prueba.",
                ],
              ].map(([title, text], index) => (
                <li key={title} className="flex gap-3 bg-muted/40 p-3">
                  <span className="grid size-7 shrink-0 place-items-center bg-primary text-sm font-bold text-primary-foreground">
                    {index + 1}
                  </span>
                  <span>
                    <strong className="font-semibold">{title}</strong> {text}
                  </span>
                </li>
              ))}
            </ol>

            {bundle.categories.length > 1 && (
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">Categoría</span>
                <div
                  role="radiogroup"
                  aria-label="Categoría"
                  className="flex flex-wrap gap-1.5"
                >
                  {bundle.categories.map((item) => {
                    const count = bundle.teams.filter(
                      (team) => team.category === item.name,
                    ).length;
                    return (
                      <button
                        key={item.name}
                        type="button"
                        role="radio"
                        aria-checked={item.name === category}
                        onClick={() => setCategory(item.name)}
                        className="border-2 border-border/30 px-3 py-1.5 text-sm transition-colors hover:border-primary/60 aria-checked:border-primary aria-checked:bg-primary/10 aria-checked:font-semibold"
                      >
                        {item.name}
                        <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">Qué imprimir</span>
              <div className="flex flex-col gap-2 sm:flex-row">
                {(
                  [
                    [
                      "booklet",
                      "Cuadernillo",
                      `${tasks.length + 1} páginas: portada y una pregunta por página`,
                    ],
                    [
                      "sheets",
                      "Hojas de respuestas",
                      students.length > 0
                        ? `Una por estudiante: ${students.length}`
                        : "Nadie inscrito en esta categoría",
                    ],
                  ] as const
                ).map(([key, label, detail]) => (
                  <button
                    key={key}
                    type="button"
                    role="checkbox"
                    aria-checked={parts[key]}
                    onClick={() =>
                      setParts((value) => ({ ...value, [key]: !value[key] }))
                    }
                    className="flex flex-1 items-start gap-3 border-2 border-border/30 p-3 text-left transition-colors hover:border-primary/60 aria-checked:border-primary aria-checked:bg-primary/5"
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "mt-0.5 grid size-5 shrink-0 place-items-center border-2 text-xs font-bold",
                        parts[key]
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border",
                      )}
                    >
                      {parts[key] ? "✓" : ""}
                    </span>
                    <span className="flex flex-col">
                      <span className="font-medium">{label}</span>
                      <span className="text-sm text-muted-foreground">
                        {detail}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {tasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Esta categoría todavía no tiene preguntas.
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-3 border-t pt-5">
                <Button
                  type="button"
                  size="lg"
                  disabled={sheetCount === 0 || pdf !== null}
                  onClick={() => void downloadPdf()}
                >
                  {pdf ? (
                    <LoaderCircleIcon
                      data-icon="inline-start"
                      className="animate-spin"
                    />
                  ) : (
                    <DownloadIcon data-icon="inline-start" />
                  )}
                  {pdf
                    ? `Preparando ${Math.min(pdf.done + 1, pdf.total)} de ${pdf.total}…`
                    : "Descargar PDF"}
                </Button>
                <Button
                  type="button"
                  size="lg"
                  variant="outline"
                  disabled={sheetCount === 0 || pdf !== null}
                  onClick={() => window.print()}
                >
                  <PrinterIcon data-icon="inline-start" />
                  Imprimir
                </Button>
                <span className="text-sm text-muted-foreground">
                  Tamaño carta. El PDF sirve para llevarlo a la fotocopiadora.
                </span>
              </div>
            )}
          </>
        )}
      </section>

      {bundle.canPrint && current && tasks.length > 0 && (
        <Pages>
          {parts.booklet && (
            <>
              <CoverPage bundle={bundle} category={current} />
              {tasks.map((task, index) => (
                <TaskPage
                  key={task.taskId}
                  bundle={bundle}
                  category={current.name}
                  task={task}
                  number={index + 1}
                  total={tasks.length}
                />
              ))}
            </>
          )}
          {parts.sheets && (
            <>
              {students.map((team) => (
                <AnswerSheet
                  key={team.id}
                  bundle={bundle}
                  category={current.name}
                  tasks={tasks}
                  team={team}
                />
              ))}
            </>
          )}
        </Pages>
      )}
    </div>
  );
}

/**
 * Las hojas a escala en pantalla; al imprimir, a tamaño real. Se achican con
 * `transform` y no con `zoom`: así el texto se parte en renglones igual que en
 * papel y el ajuste de cada pregunta a su hoja vale también desde un celular.
 */
function Pages({ children }: { children: React.ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ scale: 1, height: 0 });
  useLayoutEffect(() => {
    const box = outer.current;
    const content = inner.current;
    if (!box || !content) return;
    const fit = () => {
      const scale = Math.min(1, (box.clientWidth - 24) / (8.5 * 96));
      setView({ scale, height: content.offsetHeight * scale });
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(box);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={outer} className="pp-stack">
      <div className="pp-viewport" style={{ height: view.height || undefined }}>
        <div
          ref={inner}
          className="pp-scale"
          style={{ transform: `translateX(-50%) scale(${view.scale})` }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div className="pp-brand">
      <img src="/castor-logo.png" alt="" />
      <span className="pp-wordmark">
        <b>Bebras</b>
        <span>Bolivia</span>
      </span>
    </div>
  );
}

function Stripe() {
  return (
    <div className="pp-stripe" aria-hidden="true">
      <span style={{ background: "var(--pp-red)" }} />
      <span style={{ background: "var(--pp-yellow)" }} />
      <span style={{ background: "var(--pp-green)" }} />
      <span style={{ background: "var(--pp-blue)" }} />
    </div>
  );
}

function SheetFooter({
  bundle,
  children,
}: {
  bundle: PaperBundle;
  children?: React.ReactNode;
}) {
  return (
    <footer className="pp-footer">
      <span>{children}</span>
      <span>
        {bundle.contest.title} · <b>bebras.org.bo</b>
      </span>
    </footer>
  );
}

function CoverPage({
  bundle,
  category,
}: {
  bundle: PaperBundle;
  category: PaperBundle["categories"][number];
}) {
  const beaver = beaverFor(bundle.department);
  const { rules, tasks } = category;
  const penalties = rules.scoring.some((row) => row.wrong < 0);
  const kinds = new Set(tasks.map((task) => markKind(task)));
  const date = bundle.contest.startsAt ?? bundle.contest.endsAt;
  const year = date ? new Date(date).getFullYear() : null;

  return (
    <article className="pp-sheet pp-cover">
      <header className="pp-topbar">
        <Brand />
        {year && <span className="pp-eyebrow">Edición {year}</span>}
      </header>
      <Stripe />

      <div className="pp-hero">
        <div className="pp-hero-text">
          <span className="pp-eyebrow pp-green">Cuadernillo de preguntas</span>
          <h1>{bundle.contest.title}</h1>
          <div className="pp-chips">
            <span className="pp-chip pp-chip-strong">
              Categoría {category.name}
            </span>
            {ageOf(category.name) && (
              <span className="pp-chip">{ageOf(category.name)}</span>
            )}
          </div>
          <p className="pp-meta">
            <b>{tasks.length}</b> preguntas ·{" "}
            <b>{bundle.contest.durationMinutes}</b> minutos
          </p>
        </div>
        <div className="pp-hero-beaver">
          <span className="pp-sun" />
          <img src={beaver.full} alt="" />
        </div>
      </div>

      <div className="pp-note">
        <PencilLineIcon />
        <p>
          <b>No escribas en este cuadernillo.</b> Lo usará otro estudiante.
          Todas tus respuestas van en tu <b>hoja de respuestas</b>.
        </p>
      </div>

      <section className="pp-section">
        <h2>Antes de empezar</h2>
        <ol className="pp-rules">
          <li>
            <span style={{ borderColor: "var(--pp-red)" }}>1</span>
            <p>
              Tienes <b>{bundle.contest.durationMinutes} minutos</b>. Tu maestro
              te avisa cuándo empezar y cuándo terminar.
            </p>
          </li>
          <li>
            <span style={{ borderColor: "var(--pp-yellow)" }}>2</span>
            <p>
              Lee con calma. Cada pregunta está en su propia página, con su
              número.
            </p>
          </li>
          <li>
            <span style={{ borderColor: "var(--pp-green)" }}>3</span>
            <p>
              {penalties ? (
                <>
                  Si no estás seguro, <b>déjala en blanco</b>: no suma ni resta.
                </>
              ) : (
                <>Responde todas: equivocarte no te quita puntos.</>
              )}
            </p>
          </li>
          <li>
            <span style={{ borderColor: "var(--pp-blue)" }}>4</span>
            <p>
              Si cambias de idea, borra bien o tacha y escribe la nueva
              respuesta al lado, bien clara.
            </p>
          </li>
        </ol>
      </section>

      {rules.scoring.length > 0 && (
        <section className="pp-section">
          <h2>Cómo se cuentan los puntos</h2>
          <div className="pp-scoring">
            {rules.scoring.map((row) => (
              <div key={row.difficulty} className="pp-score">
                <DifficultyChip difficulty={row.difficulty} />
                <span>
                  {row.count} {row.count === 1 ? "pregunta" : "preguntas"}
                </span>
                <b className="pp-green">{signed(row.correct)} si aciertas</b>
                {row.wrong !== 0 && (
                  <b className="pp-red">{signed(row.wrong)} si fallas</b>
                )}
              </div>
            ))}
          </div>
          {penalties && (
            <p className="pp-small">
              Empiezas con {rules.initialScore} puntos, así tu puntaje nunca
              baja de cero.
            </p>
          )}
        </section>
      )}

      <section className="pp-section">
        <h2>Cómo marcar tu hoja</h2>
        <div className="pp-howto">
          {kinds.has("bubble") && (
            <div>
              <div className="pp-howto-sample">
                <Bubble label="A" />
                <Bubble label="B" filled />
                <Bubble label="C" />
              </div>
              <p>Rellena el círculo de la letra que elijas.</p>
            </div>
          )}
          {kinds.has("box") && (
            <div>
              <div className="pp-howto-sample">
                <span className="pp-slot">
                  <small>1</small>
                  <i className="pp-handwriting">B</i>
                </span>
                <span className="pp-slot">
                  <small>2</small>
                  <i className="pp-handwriting">A</i>
                </span>
              </div>
              <p>Escribe la letra en la casilla de cada número.</p>
            </div>
          )}
          {kinds.has("write") && (
            <div>
              <div className="pp-howto-sample">
                <span className="pp-writebox">
                  <i className="pp-handwriting">42</i>
                </span>
              </div>
              <p>Escribe tu respuesta dentro del recuadro.</p>
            </div>
          )}
          {kinds.has("cross") && (
            <div>
              <div className="pp-howto-sample">
                <span className="pp-crossbox">
                  <i className="pp-handwriting">✕</i>
                </span>
              </div>
              <p>Marca con una X el lugar que elijas en la imagen.</p>
            </div>
          )}
        </div>
      </section>

      <SheetFooter bundle={bundle}>
        Grupo <b>{bundle.group.name}</b>
      </SheetFooter>
    </article>
  );
}

function DifficultyChip({ difficulty }: { difficulty: string }) {
  const label = difficultyLabel(difficulty);
  if (!label) return null;
  return <span className={`pp-difficulty pp-${difficulty}`}>{label}</span>;
}

function Bubble({
  label,
  filled = false,
  square = false,
}: {
  label: string;
  filled?: boolean;
  square?: boolean;
}) {
  return (
    <span
      className={cn(
        "pp-bubble",
        filled && "pp-bubble-filled",
        square && "pp-bubble-square",
      )}
    >
      {label}
    </span>
  );
}

/** Alto útil de una hoja carta con los márgenes de impresión. */
const PAGE_INNER_PX = (11 - 0.9) * 96;
const IMAGE_MAX_IN = 3.5;
const IMAGE_MIN_IN = 1.5;

/**
 * Una pregunta va en una sola hoja: si no cabe, sus imágenes se achican de a
 * poco. Solo si ni así cabe (mucho texto), sigue en la hoja siguiente.
 */
/**
 * Cabe si la hoja no pasa del alto carta y queda un colchón antes del pie: la
 * impresora no dibuja exactamente igual que la pantalla.
 */
function fitsInPage(element: HTMLElement) {
  const style = getComputedStyle(element);
  const inner =
    element.offsetHeight -
    parseFloat(style.paddingTop) -
    parseFloat(style.paddingBottom);
  const footer = element.lastElementChild as HTMLElement | null;
  const above = footer?.previousElementSibling as HTMLElement | null;
  const slack =
    footer && above
      ? footer.offsetTop - (above.offsetTop + above.offsetHeight)
      : Infinity;
  return inner <= PAGE_INNER_PX + 1 && slack >= 28;
}

function useFitToPage() {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const fit = () => {
      for (let size = IMAGE_MAX_IN; ; size -= 0.25) {
        element.style.setProperty("--pp-img", `${size}in`);
        if (fitsInPage(element)) return;
        if (size <= IMAGE_MIN_IN) {
          // Ni con las imágenes chicas cabe: mejor que se vean bien en dos hojas.
          element.style.setProperty("--pp-img", `${IMAGE_MAX_IN}in`);
          return;
        }
      }
    };
    fit();
    // Las imágenes que terminan de cargar cambian el alto: se vuelve a probar.
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return ref;
}

function TaskPage({
  bundle,
  category,
  task,
  number,
  total,
}: {
  bundle: PaperBundle;
  category: string;
  task: PaperTask;
  number: number;
  total: number;
}) {
  const cloze = clozeConfig(task);
  const blankNumber = (id: string) =>
    (cloze?.blanks.findIndex((blank) => blank.id === id) ?? -1) + 1;
  const renderBlank = cloze
    ? (id: string) => (
        <span key={id} className="pp-blank">
          <b>{blankNumber(id) || "?"}</b>
        </span>
      )
    : undefined;
  const fit = useFitToPage();

  return (
    <article ref={fit} className="pp-sheet pp-task">
      <header className="pp-runninghead">
        <span>
          {bundle.contest.title} · Categoría {category}
        </span>
        <span>
          Pregunta {number} de {total}
        </span>
      </header>

      <div className="pp-task-title">
        <span className="pp-number">{number}</span>
        <div>
          <h2>{task.title}</h2>
          <p className="pp-task-meta">
            <DifficultyChip difficulty={task.difficulty} />
            <span>
              Correcta <b>{signed(task.maxScore)}</b>
              {task.minScore !== 0 && (
                <>
                  {" "}
                  · Incorrecta <b>{signed(task.minScore)}</b>
                </>
              )}
            </span>
          </p>
        </div>
      </div>

      <div className="pp-content">
        <TaskContentRenderer
          fixed
          blocks={task.bodyBlocks}
          renderBlank={renderBlank}
        />
        {task.challengeBlocks.length > 0 && (
          <div className="pp-challenge">
            <TaskContentRenderer
              fixed
              blocks={task.challengeBlocks}
              renderBlank={renderBlank}
            />
          </div>
        )}
      </div>

      <section className="pp-answer">
        <h3>
          <PencilLineIcon />
          Responde en tu hoja, en la pregunta {number}
        </h3>
        <BookletAnswer task={task} />
      </section>

      <SheetFooter bundle={bundle}>
        Pregunta <b>{number}</b>
      </SheetFooter>
    </article>
  );
}

/** Lo que el estudiante necesita ver para responder en papel, según el tipo. */
function BookletAnswer({ task }: { task: PaperTask }) {
  if (task.answerType === "multiple_choice") {
    const images = task.answers.some((answer) =>
      answer.blocks.some((block) => block.type === "image" && block.image),
    );
    // Opciones de texto cortas van en dos columnas: la pregunta cabe en su hoja.
    const short =
      !images &&
      task.answers.every(
        (answer) =>
          answer.blocks.reduce(
            (total, block) => total + (block.content ?? "").length,
            0,
          ) <= 60,
      );
    return (
      <>
        <div
          className={cn(
            "pp-options",
            short && "pp-options-short",
            images && "pp-options-images",
            images && task.answers.length >= 4 && "pp-options-4",
          )}
        >
          {task.answers.map((answer, index) => (
            <div key={answer.id} className="pp-option">
              <Bubble label={choiceLetter(answer.id, index)} />
              <TaskContentRenderer blocks={answer.blocks} minImageWidth="0px" />
            </div>
          ))}
        </div>
        {task.multipleChoiceMode === "all" && (
          <p className="pp-hint">Marca todas las opciones correctas.</p>
        )}
      </>
    );
  }

  if (task.answerType === "short_text") {
    return (
      <p className="pp-hint">
        Escribe tu respuesta en el recuadro de tu hoja. Que se lea bien.
      </p>
    );
  }

  if (task.answerType === "image_hotspot") {
    const image = hotspotImage(task);
    return (
      <>
        {image && (
          <div className="pp-stage-wrap">
            <img className="pp-hotspot" src={image} alt="" />
          </div>
        )}
        <p className="pp-hint">
          Elige un lugar de la imagen y márcalo con una <b>X</b> en la imagen
          pequeña de tu hoja.
        </p>
      </>
    );
  }

  if (task.answerType === "drag_drop" && task.dragDropBackground) {
    return <BookletDragDrop task={task} />;
  }

  const grid = gridConfig(task);
  if (grid) {
    const states = usable(grid.states);
    return (
      <>
        <Legend
          options={states.map((state, index) => ({
            letter: letter(index),
            label: state.label,
            image: state.image,
          }))}
        />
        <p className="pp-hint">
          En tu hoja, escribe en cada casilla la letra de lo que va ahí.
        </p>
      </>
    );
  }

  const cloze = clozeConfig(task);
  if (cloze) {
    return (
      <>
        <Legend
          options={usable(cloze.options).map((option, index) => ({
            letter: letter(index),
            label: option.label,
            image: option.image,
          }))}
        />
        <p className="pp-hint">
          En tu hoja, escribe en cada número la letra de la opción que completa
          el texto.
          {cloze.options.some((option) => option.limit === 1) &&
            " Cada opción se usa una sola vez."}
        </p>
      </>
    );
  }

  return null;
}

/**
 * El fondo del arrastre con un número en cada lugar. El ancho sale de la
 * proporción de la imagen, así al limitar su alto los números no se corren.
 */
function BookletDragDrop({ task }: { task: PaperTask }) {
  const [ratio, setRatio] = useState<number | null>(null);
  const background = task.dragDropBackground!;
  const targets = paperTargets(task);
  const pieces = paperPieces(task);
  const repeated = pieces.some((piece) => piece.itemIds.length > 1);
  const percent = Math.min(100, Math.max(45, background.widthPercent ?? 100));
  return (
    <>
      <div className="pp-stage-wrap">
        <div
          className="pp-stage"
          style={{
            width: ratio
              ? `min(${percent}%, calc(var(--pp-img, 3.4in) * ${ratio.toFixed(4)}))`
              : `${percent}%`,
          }}
        >
          <img
            src={background.url}
            alt=""
            onLoad={(event) => {
              const image = event.currentTarget;
              setRatio(image.naturalWidth / Math.max(1, image.naturalHeight));
            }}
          />
          {targets.map((target, index) => (
            <span
              key={target.id}
              className="pp-target"
              style={{ left: `${target.x}%`, top: `${target.y}%` }}
            >
              {index + 1}
            </span>
          ))}
        </div>
      </div>
      <div className="pp-pieces">
        {pieces.map((piece) => (
          <div key={piece.letter} className="pp-piece">
            <span className="pp-piece-letter">{piece.letter}</span>
            {piece.image ? (
              <img src={piece.image.url} alt={piece.label} />
            ) : (
              <span className="pp-piece-label">{piece.label || "Pieza"}</span>
            )}
            {piece.itemIds.length > 1 && (
              <span className="pp-piece-count">×{piece.itemIds.length}</span>
            )}
          </div>
        ))}
      </div>
      <p className="pp-hint">
        Escribe en tu hoja qué pieza va en cada lugar numerado. Cada pieza va en
        un solo lugar
        {repeated
          ? "; las que tienen ×2 o más se pueden usar esas veces."
          : "."}{" "}
        Los lugares que quedan vacíos se dejan en blanco.
      </p>
    </>
  );
}

function Legend({
  options,
}: {
  options: Array<{
    letter: string;
    label: string;
    image: { url: string } | null;
  }>;
}) {
  return (
    <div className="pp-legend">
      {options.map((option) => (
        <div key={option.letter} className="pp-legend-item">
          <span className="pp-piece-letter">{option.letter}</span>
          {option.image ? (
            <img src={option.image.url} alt={option.label} />
          ) : null}
          <span>{option.label}</span>
        </div>
      ))}
    </div>
  );
}

function AnswerSheet({
  bundle,
  category,
  tasks,
  team,
}: {
  bundle: PaperBundle;
  category: string;
  tasks: PaperTask[];
  team: PaperTeam;
}) {
  const beaver = beaverFor(bundle.department);
  const kinds = new Set<MarkKind>(tasks.map((task) => markKind(task)));
  const code = team.personalCode;

  return (
    <article className="pp-sheet pp-answersheet">
      <header className="pp-topbar">
        <Brand />
        <div className="pp-sheet-title">
          <span className="pp-eyebrow pp-green">Hoja de respuestas</span>
          <b>{bundle.contest.title}</b>
          <span>Categoría {category}</span>
        </div>
      </header>
      <Stripe />

      <div className="pp-student">
        <img src={beaver.head} alt="" className="pp-student-beaver" />
        <div className="pp-student-fields">
          <div className="pp-field pp-field-wide">
            <small>Nombre</small>
            <b>{teamName(team)}</b>
          </div>
          <div className="pp-field">
            <small>Curso</small>
            <b>{gradeLabel(team.grade)}</b>
          </div>
          <div className="pp-field">
            <small>Grupo</small>
            <b>{bundle.group.name}</b>
          </div>
        </div>
        <div className="pp-code">
          <small>Código personal</small>
          <div>
            {Array.from({ length: 8 }, (_, index) => (
              <span key={index}>{code[index] ?? ""}</span>
            ))}
          </div>
        </div>
      </div>

      <p className="pp-sheet-legend">
        {kinds.has("bubble") && (
          <span>
            <Bubble label="" filled /> Rellena el círculo
          </span>
        )}
        {kinds.has("box") && (
          <span>
            <span className="pp-slot pp-slot-mini">B</span> Escribe la letra
          </span>
        )}
        {kinds.has("cross") && (
          <span>
            <b>✕</b> Marca con una X
          </span>
        )}
        <span>Lo que no sepas, déjalo en blanco.</span>
      </p>

      <ol className={cn("pp-rows", tasks.length > 10 && "pp-rows-two")}>
        {tasks.map((task, index) => (
          <li
            key={task.taskId}
            className={cn("pp-row", sheetRowIsWide(task) && "pp-row-wide")}
          >
            <span className="pp-row-number">{index + 1}</span>
            <SheetAnswer task={task} />
          </li>
        ))}
      </ol>

      <SheetFooter bundle={bundle}>
        {team.memberOneFirstName} · <b className="pp-mono">{code}</b>
      </SheetFooter>
    </article>
  );
}

function hotspotImage(task: PaperTask) {
  const config = task.answerConfig as { image?: { url?: unknown } } | undefined;
  return task.answerConfig?.version === 1 &&
    typeof config?.image?.url === "string"
    ? config.image.url
    : null;
}

function sheetRowIsWide(task: PaperTask) {
  if (task.answerType === "image_hotspot") return true;
  if (task.answerType === "drag_drop") return task.dragDropTargets.length > 5;
  const grid = gridConfig(task);
  if (grid) return grid.columns > 5;
  const cloze = clozeConfig(task);
  if (cloze) return cloze.blanks.length > 5;
  return false;
}

/** El espacio de cada pregunta en la hoja de respuestas. */
function SheetAnswer({ task }: { task: PaperTask }) {
  if (task.answerType === "multiple_choice") {
    const multi = task.multipleChoiceMode === "all";
    return (
      <div className="pp-row-answer">
        {task.answers.map((answer, index) => (
          <Bubble
            key={answer.id}
            label={choiceLetter(answer.id, index)}
            square={multi}
          />
        ))}
        {multi && <small>marca todas las correctas</small>}
      </div>
    );
  }

  if (task.answerType === "short_text") {
    return (
      <div className="pp-row-answer">
        <span className="pp-writebox pp-writebox-sheet" />
      </div>
    );
  }

  if (task.answerType === "image_hotspot") {
    const image = hotspotImage(task);
    return (
      <div className="pp-row-answer">
        {image && <img className="pp-thumb" src={image} alt="" />}
        <small>Marca con una X el lugar que elegiste.</small>
      </div>
    );
  }

  if (task.answerType === "drag_drop") {
    return (
      <div className="pp-row-answer pp-slots">
        {paperTargets(task).map((target, index) => (
          <span key={target.id} className="pp-slot">
            <small>{index + 1}</small>
          </span>
        ))}
      </div>
    );
  }

  const grid = gridConfig(task);
  if (grid) {
    return (
      <div
        className="pp-row-answer pp-gridsheet"
        style={{ gridTemplateColumns: `repeat(${grid.columns}, 0.42in)` }}
      >
        {gridCellLabels(grid).map((label, index) => (
          <span key={grid.cells[index].id} className="pp-slot">
            <small>{label}</small>
          </span>
        ))}
      </div>
    );
  }

  const cloze = clozeConfig(task);
  if (cloze) {
    return (
      <div className="pp-row-answer pp-slots">
        {cloze.blanks.map((blank, index) => (
          <span key={blank.id} className="pp-slot">
            <small>{index + 1}</small>
          </span>
        ))}
      </div>
    );
  }

  return <div className="pp-row-answer" />;
}

const PRINT_CSS = `
.pp-root {
  --pp-ink: #1d1d1b;
  --pp-muted: #6b6762;
  --pp-line: #d6d3ce;
  --pp-green: #1b8f60;
  --pp-yellow: #f8ae31;
  --pp-red: #e83b3b;
  --pp-blue: #324c87;
  --pp-green-tint: #e8f4ee;
  --pp-yellow-tint: #fef3dc;
  --pp-red-tint: #fdeaea;
  --pp-blue-tint: #eaeef6;
}
.pp-stack {
  background: #ebe8e3;
  padding: 24px 12px 48px;
  overflow: hidden;
}
.pp-viewport { position: relative; }
.pp-scale {
  position: absolute;
  top: 0;
  left: 50%;
  transform-origin: top center;
  display: flex;
  flex-direction: column;
  gap: 24px;
}
.pp-sheet {
  box-sizing: border-box;
  width: 8.5in;
  min-height: 11in;
  padding: 0.5in 0.55in 0.4in;
  background: #fff;
  color: var(--pp-ink);
  box-shadow: 0 1px 2px rgba(0,0,0,.08), 0 10px 30px -12px rgba(0,0,0,.25);
  display: flex;
  flex-direction: column;
  gap: 0.17in;
  font-size: 11pt;
  line-height: 1.45;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.pp-sheet b { font-weight: 800; }
.pp-green { color: var(--pp-green); }
.pp-red { color: var(--pp-red); }
.pp-mono { font-family: var(--font-mono); letter-spacing: .08em; }
.pp-eyebrow {
  font-family: var(--font-mono);
  font-size: 8.5pt;
  font-weight: 700;
  letter-spacing: .14em;
  text-transform: uppercase;
  color: var(--pp-muted);
}
.pp-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.3in;
}
.pp-brand { display: flex; align-items: center; gap: 10px; }
.pp-brand img { height: 0.55in; width: auto; }
.pp-wordmark { display: flex; flex-direction: column; line-height: .95; }
.pp-wordmark b {
  font-size: 17pt; font-weight: 900; letter-spacing: .02em; text-transform: uppercase;
}
.pp-wordmark span {
  font-size: 9pt; font-weight: 800; letter-spacing: .32em; text-transform: uppercase;
  color: var(--pp-green);
}
.pp-stripe { display: grid; grid-template-columns: repeat(4, 1fr); height: 5px; margin-top: -0.08in; }

/* Portada */
.pp-hero {
  display: grid;
  grid-template-columns: 1fr 2.55in;
  align-items: center;
  gap: 0.2in;
  margin-top: 0.1in;
}
.pp-hero-text { display: flex; flex-direction: column; gap: 0.12in; }
.pp-hero h1 {
  margin: 0;
  font-size: 34pt;
  line-height: 1.02;
  font-weight: 900;
  letter-spacing: -0.02em;
  text-wrap: balance;
}
.pp-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.pp-chip {
  border: 2px solid var(--pp-ink);
  padding: 3px 10px;
  font-size: 10.5pt;
  font-weight: 700;
}
.pp-chip-strong {
  background: var(--pp-yellow-tint);
  box-shadow: 3px 3px 0 var(--pp-ink);
}
.pp-meta { margin: 0; font-size: 12pt; color: var(--pp-muted); }
.pp-meta b { color: var(--pp-ink); }
.pp-hero-beaver {
  position: relative;
  height: 2.75in;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.pp-sun {
  position: absolute;
  inset: 0.15in 0 0.05in;
  border-radius: 50%;
  background: var(--pp-yellow-tint);
  border: 2px dashed var(--pp-yellow);
}
.pp-hero-beaver img { position: relative; height: 100%; width: auto; object-fit: contain; }
.pp-note {
  display: flex;
  align-items: center;
  gap: 12px;
  border: 2px dashed var(--pp-ink);
  padding: 10px 14px;
}
.pp-note svg { width: 22px; height: 22px; flex-shrink: 0; color: var(--pp-red); }
.pp-note p { margin: 0; }
.pp-section { display: flex; flex-direction: column; gap: 8px; }
.pp-section h2 {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13pt;
  font-weight: 900;
}
.pp-section h2::after { content: ""; flex: 1; height: 2px; background: var(--pp-ink); }
.pp-rules {
  list-style: none; margin: 0; padding: 0;
  display: grid; grid-template-columns: 1fr 1fr; gap: 8px 22px;
}
.pp-rules li { display: flex; gap: 10px; align-items: flex-start; font-size: 10.5pt; }
.pp-rules p { margin: 0; }
.pp-rules li > span {
  flex-shrink: 0;
  display: grid; place-items: center;
  width: 24px; height: 24px;
  border: 3px solid; border-radius: 50%;
  font-weight: 900; font-size: 10pt;
}
.pp-scoring { display: flex; flex-direction: column; }
.pp-score {
  display: grid;
  grid-template-columns: 0.85in 1.2in 1.4in 1.4in;
  align-items: center;
  gap: 10px;
  padding: 5px 0;
  border-bottom: 1px solid var(--pp-line);
  font-size: 10.5pt;
}
.pp-small { margin: 0; font-size: 9.5pt; color: var(--pp-muted); }
.pp-difficulty {
  display: inline-block;
  width: fit-content;
  padding: 1px 8px;
  border: 2px solid;
  font-size: 9pt;
  font-weight: 800;
}
.pp-easy { color: var(--pp-green); background: var(--pp-green-tint); }
.pp-medium { color: #a86b00; border-color: var(--pp-yellow); background: var(--pp-yellow-tint); }
.pp-hard { color: var(--pp-red); background: var(--pp-red-tint); }
.pp-howto { display: grid; grid-template-columns: repeat(auto-fit, minmax(1.6in, 1fr)); gap: 12px; }
.pp-howto > div {
  display: flex; flex-direction: column; gap: 6px;
  background: var(--pp-blue-tint);
  padding: 10px 12px;
}
.pp-howto p { margin: 0; font-size: 9.5pt; }
.pp-howto-sample { display: flex; align-items: center; gap: 6px; min-height: 0.42in; }
.pp-handwriting {
  font-family: "Comic Sans MS", "Segoe Print", "Bradley Hand", cursive;
  font-style: normal;
  font-weight: 700;
  font-size: 14pt;
  color: var(--pp-blue);
}

/* Burbujas y casillas */
.pp-bubble {
  display: inline-grid; place-items: center;
  flex-shrink: 0;
  width: 0.3in; height: 0.3in;
  border: 2px solid var(--pp-ink);
  border-radius: 50%;
  font-size: 9.5pt; font-weight: 800;
  color: var(--pp-ink);
  background: #fff;
}
.pp-bubble-square { border-radius: 3px; }
.pp-bubble-filled { background: var(--pp-ink); color: #fff; }
.pp-slot {
  position: relative;
  display: inline-grid; place-items: center;
  width: 0.42in; height: 0.42in;
  border: 2px solid var(--pp-ink);
  background: #fff;
}
.pp-slot small {
  position: absolute; top: 1px; left: 3px; right: 2px;
  overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
  font-size: 6.5pt; font-weight: 800; line-height: 1;
  color: var(--pp-muted);
}
.pp-slot-mini { width: 0.24in; height: 0.24in; font-size: 8pt; font-weight: 800; vertical-align: middle; }
.pp-writebox {
  display: inline-grid; place-items: center;
  width: 1.4in; height: 0.42in;
  border: 2px solid var(--pp-ink);
}
.pp-writebox-sheet { width: 2.6in; }
.pp-crossbox {
  display: inline-grid; place-items: center;
  width: 0.8in; height: 0.42in;
  border: 2px solid var(--pp-ink);
  background: repeating-linear-gradient(135deg, #fff 0 6px, var(--pp-blue-tint) 6px 12px);
}

/* Páginas de preguntas */
.pp-runninghead {
  display: flex; justify-content: space-between; gap: 12px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--pp-line);
  font-size: 8.5pt; color: var(--pp-muted);
}
.pp-task-title { display: flex; align-items: flex-start; gap: 14px; }
.pp-task-title > div { flex: 1; min-width: 0; }
.pp-number {
  flex-shrink: 0;
  display: grid; place-items: center;
  width: 0.62in; height: 0.62in;
  border: 2.5px solid var(--pp-ink);
  background: var(--pp-yellow-tint);
  box-shadow: 4px 4px 0 var(--pp-ink);
  font-size: 24pt; font-weight: 900; line-height: 1;
}
.pp-task-title h2 { margin: 0; font-size: 18pt; line-height: 1.15; font-weight: 900; text-wrap: balance; }
.pp-task-meta {
  margin: 5px 0 0; display: flex; flex-wrap: wrap; align-items: center; gap: 10px;
  font-size: 9.5pt; color: var(--pp-muted);
}
.pp-task-meta b { color: var(--pp-ink); }
.pp-content { display: flex; flex-direction: column; gap: 12px; }
.pp-content > div, .pp-challenge > div { gap: 10px; }
.pp-content [class*="leading-7"] { line-height: 1.55; }
.pp-content img { max-height: var(--pp-img, 3.5in) !important; object-fit: contain; }
.pp-challenge {
  border-left: 5px solid var(--pp-green);
  background: var(--pp-green-tint);
  padding: 10px 14px;
  font-weight: 600;
}
.pp-blank {
  display: inline-block;
  min-width: 0.9in;
  margin: 0 3px;
  border-bottom: 2px solid var(--pp-ink);
  text-align: left;
  line-height: 1.2;
}
.pp-blank b {
  display: inline-grid; place-items: center;
  width: 17px; height: 17px;
  border-radius: 50%;
  background: var(--pp-ink); color: #fff;
  font-size: 8pt;
  transform: translateY(-2px);
}
.pp-answer {
  display: flex; flex-direction: column; gap: 10px;
  border-top: 2px solid var(--pp-ink);
  padding-top: 10px;
  break-inside: avoid;
}
.pp-answer h3 {
  margin: 0; display: flex; align-items: center; gap: 8px;
  font-size: 10.5pt; font-weight: 800;
}
.pp-answer h3 svg { width: 18px; height: 18px; color: var(--pp-red); }
.pp-hint { margin: 0; font-size: 10pt; color: var(--pp-muted); }
.pp-hint b { color: var(--pp-ink); }
.pp-options { display: flex; flex-direction: column; gap: 8px; }
.pp-options-short { display: grid; grid-template-columns: 1fr 1fr; }
.pp-options-images { display: grid; grid-template-columns: repeat(3, 1fr); }
.pp-hotspot { display: block; max-width: 100%; max-height: var(--pp-img, 3.5in); object-fit: contain; }
.pp-options-4 { grid-template-columns: repeat(4, 1fr); }
.pp-option {
  display: flex; align-items: center; gap: 10px;
  border: 1.5px solid var(--pp-line);
  padding: 8px 10px;
  break-inside: avoid;
}
.pp-options-images .pp-option { flex-direction: column; align-items: center; }
.pp-option > div { min-width: 0; flex: 1; gap: 6px; }
.pp-option img { max-height: min(1.3in, calc(var(--pp-img, 3.5in) * 0.4)) !important; width: auto !important; max-width: 100%; }
.pp-option > div > div { padding: 0; }
.pp-stage-wrap { display: flex; justify-content: center; }
.pp-stage { position: relative; }
.pp-stage img { display: block; width: 100%; height: auto; }
.pp-target {
  position: absolute;
  transform: translate(-50%, -50%);
  display: grid; place-items: center;
  width: 0.3in; height: 0.3in;
  border: 2.5px solid var(--pp-ink);
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 0 0 2px #fff;
  font-size: 10pt; font-weight: 900;
}
.pp-pieces, .pp-legend { display: flex; flex-wrap: wrap; gap: 8px; }
.pp-piece, .pp-legend-item {
  display: flex; align-items: center; gap: 8px;
  border: 1.5px solid var(--pp-line);
  padding: 5px 9px 5px 5px;
  font-size: 10pt;
}
.pp-piece img, .pp-legend-item img { height: 0.55in; width: auto; max-width: 1.2in; object-fit: contain; }
.pp-piece-letter {
  display: grid; place-items: center; flex-shrink: 0;
  width: 0.27in; height: 0.27in;
  background: var(--pp-ink); color: #fff;
  font-weight: 900; font-size: 10pt;
}
.pp-piece-count { font-weight: 800; color: var(--pp-muted); }
.pp-footer {
  margin-top: auto;
  display: flex; justify-content: space-between; align-items: flex-end; gap: 12px;
  padding-top: 8px;
  border-top: 1px solid var(--pp-line);
  font-size: 8.5pt; color: var(--pp-muted);
}
.pp-footer b { color: var(--pp-ink); }

/* Hoja de respuestas */
.pp-sheet-title { display: flex; flex-direction: column; align-items: flex-end; text-align: right; line-height: 1.25; }
.pp-sheet-title b { font-size: 12pt; }
.pp-sheet-title span:last-child { font-size: 9.5pt; color: var(--pp-muted); }
.pp-student {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 14px;
  border: 2.5px solid var(--pp-ink);
  box-shadow: 4px 4px 0 var(--pp-ink);
  padding: 10px 14px;
}
.pp-student-beaver { height: 0.75in; width: auto; }
.pp-student-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 16px; }
.pp-field { display: flex; flex-direction: column; min-width: 0; }
.pp-field-wide { grid-column: 1 / -1; }
.pp-field small, .pp-code small {
  font-size: 7.5pt; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--pp-muted);
}
.pp-field b { font-size: 11pt; overflow-wrap: anywhere; }
.pp-field-wide b { font-size: 14pt; }
.pp-code { display: flex; flex-direction: column; gap: 4px; }
.pp-code > div { display: flex; }
.pp-code > div span {
  display: grid; place-items: center;
  width: 0.27in; height: 0.36in;
  border: 1.5px solid var(--pp-ink);
  margin-left: -1.5px;
  font-family: var(--font-mono);
  font-size: 12pt; font-weight: 700;
}
.pp-code > div span:first-child { margin-left: 0; }
.pp-sheet-legend {
  margin: 0;
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px 18px;
  font-size: 9pt; color: var(--pp-muted);
}
.pp-sheet-legend > span { display: inline-flex; align-items: center; gap: 6px; }
.pp-sheet-legend .pp-bubble { width: 0.17in; height: 0.17in; }
.pp-rows {
  list-style: none; margin: 0; padding: 0;
  display: grid;
  grid-template-columns: 1fr;
  column-gap: 0.3in;
}
.pp-rows-two { grid-template-columns: 1fr 1fr; }
.pp-rows:not(.pp-rows-two) .pp-row { padding: 10px 0; }
.pp-row {
  display: flex; align-items: center; gap: 12px;
  padding: 7px 0;
  border-bottom: 1px solid var(--pp-line);
  break-inside: avoid;
}
.pp-row-wide { grid-column: 1 / -1; }
.pp-row-number {
  flex-shrink: 0;
  display: grid; place-items: center;
  width: 0.34in; height: 0.34in;
  background: var(--pp-yellow-tint);
  border: 2px solid var(--pp-ink);
  font-weight: 900; font-size: 11pt;
}
.pp-row-answer { flex: 1; min-width: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 7px; }
.pp-row-answer small { font-size: 8.5pt; color: var(--pp-muted); }
.pp-slots { gap: 5px; }
.pp-gridsheet { display: grid; gap: 4px; }
.pp-thumb {
  max-height: 1.9in; max-width: 4.5in; width: auto;
  border: 1.5px solid var(--pp-ink);
  filter: grayscale(.2) contrast(.92) brightness(1.06);
}

@media print {
  @page { size: letter; margin: 0.5in 0.55in 0.4in; }
  html, body { background: #fff !important; }
  header[data-site-chrome], footer[data-site-chrome], .pp-toolbar, astro-dev-toolbar { display: none !important; }
  .pp-stack { padding: 0; background: none; overflow: visible; }
  .pp-viewport { height: auto !important; }
  .pp-scale { position: static; transform: none !important; display: block; }
  .pp-sheet {
    box-shadow: none;
    width: 7.4in;
    min-height: calc(11in - 0.9in - 2px);
    padding: 0;
    break-after: page;
  }
  .pp-sheet:last-child { break-after: auto; }
}
`;
