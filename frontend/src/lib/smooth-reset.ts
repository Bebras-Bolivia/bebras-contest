import { flushSync } from "react-dom";

export function smoothReset(update: () => void) {
  if (
    !document.startViewTransition ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    update();
    return;
  }

  const root = document.documentElement;
  root.dataset.answerReset = "";
  const transition = document.startViewTransition(() => {
    flushSync(update);
  });
  void transition.finished.finally(() => {
    delete root.dataset.answerReset;
  });
}
