import { Fragment, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import { useTranslation } from "react-i18next";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger } from "@/components/ui/context-menu";
import { ClipboardCopyNotice } from "@/components/ClipboardCopyNotice";
import { copyHtmlToClipboard, copyTextToClipboard } from "@/lib/clipboard";
import { getEditorTableActions } from "@/lib/editor-table-actions";
import { selectTableContextTarget } from "@/lib/editor-table-context";

export const EditorTableContextMenu = ({ editor, readOnly, children }: {
  editor: Editor | null;
  readOnly: boolean;
  children: ReactNode;
}) => {
  const { t } = useTranslation();
  const [notice, setNotice] = useState<{ message: string; status: "copied" | "error" } | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const interactedOutside = useRef(false);
  const target = useRef<Editor["state"] | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const state = useEditorState({ editor, selector: ({ editor: active }) =>
    (active?.isActive("table") ? 1 : 0)
    | (active?.isActive("tableHeader") ? 2 : 0)
    | (active && !active.state.selection.empty ? 4 : 0),
  });
  const canCopy = Boolean((state ?? 0) & 4);
  const modifier = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

  const prepare = (event: MouseEvent<HTMLDivElement>) => {
    const cell = event.target instanceof Element ? event.target.closest<HTMLElement>("td, th") : null;
    if (event.shiftKey || readOnly || !editor || editor.isDestroyed || !cell
      || !selectTableContextTarget(editor.view, cell, event.button === 2 ? { left: event.clientX, top: event.clientY } : undefined)) {
      // Do not preventDefault: the normal browser menu must remain available elsewhere.
      event.stopPropagation();
      return;
    }
    interactedOutside.current = false;
    target.current = editor.state;
    setNotice(null);
  };

  const validTarget = () => {
    if (!editor || editor.isDestroyed || !target.current) return false;
    if (editor.state.doc === target.current.doc && editor.state.selection.eq(target.current.selection)) return true;
    setNotice({ message: t("aiAssistant.sidebar.selection.stale"), status: "error" });
    return false;
  };

  const openFromKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey)) return;
    if (!editor || editor.isDestroyed || !editor.isEditable || readOnly || !editor.isActive("table")) return;
    const { node } = editor.view.domAtPos(editor.state.selection.from);
    const element = node instanceof Element ? node : node.parentElement;
    const cell = element?.closest<HTMLElement>("td, th");
    if (!cell || !editor.view.dom.contains(cell)) return;
    const bounds = editor.view.coordsAtPos(editor.state.selection.from);
    event.preventDefault();
    // Radix uses these coordinates for the menu's virtual anchor.
    cell.dispatchEvent(new globalThis.MouseEvent("contextmenu", {
      bubbles: true, cancelable: true, button: 0, clientX: bounds.left, clientY: bounds.bottom,
    }));
  };

  const copy = async () => {
    if (!editor || editor.isDestroyed || editor.state.selection.empty || !validTarget()) return;
    try {
      const { dom, text } = editor.view.serializeForClipboard(editor.state.selection.content());
      try {
        await copyHtmlToClipboard(dom.innerHTML, text);
      } catch {
        if (!await copyTextToClipboard(text)) throw new Error("Clipboard copy unavailable");
      }
      if (mounted.current) setNotice({ message: t("common.copied"), status: "copied" });
    } catch {
      if (mounted.current) setNotice({ message: `${t("systemInfo.copyFailed")} (${modifier}C)`, status: "error" });
    }
  };

  const paste = async () => {
    if (!editor || editor.isDestroyed || !editor.isEditable || readOnly || pending.current || !validTarget()) return;
    const { doc, selection } = editor.state;
    pending.current = true;
    setBusy(true);
    try {
      let html = "";
      let text = "";
      const images: File[] = [];
      if (navigator.clipboard?.read) {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          if (item.types.includes("text/html")) html += await (await item.getType("text/html")).text();
          if (item.types.includes("text/plain")) text += await (await item.getType("text/plain")).text();
          for (const type of item.types.filter((type) => type.startsWith("image/"))) {
            images.push(new File([await item.getType(type)], `clipboard.${type.split("/")[1]}`, { type }));
          }
        }
      } else if (navigator.clipboard?.readText) {
        text = await navigator.clipboard.readText();
      } else {
        throw new Error("Clipboard read unavailable");
      }
      // A permission prompt may outlive a note switch or an edit. Never paste into a changed target.
      if (!mounted.current || editor.isDestroyed) return;
      if (!editor.isEditable || editor.state.doc !== doc || !editor.state.selection.eq(selection)) {
        setNotice({ message: t("aiAssistant.sidebar.selection.stale"), status: "error" });
        return;
      }
      editor.view.focus();
      if (html) editor.view.pasteHTML(html);
      else if (text) editor.view.pasteText(text);
      else if (images.length) {
        const transfer = new DataTransfer();
        for (const image of images) transfer.items.add(image);
        // Reuse the editor's existing attachment upload pipeline.
        editor.view.dom.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
      }
    } catch {
      if (mounted.current) setNotice({ message: `${t("editor.clipboardReadFailed")} (${modifier}V)`, status: "error" });
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild disabled={readOnly || !editor || editor.isDestroyed}>
        <div
          onContextMenuCapture={prepare}
          onKeyDown={openFromKeyboard}
          onPointerDownCapture={(event) => {
            // This desktop experiment must not override native touch selection with Radix long-press.
            if (event.pointerType !== "mouse") event.stopPropagation();
          }}
        >{children}</div>
      </ContextMenuTrigger>
      <ContextMenuContent
        onInteractOutside={() => { interactedOutside.current = true; }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!interactedOutside.current && editor && !editor.isDestroyed) editor.view.focus();
        }}
      >
        <ContextMenuItem disabled={!canCopy || busy} onSelect={() => void copy()}>
          {t("aiAssistant.sidebar.selection.copy")}<ContextMenuShortcut>{modifier}C</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem disabled={readOnly || busy} onSelect={() => void paste()}>
          {t("editor.paste")}<ContextMenuShortcut>{modifier}V</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        {getEditorTableActions(editor, readOnly).map((action) => (
          <Fragment key={action.key}>
            {action.destructive ? <ContextMenuSeparator /> : null}
            <ContextMenuItem disabled={action.disabled || busy} className={action.destructive ? "text-rose-700 focus:text-rose-800" : undefined} onSelect={() => { if (validTarget()) action.run(); }}>
              {t(action.key)}
            </ContextMenuItem>
          </Fragment>
        ))}
      </ContextMenuContent>
      {notice ? <ClipboardCopyNotice status={notice.status}>{notice.message}</ClipboardCopyNotice> : null}
    </ContextMenu>
  );
};
