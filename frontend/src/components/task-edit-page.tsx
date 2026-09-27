"use client";

import { useEffect, useState } from "react";

import { TaskUploadForm } from "@/components/task-upload-form";
import { getTask } from "@/lib/tasks-api";
import { safeReturnTo } from "@/lib/site-navigation";
import { type StoredTask } from "@/lib/task-schema";

/** Nueva tarea sin `id`; con `id`, la carga y la edita en el mismo formulario. */
export function TaskEditPage() {
  const params =
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search);
  const taskId = params?.get("id") ?? null;
  const returnTo = safeReturnTo(params?.get("volver"));
  const [task, setTask] = useState<StoredTask | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!taskId) return;
    let active = true;
    void getTask(taskId)
      .then((loadedTask) => {
        if (active) setTask(loadedTask);
      })
      .catch(() => {
        if (active) setNotFound(true);
      });
    return () => {
      active = false;
    };
  }, [taskId]);

  if (!taskId) return <TaskUploadForm returnTo={returnTo} />;

  if (notFound) {
    return (
      <div className="flex flex-col items-start gap-2 py-10">
        <p className="text-lg font-semibold">No encontramos esta tarea</p>
        <a
          href="/tareas"
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          Volver a Tareas
        </a>
      </div>
    );
  }

  if (!task) return null;

  return <TaskUploadForm initialTask={task} returnTo={returnTo} />;
}
