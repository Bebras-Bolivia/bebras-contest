"use client";
import {
  StateGridEditor,
  initialGrid,
  initialCloze,
  activeCloze,
  activeKey,
} from "@/components/assignment-editor";
import {
  collectTaskBlankIds,
  parseAssignmentConfig,
  parseAssignmentKey,
  type GridConfig,
  type ClozeConfig,
  type AssignmentKey,
} from "@/lib/assignment-answers";
import { ImageHotspotEditor } from "@/components/image-hotspot-editor";
import {
  parseHotspotConfig,
  parseHotspotKey,
  type HotspotConfig,
  type HotspotKey,
} from "@/lib/image-hotspot";

import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import {
  BracketsIcon,
  CheckIcon,
  LightbulbIcon,
  Grid3x3Icon,
  ListChecksIcon,
  MousePointerClickIcon,
  MoveIcon,
  PlayIcon,
  TextCursorInputIcon,
  UploadIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { countries } from "@/lib/countries";
import { cn } from "@/lib/utils";
import {
  emptyInformaticsBlock,
  splitExplanationForEditing,
} from "@/lib/explanation";
import { difficultyStyles } from "@/lib/difficulty";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DragDropEditor } from "@/components/drag-drop-editor";
import { MultipleChoiceEditor } from "@/components/multiple-choice-editor";
import { ClozeEditor, withClozeOptions } from "@/components/cloze-editor";
import { blankRemovalImpact, nextTargetPosition } from "@/lib/authoring";
import { TaskContentBuilder } from "@/components/task-content-builder";
import { FormSection } from "@/components/form-section";
import {
  dragDropPrimaryPlacements,
  dragDropSignature,
} from "@/lib/drag-drop-grading";
import { createTask, listTasks, updateTask } from "@/lib/tasks-api";
import {
  clearTaskDraftForTest,
  readTaskDraftForTest,
  storeTaskDraftForTest,
} from "@/lib/task-draft-test";
import { categoryForAgeRange } from "@/lib/contest-schema";
import {
  ageRanges,
  answerTypeLabels,
  answerTypes,
  buildAgeSummary,
  categories,
  createContentBlock,
  createContentImages,
  DEFAULT_DRAG_DROP_ITEM_WIDTH_PERCENT,
  encodeMultipleChoiceCorrectness,
  getBlocksSummary,
  getNonEmptyBlocks,
  normalizeCategories,
  optionLabels,
  parseMultipleChoiceCorrectness,
  type AnswerType,
  type CategoryItem,
  type ContentBlock,
  type ContentBlockType,
  type DifficultyKey,
  type MultipleChoiceCorrectnessMode,
  type MultipleChoiceLayout,
  type MultipleChoiceOrderMode,
  readMultipleChoiceLayout,
  type OptionKey,
  type StoredTaskDragDropItem,
  type StoredTaskDragDropSolution,
  type StoredTaskDragDropTarget,
  type StoredTask,
} from "@/lib/task-schema";

const difficultyOptions = [
  { value: "easy", label: "Fácil" },
  { value: "medium", label: "Medio" },
  { value: "hard", label: "Difícil" },
] as const;
const minimumAnswerCount = 2;
const answerTypeIcons = {
  multiple_choice: ListChecksIcon,
  short_text: TextCursorInputIcon,
  drag_drop: MoveIcon,
  image_hotspot: MousePointerClickIcon,
  state_grid: Grid3x3Icon,
  text_cloze: BracketsIcon,
} satisfies Record<AnswerType, unknown>;
type BlocksSection = "bodyBlocks" | "challengeBlocks" | "explanationBlocks";

/** Lo que falta en la respuesta, dicho como en el resto del formulario. */
function missingAnswerPart(state: FormState) {
  if (state.answerType === "image_hotspot") {
    if (!state.hotspotConfig) return "Falta la imagen.";
    if (!state.hotspotConfig.regions.length) return "Falta marcar una zona.";
    if (!state.hotspotKey.acceptedRegionIds.length)
      return "Marca la zona correcta.";
  }
  if (state.answerType === "state_grid") {
    if (!state.gridConfig.states.length) return "Falta al menos un estado.";
    const answer = state.gridKey.acceptedAssignments[0] ?? {};
    if (state.gridConfig.cells.some((cell) => !answer[cell.id]))
      return "Falta elegir el estado de cada casilla.";
  }
  if (state.answerType === "text_cloze") {
    const { blanks, options } = activeCloze(state.clozeConfig, [
      ...state.bodyBlocks,
      ...state.challengeBlocks,
    ]);
    if (!blanks.length) return "Falta poner un hueco en la pregunta.";
    const answer = state.clozeKey.acceptedAssignments[0] ?? {};
    if (blanks.some((blank) => !answer[blank.id]))
      return "Falta la respuesta de algún hueco.";
    if (options.some((option) => !option.label.trim()))
      return "Falta el texto de alguna opción.";
  }
  return null;
}

/**
 * Año, país y un número correlativo (2024-BR-04). Si la tarea ya tiene un
 * código de ese año y país se conserva, así las del cuadernillo mantienen el
 * suyo.
 */
async function automaticSourceCode(state: FormState, taskId?: string) {
  const country = countries
    .find((entry) => entry.name === state.country)
    ?.code.toUpperCase();
  const year = state.year.trim();
  if (!country || !/^\d{4}$/.test(year)) return "";
  const prefix = `${year}-${country}-`;
  if (state.sourceTaskCode.startsWith(prefix)) return state.sourceTaskCode;
  const tasks = await listTasks().catch(() => []);
  const numbers = tasks
    .filter((task) => task.id !== taskId)
    .map((task) => task.sourceTaskCode ?? "")
    .filter((code) => code.startsWith(prefix))
    .map((code) => parseInt(code.slice(prefix.length), 10))
    .filter(Number.isFinite);
  return `${prefix}${String(Math.max(0, ...numbers) + 1).padStart(2, "0")}`;
}

type FormState = {
  title: string;
  country: string;
  year: string;
  sourceTaskCode: string;
  categories: CategoryItem[];
  selectedAgeRanges: Record<DifficultyKey, boolean>;
  difficulties: Record<DifficultyKey, string>;
  bodyBlocks: ContentBlock[];
  challengeBlocks: ContentBlock[];
  answerType: AnswerType;
  hotspotConfig: HotspotConfig | null;
  hotspotKey: HotspotKey;
  gridConfig: GridConfig;
  clozeConfig: ClozeConfig;
  gridKey: AssignmentKey;
  clozeKey: AssignmentKey;
  multipleChoiceOrderMode: MultipleChoiceOrderMode;
  multipleChoiceLayout: MultipleChoiceLayout;
  answerCount: number;
  answerOrder: OptionKey[];
  multipleChoiceContentType: "text" | "image";
  options: Record<OptionKey, ContentBlock[]>;
  multipleChoiceCorrectnessMode: MultipleChoiceCorrectnessMode;
  correctOptions: OptionKey[];
  shortAnswer: string;
  dragDropBackground: {
    id: string;
    name: string;
    url: string;
    widthPercent?: number;
  } | null;
  dragDropItems: StoredTaskDragDropItem[];
  dragDropTargets: StoredTaskDragDropTarget[];
  dragDropSolutions: StoredTaskDragDropSolution[];
  explanationBlocks: ContentBlock[];
  informaticsBlock: ContentBlock;
};

