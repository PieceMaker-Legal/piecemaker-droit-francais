import type { Node } from 'prosemirror-model';
import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

import { locateQuote } from '@/piecemaker/citations/locateQuote';

const HIGHLIGHT_NAME = 'piecemaker-citation';

type HighlightStore = {
  set: (name: string, value: unknown) => void;
  delete: (name: string) => void;
};

function highlightStore(): HighlightStore | undefined {
  return (CSS as typeof CSS & { highlights?: HighlightStore }).highlights;
}

function paintHighlight(view: EditorView, from: number, to: number) {
  const store = highlightStore();
  const HighlightCtor = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
  if (!store || !HighlightCtor) return;
  try {
    const start = view.domAtPos(from);
    const end = view.domAtPos(to);
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    store.set(HIGHLIGHT_NAME, new HighlightCtor(range));
  } catch {
    store.delete(HIGHLIGHT_NAME);
  }
}

function docText(doc: Node) {
  let text = '';
  const posAt: number[] = [];
  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      for (let index = 0; index < node.text.length; index += 1) {
        posAt.push(pos + index);
        text += node.text[index];
      }
      return;
    }
    if (node.isBlock && text.length > 0 && !text.endsWith('\n')) {
      text += '\n';
      posAt.push(pos);
    }
  });
  return { text, posAt };
}

export function citationRangeInDoc(doc: Node, quote: string) {
  const { text, posAt } = docText(doc);
  const hit = locateQuote(text, quote);
  if (!hit || hit.end <= hit.start) return null;
  const from = posAt[hit.start] ?? 0;
  const last = posAt[hit.end - 1];
  return { from, to: last === undefined ? from : last + 1 };
}

export function highlightCitationInDocx(views: EditorView[], quote: string) {
  highlightStore()?.delete(HIGHLIGHT_NAME);
  if (!quote) return false;
  for (const view of views) {
    const range = citationRangeInDoc(view.state.doc, quote);
    if (!range) continue;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, range.from, range.to)).scrollIntoView());
    paintHighlight(view, range.from, range.to);
    return true;
  }
  return false;
}

export function clearDocxCitationHighlight() {
  highlightStore()?.delete(HIGHLIGHT_NAME);
}
