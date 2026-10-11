function rangeFromViewportPoint(x, y) {
  if (document.caretRangeFromPoint) {
    return document.caretRangeFromPoint(x, y);
  }
  const pos = document.caretPositionFromPoint?.(x, y);
  if (!pos) return null;
  const r = document.createRange();
  r.setStart(pos.offsetNode, pos.offset);
  r.collapse(true);
  return r;
}

function insertBreakAtBoundaryLineStart(textEditor, wrap, topPx) {
  const wrapRect = wrap.getBoundingClientRect();
  const edRect = textEditor.getBoundingClientRect();
  const x = edRect.left + Math.min(24, Math.max(8, edRect.width * 0.25));
  const y = wrapRect.top + topPx - wrap.scrollTop;
  const range = rangeFromViewportPoint(x, y);
  if (!range || !textEditor.contains(range.commonAncestorContainer)) {
    return false;
  }
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  try {
    sel.modify("move", "backward", "lineboundary");
  } catch {
    try {
      sel.modify("move", "backward", "line");
    } catch {
      return false;
    }
  }
  const r2 = sel.rangeCount ? sel.getRangeAt(0) : null;
  if (!r2 || !textEditor.contains(r2.commonAncestorContainer)) {
    return false;
  }
  const br = document.createElement("br");
  r2.insertNode(br);
  return true;
}

export function insertSnapBreaksAtPageBoundaries(textEditor, wrap, getBoundaryTops) {
  const tops = getBoundaryTops().sort((a, b) => b - a);
  for (let i = 0; i < tops.length; i++) {
    insertBreakAtBoundaryLineStart(textEditor, wrap, tops[i]);
  }
}
