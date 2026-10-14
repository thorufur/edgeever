import { Fragment, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import { useTranslation } from "react-i18next";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger } from "@/components/ui/context-menu";
import { ClipboardCopyNotice } from "@/components/ClipboardCopyNotice";
import { copyHtmlToClipboard, copyTextToClipboard } from "@/lib/clipboard";
import { readTableClipboard } from "@/lib/editor-table-clipboard";
import { getEditorTableActions } from "@/lib/editor-table-actions";
import { isMouseTableContextEvent, selectTableContextTarget } from "@/lib/editor-table-context";

export const EditorTableContextMenu = ({ editor, readOnly, children }: {
  editor: Editor | null;
  readOnly: boolean;
  children: ReactNode;
}) => {
  const { t } = useTranslation();
  const [notice, setNotice] = useState<{ message: string; status: "copied" | "error" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const pending = useRef(false);
  const interactedOutside = useRef(false);
  const trigger = useRef<HTMLSpanElement>(null);
  const pointerType = useRef<string | null>(null);
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

  const openMenu = (cell: HTMLElement, point: { left: number; top: number }, keyboard = false) => {
    if (readOnly || !editor || editor.isDestroyed
      || !selectTableContextTarget(editor.view, cell, keyboard ? undefined : point)) return false;
    interactedOutside.current = false;
    target.current = editor.state;
    setNotice(null);
    // Keep Radix's trigger separate from the editor: its native long-press handler
    // and touch-callout style must not interfere with text selection or node views.
    trigger.current?.dispatchEvent(new globalThis.MouseEvent("contextmenu", {
      bubbles: true, cancelable: true, button: 2, clientX: point.left, clientY: point.top,
    }));
    return true;
  };

  const prepare = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === trigger.current || event.defaultPrevented
      || !isMouseTableContextEvent(event.nativeEvent, pointerType.current)) return;
    const cell = event.target instanceof Element ? event.target.closest<HTMLElement>("td, th") : null;
    if (cell && openMenu(cell, { left: event.clientX, top: event.clientY })) event.preventDefault();
  };

  const validTarget = () => {
    if (!editor || editor.isDestroyed || !target.current) return false;
    if (editor.state.doc === target.current.doc && editor.state.selection.eq(target.current.selection)) return true;
    setNotice({ message: t("aiAssistant.sidebar.selection.stale"), status: "error" });
    return false;
  };

  const openFromKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey))) return;
    if (!editor || editor.isDestroyed || !editor.isEditable || readOnly || !editor.isActive("table")) return;
    const { node } = editor.view.domAtPos(editor.state.selection.from);
    const element = node instanceof Element ? node : node.parentElement;
    const cell = element?.closest<HTMLElement>("td, th");
    if (!cell || !editor.view.dom.contains(cell)) return;
    const bounds = editor.view.coordsAtPos(editor.state.selection.from);
    if (openMenu(cell, { left: bounds.left, top: bounds.bottom }, true)) event.preventDefault();
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
      const { html, text, images } = await readTableClipboard(navigator.clipboard);
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
    <ContextMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <div
        onContextMenu={prepare}
        onKeyDown={openFromKeyboard}
        onPointerDownCapture={(event) => { pointerType.current = event.pointerType; }}
      >
        {children}
        <ContextMenuTrigger asChild disabled={readOnly || !editor || editor.isDestroyed}>
          <span ref={trigger} aria-hidden="true" />
        </ContextMenuTrigger>
      </div>
      <ContextMenuContent
        onInteractOutside={() => { interactedOutside.current = true; }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!interactedOutside.current && editor && !editor.isDestroyed) {
            editor.commands.focus(undefined, { scrollIntoView: false });
          }
        }}
      >
        <ContextMenuItem disabled={!canCopy || busy} onSelect={() => { void copy(); setMenuOpen(false); }}>
          {t("aiAssistant.sidebar.selection.copy")}<ContextMenuShortcut>{modifier}C</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem disabled={readOnly || busy} onSelect={() => { void paste(); setMenuOpen(false); }}>
          {t("editor.paste")}<ContextMenuShortcut>{modifier}V</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        {getEditorTableActions(editor, readOnly).map((action) => (
          <Fragment key={action.key}>
            {action.destructive ? <ContextMenuSeparator /> : null}
            <ContextMenuItem disabled={action.disabled || busy} className={action.destructive ? "text-rose-700 focus:text-rose-800" : undefined} onSelect={() => { if (validTarget()) action.run(); setMenuOpen(false); }}>
              {t(action.key)}
            </ContextMenuItem>
          </Fragment>
        ))}
      </ContextMenuContent>
      {notice ? <ClipboardCopyNotice status={notice.status}>{notice.message}</ClipboardCopyNotice> : null}
    </ContextMenu>
  );
};