type TaskUploadFormProps = {
  initialTask?: StoredTask | null;
  onSubmitted?: (task: StoredTask) => void;
  /** Ruta a la que volver al guardar, cuando se llegó desde otra pantalla. */
  returnTo?: string | null;
};

const createInitialOptions = (): Record<OptionKey, ContentBlock[]> => ({
  A: [createContentBlock("text")],
  B: [createContentBlock("text")],
  C: [createContentBlock("text")],
  D: [createContentBlock("text")],
  E: [createContentBlock("text")],
  F: [createContentBlock("text")],
});

const createInitialState = (
  idPrefix: string = crypto.randomUUID(),
): FormState => {
  return {
    title: "",
    country: "",
    year: "",
    sourceTaskCode: "",
    categories: [],
    selectedAgeRanges: {
      "5–8": false,
      "8–10": false,
      "10–12": false,
      "12–14": false,
      "14–16": false,
      "17–18": false,
    },
    difficulties: {
      "5–8": "",
      "8–10": "",
      "10–12": "",
      "12–14": "",
      "14–16": "",
      "17–18": "",
    },
    bodyBlocks: [{ ...createContentBlock("text"), id: `${idPrefix}-body` }],
    challengeBlocks: [
      { ...createContentBlock("text"), id: `${idPrefix}-challenge` },
    ],
    answerType: "multiple_choice",
    hotspotConfig: null,
    gridConfig: initialGrid(),
    clozeConfig: initialCloze(),
    gridKey: { version: 1, acceptedAssignments: [{}] },
    clozeKey: { version: 1, acceptedAssignments: [{}] },
    hotspotKey: { version: 1, acceptedRegionIds: [] },
    multipleChoiceOrderMode: "fixed",
    multipleChoiceLayout: "vertical",
    answerCount: minimumAnswerCount,
    answerOrder: [...optionLabels],
    multipleChoiceContentType: "text",
    options: createInitialOptions(),
    multipleChoiceCorrectnessMode: "single",
    correctOptions: [],
    shortAnswer: "",
    dragDropBackground: null,
    // Un arrastre nuevo empieza vacío: el autor sube el fondo y sus piezas.
    dragDropItems: [],
    dragDropTargets: [],
    dragDropSolutions: [],
    explanationBlocks: [
      { ...createContentBlock("text"), id: `${idPrefix}-explanation` },
    ],
    informaticsBlock: emptyInformaticsBlock(idPrefix),
  };
};

function createStateFromTask(task: StoredTask): FormState {
  const explanation = splitExplanationForEditing(task.explanationBlocks ?? []);
  const nextOptions = createInitialOptions();
  const hasDragDropConfiguration =
    task.dragDropItems.length > 0 && task.dragDropTargets.length > 0;
  let multipleChoiceContentType: "text" | "image" = "text";
  const parsedCorrectness = parseMultipleChoiceCorrectness(
    task.correctAnswerId,
  );
  const inferredCorrectOptionIds = task.answers
    .filter((answer) => answer.isCorrect)
    .map((answer) => answer.id);
  const correctOptionIds =
    parsedCorrectness.correctOptionIds.length > 0
      ? parsedCorrectness.correctOptionIds
      : inferredCorrectOptionIds;

  for (const answer of task.answers) {
    nextOptions[answer.id] = answer.blocks;
    if (answer.blocks.some((block) => block.type === "image")) {
      multipleChoiceContentType = "image";
    }
  }

  return {
    title: task.title,
    country: task.country ?? "",
    year: task.year ? String(task.year) : "",
    sourceTaskCode: task.sourceTaskCode ?? "",
    categories: normalizeCategories(task.categories),
    selectedAgeRanges: {
      "5–8": Boolean(task.difficulties["5–8"]),
      "8–10": Boolean(task.difficulties["8–10"]),
      "10–12": Boolean(task.difficulties["10–12"]),
      "12–14": Boolean(task.difficulties["12–14"]),
      "14–16": Boolean(task.difficulties["14–16"]),
      "17–18": Boolean(task.difficulties["17–18"]),
    },
    difficulties: task.difficulties,
    bodyBlocks: task.bodyBlocks,
    challengeBlocks: task.challengeBlocks,
    answerType: task.answerType ?? "multiple_choice",
    gridConfig:
      task.answerType === "state_grid"
        ? (task.answerConfig as unknown as GridConfig)
        : initialGrid(),
    clozeConfig:
      task.answerType === "text_cloze"
        ? (task.answerConfig as unknown as ClozeConfig)
        : initialCloze(),
    gridKey:
      task.answerType === "state_grid"
        ? (task.answerKey as unknown as AssignmentKey)
        : { version: 1, acceptedAssignments: [{}] },
    clozeKey:
      task.answerType === "text_cloze"
        ? (task.answerKey as unknown as AssignmentKey)
        : { version: 1, acceptedAssignments: [{}] },
    hotspotConfig:
      task.answerType === "image_hotspot" && task.answerConfig?.version === 1
        ? (task.answerConfig as unknown as HotspotConfig)
        : null,
    hotspotKey:
      task.answerType === "image_hotspot" && task.answerKey?.version === 1
        ? (task.answerKey as unknown as HotspotKey)
        : { version: 1, acceptedRegionIds: [] },
    multipleChoiceOrderMode: task.multipleChoiceOrderMode ?? "fixed",
    multipleChoiceLayout: readMultipleChoiceLayout(task.answerConfig),
    answerCount:
      task.answerType === "multiple_choice"
        ? Math.max(task.answers.length, minimumAnswerCount)
        : minimumAnswerCount,
    answerOrder: [
      ...task.answers.map((answer) => answer.id),
      ...optionLabels.filter(
        (label) => !task.answers.some((answer) => answer.id === label),
      ),
    ],
    multipleChoiceContentType,
    options: nextOptions,
    multipleChoiceCorrectnessMode: parsedCorrectness.mode,
    correctOptions: correctOptionIds,
    shortAnswer: task.shortAnswer ?? "",
    dragDropBackground: task.dragDropBackground ?? null,
    dragDropItems: hasDragDropConfiguration
      ? task.dragDropItems.map((item) => ({
          ...item,
          widthPercent: Number.isFinite(item.widthPercent)
            ? item.widthPercent
            : DEFAULT_DRAG_DROP_ITEM_WIDTH_PERCENT,
        }))
      : [],
    dragDropTargets: hasDragDropConfiguration ? task.dragDropTargets : [],
    dragDropSolutions: hasDragDropConfiguration
      ? (task.dragDropSolutions ?? [])
      : [],
    explanationBlocks: explanation.solution,
    informaticsBlock: explanation.informaticsBlock,
  };
}

