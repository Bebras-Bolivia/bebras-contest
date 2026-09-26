"use client";

import { useEffect, useRef } from "react";
import { CheckCircle2Icon, XCircleIcon } from "lucide-react";

import { TaskExplanation } from "@/components/task-explanation";
import type { ContentBlock } from "@/lib/task-schema";
import { cn } from "@/lib/utils";

export function AnswerResult({
  correct,
  explanationBlocks,
  reveal = false,
  className,
}: {
  correct: boolean;
  explanationBlocks?: ContentBlock[] | null;
  reveal?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const Icon = correct ? CheckCircle2Icon : XCircleIcon;

  useEffect(() => {
    if (!reveal) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    ref.current?.scrollIntoView({
      behavior: still ? "auto" : "smooth",
      block: "nearest",
    });
  }, [reveal]);

  return (
    <section
      ref={ref}
      role="status"
      aria-live="polite"
      className={cn("flex scroll-my-6 flex-col gap-4", className)}
    >
      <div className="flex items-center gap-3 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-3 motion-safe:duration-300">
        <Icon
          aria-hidden
          className={cn(
            "size-9 shrink-0 motion-safe:animate-in motion-safe:zoom-in-0 motion-safe:duration-500 motion-safe:ease-[cubic-bezier(0.34,1.56,0.64,1)]",
            correct
              ? "text-difficulty-easy motion-safe:-spin-in-45"
              : "text-destructive motion-safe:spin-in-45",
          )}
        />
        <p className="text-xl font-bold">
          {correct ? "¡Correcto!" : "Respuesta incorrecta"}
        </p>
      </div>
      {explanationBlocks && explanationBlocks.length > 0 && (
        <div className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:delay-200 motion-safe:duration-500 motion-safe:fill-mode-both">
          <TaskExplanation blocks={explanationBlocks} />
        </div>
      )}
    </section>
  );
}
