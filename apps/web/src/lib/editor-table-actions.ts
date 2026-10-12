import type { Editor } from "@tiptap/react";

/** Both menus share commands and the existing header-row protection. */
export const getEditorTableActions = (editor: Editor | null, readOnly: boolean) => {
  const inTable = Boolean(editor && !editor.isDestroyed && editor.isActive("table"));
  const actions = [
    { key: "editorToolbar.addTableRow", command: "addRowAfter" },
    { key: "editorToolbar.deleteTableRow", command: "deleteRow", protectHeader: true },
    { key: "editorToolbar.addTableColumn", command: "addColumnAfter" },
    { key: "editorToolbar.deleteTableColumn", command: "deleteColumn" },
    { key: "editorToolbar.toggleTableHeader", command: "toggleHeaderRow" },
    { key: "editorToolbar.deleteTable", command: "deleteTable", destructive: true },
  ] as const;
  return actions.map((action) => ({
    key: action.key,
    destructive: "destructive" in action,
    disabled: readOnly || !inTable || ("protectHeader" in action && Boolean(editor?.isActive("tableHeader"))),
    run: () => {
      if (!editor || editor.isDestroyed || !editor.isEditable || readOnly || !editor.isActive("table")) return;
      if ("protectHeader" in action && editor.isActive("tableHeader")) return;
      editor.chain().focus()[action.command]().run();
    },
  }));
};