function validateForm(state: FormState) {
  const errors: string[] = [];
  const activeOptionLabels = state.answerOrder.slice(0, state.answerCount);
  const completedOptions = activeOptionLabels.filter(
    (label) => getNonEmptyBlocks(state.options[label]).length > 0,
  );
  const nonEmptyBodyBlocks = getNonEmptyBlocks(state.bodyBlocks);
  const nonEmptyChallengeBlocks = getNonEmptyBlocks(state.challengeBlocks);

  if (!state.title.trim()) {
    errors.push("Falta el título.");
  }

  if (state.categories.length === 0) {
    errors.push("Falta el área de contenido.");
  }

  const selectedRanges = ageRanges.filter(
    (range) => state.selectedAgeRanges[range],
  );

  if (selectedRanges.length === 0) {
    errors.push("Falta la dificultad en alguna categoría.");
  }

  if (selectedRanges.some((range) => !state.difficulties[range])) {
    errors.push("Cada rango activado debe tener una dificultad.");
  }

  if (nonEmptyBodyBlocks.length === 0) {
    errors.push("Falta el enunciado.");
  }

  if (nonEmptyChallengeBlocks.length === 0) {
    errors.push("Falta la pregunta.");
  }

  if (state.answerType === "multiple_choice") {
    if (completedOptions.length < minimumAnswerCount) {
      errors.push("Faltan al menos dos opciones.");
    }

    const activeCorrectOptions = state.correctOptions.filter((option) =>
      activeOptionLabels.includes(option),
    );
    const completedCorrectOptions = activeCorrectOptions.filter(
      (option) => getNonEmptyBlocks(state.options[option]).length > 0,
    );

    if (state.multipleChoiceCorrectnessMode === "single") {
      if (activeCorrectOptions.length !== 1) {
        errors.push("Marca la respuesta correcta.");
      }
    } else if (activeCorrectOptions.length < 2) {
      errors.push("Marca al menos dos respuestas correctas.");
    }

    if (activeCorrectOptions.length > completedCorrectOptions.length) {
      errors.push(
        "Las respuestas marcadas como correctas deben tener contenido.",
      );
    }

    const normalizedValues = completedOptions
      .map((label) => getBlocksSummary(state.options[label]))
      .filter(Boolean);
    if (new Set(normalizedValues).size !== normalizedValues.length) {
      errors.push("Las respuestas no deben repetir el mismo contenido.");
    }
  }

  if (state.answerType === "short_text" && !state.shortAnswer.trim()) {
    errors.push("Falta la respuesta correcta.");
  }

  const missingAnswer = missingAnswerPart(state);
  if (missingAnswer) {
    errors.push(missingAnswer);
  } else if (state.answerType === "image_hotspot") {
    try {
      parseHotspotKey(
        state.hotspotKey,
        parseHotspotConfig(state.hotspotConfig),
      );
    } catch (error) {
      errors.push(
        error instanceof Error
          ? error.message
          : "Revisa las zonas de la imagen.",
      );
    }
  }

  const year = state.year.trim();
  if (
    !missingAnswer &&
    (state.answerType === "state_grid" || state.answerType === "text_cloze")
  ) {
    try {
      const task = buildStoredTask(state);
      const config = parseAssignmentConfig(
        state.answerType,
        task.answerConfig,
        [...state.bodyBlocks, ...state.challengeBlocks],
      );
      parseAssignmentKey(task.answerKey, config);
    } catch (error) {
      errors.push(
        error instanceof Error
          ? error.message
          : "Completa la configuración y la respuesta correcta.",
      );
    }
  }

  if (year && !/^\d{4}$/.test(year)) {
    errors.push("El año del desafío debe tener cuatro cifras.");
  }

  if (state.answerType === "drag_drop") {
    if (!state.dragDropBackground) {
      errors.push("Falta la imagen de fondo.");
    }

    if (state.dragDropItems.length === 0) {
      errors.push("Falta al menos una pieza.");
    }

    if (state.dragDropTargets.length === 0) {
      errors.push("Arrastra cada pieza a su lugar.");
    }

    for (const item of state.dragDropItems) {
      if (!item.label.trim()) {
        errors.push("Falta el nombre de alguna pieza.");
      }

      if (!item.image) {
        errors.push("Falta la imagen de alguna pieza.");
      }

      if (
        !Number.isFinite(item.widthPercent) ||
        item.widthPercent <= 0 ||
        item.widthPercent > 100
      ) {
        errors.push(
          "El tamaño de cada pieza debe ser mayor que 0 y hasta 100.",
        );
      }
    }

    const itemIds = state.dragDropItems.map((item) => item.id);
    const targetIds = state.dragDropTargets.map((target) => target.id);
    const correctTargetIds = state.dragDropItems.map(
      (item) => item.correctTargetId,
    );
    const hasOneToOneMapping =
      state.dragDropItems.length <= state.dragDropTargets.length &&
      itemIds.every(Boolean) &&
      targetIds.every(Boolean) &&
      correctTargetIds.every(Boolean) &&
      new Set(itemIds).size === itemIds.length &&
      new Set(targetIds).size === targetIds.length &&
      new Set(correctTargetIds).size === correctTargetIds.length &&
      correctTargetIds.every((targetId) => targetIds.includes(targetId));

    if (!hasOneToOneMapping) {
      errors.push("Cada pieza debe ir a un solo lugar.");
    }

    if (
      state.dragDropTargets.some(
        (target) =>
          !Number.isFinite(target.x) ||
          target.x < 0 ||
          target.x > 100 ||
          !Number.isFinite(target.y) ||
          target.y < 0 ||
          target.y > 100,
      )
    ) {
      errors.push("Hay un lugar fuera de la imagen.");
    }

    if (
      state.dragDropTargets.some(
        (target) =>
          !Number.isFinite(target.snapRadius) ||
          target.snapRadius <= 0 ||
          target.snapRadius > 100,
      )
    ) {
      errors.push("Hay un lugar con un tamaño no válido.");
    }

    // Las alternativas reparten los mismos objetos entre los mismos destinos.
    // Dos que solo intercambian piezas idénticas son la misma respuesta.
    const signatures = new Set<string>();
    const primary = dragDropSignature(
      state.dragDropItems,
      dragDropPrimaryPlacements(state.dragDropItems),
    );

    if (primary) {
      signatures.add(primary);
    }

    for (const solution of state.dragDropSolutions) {
      const usedTargets = new Set<string>();
      let valid = true;

      for (const item of state.dragDropItems) {
        const targetId = solution.placements[item.id];

        if (
          !targetId ||
          !targetIds.includes(targetId) ||
          usedTargets.has(targetId)
        ) {
          valid = false;
          break;
        }

        usedTargets.add(targetId);
      }

      if (!valid) {
        errors.push(
          "Cada otra respuesta correcta debe poner todas las piezas, cada una en un lugar distinto.",
        );
        break;
      }

      const signature = dragDropSignature(
        state.dragDropItems,
        solution.placements,
      );

      if (!signature || signatures.has(signature)) {
        errors.push("Hay otra respuesta correcta repetida.");
        break;
      }

      signatures.add(signature);
    }
  }

  if (!getNonEmptyBlocks(state.explanationBlocks).length) {
    errors.push("Falta la explicación.");
  }

  return errors;
}

