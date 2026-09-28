import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const MIME_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

export function DocumentUpload({
  id,
  label,
  busy,
  description,
  confirmLabel = "Sí, enviar documento",
  variant = "outline",
  size = "sm",
  className,
  onPick,
}: {
  id: string;
  label: string;
  busy: boolean;
  description: string;
  confirmLabel?: string;
  variant?: "default" | "outline";
  size?: "sm" | "default";
  className?: string;
  onPick: (file: File) => boolean | Promise<boolean>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const sending = useRef(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const locked = busy || submitting;
  const extension = file?.name.split(".").pop()?.toLowerCase() ?? "";

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(
      new Blob([file], { type: MIME_TYPES[extension] }),
    );
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file, extension]);

  const confirm = async () => {
    if (!file || locked || sending.current) return;
    sending.current = true;
    setSubmitting(true);
    try {
      if (await onPick(file)) setFile(null);
    } catch {
      toast.error("No se pudo enviar el documento. Inténtalo de nuevo.");
    } finally {
      sending.current = false;
      setSubmitting(false);
    }
  };

  return (
    <>
      <input
        ref={input}
        id={id}
        type="file"
        className="hidden"
        accept=".pdf,.jpg,.jpeg,.png"
        disabled={locked}
        onChange={(event) => {
          const selected = event.target.files?.[0];
          event.target.value = "";
          if (!selected || locked) return;
          const ext = selected.name.split(".").pop()?.toLowerCase() ?? "";
          if (!Object.hasOwn(MIME_TYPES, ext)) {
            toast.error("Elige un archivo PDF, JPG o PNG.");
            return;
          }
          if (!selected.size || selected.size > 5 * 1024 * 1024) {
            toast.error(
              "El documento no debe estar vacío ni pesar más de 5 MB.",
            );
            return;
          }
          setPreview("");
          setFile(selected);
        }}
      />
      <Button
        ref={trigger}
        type="button"
        size={size}
        variant={variant}
        className={className}
        disabled={locked}
        onClick={() => input.current?.click()}
      >
        {label}
      </Button>
      <Dialog
        open={Boolean(file)}
        onOpenChange={(open) => {
          if (!open && !locked) setFile(null);
        }}
      >
        <DialogContent
          className="flex max-h-[90dvh] flex-col sm:max-w-3xl"
          showCloseButton={false}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>Revisa el documento antes de continuar</DialogTitle>
            <DialogDescription>
              {description} Comprueba que se vea completo y legible.
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
            <p className="break-all text-sm">
              {file?.name} · {Math.ceil((file?.size ?? 0) / 1024)} KB
            </p>
            {preview &&
              (extension === "pdf" ? (
                <object
                  data={preview}
                  type="application/pdf"
                  aria-label="Vista previa del documento PDF"
                  className="h-[50dvh] min-h-48 w-full shrink-0 rounded-md border"
                >
                  <p className="p-4">
                    Tu navegador no muestra el PDF aquí. Usa el enlace de abajo
                    para revisarlo.
                  </p>
                </object>
              ) : (
                <img
                  src={preview}
                  alt="Vista previa del documento seleccionado"
                  className="max-h-[50dvh] w-full rounded-md border object-contain"
                />
              ))}
            {preview && (
              <a
                href={preview}
                target="_blank"
                rel="noreferrer"
                className="text-sm underline underline-offset-4"
              >
                Abrir vista previa en otra pestaña
              </a>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={locked}
              onClick={() => setFile(null)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={locked}
              onClick={() => input.current?.click()}
            >
              Cambiar archivo
            </Button>
            <Button
              type="button"
              disabled={locked || !preview}
              onClick={() => void confirm()}
            >
              {submitting ? "Enviando..." : confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
