"use client";

import { PlayTaskFields } from "@/components/play-task-fields";
import { TaskContentRenderer } from "@/components/task-content-renderer";
import type { PlayTask } from "@/lib/play-api";
import {
  TextClozePlayer,
  readAssignments,
} from "@/components/assignment-player";
import type { ClozeConfig } from "@/lib/assignment-answers";

/**
 * Las figuras llegan con el ancho del cuadernillo y algunas miden más que la
 * pantalla: en la vista del estudiante manda un alto máximo, con su proporción.
 */
const playImages = "gap-4 [&_img]:max-h-[24rem] [&_img]:object-contain";

const answerTitles: Record<string, string> = {
  multiple_choice: "Opciones de respuesta",
  short_text: "Respuesta corta",
  drag_drop: "Arrastrar y soltar",
  image_hotspot: "Señala sobre la imagen",
};

/** Shared document/interaction boundary for the tester and the contest player. */
export function TaskPlayContent({
  task,
  value,
  onChange,
  disabled = false,
  showHeadings = false,
}: {
  task: PlayTask;
  value: unknown;
  onChange: (payload: unknown) => void;
  disabled?: boolean;
  showHeadings?: boolean;
}) {
  if (task.answerType === "text_cloze" && task.answerConfig?.version === 1) {
    return (
      <TextClozePlayer
        config={task.answerConfig as unknown as ClozeConfig}
        blocks={[...task.bodyBlocks, ...task.challengeBlocks]}
        value={readAssignments(value, "blanks")}
        disabled={disabled}
        onChange={(blanks) => onChange({ version: 1, blanks })}
      />
    );
  }
  const sectionHeadings =
    showHeadings && !["image_hotspot", "state_grid"].includes(task.answerType);
  return (
    <div className="flex flex-col gap-5">
      <TaskContentRenderer blocks={task.bodyBlocks} className={playImages} />
      {task.challengeBlocks.length > 0 && (
        <section className="flex flex-col gap-3">
          {sectionHeadings && (
            <h2 className="text-xl font-semibold sm:text-2xl">
              Pregunta o desafío
            </h2>
          )}
          <TaskContentRenderer
            blocks={task.challengeBlocks}
            className={playImages}
          />
        </section>
      )}
      <section className="flex flex-col gap-4">
        {sectionHeadings && (
          <h2 className="text-xl font-semibold sm:text-2xl">
            {answerTitles[task.answerType] ?? "Tu respuesta"}
          </h2>
        )}
        <PlayTaskFields
          task={task}
          value={value}
          disabled={disabled}
          onChange={disabled ? () => undefined : onChange}
        />
      </section>
    </div>
  );
}
