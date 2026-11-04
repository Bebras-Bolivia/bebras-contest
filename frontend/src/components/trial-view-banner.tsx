"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { leaveTrialView, readTrialView } from "@/lib/trial-view";

export function TrialViewBanner() {
  const [view] = useState(readTrialView);

  if (!view) {
    return null;
  }

  return (
    <div data-site-chrome="trial" className="border-b bg-primary/5">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 sm:px-8 lg:px-12">
        <span className="text-sm text-muted-foreground">
          Vista de maestro de ensayo:{" "}
          <span className="font-medium text-foreground">
            {view.name || view.email}
          </span>
          .
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            leaveTrialView();
            window.close();
            window.setTimeout(() => {
              window.location.href = "/pruebas-guiadas";
            }, 300);
          }}
        >
          Cerrar esta vista
        </Button>
      </div>
    </div>
  );
}
