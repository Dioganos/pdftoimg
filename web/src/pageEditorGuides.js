const DEBOUNCE_MS = 120;

export function createPageEditorGuides({
  textEditor,
  markersLayer,
  toggleBtn,
  resetBtn,
  readBox,
  isActive,
}) {
  let visible = false;
  const manualDeltas = new Map();
  let debounceId = null;
  let dragState = null;

  function syncToolbar() {
    const on = visible && isActive();
    toggleBtn.classList.toggle("tb-btn-active", on);
    resetBtn.disabled = !on || manualDeltas.size === 0;
    markersLayer.classList.toggle("hidden", !on);
    markersLayer.setAttribute("aria-hidden", on ? "false" : "true");
  }

  function autoTopForBoundary(m, boxH) {
    return 12 + m * boxH;
  }

  function trimManualToCount(count) {
    for (const k of [...manualDeltas.keys()]) {
      if (k > count) manualDeltas.delete(k);
    }
  }

  function render() {
    if (!visible || !isActive()) {
      markersLayer.innerHTML = "";
      markersLayer.style.minHeight = "";
      syncToolbar();
      return;
    }
    const box = readBox();
    if (!box) {
      markersLayer.innerHTML = "";
      markersLayer.style.minHeight = "";
      syncToolbar();
      return;
    }
    const { boxH } = box;
    const innerH = Math.max(0, textEditor.scrollHeight - 24);
    const numPages = Math.max(1, Math.ceil(innerH / boxH));
    const count = numPages - 1;
    trimManualToCount(count);
    markersLayer.innerHTML = "";
    markersLayer.style.minHeight = `${textEditor.scrollHeight}px`;
    for (let m = 1; m <= count; m++) {
      const autoY = autoTopForBoundary(m, boxH);
      const delta = manualDeltas.get(m) || 0;
      const topPx = autoY + delta;
      const row = document.createElement("div");
      row.className = "page-guide-row";
      row.style.top = `${topPx}px`;
      row.dataset.boundary = String(m);
      const line = document.createElement("div");
      line.className = "page-guide-line";
      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = "page-guide-handle";
      handle.title = "Drag to adjust page break";
      handle.textContent = "⋮";
      handle.dataset.boundary = String(m);
      row.appendChild(line);
      row.appendChild(handle);
      markersLayer.appendChild(row);
    }
    syncToolbar();
  }

  function scheduleRender() {
    if (debounceId) clearTimeout(debounceId);
    debounceId = setTimeout(() => {
      debounceId = null;
      render();
    }, DEBOUNCE_MS);
  }

  function onPointerMove(e) {
    if (!dragState) return;
    const dy = e.clientY - dragState.startY;
    let next = dragState.startDelta + dy;
    const top = dragState.autoY + next;
    const minTop = 16;
    const maxTop = Math.max(minTop, textEditor.scrollHeight - 8);
    const clampedTop = Math.max(minTop, Math.min(maxTop, top));
    next = clampedTop - dragState.autoY;
    manualDeltas.set(dragState.m, next);
    const row = markersLayer.querySelector(
      `[data-boundary="${dragState.m}"]`
    );
    if (row) row.style.top = `${dragState.autoY + next}px`;
  }

  function endPointerDrag(e) {
    if (dragState?.handle && e.pointerId != null) {
      try {
        dragState.handle.releasePointerCapture(e.pointerId);
      } catch {}
    }
    dragState = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", endPointerDrag);
    window.removeEventListener("pointercancel", endPointerDrag);
    render();
  }

  function onPointerDown(e) {
    const h = e.target.closest(".page-guide-handle");
    if (!h || !visible) return;
    const m = Number(h.dataset.boundary);
    if (Number.isNaN(m)) return;
    const box = readBox();
    if (!box) return;
    dragState = {
      m,
      startY: e.clientY,
      startDelta: manualDeltas.get(m) || 0,
      autoY: autoTopForBoundary(m, box.boxH),
      handle: h,
    };
    try {
      h.setPointerCapture(e.pointerId);
    } catch {}
    e.preventDefault();
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", endPointerDrag);
    window.addEventListener("pointercancel", endPointerDrag);
  }

  markersLayer.addEventListener("pointerdown", onPointerDown);

  toggleBtn.addEventListener("click", () => {
    visible = !visible;
    if (!visible) {
      markersLayer.innerHTML = "";
      markersLayer.style.minHeight = "";
    }
    syncToolbar();
    render();
  });

  resetBtn.addEventListener("click", () => {
    manualDeltas.clear();
    render();
  });

  return {
    scheduleRender,
    render,
    applyEditorMetrics(boxW) {
      if (!boxW || boxW < 1) return;
      textEditor.style.width = `${boxW}px`;
      textEditor.style.maxWidth = "100%";
      textEditor.style.boxSizing = "border-box";
      textEditor.style.padding = "12px";
    },
    setVisible(v) {
      visible = v;
      syncToolbar();
      render();
    },
    clearManual() {
      manualDeltas.clear();
      render();
    },
    getBoundaryTops() {
      const box = readBox();
      if (!box) return [];
      const { boxH } = box;
      const innerH = Math.max(0, textEditor.scrollHeight - 24);
      const numPages = Math.max(1, Math.ceil(innerH / boxH));
      const count = numPages - 1;
      const tops = [];
      for (let m = 1; m <= count; m++) {
        const autoY = autoTopForBoundary(m, boxH);
        const delta = manualDeltas.get(m) || 0;
        tops.push(autoY + delta);
      }
      return tops;
    },
  };
}
