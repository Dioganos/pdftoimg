import JSZip from "jszip";
import { convertPdfInBrowser } from "./convert.js";
import { renderHtmlToImagePages } from "./htmlToImage.js";
import defaultPageBgUrl from "./assets/bg.webp?url";
import defaultEditorFontUrl from "./assets/HarryPotter-ov4z.ttf?url";
import { createPageEditorGuides } from "./pageEditorGuides.js";
import { insertSnapBreaksAtPageBoundaries } from "./pageBreakReflow.js";

const $ = (id) => document.getElementById(id);

let syncEditorLayoutForExport = () => {};
let pageGuides = null;

const HINT_PDF = `Browsers cannot pick an arbitrary “output folder.” PDF output is a ZIP download. Text (.txt) output is a single image file.`;
const HINT_TXT = `Use the toolbar for bold, lists, and Left/Center/Right to align each paragraph. If there is empty space under your text, set “Vertical position in white area” to Top.`;
const HINT_COMPOSE = `Type below, then Convert & download. The file is saved as page plus your format (e.g. page.webp).`;

const TXT_CUSTOM_FONT_FAMILY = "PdftoimgCustom";

const TEXT_FONT_PRESETS = {
  georgia: 'Georgia, "Times New Roman", "Noto Serif", serif',
  times: '"Times New Roman", Times, Georgia, serif',
  arial: "Arial, Helvetica, sans-serif",
  verdana: "Verdana, Geneva, sans-serif",
  courier: '"Courier New", Courier, monospace',
  palatino: '"Palatino Linotype", Palatino, "Book Antiqua", serif',
  garamond: "Garamond, Baskerville, Georgia, serif",
};

let customTextFontFace = null;
let customTextFontObjectUrl = null;

function baseFromFileName(name) {
  const n = name.replace(/.*[/\\]/, "");
  const dot = n.lastIndexOf(".");
  const stem = dot > 0 ? n.slice(0, dot) : n;
  const safe = stem.replace(/[^\w\-.\u0080-\uFFFF]+/g, "_").trim();
  return safe || "document";
}

function isPdfFile(file) {
  return (
    file &&
    (file.type === "application/pdf" || /\.pdf$/i.test(file.name))
  );
}

function isTxtFile(file) {
  return (
    file &&
    (file.type === "text/plain" ||
      /\.txt$/i.test(file.name) ||
      file.type === "text/plain;charset=UTF-8")
  );
}

function clearRichEditor() {
  const el = $("textEditor");
  el.innerHTML = "<p><br></p>";
}

function readOptions() {
  const w = Number($("width").value);
  const h = Number($("height").value);
  const top = Number($("top").value);
  const bottom = Number($("bottom").value);
  const pad = Number($("pad").value);
  const quality = Number($("quality").value);
  const format = $("format").value;
  const fitWidth = $("fitWidth").checked;

  if ([w, h, top, bottom, pad].some((n) => Number.isNaN(n))) {
    throw new Error("Enter valid numbers for size and padding.");
  }
  if (w <= 0 || h <= 0 || top < 0 || bottom < 0 || pad < 0) {
    throw new Error("Width and height must be positive; padding cannot be negative.");
  }
  if (2 * pad >= w || 2 * pad >= h) {
    throw new Error("Inner pad is too large for the chosen width and height.");
  }
  if ((format === "webp" || format === "jpeg") && (Number.isNaN(quality) || quality < 1 || quality > 100)) {
    throw new Error("Quality must be between 1 and 100.");
  }

  return {
    contentWidth: w,
    contentHeight: h,
    topPadding: top,
    bottomPadding: bottom,
    fitWidth,
    innerPad: pad,
    outputFormat: format,
    quality: format === "png" ? undefined : quality,
  };
}

let pageBackgroundBitmap = null;
let suppressDefaultPageBackground = false;
let pageBackgroundFromBundledDefault = false;
let pageBackgroundUploadLabel = "";

const DEFAULT_PAGE_BG_LABEL = "bg.webp";
const DEFAULT_EDITOR_FONT_LABEL = "HarryPotter-ov4z.ttf";

let textFontFromBundledDefault = false;
let textFontUploadLabel = "";

