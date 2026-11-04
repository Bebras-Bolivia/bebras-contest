export const TRIAL_TASK_TEXT: Record<string, string> = {
  M1: "Crea una cuenta de maestro con una carta de ejemplo.",
  M2: "Inscribe a los estudiantes de un curso con una planilla.",
  M3: "Corrige el nombre de un estudiante inscrito.",
  M4: "Descarga los códigos personales de tus estudiantes.",
  M5: "Sigue el avance de tus estudiantes durante la rendición.",
  M6: "Mira los resultados de un curso y descárgalos en Excel.",
  M7: "Crea una práctica para tus estudiantes.",
  A1: "Aprueba la solicitud de un maestro.",
  A2: "Registra una tarea de opción múltiple en el banco.",
  A3: "Crea y publica un desafío con dos categorías, sus preguntas y sus fechas.",
  A4: "Prueba el desafío como lo vería un estudiante.",
  A5: "Amplía la rendición de un desafío que está en curso.",
  A6: "Publica los resultados y revisa el ranking.",
  A7: "Publica una noticia en el sitio informativo desde el CMS.",
};

export const TRIAL_TASK_HINT: Record<string, string> = {
  M1: "Que haga el registro en una ventana privada (Ctrl+Mayús+N); en una ventana normal se cierra tu sesión de admin.",
  A7: "Se hace en el CMS, que es otra aplicación: márcala tú.",
};

export const TRIAL_LIMIT_MINUTES: Record<string, number> = {
  M1: 15,
  M2: 10,
  M3: 5,
  M4: 5,
  M5: 5,
  M6: 7,
  M7: 10,
  A1: 5,
  A2: 10,
  A3: 15,
  A4: 5,
  A5: 5,
  A6: 5,
  A7: 10,
};

export const TRIAL_AUTO = [
  "M1",
  "M2",
  "M3",
  "M4",
  "M5",
  "M6",
  "M7",
  "A1",
  "A2",
  "A3",
  "A5",
  "A6",
];

export const TRIAL_RESULT_LABEL = {
  alone: "Lo logré solo",
  help: "Lo logré con ayuda",
  failed: "No pude",
} as const;

export const SUS_STATEMENTS = [
  "Creo que me gustaría usar este sistema con frecuencia.",
  "Encontré el sistema innecesariamente complejo.",
  "Pensé que el sistema era fácil de usar.",
  "Creo que necesitaría el apoyo de un técnico para usar este sistema.",
  "Encontré que las funciones del sistema estaban bien integradas.",
  "Pensé que había demasiada inconsistencia en el sistema.",
  "Imagino que la mayoría de las personas aprenderían a usarlo muy rápido.",
  "Encontré el sistema muy complicado de usar.",
  "Me sentí muy seguro usando el sistema.",
  "Necesité aprender muchas cosas antes de poder usarlo.",
];

export function formatTrialSeconds(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
