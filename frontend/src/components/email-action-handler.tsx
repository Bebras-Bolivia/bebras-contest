"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { applyActionCode } from "firebase/auth";
import { CircleAlertIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import {
  EMAIL_VERIFICATION_CHANNEL,
  parseVerifyEmailAction,
  sanitizedEmailActionPath,
  verificationDestination,
} from "@/lib/email-action";
import { firebaseAuth } from "@/lib/firebase";

export function EmailActionHandler() {
  const startedRef = useRef(false);
  const [failed, setFailed] = useState(false);

  useLayoutEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const sourceUrl = window.location.href;
    const action = parseVerifyEmailAction(sourceUrl);
    window.history.replaceState(
      window.history.state,
      "",
      sanitizedEmailActionPath(sourceUrl),
    );

    if (!action) {
      queueMicrotask(() => setFailed(true));
      return;
    }

    let disposed = false;
    void applyActionCode(firebaseAuth(), action.oobCode)
      .then(() => {
        if (disposed) return;
        if ("BroadcastChannel" in window) {
          const channel = new BroadcastChannel(EMAIL_VERIFICATION_CHANNEL);
          channel.postMessage({ type: "email-verified" });
          channel.close();
        }
        window.location.replace(
          verificationDestination(action.continueUrl, window.location.origin),
        );
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });

    return () => {
      disposed = true;
    };
  }, []);

  return (
    <Card className="mx-auto w-full max-w-md">
      <CardHeader className="items-center text-center">
        <img
          src="/castor.png"
          alt="Bebras Bolivia"
          className="size-20 object-contain"
        />
        <CardTitle>
          {failed ? "No pudimos verificar tu correo" : "Verificando tu correo"}
        </CardTitle>
        <CardDescription>
          {failed
            ? "El enlace puede haber vencido, ya haberse usado o no ser válido."
            : "Estamos confirmando tu cuenta de Bebras. Esto tomará solo un momento."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {failed ? (
          <Alert variant="destructive">
            <CircleAlertIcon />
            <AlertTitle>Enlace vencido o inválido</AlertTitle>
            <AlertDescription>
              Inicia sesión para solicitar un correo nuevo y vuelve a abrir el
              enlace más reciente.
            </AlertDescription>
          </Alert>
        ) : (
          <div
            className="flex items-center justify-center gap-3 py-4 text-sm text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            <Spinner />
            <span>Confirmando verificación...</span>
          </div>
        )}
      </CardContent>
      {failed && (
        <CardFooter className="flex flex-col gap-2">
          <Button asChild className="w-full">
            <a href="/login?resend=1">Reenviar correo de verificación</a>
          </Button>
          <Button asChild variant="outline" className="w-full">
            <a href="/login">Volver a iniciar sesión</a>
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
