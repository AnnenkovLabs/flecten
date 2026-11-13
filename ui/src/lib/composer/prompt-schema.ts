import { Extension, Node } from "@tiptap/core";
import { baseKeymap } from "@tiptap/pm/commands";
import { history, redo, undo } from "@tiptap/pm/history";
import { keymap } from "@tiptap/pm/keymap";

const Document = Node.create({ name: "doc", topNode: true, content: "paragraph" });
const Paragraph = Node.create({
  name: "paragraph",
  content: "inline*",
  group: "block",
  whitespace: "pre",
  parseHTML: () => [{ tag: "p" }],
  renderHTML: () => ["p", 0],
});
const Text = Node.create({ name: "text", group: "inline" });

// T3Code's composer uses an inline atom with a basename label and a separate source path.
// Adapted to Svelte without its React node view or Markdown formatting extensions.
const Mention = Node.create({
  name: "mention",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => ({
    path: { default: "" },
    kind: { default: "file" },
    context: { default: null },
    label: { default: null },
  }),
  parseHTML: () => [{ tag: "span[data-mention]" }],
  renderHTML({ node }) {
    const path = String(node.attrs.path);
    const name =
      node.attrs.label ?? path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
    return [
      "span",
      {
        "data-mention": "",
        "data-path": path,
        "data-kind": node.attrs.kind,
        class: "prompt-mention",
        contenteditable: "false",
        title: path,
        "aria-label": path,
        dir: "ltr",
      },
      ...(node.attrs.kind === "image"
        ? []
        : [["span", { class: "prompt-mention-mark", "aria-hidden": "true" }, "@"]]),
      ["span", { class: "prompt-mention-name" }, name],
    ];
  },
  renderText: ({ node }) => `@${String(node.attrs.path)}`,
});

const Editing = Extension.create({
  name: "promptEditing",
  addProseMirrorPlugins: () => [
    history(),
    keymap({ ...baseKeymap, "Mod-z": undo, "Mod-Shift-z": redo, "Mod-y": redo }),
  ],
  addKeyboardShortcuts() {
    const removeAtom = (direction: -1 | 1): boolean => {
      const { selection } = this.editor.state;
      if (!selection.empty) return false;
      const adjacent = direction === -1 ? selection.$from.nodeBefore : selection.$from.nodeAfter;
      if (adjacent?.type.name !== "mention") return false;
      return this.editor.commands.deleteRange({
        from: selection.from - (direction === -1 ? adjacent.nodeSize : 0),
        to: selection.from + (direction === 1 ? adjacent.nodeSize : 0),
      });
    };
    return {
      "Shift-Enter": () => this.editor.commands.insertContent({ type: "text", text: "\n" }),
      "Alt-Enter": () => this.editor.commands.insertContent({ type: "text", text: "\n" }),
      Backspace: () => removeAtom(-1),
      Delete: () => removeAtom(1),
    };
  },
});

export const promptExtensions = [Document, Paragraph, Text, Mention, Editing];
