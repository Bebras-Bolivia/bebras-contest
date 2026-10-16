import dmSans from "@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2?inline";
import { API_BASE_URL } from "@/lib/api-client";

export type InteractiveElement = {
  type: "html" | "javascript" | "library";
  content: string;
};

export type InteractiveConfig = {
  version: 1;
  engine: { name: string; version: string };
  width: number;
  height: number;
  elements: InteractiveElement[];
};

export type InteractiveAnswer = { version: 1; answer: string; state?: string };

export const HOST_SOURCE = "bebras-host";
export const TASK_SOURCE = "bebras-interactive";

export const PAPER_BLOCKED_INTERACTIVE =
  "Este desafío tiene preguntas interactivas, que solo se responden en línea: no se puede imprimir ni cargar hojas en papel.";

export type TaskMessage =
  | { source: typeof TASK_SOURCE; type: "hello" }
  | {
      source: typeof TASK_SOURCE;
      type: "ready" | "change";
      answer: string;
      state: string;
      primary: boolean;
    }
  | {
      source: typeof TASK_SOURCE;
      type: "size";
      width: number;
      height: number;
      crop?: { x: number; y: number; width: number; height: number };
    }
  | { source: typeof TASK_SOURCE; type: "text"; html: string }
  | { source: typeof TASK_SOURCE; type: "error"; message: string };

export function readInteractiveConfig(
  value: unknown,
): InteractiveConfig | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const config = value as Partial<InteractiveConfig>;
  if (
    config.version !== 1 ||
    typeof config.engine?.name !== "string" ||
    !/^[0-9a-f]{12}$/.test(String(config.engine?.version)) ||
    typeof config.width !== "number" ||
    typeof config.height !== "number" ||
    !Array.isArray(config.elements)
  )
    return null;
  return config as InteractiveConfig;
}

export function readInteractiveAnswer(
  value: unknown,
): InteractiveAnswer | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const answer = value as Partial<InteractiveAnswer>;
  return answer.version === 1 &&
    typeof answer.answer === "string" &&
    answer.answer.trim() !== ""
    ? {
        version: 1,
        answer: answer.answer,
        ...(typeof answer.state === "string" ? { state: answer.state } : {}),
      }
    : null;
}

export function interactiveEngineUrl(engine: InteractiveConfig["engine"]) {
  const path = `${API_BASE_URL}/api/interactive/engines/${encodeURIComponent(engine.name)}/${engine.version}.js`;
  return typeof window === "undefined"
    ? path
    : new URL(path, window.location.href).toString();
}

function scriptJson(value: unknown) {
  const escape = (code: number) => `\\u${code.toString(16).padStart(4, "0")}`;
  return JSON.stringify(value).replace(
    new RegExp(`[${String.fromCharCode(0x3c, 0x2028, 0x2029)}]`, "g"),
    (char) => escape(char.charCodeAt(0)),
  );
}

