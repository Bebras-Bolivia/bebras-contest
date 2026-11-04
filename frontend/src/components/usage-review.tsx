"use client";

import { useState } from "react";
import { CheckIcon, LoaderCircleIcon, StarIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { sendUsageReview } from "@/lib/usage-api";
import { cn } from "@/lib/utils";

export function UsageReview({ reviewed }: { reviewed: boolean }) {
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(reviewed);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!stars && !comment.trim()) {
      setError("Elige las estrellas o escribe un comentario.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await sendUsageReview(stars || null, comment);
      setSent(true);
    } catch {
      setError("No pudimos enviar tu reseña. Inténtalo otra vez.");
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <CheckIcon className="size-4 text-difficulty-easy" aria-hidden="true" />
        Gracias por contarnos cómo te fue.
      </p>
    );
  }

  return (
    <section className="mx-auto flex w-full max-w-xl flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-heading text-xl font-semibold">
          Cuéntanos cómo te fue
        </h2>
        <p className="text-sm text-muted-foreground">
          Es opcional y nos ayuda a mejorar la prueba.
        </p>
      </div>
      <div role="radiogroup" aria-label="Estrellas" className="flex gap-1">
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={stars === value}
            aria-label={`${value} de 5`}
            onClick={() => setStars(value)}
            className="p-1 outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            <StarIcon
              aria-hidden="true"
              className={cn(
                "size-9",
                value <= stars
                  ? "fill-primary text-primary"
                  : "text-muted-foreground/40",
              )}
            />
          </button>
        ))}
      </div>
      <Textarea
        value={comment}
        maxLength={500}
        rows={3}
        placeholder="¿Algo no se entendió o no funcionó?"
        onChange={(event) => setComment(event.target.value)}
      />
      {error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}
      <div>
        <Button type="button" disabled={busy} onClick={() => void submit()}>
          {busy && (
            <LoaderCircleIcon
              data-icon="inline-start"
              className="animate-spin"
            />
          )}
          Enviar
        </Button>
      </div>
    </section>
  );
}