function fallbackPublicBgUrl() {
  const base = import.meta.env.BASE_URL || "/";
  const path = base.endsWith("/") ? `${base}bg.webp` : `${base}/bg.webp`;
  try {
    return new URL(path, document.baseURI || window.location.href).href;
  } catch {
    return path;
  }
}

function syncPageBackgroundStatusHint() {
  const el = $("pageBackgroundStatus");
  if (!el) return;
  if (!pageBackgroundBitmap) {
    el.textContent = "";
    return;
  }
  if (pageBackgroundFromBundledDefault) {
    el.textContent = `Using default: ${DEFAULT_PAGE_BG_LABEL}`;
    return;
  }
  if (pageBackgroundUploadLabel) {
    el.textContent = `Using: ${pageBackgroundUploadLabel}`;
    return;
  }
  el.textContent = "";
}

async function loadDefaultPageBackground() {
  if (suppressDefaultPageBackground || pageBackgroundBitmap) return;
  const urls = [defaultPageBgUrl, fallbackPublicBgUrl()];
  for (let i = 0; i < urls.length; i++) {
    try {
      const res = await fetch(urls[i]);
      if (!res.ok) continue;
      const blob = await res.blob();
      pageBackgroundBitmap = await createImageBitmap(blob);
      pageBackgroundFromBundledDefault = i === 0;
      pageBackgroundUploadLabel = "";
      syncPageBackgroundStatusHint();
      return;
    } catch {
    }
  }
}

function pageBackgroundForExport() {
  if (!pageBackgroundBitmap) return {};
  return {
    pageBackground: pageBackgroundBitmap,
  };
}

function setRichBusy(busy) {
  $("convert").disabled = busy;
  $("fileInput").disabled = busy;
  $("composeTextMode").disabled = busy;
  $("textAlign").disabled = busy;
  $("textValign").disabled = busy;
  $("textFontSize").disabled = busy;
  $("textFontFamily").disabled = busy;
  $("textCustomFontInput").disabled = busy;
  $("textCustomFontClear").disabled = busy;
  $("toolbarTextColor").disabled = busy;
  $("pageBackgroundInput").disabled = busy;
  $("pageBackgroundClear").disabled = busy;
  $("pageGuidesToggle").disabled = busy;
  $("pageGuidesSnapLines").disabled = busy;
  if (busy) {
    $("pageGuidesReset").disabled = true;
  } else if (pageGuides) {
    pageGuides.render();
  }
  const ed = $("textEditor");
  ed.contentEditable = busy ? "false" : "true";
  ed.setAttribute("aria-disabled", busy ? "true" : "false");
  document.querySelectorAll("#richToolbar .tb-btn").forEach((b) => {
    b.disabled = busy;
  });
}

function isComposeTextMode() {
  return $("composeTextMode").checked;
}

function readExportBoxDimensions() {
  const w = Number($("width").value);
  const h = Number($("height").value);
  const pad = Number($("pad").value);
  if (
    [w, h, pad].some((n) => Number.isNaN(n)) ||
    w <= 0 ||
    h <= 0 ||
    pad < 0 ||
    2 * pad >= w ||
    2 * pad >= h
  ) {
    return null;
  }
  return {
    boxW: Math.max(1, w - 2 * pad),
    boxH: Math.max(1, h - 2 * pad),
  };
}

function isTxtPanelActive() {
  return !$("txtPanel").classList.contains("hidden");
}

function syncTextModeUi() {
  const file = $("fileInput").files?.[0];
  const txtPanel = $("txtPanel");
  const fitWidthWrap = $("fitWidthWrap");
  const hint = $("hint");

  if (file && isPdfFile(file)) {
    txtPanel.classList.add("hidden");
    fitWidthWrap.classList.remove("hidden");
    hint.textContent = HINT_PDF;
    clearRichEditor();
    syncEditorLayoutForExport();
    return;
  }
  if (file && isTxtFile(file)) {
    txtPanel.classList.remove("hidden");
    fitWidthWrap.classList.add("hidden");
    hint.textContent = HINT_TXT;
    syncEditorLayoutForExport();
    return;
  }
  if (isComposeTextMode()) {
    txtPanel.classList.remove("hidden");
    fitWidthWrap.classList.add("hidden");
    hint.textContent = HINT_COMPOSE;
    syncEditorLayoutForExport();
    return;
  }
  txtPanel.classList.add("hidden");
  fitWidthWrap.classList.remove("hidden");
  hint.textContent = HINT_PDF;
  syncEditorLayoutForExport();
}