function buildStoredTask(
  state: FormState,
  existingTaskId?: string,
): StoredTask {
  const activeOptionLabels = state.answerOrder.slice(0, state.answerCount);
  const activeCorrectOptions = state.correctOptions.filter((option) =>
    activeOptionLabels.includes(option),
  );

  return {
    id: existingTaskId ?? crypto.randomUUID(),
    title: state.title.trim(),
    country: state.country || null,
    year: state.year.trim() ? Number(state.year) : null,
    sourceTaskCode: state.sourceTaskCode.trim() || null,
    categories: state.categories,
    difficulties: ageRanges.reduce<Record<DifficultyKey, string>>(
      (acc, range) => {
        acc[range] = state.selectedAgeRanges[range]
          ? state.difficulties[range]
          : "";
        return acc;
      },
      {
        "5–8": "",
        "8–10": "",
        "10–12": "",
        "12–14": "",
        "14–16": "",
        "17–18": "",
      },
    ),
    bodyBlocks: state.bodyBlocks,
    challengeBlocks: state.challengeBlocks,
    answerType: state.answerType,
    answerConfig:
      state.answerType === "state_grid"
        ? state.gridConfig
        : state.answerType === "text_cloze"
          ? activeCloze(state.clozeConfig, [
              ...state.bodyBlocks,
              ...state.challengeBlocks,
            ])
          : state.answerType === "image_hotspot"
            ? (state.hotspotConfig ?? {})
            : state.answerType === "multiple_choice"
              ? { multipleChoiceLayout: state.multipleChoiceLayout }
              : {},
    answerKey:
      state.answerType === "state_grid"
        ? activeKey(
            state.gridKey,
            state.gridConfig.cells.map((cell) => cell.id),
          )
        : state.answerType === "text_cloze"
          ? activeKey(
              state.clozeKey,
              activeCloze(state.clozeConfig, [
                ...state.bodyBlocks,
                ...state.challengeBlocks,
              ]).blanks.map((blank) => blank.id),
            )
          : state.answerType === "image_hotspot"
            ? state.hotspotKey
            : {},
    multipleChoiceOrderMode:
      state.answerType === "multiple_choice"
        ? state.multipleChoiceOrderMode
        : "fixed",
    answers:
      state.answerType === "multiple_choice"
        ? activeOptionLabels.map((label) => ({
            id: label,
            blocks: state.options[label],
            isCorrect: activeCorrectOptions.includes(label),
          }))
        : [],
    correctAnswerId:
      state.answerType === "multiple_choice"
        ? encodeMultipleChoiceCorrectness(
            state.multipleChoiceCorrectnessMode,
            activeCorrectOptions,
          )
        : "",
    shortAnswer:
      state.answerType === "short_text" ? state.shortAnswer.trim() : "",
    dragDropBackground:
      state.answerType === "drag_drop" ? state.dragDropBackground : null,
    dragDropItems:
      state.answerType === "drag_drop"
        ? state.dragDropItems.map((item) => ({
            ...item,
            label: item.label.trim(),
            widthPercent: item.widthPercent,
          }))
        : [],
    dragDropTargets:
      state.answerType === "drag_drop" ? state.dragDropTargets : [],
    dragDropSolutions:
      state.answerType === "drag_drop" ? state.dragDropSolutions : [],
    explanationBlocks: getNonEmptyBlocks([state.informaticsBlock]).length
      ? [...state.explanationBlocks, state.informaticsBlock]
      : state.explanationBlocks,
    updatedAt: new Date().toISOString(),
  };
}

