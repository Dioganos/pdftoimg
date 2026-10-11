import { createCanvas } from "@napi-rs/canvas";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

function toUint8Array(data) {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return Uint8Array.from(data);
}

function normalizeQuality(q) {
  const n = Number(q);
  if (Number.isNaN(n)) return NaN;
  if (n > 1 && n <= 100) return n / 100;
  return n;
}

export async function convertPdfToImages(options) {
  const {
    pdfPath,
    outDir,
    contentWidth,
    contentHeight,
    topPadding,
    bottomPadding,
    fitWidth = false,
    innerPad = 0,
    outputFormat = "png",
    quality,
  } = options;

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

  const absPdf = path.resolve(pdfPath);
  const raw = await fs.readFile(absPdf);
  const doc = await pdfjs
    .getDocument({ data: toUint8Array(raw), useSystemFonts: true })
    .promise;

  await fs.mkdir(path.resolve(outDir), { recursive: true });
  const base = path.basename(absPdf, path.extname(absPdf));
  const totalHeight = contentHeight + topPadding + bottomPadding;
  const outPaths = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const inner = createCanvas(contentWidth, contentHeight);
    const ictx = inner.getContext("2d");
    ictx.fillStyle = "#ffffff";
    ictx.fillRect(0, 0, contentWidth, contentHeight);
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
        }).promise;
      } else {
        const tw = Math.ceil(vw);
        const th = Math.ceil(vh);
        const temp = createCanvas(tw, th);
        const tctx = temp.getContext("2d");
        tctx.fillStyle = "#ffffff";
        tctx.fillRect(0, 0, tw, th);
        await page.render({
          canvasContext: tctx,
          viewport,
        }).promise;
        const sy = (vh - boxH) / 2;
        ictx.drawImage(
          temp,
          0,
          sy,
          vw,
          boxH,
          innerPad,
          innerPad,
          boxW,
          boxH
        );
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
      }).promise;
    }

    const out = createCanvas(contentWidth, totalHeight);
    const octx = out.getContext("2d");
    if (encFormat === "jpeg") {
      octx.fillStyle = "#ffffff";
      octx.fillRect(0, 0, contentWidth, totalHeight);
    } else {
      octx.clearRect(0, 0, contentWidth, totalHeight);
    }
    octx.drawImage(inner, 0, topPadding);

    const outPath = path.join(
      outDir,
      `${base}-page-${String(i).padStart(4, "0")}.${ext}`
    );
    const buf = lossy
      ? await out.encode(encFormat, q)
      : await out.encode("png");
    await fs.writeFile(outPath, buf);
    outPaths.push(outPath);
  }

  return outPaths;
}