function syncEditorTextAlign() {
  $("textEditor").style.textAlign = $("textAlign").value;
}

function readTextFontSizePx() {
  const n = Number($("textFontSize").value);
  if (Number.isNaN(n)) return 20;
  return Math.min(120, Math.max(8, Math.round(n)));
}

function syncEditorFontSize() {
  $("textEditor").style.fontSize = `${readTextFontSizePx()}px`;
}

function presetFontStack() {
  const key = $("textFontFamily").value;
  return TEXT_FONT_PRESETS[key] || TEXT_FONT_PRESETS.georgia;
}

function getTextFontFamilyCss() {
  const base = presetFontStack();
  if (customTextFontFace) {
    return `"${TXT_CUSTOM_FONT_FAMILY}", ${base}`;
  }
  return base;
}

function syncEditorFontFamily() {
  $("textEditor").style.fontFamily = getTextFontFamilyCss();
}

function syncTextFontStatusHint() {
  const el = $("textCustomFontStatus");
  if (!el) return;
  if (customTextFontFace && textFontFromBundledDefault) {
    el.textContent = `Using default: ${DEFAULT_EDITOR_FONT_LABEL}`;
    return;
  }
  if (customTextFontFace && textFontUploadLabel) {
    el.textContent = `Using: ${textFontUploadLabel}`;
    return;
  }
  el.textContent = "";
}

async function clearCustomTextFont() {
  if (customTextFontFace) {
    try {
      document.fonts.delete(customTextFontFace);
    } catch {}
    customTextFontFace = null;
  }
  if (customTextFontObjectUrl) {
    URL.revokeObjectURL(customTextFontObjectUrl);
    customTextFontObjectUrl = null;
  }
  textFontFromBundledDefault = false;
  textFontUploadLabel = "";
  syncTextFontStatusHint();
}

async function loadBundledTextFont(url) {
  await clearCustomTextFont();
  const face = new FontFace(TXT_CUSTOM_FONT_FAMILY, `url(${url})`);
  await face.load();
  document.fonts.add(face);
  customTextFontFace = face;
  textFontFromBundledDefault = true;
  textFontUploadLabel = "";
  syncEditorFontFamily();
  syncEditorLayoutForExport();
  syncTextFontStatusHint();
}

async function loadCustomTextFont(file) {
  await clearCustomTextFont();
  const url = URL.createObjectURL(file);
  customTextFontObjectUrl = url;
  const face = new FontFace(TXT_CUSTOM_FONT_FAMILY, `url(${url})`);
  await face.load();
  document.fonts.add(face);
  customTextFontFace = face;
  textFontUploadLabel = file.name;
  textFontFromBundledDefault = false;
  syncEditorFontFamily();
  syncEditorLayoutForExport();
  syncTextFontStatusHint();
}

$("textAlign").addEventListener("change", () => {
  syncEditorTextAlign();
  syncEditorLayoutForExport();
});
$("textCustomFontInput").addEventListener("change", async () => {
  const f = $("textCustomFontInput").files?.[0];
  if (!f) {
    await clearCustomTextFont();
    syncEditorFontFamily();
    syncEditorLayoutForExport();
    return;
  }
  try {
    await loadCustomTextFont(f);
  } catch {
    $("textCustomFontInput").value = "";
    await clearCustomTextFont();
    syncEditorFontFamily();
    try {
      await loadBundledTextFont(defaultEditorFontUrl);
    } catch {}
    $("status").textContent = "Could not load that font file.";
  }
});
$("textCustomFontClear").addEventListener("click", async () => {
  $("textCustomFontInput").value = "";
  await clearCustomTextFont();
  syncEditorFontFamily();
  syncEditorLayoutForExport();
});

const toolbar = $("richToolbar");
const textEditor = $("textEditor");
const toolbarTextColor = $("toolbarTextColor");
const tbColorLetter = toolbar.querySelector(".tb-color-a");

pageGuides = createPageEditorGuides({
  textEditor,
  markersLayer: $("pageMarkersLayer"),
  toggleBtn: $("pageGuidesToggle"),
  resetBtn: $("pageGuidesReset"),
  readBox: readExportBoxDimensions,
  isActive: isTxtPanelActive,
});

