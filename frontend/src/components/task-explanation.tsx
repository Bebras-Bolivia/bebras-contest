"use client";

import { ChevronDownIcon, LightbulbIcon } from "lucide-react";

import { TaskContentRenderer } from "@/components/task-content-renderer";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { ContentBlock } from "@/lib/task-schema";
import { cn } from "@/lib/utils";

const INFORMATICS = /^\*\*¿Qué tiene que ver con la informática\?\*\*[ \t]*$/m;
const KEEP_LEARNING = /^\*\*Continúa aprendiendo\*\*[ \t]*$/m;

export function splitExplanation(blocks: ContentBlock[]) {
  const solution: ContentBlock[] = [];
  const informatics: ContentBlock[] = [];
  let inInformatics = false;

  for (const block of blocks) {
    if (block.type !== "text" || block.richText) {
      (block.type === "image" || !inInformatics ? solution : informatics).push(
        block,
      );
      continue;
    }

    let text = block.content;
    const keepLearning = text.search(KEEP_LEARNING);
    if (keepLearning >= 0) text = text.slice(0, keepLearning);

    if (!inInformatics) {
      const start = text.search(INFORMATICS);
      if (start >= 0) {
        inInformatics = true;
        const before = text.slice(0, start).trim();
        const after = text.slice(start).replace(INFORMATICS, "").trim();
        if (before) solution.push({ ...block, content: before });
        if (after) {
          informatics.push({
            ...block,
            id: `${block.id}-informatica`,
            content: after,
          });
        }
        continue;
      }
    }

    text = text.trim();
    if (text)
      (inInformatics ? informatics : solution).push({
        ...block,
        content: text,
      });
  }

  return { solution, informatics };
}

export function TaskExplanation({
  blocks,
  className,
}: {
  blocks: ContentBlock[];
  className?: string;
}) {
  const { solution, informatics } = splitExplanation(blocks);

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {solution.length > 0 && <TaskContentRenderer blocks={solution} />}
      {informatics.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger className="group/info flex items-center gap-2 py-1 text-left font-semibold outline-none hover:text-primary focus-visible:ring-[3px] focus-visible:ring-ring/50">
            <LightbulbIcon className="size-4 shrink-0" aria-hidden />
            ¿Qué tiene que ver con la informática?
            <ChevronDownIcon
              aria-hidden
              className="size-4 shrink-0 transition-transform duration-200 group-data-[state=open]/info:rotate-180"
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
            <TaskContentRenderer blocks={informatics} className="pt-2" />
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