export function TaskUploadForm({
  initialTask = null,
  onSubmitted,
  returnTo = null,
}: TaskUploadFormProps) {
  const initialId = useId();
  const [form, setForm] = useState<FormState>(() =>
    initialTask
      ? createStateFromTask(initialTask)
      : createInitialState(initialId),
  );
  const [errors, setErrors] = useState<string[]>([]);
  // Ya no cambia en vivo: al guardar se sale de la pantalla.
  const loadedTask = initialTask;

  // Desde el probador, cada categoría enlaza a su fila de dificultad: se baja
  // hasta ella, se resalta un momento y queda enfocado su selector.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id.startsWith("dificultad-")) return;
    const row = document.getElementById(id);
    if (!row) return;
    row.scrollIntoView({ block: "center", behavior: "smooth" });
    const settle = window.setTimeout(
      () => row.scrollIntoView({ block: "center", behavior: "smooth" }),
      700,
    );
    const control =
      row.querySelector<HTMLElement>("button[aria-checked=true]") ??
      row.querySelector<HTMLElement>("button[role=radio]");
    control?.focus({ preventScroll: true });
    row.animate?.(
      [
        {
          backgroundColor:
            "color-mix(in srgb, var(--primary) 18%, transparent)",
        },
        { backgroundColor: "transparent" },
      ],
      { duration: 1600, easing: "ease-out" },
    );
    return () => window.clearTimeout(settle);
  }, []);
  const blankNumbers = useMemo(
    () =>
      Object.fromEntries(
        collectTaskBlankIds([...form.bodyBlocks, ...form.challengeBlocks]).map(
          (id, index) => [id, index + 1],
        ),
      ),
    [form.bodyBlocks, form.challengeBlocks],
  );
  const createBlankFromText = (blankId: string, text: string) =>
    setForm((current) => {
      const config = current.clozeConfig;
      const solutions = current.clozeKey.acceptedAssignments;
      const used = new Set(solutions.flatMap((map) => Object.values(map)));
      const kept = config.options.filter(
        (option) => used.has(option.id) || !/^Opción \d+$/.test(option.label),
      );
      const existing = kept.find(
        (option) => option.label.trim().toLowerCase() === text.toLowerCase(),
      );
      const option = existing ?? {
        id: crypto.randomUUID(),
        label: text,
        image: null,
        limit: 1,
      };
      const options = existing ? kept : [...kept, option];
      return {
        ...current,
        clozeConfig: withClozeOptions(config, options),
        clozeKey: {
          ...current.clozeKey,
          acceptedAssignments: [
            { ...(solutions[0] ?? {}), [blankId]: option.id },
            ...solutions.slice(1),
          ],
        },
      };
    });
  const blankRemovalDescription = (ids: string[]) => {
    const impact = blankRemovalImpact(ids, form.clozeKey.acceptedAssignments);
    return impact.length
      ? `Se quitarán ${ids.length} huecos del texto y sus respuestas de las soluciones ${impact.join(", ")}.`
      : null;
  };

  // Volver del probador no debe costar los cambios: si el probador marca que
  // trae un borrador de esta misma tarea, se recupera tal cual quedó.
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).get("borrador")) {
      return;
    }

    const stored = readTaskDraftForTest();

    if (!stored || stored.taskId !== (loadedTask?.id ?? null)) {
      return;
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect -- Restaurar el borrador del navegador después de la hidratación.
    setForm(createStateFromTask(stored.task as StoredTask));
  }, [loadedTask]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const nextErrors = validateForm(form);
    setErrors(nextErrors);

    if (nextErrors.length > 0) {
      return;
    }

    const sourceTaskCode = await automaticSourceCode(form, loadedTask?.id);
    const draft = buildStoredTask({ ...form, sourceTaskCode }, loadedTask?.id);
    const task = loadedTask ? await updateTask(draft) : await createTask(draft);
    clearTaskDraftForTest();

    onSubmitted?.(task);
    toast.success(
      loadedTask
        ? "La tarea se actualizó correctamente."
        : "La tarea se guardó correctamente.",
      { description: `${task.title} · ${buildAgeSummary(task.difficulties)}` },
    );

    // Guardar cierra el trabajo: se vuelve de donde se vino, y si se entró
    // directo, al banco de tareas.
    window.location.assign(returnTo ?? "/tareas");
  };

  // El probador vive en otra página: el borrador va por sessionStorage para
  // que se pruebe lo que hay en pantalla y no la última versión guardada.
  const handleTestDraft = () => {
    const draft = {
      taskId: loadedTask?.id ?? null,
      task: buildStoredTask(form, loadedTask?.id),
    };

    if (!storeTaskDraftForTest(draft)) {
      toast.error(
        "No se pudo llevar el borrador al probador. Guarda los cambios y vuelve a intentarlo.",
      );
      return;
    }

    window.location.assign(
      `/tareas/probador?borrador=1&volver=${encodeURIComponent(
        window.location.pathname + window.location.search,
      )}`,
    );
  };

  const updateSectionBlocks = (
    section: BlocksSection,
    blockId: string,
    updater: (block: ContentBlock) => ContentBlock,
  ) => {
    setForm((current) => ({
      ...current,
      [section]: current[section].map((block) =>
        block.id === blockId ? updater(block) : block,
      ),
    }));
  };

  const addSectionBlock = (
    section: BlocksSection,
    type: ContentBlockType = "text",
  ) => {
    const newBlock = createContentBlock(type);

    setForm((current) => ({
      ...current,
      [section]: [...current[section], newBlock],
    }));

    return newBlock.id;
  };

  const removeSectionBlock = (section: BlocksSection, blockId: string) => {
    setForm((current) => {
      const nextBlocks = current[section].filter((item) => item.id !== blockId);

      return {
        ...current,
        [section]:
          nextBlocks.length > 0 ? nextBlocks : [createContentBlock("text")],
      };
    });
  };

  /**
   * Llevar un bloque de una sección a la otra. La de origen nunca se queda sin
   * bloques: el formulario espera al menos uno en cada una.
   */
  const moveBlockToSection = (
    fromSection: BlocksSection,
    blockId: string,
    toSection: BlocksSection,
    toBlockId: string,
    position: "before" | "after",
  ) => {
    if (fromSection === toSection) {
      return;
    }

    setForm((current) => {
      const moved = current[fromSection].find((item) => item.id === blockId);

      if (!moved) {
        return current;
      }

      const remaining = current[fromSection].filter(
        (item) => item.id !== blockId,
      );
      const target = [...current[toSection]];
      const toIndex = target.findIndex((item) => item.id === toBlockId);
      const insertAt =
        toIndex === -1
          ? target.length
          : position === "before"
            ? toIndex
            : toIndex + 1;

      target.splice(insertAt, 0, moved);

      return {
        ...current,
        [fromSection]:
          remaining.length > 0 ? remaining : [createContentBlock("text")],
        [toSection]: target,
      };
    });
  };

  const moveSectionBlock = (
    section: BlocksSection,
    fromBlockId: string,
    toBlockId: string,
    position: "before" | "after",
  ) => {
    setForm((current) => {
      const destination: BlocksSection =
        section === "explanationBlocks" ||
        current[section].some((block) => block.id === toBlockId)
          ? section
          : section === "bodyBlocks"
            ? "challengeBlocks"
            : "bodyBlocks";
      if (destination !== section) {
        const block = current[section].find((item) => item.id === fromBlockId);
        const targetIndex = current[destination].findIndex(
          (item) => item.id === toBlockId,
        );
        if (!block || targetIndex === -1) return current;
        const remaining = current[section].filter(
          (item) => item.id !== fromBlockId,
        );
        const nextBlocks = [...current[destination]];
        nextBlocks.splice(
          targetIndex + (position === "after" ? 1 : 0),
          0,
          block,
        );
        return {
          ...current,
          [section]: remaining.length
            ? remaining
            : [createContentBlock("text")],
          [destination]: nextBlocks,
        };
      }
      const blocks = [...current[section]];
      const fromIndex = blocks.findIndex((block) => block.id === fromBlockId);
      const toIndex = blocks.findIndex((block) => block.id === toBlockId);

      if (fromIndex === -1 || toIndex === -1) {
        return current;
      }

      const [movedBlock] = blocks.splice(fromIndex, 1);
      const adjustedToIndex = fromIndex < toIndex ? toIndex - 1 : toIndex;
      const insertIndex =
        position === "before" ? adjustedToIndex : adjustedToIndex + 1;

      blocks.splice(insertIndex, 0, movedBlock);

      return {
        ...current,
        [section]: blocks,
      };
    });
  };

  const updateSectionBlockImage = async (
    section: BlocksSection,
    blockId: string,
    files: FileList | null,
  ) => {
    const nextImage = (await createContentImages(files))[0] ?? null;

    updateSectionBlocks(section, blockId, (block) => ({
      ...block,
      image: nextImage,
      widthPercent: block.widthPercent || 100,
    }));
  };

  const updateSectionBlockWidth = (
    section: BlocksSection,
    blockId: string,
    widthPercent: number,
  ) => {
    updateSectionBlocks(section, blockId, (block) => ({
      ...block,
      widthPercent,
    }));
  };

  const updateDragDropBackground = async (files: FileList | null) => {
    const nextImage = (await createContentImages(files))[0] ?? null;

    setForm((current) => ({
      ...current,
      // Cambiar la imagen conserva el tamaño elegido.
      dragDropBackground: nextImage && {
        ...nextImage,
        ...(current.dragDropBackground?.widthPercent
          ? { widthPercent: current.dragDropBackground.widthPercent }
          : {}),
      },
    }));
  };

  const updateDragDropItemImage = async (
    itemId: string,
    files: FileList | null,
  ) => {
    const nextImage = (await createContentImages(files))[0] ?? null;

    setForm((current) => ({
      ...current,
      dragDropItems: current.dragDropItems.map((item) =>
        item.id === itemId ? { ...item, image: nextImage } : item,
      ),
    }));
  };

  const updateDragDropItem = (
    itemId: string,
    patch: Partial<
      Pick<StoredTaskDragDropItem, "label" | "widthPercent" | "equivalenceKey">
    >,
  ) => {
    setForm((current) => ({
      ...current,
      dragDropItems: current.dragDropItems.map((item) =>
        item.id === itemId ? { ...item, ...patch } : item,
      ),
    }));
  };

  const updateDragDropTarget = (
    targetId: string,
    patch: Partial<Pick<StoredTaskDragDropTarget, "x" | "y" | "snapRadius">>,
  ) => {
    setForm((current) => ({
      ...current,
      dragDropTargets: current.dragDropTargets.map((target) =>
        target.id === targetId ? { ...target, ...patch } : target,
      ),
    }));
  };

  return (
    <form className="flex flex-col gap-10" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-1">
        <input
          id="title"
          aria-label="Título de la tarea"
          aria-invalid={!form.title.trim() && errors.length > 0}
          placeholder="Título de la tarea"
          value={form.title}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              title: event.target.value,
            }))
          }
          className="w-full border-b-2 border-border/20 bg-transparent py-2 font-heading text-2xl font-semibold outline-none transition-colors placeholder:text-muted-foreground/60 focus-visible:border-primary aria-invalid:border-destructive/60"
        />
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-base font-semibold">
          ¿Cómo responde el estudiante?
        </h2>
        <div
          role="radiogroup"
          aria-label="Tipo de respuesta"
          className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap"
        >
          {answerTypes.map((type) => {
            const Icon = answerTypeIcons[type];
            const selected = form.answerType === type;
            return (
              <button
                key={type}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() =>
                  setForm((current) => ({
                    ...current,
                    answerType: type,
                    answerCount:
                      type === "multiple_choice"
                        ? Math.max(current.answerCount, minimumAnswerCount)
                        : current.answerCount,
                  }))
                }
                className={cn(
                  "flex min-h-9 items-center gap-2 border-2 px-3 py-1.5 text-left text-sm leading-tight transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
                  selected
                    ? "border-primary bg-primary/5 font-semibold text-foreground"
                    : "border-border/30 text-muted-foreground hover:border-primary/60 hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" />
                {answerTypeLabels[type]}
              </button>
            );
          })}
        </div>
      </section>

      <FormSection title="Enunciado">
        <TaskContentBuilder
          allowedBlockTypes={["text", "image"]}
          blocks={form.bodyBlocks}
          allowBlanks={form.answerType === "text_cloze"}
          onBlankFromText={createBlankFromText}
          blankNumbers={blankNumbers}
          blankRemovalDescription={blankRemovalDescription}
          allowCrossSectionDrag
          sectionId="bodyBlocks"
          onMoveBlockToSection={(blockId, toSectionId, toBlockId, position) =>
            moveBlockToSection(
              "bodyBlocks",
              blockId,
              toSectionId as BlocksSection,
              toBlockId,
              position,
            )
          }
          onAddBlock={(type) => addSectionBlock("bodyBlocks", type)}
          onRemoveBlock={(blockId) => removeSectionBlock("bodyBlocks", blockId)}
          onMoveBlock={(fromBlockId, toBlockId, position) =>
            moveSectionBlock("bodyBlocks", fromBlockId, toBlockId, position)
          }
          onUpdateBlockContent={(blockId, content, richText) =>
            updateSectionBlocks("bodyBlocks", blockId, (current) => ({
              ...current,
              content,
              richText,
            }))
          }
          onUpdateBlockImage={(blockId, files) => {
            void updateSectionBlockImage("bodyBlocks", blockId, files);
          }}
          onUpdateBlockWidth={(blockId, widthPercent) =>
            updateSectionBlockWidth("bodyBlocks", blockId, widthPercent)
          }
          showChallengeErrors={false}
          textPlaceholder="Cuenta la situación de la tarea."
        />
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-muted-foreground">
            Pregunta
          </h3>
          <TaskContentBuilder
            allowedBlockTypes={["text", "image"]}
            blocks={form.challengeBlocks}
            allowBlanks={form.answerType === "text_cloze"}
            onBlankFromText={createBlankFromText}
            blankNumbers={blankNumbers}
            blankRemovalDescription={blankRemovalDescription}
            allowCrossSectionDrag
            sectionId="challengeBlocks"
            onMoveBlockToSection={(blockId, toSectionId, toBlockId, position) =>
              moveBlockToSection(
                "challengeBlocks",
                blockId,
                toSectionId as BlocksSection,
                toBlockId,
                position,
              )
            }
            onAddBlock={(type) =>
              addSectionBlock("challengeBlocks", type ?? "text")
            }
            onRemoveBlock={(blockId) =>
              removeSectionBlock("challengeBlocks", blockId)
            }
            onMoveBlock={(fromBlockId, toBlockId, position) =>
              moveSectionBlock(
                "challengeBlocks",
                fromBlockId,
                toBlockId,
                position,
              )
            }
            onUpdateBlockContent={(blockId, content, richText) =>
              updateSectionBlocks("challengeBlocks", blockId, (current) => ({
                ...current,
                content,
                richText,
              }))
            }
            onUpdateBlockImage={(blockId, files) => {
              void updateSectionBlockImage("challengeBlocks", blockId, files);
            }}
            onUpdateBlockWidth={(blockId, widthPercent) =>
              updateSectionBlockWidth("challengeBlocks", blockId, widthPercent)
            }
            showChallengeErrors={false}
            textPlaceholder={
              form.answerType === "text_cloze"
                ? "Escribe la frase completa. Luego selecciona las palabras que serán el hueco y toca «Hueco»."
                : "Escribe la pregunta."
            }
          />
        </div>
      </FormSection>

      <FormSection title="Respuesta">
        <FieldGroup className="gap-4">
          {form.answerType === "state_grid" && (
            <StateGridEditor
              config={form.gridConfig}
              answerKey={form.gridKey}
              onChange={(config, key) =>
                setForm((current) => ({
                  ...current,
                  gridConfig: config,
                  gridKey: key,
                }))
              }
            />
          )}
          {form.answerType === "text_cloze" && (
            <ClozeEditor
              config={form.clozeConfig}
              answerKey={form.clozeKey}
              blocks={[...form.bodyBlocks, ...form.challengeBlocks]}
              onChange={(config, key) =>
                setForm((current) => ({
                  ...current,
                  clozeConfig: config,
                  clozeKey: key,
                }))
              }
            />
          )}
          {form.answerType === "multiple_choice" && (
            <MultipleChoiceEditor
              state={form}
              showErrors={errors.length > 0}
              update={(updater) =>
                setForm((current) => ({ ...current, ...updater(current) }))
              }
            />
          )}

          {form.answerType === "short_text" && (
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">Respuesta correcta</h3>
              <input
                id="short-answer"
                aria-label="Respuesta correcta"
                aria-invalid={!form.shortAnswer.trim() && errors.length > 0}
                placeholder="Ej. 42"
                value={form.shortAnswer}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    shortAnswer: event.target.value,
                  }))
                }
                className="h-9 w-full max-w-xs border-2 border-difficulty-easy/60 bg-background px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-primary aria-invalid:border-destructive/60"
              />
              <p className="text-xs text-muted-foreground">
                No importan las mayúsculas ni los espacios de más.
              </p>
            </section>
          )}

          {form.answerType === "image_hotspot" && (
            <ImageHotspotEditor
              config={form.hotspotConfig}
              answerKey={form.hotspotKey}
              onChange={(hotspotConfig, hotspotKey) =>
                setForm((current) => ({
                  ...current,
                  hotspotConfig,
                  hotspotKey,
                }))
              }
            />
          )}
          {form.answerType === "drag_drop" && (
            <FieldSet className="gap-4">
              <DragDropEditor
                backgroundUrl={form.dragDropBackground?.url ?? null}
                backgroundWidthPercent={form.dragDropBackground?.widthPercent}
                onResizeBackground={(widthPercent) =>
                  setForm((current) => ({
                    ...current,
                    dragDropBackground: current.dragDropBackground && {
                      ...current.dragDropBackground,
                      widthPercent,
                    },
                  }))
                }
                items={form.dragDropItems}
                targets={form.dragDropTargets}
                onUploadBackground={(files) => {
                  void updateDragDropBackground(files);
                }}
                onReplaceItemImage={(itemId, files) => {
                  void updateDragDropItemImage(itemId, files);
                }}
                onAddItem={() => {
                  const itemId = crypto.randomUUID();
                  setForm((current) => ({
                    ...current,
                    dragDropItems: [
                      ...current.dragDropItems,
                      {
                        id: itemId,
                        label: `Pieza ${current.dragDropItems.length + 1}`,
                        image: null,
                        correctTargetId: "",
                        widthPercent: DEFAULT_DRAG_DROP_ITEM_WIDTH_PERCENT,
                      },
                    ],
                  }));
                  return itemId;
                }}
                onRemoveItem={(itemId) =>
                  setForm((current) => ({
                    ...current,
                    dragDropItems: current.dragDropItems.filter(
                      (item) => item.id !== itemId,
                    ),
                    dragDropSolutions: current.dragDropSolutions.map(
                      (solution) => ({
                        ...solution,
                        placements: Object.fromEntries(
                          Object.entries(solution.placements).filter(
                            ([id]) => id !== itemId,
                          ),
                        ),
                      }),
                    ),
                  }))
                }
                onAddTarget={() => {
                  const targetId = crypto.randomUUID();
                  setForm((current) => ({
                    ...current,
                    dragDropTargets: [
                      ...current.dragDropTargets,
                      {
                        id: targetId,
                        ...nextTargetPosition(current.dragDropTargets),
                        snapRadius:
                          current.dragDropTargets[0]?.snapRadius ?? 10,
                      },
                    ],
                  }));
                  return targetId;
                }}
                onRemoveTarget={(targetId) =>
                  setForm((current) => ({
                    ...current,
                    dragDropTargets: current.dragDropTargets.filter(
                      (target) => target.id !== targetId,
                    ),
                    dragDropItems: current.dragDropItems.map((item) =>
                      item.correctTargetId === targetId
                        ? { ...item, correctTargetId: "" }
                        : item,
                    ),
                    dragDropSolutions: current.dragDropSolutions.map(
                      (solution) => ({
                        ...solution,
                        placements: Object.fromEntries(
                          Object.entries(solution.placements).filter(
                            ([, id]) => id !== targetId,
                          ),
                        ),
                      }),
                    ),
                  }))
                }
                onUpdateItem={updateDragDropItem}
                onUpdateTarget={updateDragDropTarget}
                solutions={form.dragDropSolutions}
                onAddSolution={(placements) => {
                  const solutionId = crypto.randomUUID();

                  setForm((current) => ({
                    ...current,
                    dragDropSolutions: [
                      ...current.dragDropSolutions,
                      {
                        id: solutionId,
                        placements: { ...placements },
                      },
                    ],
                  }));

                  return solutionId;
                }}
                onRemoveSolution={(solutionId) =>
                  setForm((current) => ({
                    ...current,
                    dragDropSolutions: current.dragDropSolutions.filter(
                      (solution) => solution.id !== solutionId,
                    ),
                  }))
                }
                onUpdateSolution={(solutionId, placements) =>
                  setForm((current) => ({
                    ...current,
                    dragDropItems:
                      solutionId === "primary"
                        ? current.dragDropItems.map((item) => ({
                            ...item,
                            correctTargetId: placements[item.id] ?? "",
                          }))
                        : current.dragDropItems,
                    dragDropSolutions: current.dragDropSolutions.map(
                      (solution) =>
                        solution.id === solutionId
                          ? { ...solution, placements }
                          : solution,
                    ),
                  }))
                }
              />
            </FieldSet>
          )}

          {errors.length > 0 && (
            <FieldError errors={errors.map((message) => ({ message }))} />
          )}
        </FieldGroup>
      </FormSection>

      <FormSection
        title="Explicación"
        hint="Se muestra al estudiante cuando comprueba su respuesta."
      >
        <TaskContentBuilder
          allowedBlockTypes={["text", "image"]}
          blocks={form.explanationBlocks}
          onAddBlock={(type) => addSectionBlock("explanationBlocks", type)}
          onRemoveBlock={(blockId) =>
            removeSectionBlock("explanationBlocks", blockId)
          }
          onMoveBlock={(fromBlockId, toBlockId, position) =>
            moveSectionBlock(
              "explanationBlocks",
              fromBlockId,
              toBlockId,
              position,
            )
          }
          onUpdateBlockContent={(blockId, content, richText) =>
            updateSectionBlocks("explanationBlocks", blockId, (current) => ({
              ...current,
              content,
              richText,
            }))
          }
          onUpdateBlockImage={(blockId, files) => {
            void updateSectionBlockImage("explanationBlocks", blockId, files);
          }}
          onUpdateBlockWidth={(blockId, widthPercent) =>
            updateSectionBlockWidth("explanationBlocks", blockId, widthPercent)
          }
          showChallengeErrors={false}
          textPlaceholder="Explica por qué esa es la respuesta."
        />
        <div className="flex flex-col gap-2">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <LightbulbIcon className="size-4" />
            ¿Qué tiene que ver con informática?
            <span className="font-normal text-muted-foreground">
              (opcional)
            </span>
          </h3>
          <TaskContentBuilder
            allowedBlockTypes={["text"]}
            blocks={[form.informaticsBlock]}
            allowAddingBlocks={false}
            allowRemovingBlocks={false}
            allowReorderingBlocks={false}
            onAddBlock={() => null}
            onRemoveBlock={() => {}}
            onMoveBlock={() => {}}
            onUpdateBlockContent={(_, content, richText) =>
              setForm((current) => ({
                ...current,
                informaticsBlock: {
                  ...current.informaticsBlock,
                  content,
                  richText,
                },
              }))
            }
            onUpdateBlockImage={() => {}}
            onUpdateBlockWidth={() => {}}
            showChallengeErrors={false}
            textPlaceholder="El concepto de informática que hay detrás. El estudiante lo ve plegado, debajo de la explicación."
          />
        </div>
      </FormSection>

      <FormSection title="Datos de la tarea">
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Dificultad</h3>
          <p className="text-sm text-muted-foreground">
            Elige la dificultad en cada categoría donde va la tarea. Tócala otra
            vez para quitarla.
          </p>
          <div className="grid gap-x-10 gap-y-1 md:grid-cols-2">
            {ageRanges.map((range) => {
              const category = categoryForAgeRange(range);
              const chosen = form.selectedAgeRanges[range]
                ? form.difficulties[range]
                : "";
              return (
                <div
                  key={range}
                  id={`dificultad-${range.replace("–", "-")}`}
                  className="flex scroll-mt-24 items-center justify-between gap-3 py-1"
                >
                  <span
                    className={cn(
                      "text-sm",
                      chosen ? "font-semibold" : "text-muted-foreground",
                    )}
                  >
                    {category}
                  </span>
                  <div
                    role="radiogroup"
                    aria-label={`Dificultad en ${category}`}
                    className="flex gap-1"
                  >
                    {difficultyOptions.map((option) => {
                      const selected = chosen === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() =>
                            setForm((current) => ({
                              ...current,
                              selectedAgeRanges: {
                                ...current.selectedAgeRanges,
                                [range]: !selected,
                              },
                              difficulties: {
                                ...current.difficulties,
                                [range]: selected ? "" : option.value,
                              },
                            }))
                          }
                          className={cn(
                            "h-8 w-16 border-2 text-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
                            selected
                              ? cn(
                                  difficultyStyles[option.value].className,
                                  "border-foreground/50 font-semibold",
                                )
                              : "border-border/20 text-muted-foreground hover:border-foreground/40 hover:text-foreground",
                          )}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          {errors.length > 0 &&
            !Object.values(form.selectedAgeRanges).some(Boolean) && (
              <FieldError>Falta la dificultad en alguna categoría.</FieldError>
            )}
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Área de contenido</h3>
          <div className="flex flex-wrap gap-1.5">
            {categories.map((category) => {
              const checked = form.categories.includes(category);
              return (
                <button
                  key={category}
                  type="button"
                  aria-pressed={checked}
                  onClick={() =>
                    setForm((current) => ({
                      ...current,
                      categories: checked
                        ? current.categories.filter(
                            (currentCategory) => currentCategory !== category,
                          )
                        : [...current.categories, category],
                    }))
                  }
                  className="flex h-8 items-center gap-1.5 border-2 border-border/20 px-3 text-sm text-muted-foreground transition-colors outline-none hover:border-primary/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/60 aria-pressed:border-primary aria-pressed:bg-primary/5 aria-pressed:font-medium aria-pressed:text-foreground"
                >
                  {checked && <CheckIcon className="size-3.5 text-primary" />}
                  {category}
                </button>
              );
            })}
          </div>
          {errors.length > 0 && form.categories.length === 0 && (
            <FieldError>Falta el área de contenido.</FieldError>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">
            Origen{" "}
            <span className="font-normal text-muted-foreground">
              (opcional)
            </span>
          </h3>
          <div className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="country">País de origen</FieldLabel>
              <FieldContent>
                <Select
                  value={form.country || "ninguno"}
                  onValueChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      country: value === "ninguno" ? "" : value,
                    }))
                  }
                >
                  <SelectTrigger className="w-full" id="country">
                    <SelectValue placeholder="Sin país" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ninguno">Sin país</SelectItem>
                    {countries.map((country) => (
                      <SelectItem key={country.name} value={country.name}>
                        <span className="inline-flex items-center gap-2">
                          <img
                            alt=""
                            className="h-4 w-auto rounded-xs border border-border"
                            src={country.flag}
                          />
                          {country.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldContent>
            </Field>
            <Field>
              <FieldLabel htmlFor="year">Año del desafío</FieldLabel>
              <FieldContent>
                <Input
                  id="year"
                  inputMode="numeric"
                  max={2100}
                  min={1900}
                  placeholder="Ej. 2024"
                  type="number"
                  value={form.year}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      year: event.target.value,
                    }))
                  }
                />
              </FieldContent>
            </Field>
          </div>
        </div>
      </FormSection>

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-2 border-t bg-background px-4 py-3 sm:mx-0 sm:px-0">
        <div className="flex items-center justify-end gap-3">
          {errors.length > 0 && (
            <p
              role="alert"
              className="mr-auto min-w-0 truncate text-sm font-medium text-destructive motion-safe:animate-in motion-safe:fade-in-0"
            >
              {errors[0]}
              {errors.length > 1 && (
                <span className="font-normal text-destructive/70">
                  {" "}
                  y {errors.length - 1} más
                </span>
              )}
            </p>
          )}
          {/* Probar lleva lo que hay en pantalla, guardado o no: el probador
              recibe el borrador entero y lo corrige sin tocar la base. */}
          <Button type="button" variant="outline" onClick={handleTestDraft}>
            <PlayIcon data-icon="inline-start" />
            Probar
          </Button>
          <Button type="submit">
            <UploadIcon data-icon="inline-start" />
            Guardar
          </Button>
        </div>
      </div>
    </form>
  );
}