$("pageGuidesSnapLines").addEventListener("click", () => {
  textEditor.focus();
  insertSnapBreaksAtPageBoundaries(textEditor, $("richEditorWrap"), () =>
    pageGuides.getBoundaryTops()
  );
  syncEditorLayoutForExport();
});

syncEditorLayoutForExport = () => {
  const box = readExportBoxDimensions();
  if (box) pageGuides.applyEditorMetrics(box.boxW);
  pageGuides.scheduleRender();
};

textEditor.addEventListener("input", () => {
  if (pageGuides) pageGuides.scheduleRender();
});

["width", "height", "pad"].forEach((id) => {
  $(id).addEventListener("input", syncEditorLayoutForExport);
  $(id).addEventListener("change", syncEditorLayoutForExport);
});
$("textFontFamily").addEventListener("change", () => {
  syncEditorFontFamily();
  syncEditorLayoutForExport();
});
$("textFontSize").addEventListener("change", () => {
  syncEditorFontSize();
  syncEditorLayoutForExport();
});
$("textFontSize").addEventListener("input", () => {
  syncEditorFontSize();
  syncEditorLayoutForExport();
});

let savedTextRange = null;
let selectionColorSyncScheduled = false;

const DEFAULT_TEXT_HEX = "#1a1a1a";

