import type { EditorView } from "@tiptap/pm/view";
import { TextSelection } from "@tiptap/pm/state";
import { CellSelection } from "@tiptap/pm/tables";

/** Right-click inside a selection preserves it; elsewhere it targets the clicked cell. */
export const selectTableContextTarget = (view: EditorView, cell: HTMLElement, coordinates?: { left: number; top: number }) => {
  if (!view.dom.contains(cell) || !view.editable) return false;
  const cellContentPos = view.posAtDOM(cell, 0);
  const { selection } = view.state;
  const hit = coordinates ? view.posAtCoords(coordinates)?.pos : selection.from;
  const pos = hit != null && hit >= cellContentPos && hit <= cellContentPos + (view.state.doc.nodeAt(cellContentPos - 1)?.content.size ?? 0)
    ? hit : cellContentPos;
  let insideSelection = !selection.empty && pos >= selection.from && pos <= selection.to;
  if (selection instanceof CellSelection) {
    insideSelection = false;
    selection.forEachCell((_node, cellPos) => {
      if (cellPos + 1 === cellContentPos) insideSelection = true;
    });
  }
  if (!insideSelection) view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos))));
  return true;
};
