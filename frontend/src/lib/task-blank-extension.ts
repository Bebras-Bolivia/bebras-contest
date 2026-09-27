import { Extension, Node as TiptapNode } from "@tiptap/core";
import { Fragment, Slice, type Node } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { clampTaskIndent } from "./task-blank";

let cutSource: { view: EditorView; ids: Set<string> } | undefined;

function documentHasId(document: Node, id: string): boolean {
  let found = false;
  document.descendants((node) => {
    if (node.type.name === "taskBlank" && node.attrs.blankId === id)
      found = true;
  });
  return found;
}

export const TaskBlank = TiptapNode.create({
  name: "taskBlank",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      blankId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-task-blank"),
        renderHTML: (attributes) => ({ "data-task-blank": attributes.blankId }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-task-blank]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      {
        ...HTMLAttributes,
        contenteditable: "false",
        class:
          "task-blank mx-0.5 inline-block border-b-2 border-primary bg-primary/10 px-2 align-baseline text-sm font-medium text-primary",
        "aria-label": "Hueco",
      },
    ];
  },
  renderText() {
    return "[ … ]";
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("taskBlankIdentity"),
        props: {
          handleDOMEvents: {
            cut(view) {
              const ids = new Set<string>();
              view.state.selection.content().content.descendants((node) => {
                if (node.type.name === "taskBlank") ids.add(node.attrs.blankId);
              });
              cutSource = { view, ids };
              return false;
            },
            copy() {
              cutSource = undefined;
              return false;
            },
          },
          transformPasted(slice, view) {
            // ProseMirror also invokes this hook for dragging within the editor.
            // Its drop transaction removes the source after this hook runs.
            if (view.dragging?.move) return slice;
            function transform(fragment: Fragment): Fragment {
              const children: Node[] = [];
              fragment.forEach((node) => {
                if (node.type.name === "taskBlank") {
                  const id = node.attrs.blankId as string;
                  const moving =
                    cutSource?.ids.has(id) &&
                    !documentHasId(cutSource.view.state.doc, id) &&
                    !documentHasId(view.state.doc, id);
                  cutSource?.ids.delete(id);
                  children.push(
                    node.type.create(
                      { blankId: moving ? id : crypto.randomUUID() },
                      null,
                      node.marks,
                    ),
                  );
                } else children.push(node.copy(transform(node.content)));
              });
              return Fragment.from(children);
            }
            return new Slice(
              transform(slice.content),
              slice.openStart,
              slice.openEnd,
            );
          },
        },
        appendTransaction(transactions, _oldState, state) {
          if (!transactions.some((transaction) => transaction.docChanged))
            return null;
          const ids = new Set<string>();
          const transaction = state.tr;
          state.doc.descendants((node, position) => {
            if (node.type.name !== "taskBlank") return;
            let id = node.attrs.blankId;
            if (typeof id !== "string" || !id || ids.has(id)) {
              id = crypto.randomUUID();
              transaction.setNodeMarkup(position, undefined, { blankId: id });
            }
            ids.add(id);
          });
          return transaction.docChanged ? transaction : null;
        },
      }),
    ];
  },
});

export const TaskParagraphIndent = Extension.create({
  name: "taskParagraphIndent",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph"],
        attributes: {
          indent: {
            default: 0,
            parseHTML: (element) =>
              clampTaskIndent(element.getAttribute("data-indent")),
            renderHTML: (attributes) => {
              const indent = clampTaskIndent(attributes.indent);
              return indent
                ? {
                    "data-indent": indent,
                    style: `padding-inline-start: ${indent * 1.5}em`,
                  }
                : {};
            },
          },
        },
      },
    ];
  },
});
