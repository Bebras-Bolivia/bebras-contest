import { GlobeIcon, LockIcon, UsersIcon, type LucideIcon } from "lucide-react";

export type TaskVisibility = "practica" | "maestros" | "privada";

export const TASK_VISIBILITIES: {
  value: TaskVisibility;
  label: string;
  description: string;
  icon: LucideIcon;
}[] = [
  {
    value: "practica",
    label: "Práctica",
    description: "Cualquiera la practica, sin iniciar sesión.",
    icon: GlobeIcon,
  },
  {
    value: "maestros",
    label: "Maestros",
    description: "Los maestros la usan en las prácticas de sus estudiantes.",
    icon: UsersIcon,
  },
  {
    value: "privada",
    label: "Solo admin",
    description: "Reservada para los desafíos oficiales.",
    icon: LockIcon,
  },
];

export function taskVisibility(task: {
  isPractice?: boolean;
  forTeachers?: boolean;
}): TaskVisibility {
  if (task.isPractice) return "practica";
  if (task.forTeachers) return "maestros";
  return "privada";
}

export function visibilityInfo(value: TaskVisibility) {
  return TASK_VISIBILITIES.find((item) => item.value === value)!;
}
