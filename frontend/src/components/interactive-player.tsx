"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircleIcon, RotateCcwIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  HOST_SOURCE,
  TASK_SOURCE,
  interactiveEngineUrl,
  interactiveSrcdoc,
  readInteractiveAnswer,
  readInteractiveConfig,
  type TaskMessage,
} from "@/lib/interactive";

export function InteractiveTryout({ config }: { config: unknown }) {
  const [answer, setAnswer] = useState<unknown>({});
  return (
    <InteractivePlayer config={config} value={answer} onChange={setAnswer} />
  );
}

export function InteractivePlayer({
  config: rawConfig,
  value,
  onChange,
  disabled = false,
}: {
  config: unknown;
  value: unknown;
  onChange: (payload: unknown) => void;
  disabled?: boolean;
}) {
  const config = useMemo(() => readInteractiveConfig(rawConfig), [rawConfig]);
  const srcdoc = useMemo(
    () =>
      config
        ? interactiveSrcdoc(config, interactiveEngineUrl(config.engine))
        : "",
    [config],
  );
  const incoming = readInteractiveAnswer(value)?.state ?? null;
  const [session, setSession] = useState({
    key: 0,
    state: incoming,
    seen: incoming,
  });
  const [emitted, setEmitted] = useState<string | null>(incoming);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [content, setContent] = useState({ width: 0, height: 0 });
  const [available, setAvailable] = useState<number | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);

  if (incoming !== session.seen) {
    setSession({
      key: incoming === emitted ? session.key : session.key + 1,
      state: incoming === emitted ? session.state : incoming,
      seen: incoming,
    });
    if (incoming !== emitted) {
      setEmitted(incoming);
      setStatus("loading");
    }
  }

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const element = wrapper.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setAvailable(entry.contentRect.width),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (status !== "ready" || !available) return;
    frame.current?.contentWindow?.postMessage(
      { source: HOST_SOURCE, type: "fit", width: Math.floor(available) },
      "*",
    );
  }, [status, available, session.key]);

  useEffect(() => {
    const savedState = session.state;
    const timeout = window.setTimeout(
      () => setStatus((current) => (current === "loading" ? "error" : current)),
      25000,
    );
    const listen = (event: MessageEvent) => {
      const data = event.data as TaskMessage | null;
      if (
        !frame.current ||
        event.source !== frame.current.contentWindow ||
        !data ||
        data.source !== TASK_SOURCE
      )
        return;
      if (data.type === "hello") {
        frame.current.contentWindow?.postMessage(
          { source: HOST_SOURCE, type: "init", state: savedState },
          "*",
        );
      } else if (data.type === "ready") {
        setStatus("ready");
      } else if (data.type === "error") {
        setStatus("error");
      } else if (data.type === "size") {
        setContent({ width: data.width, height: data.height });
      } else if (data.type === "change") {
        const payload = data.primary
          ? {}
          : { version: 1, answer: data.answer, state: data.state };
        setEmitted(data.primary ? null : data.state);
        onChangeRef.current(payload);
      }
    };
    window.addEventListener("message", listen);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("message", listen);
    };
  }, [session]);

  if (!config) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Esta actividad no se puede mostrar</AlertTitle>
        <AlertDescription>
          Avisa a tu maestro y continúa con las demás tareas.
        </AlertDescription>
      </Alert>
    );
  }

  const width = Math.max(available ?? config.width, content.width);
  const height = content.height || config.height;
  const scale = available ? Math.min(1, available / width) : 1;

  const restart = () => {
    setEmitted(null);
    setSession((current) => ({
      ...current,
      key: current.key + 1,
      state: null,
    }));
    setStatus("loading");
    onChangeRef.current({});
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <div ref={wrapper} className="w-full overflow-x-auto">
        <div
          className="relative mx-auto overflow-hidden bg-white"
          style={{ width: width * scale, height: height * scale }}
        >
          <iframe
            key={session.key}
            ref={frame}
            title="Actividad interactiva"
            sandbox="allow-scripts"
            srcDoc={srcdoc}
            className="absolute top-0 left-0 origin-top-left border-0 bg-white"
            style={{ width, height, transform: `scale(${scale})` }}
          />
          {disabled && <div aria-hidden="true" className="absolute inset-0" />}
          {status !== "ready" && (
            <div className="absolute inset-0 flex items-center justify-center bg-white p-6 text-center text-sm text-muted-foreground">
              {status === "loading" ? (
                <span className="flex items-center gap-2">
                  <LoaderCircleIcon className="size-4 animate-spin" />
                  Cargando la actividad…
                </span>
              ) : (
                "No se pudo cargar la actividad. Revisa tu conexión y recarga la página."
              )}
            </div>
          )}
        </div>
      </div>
      {!disabled && status === "ready" && (
        <Button type="button" variant="ghost" size="sm" onClick={restart}>
          <RotateCcwIcon data-icon="inline-start" />
          Empezar de nuevo
        </Button>
      )}
    </div>
  );
}
