"use client";

import { ChevronDownIcon, LightbulbIcon } from "lucide-react";

import { TaskContentRenderer } from "@/components/task-content-renderer";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { splitExplanation } from "@/lib/explanation";
import type { ContentBlock } from "@/lib/task-schema";
import { cn } from "@/lib/utils";

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
            ¿Qué tiene que ver con informática?
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