function cssColorToHex(css) {
  if (!css || css === "transparent") return DEFAULT_TEXT_HEX;
  const m = css.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (m) {
    const r = Math.min(255, parseInt(m[1], 10));
    const g = Math.min(255, parseInt(m[2], 10));
    const b = Math.min(255, parseInt(m[3], 10));
    return `#${[r, g, b]
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("")}`;
  }
  const t = css.trim();
  if (/^#[0-9a-f]{3}$/i.test(t)) {
    const h = t.slice(1);
    return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`.toLowerCase();
  }
  if (/^#[0-9a-f]{6}$/i.test(t)) return t.toLowerCase();
  return DEFAULT_TEXT_HEX;
}

function elementAtRangeStart(range, root) {
  const sc = range.startContainer;
  const so = range.startOffset;
  if (sc.nodeType === Node.TEXT_NODE) {
    return sc.parentElement;
  }
  if (sc === root) {
    if (so < sc.childNodes.length) {
      const n = sc.childNodes[so];
      if (n.nodeType === Node.ELEMENT_NODE) return n;
      if (n.nodeType === Node.TEXT_NODE) return n.parentElement;
      return root;
    }
    if (so > 0) {
      const n = sc.childNodes[so - 1];
      if (n.nodeType === Node.ELEMENT_NODE) return n;
      if (n.nodeType === Node.TEXT_NODE) return n.parentElement;
    }
    return root;
  }
  if (sc.nodeType === Node.ELEMENT_NODE) {
    if (so < sc.childNodes.length) {
      const n = sc.childNodes[so];
      if (n.nodeType === Node.ELEMENT_NODE) return n;
      if (n.nodeType === Node.TEXT_NODE) return n.parentElement;
    }
    return sc;
  }
  return root;
}

function hexAtSelection() {
  const sel = window.getSelection();
  if (!sel.rangeCount || !textEditor.contains(sel.anchorNode)) {
    return DEFAULT_TEXT_HEX;
  }
  const range = sel.getRangeAt(0);
  if (!textEditor.contains(range.commonAncestorContainer)) {
    return DEFAULT_TEXT_HEX;
  }
  try {
    document.execCommand("styleWithCSS", false, true);
    const q = document.queryCommandValue("foreColor");
    if (q && typeof q === "string") {
      if (/^\d+,\s*\d+,\s*\d+/.test(q)) {
        const p = q.split(",").map((x) => parseInt(x.trim(), 10));
        if (p.length >= 3 && p.every((n) => !Number.isNaN(n))) {
          return cssColorToHex(`rgb(${p[0]}, ${p[1]}, ${p[2]})`);
        }
      }
      if (/^rgb/i.test(q) || /^#/i.test(q)) return cssColorToHex(q);
    }
  } catch (_) {}
  const el = elementAtRangeStart(range, textEditor);
  return cssColorToHex(getComputedStyle(el).color);
}

function setToolbarColorUi(hex) {
  const h = /^#[0-9a-f]{6}$/i.test(hex) ? hex.toLowerCase() : DEFAULT_TEXT_HEX;
  toolbarTextColor.value = h;
  if (tbColorLetter) {
    tbColorLetter.style.color = h;
    tbColorLetter.style.borderBottomColor = h;
  }
}

function syncToolbarColorFromSelection() {
  if (document.activeElement === toolbarTextColor) return;
  setToolbarColorUi(hexAtSelection());
}

function syncAlignToolbarFromSelection() {
  const cmds = ["justifyLeft", "justifyCenter", "justifyRight"];
  for (const cmd of cmds) {
    const btn = toolbar.querySelector(`[data-cmd="${cmd}"]`);
    if (!btn) continue;
    let on = false;
    try {
      on = document.queryCommandState(cmd);
    } catch {}
    btn.classList.toggle("tb-btn-active", on);
  }
}

function scheduleSelectionColorSync() {
  if (selectionColorSyncScheduled) return;
  selectionColorSyncScheduled = true;
  requestAnimationFrame(() => {
    selectionColorSyncScheduled = false;
    syncToolbarColorFromSelection();
    syncAlignToolbarFromSelection();
  });
}

document.addEventListener("selectionchange", () => {
  const sel = window.getSelection();
  if (!sel.anchorNode || !textEditor.contains(sel.anchorNode)) return;
  if (document.activeElement === toolbarTextColor) return;
  scheduleSelectionColorSync();
});

textEditor.addEventListener("keyup", scheduleSelectionColorSync);
textEditor.addEventListener("mouseup", scheduleSelectionColorSync);

toolbar.addEventListener(
  "mousedown",
  (e) => {
    if (e.target.closest("[data-cmd]")) e.preventDefault();
    if (e.target.closest(".tb-color")) {
      syncToolbarColorFromSelection();
      const sel = window.getSelection();
      if (
        sel.rangeCount > 0 &&
        textEditor.contains(sel.getRangeAt(0).commonAncestorContainer)
      ) {
        savedTextRange = sel.getRangeAt(0).cloneRange();
      } else {
        savedTextRange = null;
      }
    }
  },
  true
);

function applyToolbarTextColor(hex) {
  textEditor.focus();
  const sel = window.getSelection();
  if (savedTextRange) {
    sel.removeAllRanges();
    sel.addRange(savedTextRange);
  } else if (
    !(
      sel.rangeCount > 0 &&
      textEditor.contains(sel.getRangeAt(0).commonAncestorContainer)
    )
  ) {
    return;
  }
  try {
    document.execCommand("styleWithCSS", false, true);
    document.execCommand("foreColor", false, hex);
  } catch (_) {}
  setToolbarColorUi(hex);
}

toolbarTextColor.addEventListener("change", (e) => {
  applyToolbarTextColor(e.target.value);
  savedTextRange = null;
});

toolbar.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-cmd]");
  if (!btn || btn.disabled) return;
  textEditor.focus();
  const cmd = btn.dataset.cmd;
  try {
    if (cmd.startsWith("justify")) {
      document.execCommand("styleWithCSS", false, true);
    }
    document.execCommand(cmd, false, null);
  } catch (_) {}
  requestAnimationFrame(() => syncAlignToolbarFromSelection());
});

$("pageBackgroundInput").addEventListener("change", async () => {
  const f = $("pageBackgroundInput").files?.[0];
  if (pageBackgroundBitmap) {
    pageBackgroundBitmap.close();
    pageBackgroundBitmap = null;
  }
  pageBackgroundFromBundledDefault = false;
  pageBackgroundUploadLabel = "";
  if (!f) {
    syncPageBackgroundStatusHint();
    return;
  }
  try {
    pageBackgroundBitmap = await createImageBitmap(f);
    pageBackgroundUploadLabel = f.name;
    syncPageBackgroundStatusHint();
  } catch {
    $("pageBackgroundInput").value = "";
    syncPageBackgroundStatusHint();
  }
});

$("pageBackgroundClear").addEventListener("click", () => {
  suppressDefaultPageBackground = true;
  $("pageBackgroundInput").value = "";
  pageBackgroundFromBundledDefault = false;
  pageBackgroundUploadLabel = "";
  if (pageBackgroundBitmap) {
    pageBackgroundBitmap.close();
    pageBackgroundBitmap = null;
  }
  syncPageBackgroundStatusHint();
});

$("composeTextMode").addEventListener("change", () => {
  syncTextModeUi();
});

$("fileInput").addEventListener("change", async () => {
  const file = $("fileInput").files?.[0];
  syncTextModeUi();
  if (file && isTxtFile(file)) {
    try {
      const t = await file.text();
      textEditor.innerText = t;
      syncEditorTextAlign();
      syncEditorFontSize();
      scheduleSelectionColorSync();
    } catch {
      clearRichEditor();
    }
  }
});

$("convert").addEventListener("click", async () => {
  const fileInput = $("fileInput");
  const file = fileInput.files?.[0];
  const status = $("status");
  const progressWrap = $("progressWrap");
  const progressBar = $("progressBar");

  status.textContent = "";
  progressWrap.classList.add("hidden");
  progressBar.style.width = "0%";

  const compose = isComposeTextMode();
  if (!file && !compose) {
    status.textContent =
      "Choose a PDF or .txt file, or turn on “Write text directly”.";
    return;
  }

  const pdf = file && isPdfFile(file);
  const txt = file && isTxtFile(file);
  if (file && !pdf && !txt) {
    status.textContent = "Use a .pdf or .txt file.";
    return;
  }

  try {
    const options = readOptions();
    setRichBusy(true);

    if (txt || (!file && compose)) {
      const align = $("textAlign").value;
      const valign = $("textValign").value;
      if (!["left", "center", "right"].includes(align)) {
        throw new Error("Invalid text alignment.");
      }
      if (!["top", "center", "bottom"].includes(valign)) {
        throw new Error("Invalid vertical alignment.");
      }
      const html = textEditor.innerHTML;
      status.textContent = "Rendering pages (may take a moment)…";
      const { blobs, ext } = await renderHtmlToImagePages(html, {
        ...options,
        textAlign: align,
        verticalAlign: valign,
        fontSize: readTextFontSizePx(),
        fontFamily: getTextFontFamilyCss(),
        ...pageBackgroundForExport(),
      });
      const base = txt ? baseFromFileName(file.name) : "page";
      if (blobs.length === 1) {
        const url = URL.createObjectURL(blobs[0]);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${base}.${ext}`;
        a.click();
        URL.revokeObjectURL(url);
        status.textContent = `Done. Downloaded ${base}.${ext}`;
        return;
      }
      progressWrap.classList.remove("hidden");
      status.textContent = "Creating ZIP…";
      const zip = new JSZip();
      for (let i = 0; i < blobs.length; i++) {
        zip.file(
          `${base}-page-${String(i + 1).padStart(4, "0")}.${ext}`,
          blobs[i]
        );
      }
      const zipBlob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${base}-pages.zip`;
      a.click();
      URL.revokeObjectURL(url);
      status.textContent = `Done. ${blobs.length} pages in ${base}-pages.zip`;
      progressBar.style.width = "100%";
      return;
    }

    status.textContent = "Loading PDF…";
    const buf = await file.arrayBuffer();
    const base = baseFromFileName(file.name);

    progressWrap.classList.remove("hidden");
    const files = await convertPdfInBrowser(buf, base, {
      ...options,
      ...pageBackgroundForExport(),
    }, (page, total) => {
      status.textContent = `Rendering page ${page} of ${total}…`;
      progressBar.style.width = `${(page / total) * 100}%`;
    });

    status.textContent = "Creating ZIP…";
    const zip = new JSZip();
    for (const { filename, blob } of files) {
      zip.file(filename, blob);
    }
    const zipBlob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${base}-pages.zip`;
    a.click();
    URL.revokeObjectURL(url);

    status.textContent = `Done. ${files.length} image(s) in ${base}-pages.zip`;
    progressBar.style.width = "100%";
  } catch (e) {
    status.textContent = e?.message || String(e);
    progressWrap.classList.add("hidden");
  } finally {
    setRichBusy(false);
  }
});

syncTextModeUi();
clearRichEditor();
syncEditorTextAlign();
syncEditorFontSize();
syncEditorFontFamily();
syncEditorLayoutForExport();
scheduleSelectionColorSync();
void (async () => {
  await loadDefaultPageBackground();
  try {
    await loadBundledTextFont(defaultEditorFontUrl);
  } catch {}
})();
