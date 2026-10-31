"use client";

import { useState } from "react";
import { LogOutIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { signOutFirebase } from "@/lib/firebase-auth";

export function SignOutButton() {
  const [leaving, setLeaving] = useState(false);

  return (
    <div className="border-t pt-6">
      <Button
        type="button"
        variant="outline"
        disabled={leaving}
        onClick={() => {
          setLeaving(true);
          void signOutFirebase().finally(() => {
            window.location.href = "/";
          });
        }}
      >
        <LogOutIcon data-icon="inline-start" />
        {leaving ? "Cerrando sesión…" : "Cerrar sesión"}
      </Button>
    </div>
  );
}
