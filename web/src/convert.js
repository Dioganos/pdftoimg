import * as pdfjs from "pdfjs-dist";
import { drawPageBackground } from "./pageBackground.js";

pdfjs.GlobalWorkerOptions.workerSrc = `${import.meta.env.BASE_URL}pdf.worker.min.mjs`;

export function normalizeQuality(q) {
  const n = Number(q);
  if (Number.isNaN(n)) return NaN;
  if (n > 1 && n <= 100) return n / 100;
  return n;
}

export function resolveImageEncode(outputFormat, quality) {
  const fmt = String(outputFormat).toLowerCase();
  const encFormat = fmt === "jpg" ? "jpeg" : fmt;
  if (!["png", "webp", "jpeg"].includes(encFormat)) {
    throw new RangeError("outputFormat must be png, webp, or jpeg");
  }
  const lossy = encFormat === "webp" || encFormat === "jpeg";
  const q = lossy
    ? quality != null
      ? normalizeQuality(quality)
      : 0.82
    : null;
  if (lossy && (Number.isNaN(q) || q <= 0 || q > 1)) {
    throw new RangeError("quality must be between 0 and 1 or 1 and 100");
  }
  const ext = encFormat === "jpeg" ? "jpg" : encFormat;
  return { encFormat, q, ext, lossy };
}

export function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function canvasToBlob(canvas, encFormat, q) {
  const mime =
    encFormat === "jpeg"
      ? "image/jpeg"
      : encFormat === "webp"
        ? "image/webp"
        : "image/png";
  return new Promise((resolve, reject) => {
    if (encFormat === "png") {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG export failed"))), mime);
    } else {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Image export failed"))),
        mime,
        q
      );
    }
  });
}

export async function convertPdfInBrowser(
  data,
  baseName,
  options,
  onProgress
) {
  const {
    contentWidth,
    contentHeight,
    topPadding,
    bottomPadding,
    fitWidth,
    innerPad,
    outputFormat,
    quality,
    pageBackground = null,
  } = options;

  const { encFormat, q, ext } = resolveImageEncode(outputFormat, quality);
  const usePageBg = pageBackground != null;
  const pdfRenderBg = usePageBg ? "rgba(0,0,0,0)" : undefined;

  const u8 =
    data instanceof Uint8Array ? data : new Uint8Array(data);
  const doc = await pdfjs.getDocument({ data: u8, useSystemFonts: true }).promise;
  const totalHeight = contentHeight + topPadding + bottomPadding;
  const results = [];

  for (let i = 1; i <= doc.numPages; i++) {
    if (onProgress) onProgress(i, doc.numPages);
    await new Promise((r) => requestAnimationFrame(r));

    const page = await doc.getPage(i);
    const inner = makeCanvas(contentWidth, contentHeight);
    const ictx = inner.getContext("2d");
    if (!usePageBg) {
      ictx.fillStyle = "#ffffff";
      ictx.fillRect(0, 0, contentWidth, contentHeight);
    }
    const vp1 = page.getViewport({ scale: 1 });
    const boxW = Math.max(1, contentWidth - 2 * innerPad);
    const boxH = Math.max(1, contentHeight - 2 * innerPad);

    if (fitWidth) {
      const scale = boxW / vp1.width;
      const viewport = page.getViewport({ scale });
      const vw = viewport.width;
      const vh = viewport.height;
      if (vh <= boxH) {
        const ox = innerPad + (boxW - vw) / 2;
        const oy = innerPad + (boxH - vh) / 2;
        ictx.translate(ox, oy);
        await page.render({
          canvasContext: ictx,
          viewport,
          background: pdfRenderBg,
        }).promise;
      } else {
        const tw = Math.ceil(vw);
        const th = Math.ceil(vh);
        const temp = makeCanvas(tw, th);
        const tctx = temp.getContext("2d");
        if (usePageBg) {
          tctx.clearRect(0, 0, tw, th);
        } else {
          tctx.fillStyle = "#ffffff";
          tctx.fillRect(0, 0, tw, th);
        }
        await page.render({
          canvasContext: tctx,
          viewport,
          background: pdfRenderBg,
        }).promise;
        const sy = (vh - boxH) / 2;
        ictx.drawImage(temp, 0, sy, vw, boxH, innerPad, innerPad, boxW, boxH);
      }
    } else {
      const scale = Math.min(boxW / vp1.width, boxH / vp1.height);
      const viewport = page.getViewport({ scale });
      const ox = innerPad + (boxW - viewport.width) / 2;
      const oy = innerPad + (boxH - viewport.height) / 2;
      ictx.translate(ox, oy);
      await page.render({
        canvasContext: ictx,
        viewport,
        background: pdfRenderBg,
      }).promise;
    }

    const out = makeCanvas(contentWidth, totalHeight);
    const octx = out.getContext("2d");
    if (usePageBg) {
      drawPageBackground(octx, pageBackground, contentWidth, totalHeight);
    } else if (encFormat === "jpeg") {
      octx.fillStyle = "#ffffff";
      octx.fillRect(0, 0, contentWidth, totalHeight);
    } else {
      octx.clearRect(0, 0, contentWidth, totalHeight);
    }
    octx.drawImage(inner, 0, topPadding);

    const blob = await canvasToBlob(out, encFormat, q);
    results.push({
      filename: `${baseName}-page-${String(i).padStart(4, "0")}.${ext}`,
      blob,
    });
  }

  return results;
}
