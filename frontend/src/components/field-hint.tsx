"use client";

import { useState, type ReactNode } from "react";
import { HelpCircleIcon } from "lucide-react";

import { FieldLabel } from "@/components/ui/field";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function FieldHint({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Más información"
            onClick={(event) => {
              event.preventDefault();
              setOpen(true);
            }}
            className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <HelpCircleIcon className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-80 px-4 py-3 text-sm leading-6 text-pretty">
          {children}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function LabelWithHint({
  htmlFor,
  children,
  hint,
  required = false,
}: {
  htmlFor?: string;
  children: ReactNode;
  hint: ReactNode;
  required?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <FieldLabel htmlFor={htmlFor}>
        {children}
        {required && <span className="text-destructive">*</span>}
      </FieldLabel>
      <FieldHint>{hint}</FieldHint>
    </div>
  );
}
