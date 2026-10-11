import {
  makeCanvas,
  canvasToBlob,
  resolveImageEncode,
} from "./convert.js";
import { drawPageBackground } from "./pageBackground.js";

const DEFAULT_TEXT_FONT_FAMILY =
  'Georgia, "Times New Roman", "Noto Serif", serif';

const GHOST_LINE_BOTTOM_PAD = 1.75;

const SNAP_LINE_END_PAD = 2;

function collectLineBottomsFromGhost(ghost) {
  const gRect = ghost.getBoundingClientRect();
  const bottoms = [];
  const body = ghost.querySelector(".rich-ghost-body");
  if (!body) return [];
  const blocks = body.querySelectorAll(
    "p, li, h1, h2, h3, h4, h5, h6, blockquote, pre"
  );
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (!ghost.contains(block)) continue;
    const range = document.createRange();
    try {
      range.selectNodeContents(block);
      const rects = range.getClientRects();
      for (let j = 0; j < rects.length; j++) {
        const r = rects[j];
        if (r.height < 0.5) continue;
        bottoms.push(r.bottom - gRect.top + GHOST_LINE_BOTTOM_PAD);
      }
    } catch {}
  }
  if (bottoms.length === 0) {
    const range = document.createRange();
    try {
      range.selectNodeContents(body);
      const rects = range.getClientRects();
      for (let j = 0; j < rects.length; j++) {
        const r = rects[j];
        if (r.height < 0.5) continue;
        bottoms.push(r.bottom - gRect.top + GHOST_LINE_BOTTOM_PAD);
      }
    } catch {}
  }
  return [...new Set(bottoms.map((y) => Math.ceil(y * 1000) / 1000))].sort(
    (a, b) => a - b
  );
}

function firstFontFamilyForLoad(cssStack) {
  const t = String(cssStack || "").trim();
  if (!t) return "serif";
  if (t.startsWith('"')) {
    const end = t.indexOf('"', 1);
    if (end > 1) return t.slice(1, end);
  }
  if (t.startsWith("'")) {
    const end = t.indexOf("'", 1);
    if (end > 1) return t.slice(1, end);
  }
  const i = t.indexOf(",");
  return (i < 0 ? t : t.slice(0, i)).trim() || "serif";
}

async function prepareTextSnapshot(html, options) {
  const { default: html2canvas } = await import("html2canvas");
  const {
    contentWidth,
    contentHeight,
    topPadding,
    bottomPadding,
    innerPad,
    outputFormat,
    quality,
    textAlign = "center",
    verticalAlign = "center",
    fontSize = 20,
    pageBackground = null,
    fontFamily = DEFAULT_TEXT_FONT_FAMILY,
  } = options;

  const { encFormat, q, ext } = resolveImageEncode(outputFormat, quality);
  const totalHeight = contentHeight + topPadding + bottomPadding;
  const boxW = Math.max(1, contentWidth - 2 * innerPad);
  const boxH = Math.max(1, contentHeight - 2 * innerPad);
  const fs = Math.min(120, Math.max(8, Number(fontSize) || 20));
  const usePageBg = pageBackground != null;
  const ffStack = fontFamily || DEFAULT_TEXT_FONT_FAMILY;

  await document.fonts.ready;
  try {
    await document.fonts.load(
      `${fs}px ${firstFontFamilyForLoad(ffStack)}`
    );
  } catch {
  }

  const ghost = document.createElement("div");
  ghost.className = "rich-ghost-export";
  ghost.setAttribute("dir", "ltr");
  ghost.style.cssText = [
    "position:fixed",
    "left:-99999px",
    "top:0",
    `width:${boxW}px`,
    "min-height:1px",
    "padding:12px",
    "box-sizing:border-box",
    usePageBg ? "background:transparent" : "background:#ffffff",
    "word-wrap:break-word",
    "overflow:visible",
    `text-align:${textAlign}`,
  ].join(";");

  const innerHtml = (html && html.trim()) ? html : "<p><br></p>";
  const scopedStyle = document.createElement("style");
  const transparentBlock = usePageBg
    ? `
    .rich-ghost-export,
    .rich-ghost-export * {
      background-color: transparent !important;
      background-image: none !important;
      box-shadow: none !important;
    }
  `
    : "";
  scopedStyle.textContent = `
    .rich-ghost-export .rich-ghost-body {
      color: #1a1a1a;
      overflow: visible !important;
    }
    ${transparentBlock}
    .rich-ghost-export,
    .rich-ghost-export * {
      font-size: ${fs}px !important;
      font-family: ${ffStack} !important;
      line-height: 1.5 !important;
    }
    .rich-ghost-export b,
    .rich-ghost-export strong { font-weight: 700 !important; }
    .rich-ghost-export i,
    .rich-ghost-export em { font-style: italic !important; }
    .rich-ghost-export u { text-decoration: underline !important; }
  `;
  const innerRoot = document.createElement("div");
  innerRoot.className = "rich-ghost-body";
  innerRoot.innerHTML = innerHtml;
  ghost.appendChild(scopedStyle);
  ghost.appendChild(innerRoot);
  document.body.appendChild(ghost);
  void ghost.offsetHeight;
  await document.fonts.ready;
  try {
    await document.fonts.load(
      `${fs}px ${firstFontFamilyForLoad(ffStack)}`
    );
  } catch {
  }
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  void ghost.offsetHeight;
  void innerRoot.scrollHeight;

  const lineBottomsGhost = collectLineBottomsFromGhost(ghost);
  const ghostHeight = ghost.offsetHeight;

  function forceFontOnSubtree(root) {
    const stack = [root];
    while (stack.length) {
      const node = stack.pop();
      if (node.nodeType !== 1) continue;
      const el = node;
      if (el.tagName === "STYLE") continue;
      if (el.style) {
        el.style.setProperty("font-size", `${fs}px`, "important");
        el.style.setProperty("font-family", ffStack, "important");
        el.style.setProperty("line-height", "1.5", "important");
      }
      for (let i = 0; i < el.children.length; i++) stack.push(el.children[i]);
    }
  }

  let snap;
  try {
    snap = await html2canvas(ghost, {
      backgroundColor: usePageBg ? null : "#ffffff",
      scale: 1,
      logging: false,
      useCORS: true,
      onclone(_doc, cloned) {
        forceFontOnSubtree(cloned);
      },
    });
  } finally {
    ghost.remove();
  }

  const sw = Math.max(1, snap.width);
  const sh = Math.max(1, snap.height);
  const s = boxW / sw;
  const destW = boxW;
  const dhFull = sh * s;

  return {
    snap,
    sw,
    sh,
    s,
    boxW,
    boxH,
    dhFull,
    destW,
    dx: innerPad,
    innerPad,
    contentWidth,
    contentHeight,
    topPadding,
    bottomPadding,
    totalHeight,
    usePageBg,
    pageBackground,
    encFormat,
    q,
    ext,
    verticalAlign,
    lineBottomsGhost,
    ghostHeight,
  };
}

