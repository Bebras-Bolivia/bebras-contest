"use client";
import {
  AssignmentEditor,
  initialGrid,
  initialCloze,
  activeCloze,
  activeKey,
} from "@/components/assignment-editor";
import {
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

import {
  useEffect,
  useId,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PlayIcon,
  PlusIcon,
  ShieldAlertIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ImageUploadButton } from "@/components/image-upload-button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { countries } from "@/lib/countries";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DragDropEditor } from "@/components/drag-drop-editor";
import { blankRemovalImpact, nextTargetPosition } from "@/lib/authoring";
import { TaskContentBuilder } from "@/components/task-content-builder";
import { FormSection } from "@/components/form-section";
import {
  dragDropPrimaryPlacements,
  dragDropSignature,
} from "@/lib/drag-drop-grading";
import { createTask, updateTask } from "@/lib/tasks-api";
import {
  clearTaskDraftForTest,
  readTaskDraftForTest,
  storeTaskDraftForTest,
} from "@/lib/task-draft-test";
import { ImageWidthResizer } from "@/components/image-width-resizer";
import { categoryForAgeRange } from "@/lib/contest-schema";
import {
  ageRanges,
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
const sourceTaskCodePattern = /^\d{4}-[A-Z]{2}(?:-[A-Za-z0-9]+)+$/;

type BlocksSection = "bodyBlocks" | "challengeBlocks" | "explanationBlocks";

function sourceTaskCodeIsInvalid(value: string) {
  const code = value.trim();
  return (
    Boolean(code) && (code.length > 64 || !sourceTaskCodePattern.test(code))
  );
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
  };
};

function createStateFromTask(task: StoredTask): FormState {
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
    explanationBlocks: task.explanationBlocks?.length
      ? task.explanationBlocks
      : [createContentBlock("text")],
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
    errors.push("El título es obligatorio.");
  }

  if (state.categories.length === 0) {
    errors.push("Debes seleccionar al menos un área de contenido.");
  }

  const selectedRanges = ageRanges.filter(
    (range) => state.selectedAgeRanges[range],
  );

  if (selectedRanges.length === 0) {
    errors.push("Debes activar al menos un rango de edad.");
  }

  if (selectedRanges.some((range) => !state.difficulties[range])) {
    errors.push("Cada rango activado debe tener una dificultad.");
  }

  if (nonEmptyBodyBlocks.length === 0) {
    errors.push("Debes agregar contenido en el cuerpo.");
  }

  if (nonEmptyChallengeBlocks.length === 0) {
    errors.push("Debes agregar contenido en la pregunta o desafío.");
  }

  if (state.answerType === "multiple_choice") {
    if (completedOptions.length < minimumAnswerCount) {
      errors.push("Debes completar al menos dos respuestas.");
    }

    const activeCorrectOptions = state.correctOptions.filter((option) =>
      activeOptionLabels.includes(option),
    );
    const completedCorrectOptions = activeCorrectOptions.filter(
      (option) => getNonEmptyBlocks(state.options[option]).length > 0,
    );

    if (state.multipleChoiceCorrectnessMode === "single") {
      if (activeCorrectOptions.length !== 1) {
        errors.push("Debes marcar exactamente una respuesta correcta.");
      }
    } else if (activeCorrectOptions.length < 2) {
      errors.push("Debes marcar al menos dos respuestas correctas.");
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
    errors.push("Debes definir la respuesta corta esperada.");
  }

  if (state.answerType === "image_hotspot") {
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
  if (state.answerType === "state_grid" || state.answerType === "text_cloze") {
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

  const sourceTaskCode = state.sourceTaskCode.trim();

  if (sourceTaskCodeIsInvalid(sourceTaskCode)) {
    errors.push(
      "El código original debe tener un formato como 2024-DE-04a y no superar 64 caracteres.",
    );
  }

  if (state.answerType === "drag_drop") {
    if (!state.dragDropBackground) {
      errors.push("Debes agregar la imagen de fondo para arrastrar y soltar.");
    }

    if (state.dragDropItems.length === 0) {
      errors.push("Debes agregar al menos un objeto arrastrable.");
    }

    if (state.dragDropTargets.length === 0) {
      errors.push("Debes agregar al menos un destino de encaje.");
    }

    for (const item of state.dragDropItems) {
      if (!item.label.trim()) {
        errors.push("Cada objeto arrastrable debe tener un nombre.");
      }

      if (!item.image) {
        errors.push("Cada objeto arrastrable debe tener una imagen.");
      }

      if (
        !Number.isFinite(item.widthPercent) ||
        item.widthPercent <= 0 ||
        item.widthPercent > 100
      ) {
        errors.push(
          "El ancho de cada objeto debe ser mayor que 0 y hasta 100.",
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
      errors.push(
        "Cada objeto debe tener un único destino de encaje asociado.",
      );
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
      errors.push("Las coordenadas de cada destino deben estar entre 0 y 100.");
    }

    if (
      state.dragDropTargets.some(
        (target) =>
          !Number.isFinite(target.snapRadius) ||
          target.snapRadius <= 0 ||
          target.snapRadius > 100,
      )
    ) {
      errors.push(
        "El radio de encaje de cada destino debe ser mayor que 0 y hasta 100.",
      );
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
          "Cada solución alternativa debe colocar todos los objetos en un destino distinto.",
        );
        break;
      }

      const signature = dragDropSignature(
        state.dragDropItems,
        solution.placements,
      );

      if (!signature || signatures.has(signature)) {
        errors.push("Hay una solución alternativa repetida.");
        break;
      }

      signatures.add(signature);
    }
  }

  if (!getNonEmptyBlocks(state.explanationBlocks).length) {
    errors.push("La explicación de la respuesta es obligatoria.");
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
    explanationBlocks: state.explanationBlocks,
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
    const control =
      row.querySelector<HTMLElement>("button[role=combobox]:not([disabled])") ??
      row.querySelector<HTMLElement>("button[role=checkbox]");
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
  }, []);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [selectedBlank, setSelectedBlank] = useState("");
  const blankRemovalDescription = (ids: string[]) => {
    const impact = blankRemovalImpact(ids, form.clozeKey.acceptedAssignments);
    return impact.length
      ? `Se quitarán ${ids.length} huecos del texto y sus respuestas de las soluciones ${impact.join(", ")}.`
      : null;
  };
  const activeOptionLabels = form.answerOrder.slice(0, form.answerCount);

  const completedOptionsCount = useMemo(
    () =>
      activeOptionLabels.filter(
        (label) => getNonEmptyBlocks(form.options[label]).length > 0,
      ).length,
    [activeOptionLabels, form.options],
  );

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
      toast.error("La tarea todavía no está lista para guardarse.");
      return;
    }

    const draft = buildStoredTask(form, loadedTask?.id);
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

  const handleClearForm = () => {
    clearTaskDraftForTest();
    setForm(createInitialState());
    setErrors([]);
    setClearDialogOpen(false);
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

  const updateOptionBlocks = (
    optionKey: OptionKey,
    blockId: string,
    updater: (block: ContentBlock) => ContentBlock,
  ) => {
    setForm((current) => ({
      ...current,
      options: {
        ...current.options,
        [optionKey]: current.options[optionKey].map((block) =>
          block.id === blockId ? updater(block) : block,
        ),
      },
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

  const updateOptionBlockImage = async (
    optionKey: OptionKey,
    blockId: string,
    files: FileList | null,
  ) => {
    const nextImage = (await createContentImages(files))[0] ?? null;

    updateOptionBlocks(optionKey, blockId, (block) => ({
      ...block,
      image: nextImage,
      widthPercent: block.widthPercent || 100,
    }));
  };

  const updateOptionBlockWidth = (
    optionKey: OptionKey,
    blockId: string,
    widthPercent: number,
  ) => {
    updateOptionBlocks(optionKey, blockId, (block) => ({
      ...block,
      widthPercent,
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

  const moveAnswer = (optionKey: OptionKey, direction: "up" | "down") => {
    setForm((current) => {
      const activeOrder = current.answerOrder.slice(0, current.answerCount);
      const inactiveOrder = current.answerOrder.slice(current.answerCount);
      const currentIndex = activeOrder.indexOf(optionKey);

      if (currentIndex === -1) {
        return current;
      }

      const targetIndex =
        direction === "up" ? currentIndex - 1 : currentIndex + 1;

      if (targetIndex < 0 || targetIndex >= activeOrder.length) {
        return current;
      }

      const nextActiveOrder = [...activeOrder];
      [nextActiveOrder[currentIndex], nextActiveOrder[targetIndex]] = [
        nextActiveOrder[targetIndex],
        nextActiveOrder[currentIndex],
      ];

      return {
        ...current,
        answerOrder: [...nextActiveOrder, ...inactiveOrder],
      };
    });
  };

  const removeAnswer = (optionKey: OptionKey) => {
    setForm((current) => {
      if (current.answerCount <= minimumAnswerCount) {
        return current;
      }

      const activeOrder = current.answerOrder.slice(0, current.answerCount);
      const inactiveOrder = current.answerOrder.slice(current.answerCount);

      return {
        ...current,
        answerCount: current.answerCount - 1,
        answerOrder: [
          ...activeOrder.filter((label) => label !== optionKey),
          optionKey,
          ...inactiveOrder,
        ],
        correctOptions: current.correctOptions.filter(
          (label) => label !== optionKey,
        ),
        options: {
          ...current.options,
          [optionKey]: [createContentBlock(current.multipleChoiceContentType)],
        },
      };
    });
  };

  const renderCorrectOptionsGroup = (children: ReactNode) => {
    const className = "grid gap-4 lg:grid-cols-2";

    if (form.multipleChoiceCorrectnessMode === "single") {
      return (
        <RadioGroup
          aria-label="Respuesta correcta"
          className={className}
          value={form.correctOptions[0] ?? ""}
          onValueChange={(value) =>
            setForm((current) => ({
              ...current,
              correctOptions: [value as OptionKey],
            }))
          }
        >
          {children}
        </RadioGroup>
      );
    }

    return (
      <div aria-label="Respuestas correctas" className={className} role="group">
        {children}
      </div>
    );
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
    <form className="flex flex-col gap-5 sm:gap-6" onSubmit={handleSubmit}>
      {errors.length > 0 && (
        <Alert variant="destructive">
          <ShieldAlertIcon />
          <AlertTitle>No se pudo guardar la tarea</AlertTitle>
          <AlertDescription>
            <ul className="ml-4 flex list-disc flex-col gap-1">
              {errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <FormSection title="Información general">
        <FieldGroup>
          <Field data-invalid={!form.title.trim() && errors.length > 0}>
            <FieldLabel htmlFor="title">Título</FieldLabel>
            <FieldContent>
              <Input
                id="title"
                aria-invalid={!form.title.trim() && errors.length > 0}
                placeholder="Ej. Secuencia incorrecta de transformaciones"
                value={form.title}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
              />
            </FieldContent>
          </Field>

          <div className="grid gap-4 md:grid-cols-3">
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
            <Field
              data-invalid={
                errors.length > 0 &&
                sourceTaskCodeIsInvalid(form.sourceTaskCode)
              }
            >
              <FieldLabel htmlFor="source-task-code">
                Código original
              </FieldLabel>
              <FieldContent>
                <Input
                  id="source-task-code"
                  maxLength={64}
                  placeholder="Ej. 2024-DE-04a"
                  value={form.sourceTaskCode}
                  aria-invalid={
                    errors.length > 0 &&
                    sourceTaskCodeIsInvalid(form.sourceTaskCode)
                  }
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      sourceTaskCode: event.target.value,
                    }))
                  }
                />
              </FieldContent>
            </Field>
          </div>

          <FieldSet>
            <FieldLegend variant="label">Área de contenido</FieldLegend>
            <FieldDescription>Selecciona una o varias áreas.</FieldDescription>
            <div className="grid gap-3 md:grid-cols-2">
              {categories.map((category) => {
                const checked = form.categories.includes(category);

                return (
                  <Field key={category} orientation="horizontal">
                    <Checkbox
                      checked={checked}
                      id={`category-${category}`}
                      onCheckedChange={(nextChecked) =>
                        setForm((current) => ({
                          ...current,
                          categories: nextChecked
                            ? [...current.categories, category]
                            : current.categories.filter(
                                (currentCategory) =>
                                  currentCategory !== category,
                              ),
                        }))
                      }
                    />
                    <FieldLabel htmlFor={`category-${category}`}>
                      {category}
                    </FieldLabel>
                  </Field>
                );
              })}
            </div>
            {errors.length > 0 && form.categories.length === 0 && (
              <FieldError>
                Debes seleccionar al menos un área de contenido.
              </FieldError>
            )}
          </FieldSet>
        </FieldGroup>
      </FormSection>

      <FormSection title="Dificultad por rango de edad">
        <FieldGroup className="gap-3 md:grid md:grid-cols-2 md:gap-x-6">
          {ageRanges.map((range) => (
            <Field
              key={range}
              id={`dificultad-${range.replace("–", "-")}`}
              className="scroll-mt-24 items-center rounded-md"
              orientation="horizontal"
            >
              <div className="flex shrink-0 items-center gap-3">
                <Checkbox
                  className="-translate-y-0.5"
                  checked={form.selectedAgeRanges[range]}
                  id={`age-range-${range}`}
                  onCheckedChange={(checked) =>
                    setForm((current) => ({
                      ...current,
                      selectedAgeRanges: {
                        ...current.selectedAgeRanges,
                        [range]: checked === true,
                      },
                      difficulties: {
                        ...current.difficulties,
                        [range]:
                          checked === true ? current.difficulties[range] : "",
                      },
                    }))
                  }
                />
                <FieldLabel
                  className="whitespace-nowrap"
                  htmlFor={`age-range-${range}`}
                >
                  {range}
                  <span className="hidden font-normal text-muted-foreground sm:inline">
                    {" · "}
                    {categoryForAgeRange(range)}
                  </span>
                </FieldLabel>
              </div>
              <Select
                disabled={!form.selectedAgeRanges[range]}
                value={form.difficulties[range] || undefined}
                onValueChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    difficulties: {
                      ...current.difficulties,
                      [range]: value,
                    },
                  }))
                }
              >
                <SelectTrigger
                  className="ml-auto w-40 shrink-0 min-[360px]:w-48"
                  aria-label={`Dificultad para ${range}`}
                >
                  <SelectValue placeholder="Selecciona dificultad" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {difficultyOptions.map((option) => (
                      <SelectItem key={option.label} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          ))}
          {errors.length > 0 &&
            !Object.values(form.selectedAgeRanges).some(Boolean) && (
              <FieldError>Debes activar al menos un rango de edad.</FieldError>
            )}
        </FieldGroup>
      </FormSection>

      <FormSection title="Cuerpo">
        <TaskContentBuilder
          allowedBlockTypes={["text", "image"]}
          blocks={form.bodyBlocks}
          allowBlanks={form.answerType === "text_cloze"}
          onSelectBlank={setSelectedBlank}
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
          textPlaceholder="Escribe el contenido del cuerpo."
        />
      </FormSection>

      <FormSection title="Pregunta o desafío">
        <TaskContentBuilder
          allowedBlockTypes={["text", "image"]}
          blocks={form.challengeBlocks}
          allowBlanks={form.answerType === "text_cloze"}
          onSelectBlank={setSelectedBlank}
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
          textPlaceholder="Escribe el contenido de la consigna."
        />
      </FormSection>

      <FormSection title="Respuestas">
        <FieldGroup className="gap-4">
          <FieldSet className="gap-4">
            <FieldLegend className="mb-0" variant="label">
              Tipo de respuesta
            </FieldLegend>
            <RadioGroup
              className="mt-1 md:grid-cols-2"
              value={form.answerType}
              onValueChange={(value) =>
                setForm((current) => ({
                  ...current,
                  answerType: value as AnswerType,
                  answerCount:
                    value === "multiple_choice"
                      ? Math.max(current.answerCount, minimumAnswerCount)
                      : current.answerCount,
                }))
              }
            >
              <Field orientation="horizontal">
                <RadioGroupItem
                  id="answer-type-multiple-choice"
                  value="multiple_choice"
                />
                <FieldLabel htmlFor="answer-type-multiple-choice">
                  Opción múltiple
                </FieldLabel>
              </Field>
              <Field orientation="horizontal">
                <RadioGroupItem
                  id="answer-type-short-text"
                  value="short_text"
                />
                <FieldLabel htmlFor="answer-type-short-text">
                  Respuesta corta
                </FieldLabel>
              </Field>
              <Field orientation="horizontal">
                <RadioGroupItem id="answer-type-drag-drop" value="drag_drop" />
                <FieldLabel htmlFor="answer-type-drag-drop">
                  Arrastrar y soltar
                </FieldLabel>
              </Field>
              <Field orientation="horizontal">
                <RadioGroupItem
                  id="answer-type-image-hotspot"
                  value="image_hotspot"
                />
                <FieldLabel htmlFor="answer-type-image-hotspot">
                  Zonas sobre la imagen
                </FieldLabel>
              </Field>
              <Field orientation="horizontal">
                <RadioGroupItem
                  id="answer-type-state-grid"
                  value="state_grid"
                />
                <FieldLabel htmlFor="answer-type-state-grid">
                  Estados por casilla
                </FieldLabel>
              </Field>
              <Field orientation="horizontal">
                <RadioGroupItem
                  id="answer-type-text-cloze"
                  value="text_cloze"
                />
                <FieldLabel htmlFor="answer-type-text-cloze">
                  Huecos en el texto
                </FieldLabel>
              </Field>
            </RadioGroup>
          </FieldSet>

          {(form.answerType === "state_grid" ||
            form.answerType === "text_cloze") && (
            <AssignmentEditor
              selectedBlank={selectedBlank}
              onSelectBlank={setSelectedBlank}
              key={form.answerType}
              kind={form.answerType}
              config={
                form.answerType === "state_grid"
                  ? form.gridConfig
                  : form.clozeConfig
              }
              answerKey={
                form.answerType === "state_grid" ? form.gridKey : form.clozeKey
              }
              blocks={[...form.bodyBlocks, ...form.challengeBlocks]}
              onChange={(config, key) =>
                setForm((current) =>
                  current.answerType === "state_grid"
                    ? {
                        ...current,
                        gridConfig: config as GridConfig,
                        gridKey: key,
                      }
                    : {
                        ...current,
                        clozeConfig: config as ClozeConfig,
                        clozeKey: key,
                      },
                )
              }
            />
          )}
          {form.answerType === "multiple_choice" && (
            <FieldSet className="gap-4!">
              <FieldLegend className="mb-0" variant="label">
                Configuración de opción múltiple
              </FieldLegend>
              <FieldGroup className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,11.25rem),1fr))] gap-px overflow-hidden rounded-xl bg-border">
                <div className="bg-card p-4">
                  <FieldSet className="gap-4">
                    <FieldLegend className="mb-0" variant="label">
                      Contenido
                    </FieldLegend>
                    <RadioGroup
                      value={form.multipleChoiceContentType}
                      onValueChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          multipleChoiceContentType: value as "text" | "image",
                          options: optionLabels.reduce<
                            Record<OptionKey, ContentBlock[]>
                          >(
                            (acc, optionLabel) => {
                              acc[optionLabel] = current.answerOrder
                                .slice(0, current.answerCount)
                                .includes(optionLabel)
                                ? [
                                    createContentBlock(
                                      value === "image" ? "image" : "text",
                                    ),
                                  ]
                                : current.options[optionLabel];
                              return acc;
                            },
                            {
                              A: current.options.A,
                              B: current.options.B,
                              C: current.options.C,
                              D: current.options.D,
                              E: current.options.E,
                              F: current.options.F,
                            },
                          ),
                        }))
                      }
                    >
                      <Field orientation="horizontal">
                        <RadioGroupItem
                          id="multiple-choice-content-text"
                          value="text"
                        />
                        <FieldLabel htmlFor="multiple-choice-content-text">
                          Texto
                        </FieldLabel>
                      </Field>
                      <Field orientation="horizontal">
                        <RadioGroupItem
                          id="multiple-choice-content-image"
                          value="image"
                        />
                        <FieldLabel htmlFor="multiple-choice-content-image">
                          Imagen
                        </FieldLabel>
                      </Field>
                    </RadioGroup>
                  </FieldSet>
                </div>
                <div className="bg-card p-4">
                  <FieldSet className="gap-4">
                    <FieldLegend className="mb-0" variant="label">
                      Presentación
                    </FieldLegend>
                    <RadioGroup
                      value={form.multipleChoiceOrderMode}
                      onValueChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          multipleChoiceOrderMode:
                            value as MultipleChoiceOrderMode,
                        }))
                      }
                    >
                      <Field orientation="horizontal">
                        <RadioGroupItem
                          id="multiple-choice-order-fixed"
                          value="fixed"
                        />
                        <FieldLabel htmlFor="multiple-choice-order-fixed">
                          Mantener el orden definido
                        </FieldLabel>
                      </Field>
                      <Field orientation="horizontal">
                        <RadioGroupItem
                          id="multiple-choice-order-random"
                          value="random"
                        />
                        <FieldLabel htmlFor="multiple-choice-order-random">
                          Mostrar en orden aleatorio
                        </FieldLabel>
                      </Field>
                    </RadioGroup>
                  </FieldSet>
                </div>
                <div className="bg-card p-4">
                  <FieldSet className="gap-4">
                    <FieldLegend className="mb-0" variant="label">
                      Disposición
                    </FieldLegend>
                    <RadioGroup
                      value={form.multipleChoiceLayout}
                      onValueChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          multipleChoiceLayout: value as MultipleChoiceLayout,
                        }))
                      }
                    >
                      <Field orientation="horizontal">
                        <RadioGroupItem
                          id="multiple-choice-layout-vertical"
                          value="vertical"
                        />
                        <FieldLabel htmlFor="multiple-choice-layout-vertical">
                          Una debajo de otra
                        </FieldLabel>
                      </Field>
                      <Field orientation="horizontal">
                        <RadioGroupItem
                          id="multiple-choice-layout-horizontal"
                          value="horizontal"
                        />
                        <FieldLabel htmlFor="multiple-choice-layout-horizontal">
                          Una al lado de otra
                        </FieldLabel>
                      </Field>
                    </RadioGroup>
                  </FieldSet>
                </div>
                <div className="bg-card p-4">
                  <FieldSet className="gap-4">
                    <FieldLegend className="mb-0" variant="label">
                      Criterio de corrección
                    </FieldLegend>
                    <RadioGroup
                      value={form.multipleChoiceCorrectnessMode}
                      onValueChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          multipleChoiceCorrectnessMode:
                            value as MultipleChoiceCorrectnessMode,
                          correctOptions:
                            value === "single"
                              ? current.correctOptions.slice(0, 1)
                              : current.correctOptions,
                        }))
                      }
                    >
                      <Field orientation="horizontal">
                        <RadioGroupItem
                          id="multiple-choice-correctness-single"
                          value="single"
                        />
                        <FieldLabel htmlFor="multiple-choice-correctness-single">
                          Una sola respuesta correcta
                        </FieldLabel>
                      </Field>
                      <Field orientation="horizontal">
                        <RadioGroupItem
                          id="multiple-choice-correctness-any"
                          value="any"
                        />
                        <FieldLabel htmlFor="multiple-choice-correctness-any">
                          Varias correctas (basta marcar una)
                        </FieldLabel>
                      </Field>
                      <Field orientation="horizontal">
                        <RadioGroupItem
                          id="multiple-choice-correctness-all"
                          value="all"
                        />
                        <FieldLabel htmlFor="multiple-choice-correctness-all">
                          Varias correctas (debe marcar todas)
                        </FieldLabel>
                      </Field>
                    </RadioGroup>
                  </FieldSet>
                </div>
              </FieldGroup>
              <FieldContent>
                <p className="text-sm font-medium leading-snug">
                  Opciones de respuesta
                </p>
                <FieldDescription>
                  Completa al menos dos opciones y marca cuáles deben aceptarse
                  como correctas.
                </FieldDescription>
              </FieldContent>
              {renderCorrectOptionsGroup(
                activeOptionLabels.map((label, index) => {
                  const optionBlock =
                    form.options[label][0] ??
                    createContentBlock(form.multipleChoiceContentType);
                  const optionHasContent =
                    getNonEmptyBlocks(form.options[label]).length > 0;
                  const markedAsCorrect = form.correctOptions.includes(label);
                  const invalid =
                    errors.length > 0 &&
                    (completedOptionsCount < minimumAnswerCount ||
                      (markedAsCorrect && !optionHasContent));

                  return (
                    <Field
                      key={label}
                      className="h-full"
                      data-invalid={invalid}
                    >
                      <Card className="h-full rounded-xl border bg-card shadow-sm">
                        <CardHeader className="border-b">
                          <div className="flex items-center justify-between gap-2 sm:gap-4">
                            <Field orientation="horizontal">
                              {form.multipleChoiceCorrectnessMode ===
                              "single" ? (
                                <RadioGroupItem
                                  aria-label={`Marcar respuesta ${index + 1} como correcta`}
                                  id={`correct-${label}`}
                                  value={label}
                                />
                              ) : (
                                <Checkbox
                                  aria-label={`Marcar respuesta ${index + 1} como correcta`}
                                  checked={markedAsCorrect}
                                  id={`correct-${label}`}
                                  onCheckedChange={(checked) =>
                                    setForm((current) => ({
                                      ...current,
                                      correctOptions:
                                        checked === true
                                          ? [
                                              ...new Set([
                                                ...current.correctOptions,
                                                label,
                                              ]),
                                            ]
                                          : current.correctOptions.filter(
                                              (option) => option !== label,
                                            ),
                                    }))
                                  }
                                />
                              )}
                              <FieldContent className="gap-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <FieldLabel htmlFor={`correct-${label}`}>
                                    Respuesta {index + 1}
                                  </FieldLabel>
                                  {markedAsCorrect && (
                                    <Badge variant="secondary">
                                      Respuesta correcta
                                    </Badge>
                                  )}
                                </div>
                              </FieldContent>
                            </Field>
                            {(form.multipleChoiceOrderMode === "fixed" ||
                              form.answerCount > minimumAnswerCount) && (
                              <div className="flex items-center gap-2">
                                {form.multipleChoiceOrderMode === "fixed" && (
                                  <>
                                    <Button
                                      aria-label={`Mover respuesta ${index + 1} antes`}
                                      size="icon-sm"
                                      type="button"
                                      variant="outline"
                                      disabled={index === 0}
                                      onClick={() => moveAnswer(label, "up")}
                                    >
                                      <ChevronLeftIcon />
                                    </Button>
                                    <Button
                                      aria-label={`Mover respuesta ${index + 1} después`}
                                      size="icon-sm"
                                      type="button"
                                      variant="outline"
                                      disabled={
                                        index === activeOptionLabels.length - 1
                                      }
                                      onClick={() => moveAnswer(label, "down")}
                                    >
                                      <ChevronRightIcon />
                                    </Button>
                                  </>
                                )}
                                {form.answerCount > minimumAnswerCount && (
                                  <Button
                                    aria-label={`Eliminar respuesta ${index + 1}`}
                                    size="icon-sm"
                                    type="button"
                                    variant="destructive"
                                    onClick={() => removeAnswer(label)}
                                  >
                                    <Trash2Icon />
                                  </Button>
                                )}
                              </div>
                            )}
                          </div>
                        </CardHeader>
                        <CardContent>
                          {form.multipleChoiceContentType === "text" ? (
                            <Input
                              aria-invalid={invalid}
                              placeholder="Escribe la respuesta."
                              value={optionBlock.content}
                              onChange={(event) =>
                                updateOptionBlocks(
                                  label,
                                  optionBlock.id,
                                  (current) => ({
                                    ...current,
                                    content: event.target.value,
                                  }),
                                )
                              }
                            />
                          ) : (
                            <div className="flex flex-col gap-4">
                              {!optionBlock.image && (
                                <ImageUploadButton
                                  onChange={(event) => {
                                    void updateOptionBlockImage(
                                      label,
                                      optionBlock.id,
                                      event.target.files,
                                    );
                                    event.target.value = "";
                                  }}
                                />
                              )}
                              {optionBlock.image && (
                                <div className="flex flex-col gap-4">
                                  <ImageWidthResizer
                                    alt={optionBlock.image.name}
                                    src={optionBlock.image.url}
                                    widthPercent={optionBlock.widthPercent}
                                    minPercent={10}
                                    onChange={(widthPercent) =>
                                      updateOptionBlockWidth(
                                        label,
                                        optionBlock.id,
                                        widthPercent,
                                      )
                                    }
                                  />
                                  <div className="flex justify-start">
                                    <label>
                                      <input
                                        accept="image/*"
                                        className="sr-only"
                                        type="file"
                                        onChange={(event) => {
                                          void updateOptionBlockImage(
                                            label,
                                            optionBlock.id,
                                            event.target.files,
                                          );
                                          event.target.value = "";
                                        }}
                                      />
                                      <Button
                                        type="button"
                                        variant="outline"
                                        asChild
                                      >
                                        <span>Reemplazar imagen</span>
                                      </Button>
                                    </label>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    </Field>
                  );
                }),
              )}
              {form.answerCount < optionLabels.length && (
                <Button
                  className="w-fit"
                  type="button"
                  onClick={() =>
                    setForm((current) => ({
                      ...current,
                      answerCount: Math.min(
                        current.answerCount + 1,
                        optionLabels.length,
                      ),
                    }))
                  }
                >
                  <PlusIcon data-icon="inline-start" />
                  Agregar respuesta
                </Button>
              )}
            </FieldSet>
          )}

          {form.answerType === "short_text" && (
            <Field data-invalid={!form.shortAnswer.trim() && errors.length > 0}>
              <FieldLabel htmlFor="short-answer">
                Respuesta corta esperada
              </FieldLabel>
              <FieldContent>
                <Input
                  id="short-answer"
                  aria-invalid={!form.shortAnswer.trim() && errors.length > 0}
                  placeholder="Ej. 42"
                  value={form.shortAnswer}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      shortAnswer: event.target.value,
                    }))
                  }
                />
                <FieldDescription>
                  El probador validará este texto ignorando mayúsculas y
                  espacios al inicio y al final.
                </FieldDescription>
              </FieldContent>
            </Field>
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
        title="Explicación de la respuesta"
        hint="Esta explicación es para revisión interna; no se muestra al estudiante."
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
          textPlaceholder="Explica por qué la respuesta es correcta."
        />
      </FormSection>

      <div className="flex flex-col gap-4 border-t pt-5 sm:flex-row sm:items-center sm:justify-end">
        <div className="flex flex-wrap items-center gap-3">
          {/* Probar lleva lo que hay en pantalla, guardado o no: el probador
              recibe el borrador entero y lo corrige sin tocar la base. */}
          <Button type="button" variant="outline" onClick={handleTestDraft}>
            <PlayIcon data-icon="inline-start" />
            Probar
          </Button>
          {!loadedTask && (
            <Dialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
              <DialogTrigger asChild>
                <Button type="button" variant="outline">
                  Limpiar
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Limpiar todo el formulario</DialogTitle>
                  <DialogDescription>
                    Se eliminará todo el contenido cargado en esta tarea. Esta
                    acción no se puede deshacer.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setClearDialogOpen(false)}
                  >
                    Cancelar
                  </Button>
                  <Button type="button" onClick={handleClearForm}>
                    Sí, limpiar todo
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
          <Button type="submit">
            <UploadIcon data-icon="inline-start" />
            {loadedTask ? "Guardar cambios" : "Guardar borrador"}
          </Button>
        </div>
      </div>
    </form>
  );
}