const BOOTSTRAP = String.raw`
(function () {
  var HOST = "${HOST_SOURCE}";
  var SOURCE = "${TASK_SOURCE}";
  var started = false;
  var initial = null;
  var last = { answer: null, state: null };
  function post(message) {
    message.source = SOURCE;
    window.parent.postMessage(message, "*");
  }
  function fail(message) {
    post({ type: "error", message: String(message) });
  }
  function read() {
    try {
      return { answer: String(task.getAnswer()), state: String(task.getState()) };
    } catch (error) {
      return null;
    }
  }
  function report(type) {
    var current = read();
    if (!current) return;
    if (type === "change" && current.answer === last.answer && current.state === last.state) return;
    last = current;
    post({ type: type, answer: current.answer, state: current.state, primary: current.answer === initial });
  }
  var separated = false;
  function separate() {
    if (separated) return;
    var stage = document.querySelector("#bebras-task .componental-task");
    if (!stage) return;
    var parts = [];
    Array.prototype.forEach.call(stage.children, function (el) {
      if (el.classList.contains("canvas-container") || getComputedStyle(el).position !== "absolute") return;
      if (!el.querySelector("p,ul,ol") || el.querySelector("input,button,select,textarea,svg,canvas,table,[draggable]")) return;
      if ((el.textContent || "").trim().length < 40) return;
      parts.push(el.innerHTML);
      el.setAttribute("data-bebras-moved", "");
      el.style.visibility = "hidden";
    });
    if (!parts.length) return;
    separated = true;
    stage.setAttribute("data-bebras-cropped", "");
    post({ type: "text", html: parts.join("") });
  }
  function crop() {
    var stage = document.querySelector("#bebras-task .componental-task[data-bebras-cropped]");
    if (!stage) return null;
    var base = stage.getBoundingClientRect();
    var left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    function add(rect) {
      if (rect.width < 1 || rect.height < 1) return;
      left = Math.min(left, rect.left);
      top = Math.min(top, rect.top);
      right = Math.max(right, rect.right);
      bottom = Math.max(bottom, rect.bottom);
    }
    function blank(el) {
      if ((el.textContent || "").trim()) return false;
      if (el.matches("img") ? el.getAttribute("src") : el.querySelector("img[src]:not([src='']),svg,canvas,input,button,select,textarea")) return false;
      var cs = getComputedStyle(el);
      var painted = cs.backgroundColor !== "rgba(0, 0, 0, 0)" && cs.backgroundColor !== "transparent";
      return !painted && !parseFloat(cs.borderTopWidth) && !parseFloat(cs.borderLeftWidth) && cs.backgroundImage === "none";
    }
    Array.prototype.forEach.call(stage.children, function (el) {
      if (el.hasAttribute("data-bebras-moved") || blank(el)) return;
      if (el.classList.contains("canvas-container")) {
        el.querySelectorAll("svg > :not(desc):not(defs)").forEach(function (node) {
          if (node.tagName.toLowerCase() === "image" && !(node.getAttribute("href") || node.getAttribute("xlink:href"))) return;
          add(node.getBoundingClientRect());
        });
        return;
      }
      add(el.getBoundingClientRect());
    });
    if (!isFinite(left)) return null;
    left = Math.max(base.left, left - 8);
    top = Math.max(base.top, top - 8);
    right = Math.min(base.right, right + 8);
    bottom = Math.min(base.bottom, bottom + 8);
    return {
      x: Math.floor(left + window.scrollX),
      y: Math.floor(top + window.scrollY),
      width: Math.ceil(right - left),
      height: Math.ceil(bottom - top)
    };
  }
  function size() {
    separate();
    var root = document.getElementById("bebras-task");
    var message = { type: "size", width: Math.ceil(root.scrollWidth), height: Math.ceil(root.scrollHeight) };
    var box = crop();
    if (box) message.crop = box;
    post(message);
  }
  function loadLibraries(list, done) {
    if (!list.length) return done();
    var script = document.createElement("script");
    script.src = list[0];
    script.onload = script.onerror = function () { loadLibraries(list.slice(1), done); };
    document.head.appendChild(script);
  }
  function runTask(__bebrasElements) {
    for (var __bebrasIndex = 0; __bebrasIndex < __bebrasElements.length; __bebrasIndex++) {
      eval(__bebrasElements[__bebrasIndex]);
    }
  }
  function start(savedState) {
    if (started) return;
    started = true;
    if (typeof Task !== "function" || typeof jQuery !== "function") return fail("engine");
    window.$ = jQuery.noConflict();
    var elements = window.__bebrasElements || [];
    elements.forEach(function (element) {
      if (element.type === "html") $("#bebras-task").append(element.content);
    });
    loadLibraries(
      elements.filter(function (element) { return element.type === "library"; }).map(function (element) { return element.content; }),
      function () {
        try {
          runTask(elements.filter(function (element) { return element.type === "javascript"; }).map(function (element) { return element.content; }));
          task.load();
        } catch (error) {
          return fail(error && error.message);
        }
        var waited = 0;
        var timer = setInterval(function () {
          waited += 50;
          var loaded = false;
          try { loaded = task.isLoaded(); } catch (error) {}
          if (!loaded) {
            if (waited > 20000) { clearInterval(timer); fail("timeout"); }
            return;
          }
          clearInterval(timer);
          var first = read();
          initial = first ? first.answer : null;
          if (savedState) {
            try { task.setState(savedState); } catch (error) {}
          }
          report("ready");
          size();
          setTimeout(size, 300);
          setTimeout(size, 1200);
          watch();
        }, 50);
      }
    );
  }
  function watch() {
    var pending = [];
    function soon() {
      pending.forEach(clearTimeout);
      pending = [setTimeout(function () { report("change"); }, 60), setTimeout(function () { report("change"); size(); }, 450)];
    }
    ["pointerup", "mouseup", "touchend", "click", "keyup", "input", "change", "drop", "dragend"].forEach(function (name) {
      document.addEventListener(name, soon, true);
    });
    setInterval(function () { report("change"); }, 1000);
    if (window.ResizeObserver) new ResizeObserver(size).observe(document.getElementById("bebras-task"));
  }
  window.addEventListener("message", function (event) {
    var data = event.data;
    if (event.source !== window.parent || !data || data.source !== HOST) return;
    if (data.type === "init") start(typeof data.state === "string" ? data.state : null);
  });
  window.addEventListener("error", function (event) {
    if (!started) fail(event.message);
  });
  var hello = 0;
  (function greet() {
    if (started || hello++ > 100) return;
    post({ type: "hello" });
    setTimeout(greet, 150);
  })();
})();
`;