async function composeOneOutput(pre, drawInner) {
  const inner = makeCanvas(pre.contentWidth, pre.contentHeight);
  const ictx = inner.getContext("2d");
  if (!pre.usePageBg) {
    ictx.fillStyle = "#ffffff";
    ictx.fillRect(0, 0, pre.contentWidth, pre.contentHeight);
  }
  drawInner(ictx);

  const out = makeCanvas(pre.contentWidth, pre.totalHeight);
  const octx = out.getContext("2d");
  if (pre.usePageBg) {
    drawPageBackground(
      octx,
      pre.pageBackground,
      pre.contentWidth,
      pre.totalHeight
    );
  } else if (pre.encFormat === "jpeg") {
    octx.fillStyle = "#ffffff";
    octx.fillRect(0, 0, pre.contentWidth, pre.totalHeight);
  } else {
    octx.clearRect(0, 0, pre.contentWidth, pre.totalHeight);
  }
  octx.drawImage(inner, 0, pre.topPadding);

  const blob = await canvasToBlob(out, pre.encFormat, pre.q);
  return blob;
}

export async function renderHtmlToImagePages(html, options) {
  const pre = await prepareTextSnapshot(html, options);
  const {
    snap,
    sw,
    sh,
    s,
    boxH,
    dhFull,
    destW,
    dx,
    innerPad,
    verticalAlign,
    lineBottomsGhost,
    ghostHeight,
  } = pre;

  const blobs = [];

  if (dhFull <= boxH) {
    let dy = innerPad;
    if (verticalAlign === "center") dy = innerPad + (boxH - dhFull) / 2;
    else if (verticalAlign === "bottom") dy = innerPad + (boxH - dhFull);
    const b = await composeOneOutput(pre, (ictx) => {
      ictx.drawImage(snap, 0, 0, sw, sh, dx, dy, destW, dhFull);
    });
    blobs.push(b);
  } else {
    const maxSlice = boxH / s;
    const gh = Math.max(1, ghostHeight || sh);
    const ratio = sh / gh;
    const snapBreaks = (lineBottomsGhost || [])
      .map((y) => y * ratio)
      .filter((y) => y > 0 && y < sh);
    const breaks = [...new Set([0, ...snapBreaks, sh])].sort((a, b) => a - b);
    let yStart = 0;
    while (yStart < sh - 0.5) {
      const limit = Math.min(yStart + maxSlice, sh);
      let yEnd;
      const candidates = breaks.filter((b) => b > yStart && b <= limit);
      if (candidates.length) {
        yEnd = Math.min(
          limit,
          Math.ceil(
            Math.max(...candidates) + SNAP_LINE_END_PAD - 1e-6
          )
        );
      } else {
        yEnd = limit;
      }
      if (yEnd <= yStart + 0.5) {
        yEnd = Math.min(yStart + maxSlice, sh);
      }
      if (yEnd <= yStart + 0.5) break;
      const shSrc = yEnd - yStart;
      const dhDest = shSrc * s;
      const sy = yStart;
      const b = await composeOneOutput(pre, (ictx) => {
        ictx.drawImage(
          snap,
          0,
          sy,
          sw,
          shSrc,
          dx,
          innerPad,
          destW,
          dhDest
        );
      });
      blobs.push(b);
      yStart = yEnd;
    }
  }

  return { blobs, ext: pre.ext };
}

export async function renderHtmlToImage(html, options) {
  const { blobs, ext } = await renderHtmlToImagePages(html, options);
  return { blob: blobs[0], ext };
}
