"use client";

import { PencilIcon } from "lucide-react";

import {
  difficultyLabel,
  taskDifficultyForCategory,
  type TaskDifficulty,
} from "@/lib/contest-schema";
import { difficultyStyles } from "@/lib/difficulty";
import {
  parseMultipleChoiceCorrectness,
  type StoredTask,
} from "@/lib/task-schema";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TaskContentRenderer } from "@/components/task-content-renderer";
import { TaskExplanation } from "@/components/task-explanation";
import { TaskOrigin } from "@/components/task-origin";

export function difficultyOf(task: StoredTask, category: string) {
  return taskDifficultyForCategory(task.difficulties, category);
}

export function DifficultyTag({
  difficulty,
}: {
  difficulty: TaskDifficulty | null;
}) {
  if (!difficulty) {
    return (
      <span className="border border-dashed border-destructive px-1.5 py-0.5 text-xs text-destructive">
        Sin dificultad
      </span>
    );
  }

  return (
    <span
      className={cn(
        "shrink-0 border border-foreground/50 px-1.5 py-0.5 text-xs font-semibold",
        difficultyStyles[difficulty].className,
      )}
    >
      {difficultyLabel(difficulty)}
    </span>
  );
}

/** La pregunta tal como la lee el estudiante, con la respuesta marcada. */
export function TaskPreviewDialog({
  task,
  category,
  editHref,
  onClose,
}: {
  task: StoredTask | null;
  category: string;
  editHref: (taskId: string) => string;
  onClose: () => void;
}) {
  const correct = task
    ? parseMultipleChoiceCorrectness(task.correctAnswerId).correctOptionIds
    : [];

  return (
    <Dialog
      open={task !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="break-words">{task?.title ?? ""}</DialogTitle>
          {task && (
            <TaskOrigin
              country={task.country}
              year={task.year}
              sourceTaskCode={task.sourceTaskCode}
            />
          )}
          <DialogDescription>
            {task
              ? `${difficultyLabel(difficultyOf(task, category) ?? "") || "Sin dificultad"} en ${category}`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
          {task && (
            <>
              <TaskContentRenderer blocks={task.bodyBlocks} className="gap-4" />
              {task.challengeBlocks.length > 0 && (
                <TaskContentRenderer
                  blocks={task.challengeBlocks}
                  className="gap-4"
                />
              )}
              {task.answerType === "multiple_choice" &&
                task.answers.length > 0 && (
                  <ul className="flex flex-col gap-2">
                    {task.answers.map((answer) => (
                      <li
                        key={answer.id}
                        className={cn(
                          "flex items-start gap-2 border px-3 py-2 text-sm",
                          correct.includes(answer.id) &&
                            "border-difficulty-easy bg-difficulty-easy/15",
                        )}
                      >
                        <span className="font-semibold uppercase">
                          {answer.id}
                        </span>
                        <div className="min-w-0 flex-1">
                          <TaskContentRenderer blocks={answer.blocks} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              {task.explanationBlocks?.length > 0 && (
                <TaskExplanation blocks={task.explanationBlocks} />
              )}
            </>
          )}
        </div>
        <DialogFooter>
          {task && (
            <Button asChild variant="outline">
              <a href={editHref(task.id)}>
                <PencilIcon data-icon="inline-start" />
                Editar pregunta
              </a>
            </Button>
          )}
          <Button type="button" onClick={onClose}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