const TEXT_TAGS = new Set([
  "P",
  "BR",
  "STRONG",
  "B",
  "EM",
  "I",
  "U",
  "UL",
  "OL",
  "LI",
  "SPAN",
  "SUB",
  "SUP",
  "CODE",
]);

/** El texto de instrucciones que se saca de la actividad: solo formato básico, sin atributos. */
export function sanitizeLodgeText(html: string) {
  const source = new DOMParser().parseFromString(html, "text/html").body;
  const clean = (node: Node, into: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        into.appendChild(document.createTextNode(child.textContent ?? ""));
      } else if (child instanceof HTMLElement) {
        if (["SCRIPT", "STYLE", "IFRAME", "OBJECT"].includes(child.tagName))
          continue;
        if (
          child instanceof HTMLImageElement &&
          child.getAttribute("src")?.startsWith("data:image/")
        ) {
          const image = document.createElement("img");
          image.src = child.getAttribute("src") ?? "";
          image.alt = child.getAttribute("alt") ?? "";
          const height = parseFloat(
            child.style.height || child.getAttribute("height") || "",
          );
          const width = parseFloat(
            child.style.width || child.getAttribute("width") || "",
          );
          if (height > 0) image.style.height = `${Math.min(height, 160)}px`;
          else if (width > 0) image.style.width = `${Math.min(width, 320)}px`;
          else image.style.height = "1.6em";
          image.className = "inline-block max-w-full align-middle";
          into.appendChild(image);
        } else if (TEXT_TAGS.has(child.tagName)) {
          const copy = document.createElement(child.tagName.toLowerCase());
          clean(child, copy);
          into.appendChild(copy);
        } else {
          clean(child, into);
        }
      }
    }
  };
  const result = document.createElement("div");
  clean(source, result);
  while (result.firstChild?.nodeName === "BR")
    result.removeChild(result.firstChild);
  return result.innerHTML;
}

export function interactiveSrcdoc(
  config: InteractiveConfig,
  engineUrl: string,
) {
  const engine = engineUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>
@font-face{font-family:"DM Sans Variable";font-style:normal;font-weight:100 1000;font-display:block;src:url(${dmSans}) format("woff2")}
*,*:before,*:after{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff;color:#1c1c1c;font-family:"DM Sans Variable","Helvetica Neue",Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;overflow:hidden}
button,input,select,textarea{font-family:inherit}
p{margin:0 0 10px}ul,ol{margin-top:0;margin-bottom:10px}
#bebras-task{display:block;width:fit-content}
.componental-task{position:relative}
html,body,#bebras-task,.componental-task,.componental-task *{touch-action:none}
.sortable-ghost{opacity:.4}
</style><script src="${engine}"></script></head><body><div id="bebras-task"></div>
<script>window.__bebrasElements=${scriptJson(config.elements)};</script>
<script>${BOOTSTRAP}</script></body></html>`;
}
