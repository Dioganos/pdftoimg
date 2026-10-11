#!/usr/bin/env node
import { convertPdfToImages } from "./convert.js";

const LEADING_DASH =
  /[\u002D\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/;

function normalizeArg(a) {
  if (!a || !LEADING_DASH.test(a[0])) return a;
  let i = 0;
  while (i < a.length && LEADING_DASH.test(a[i])) i++;
  const rest = a.slice(i);
  const prefix = i >= 2 ? "--" : "-";
  return prefix + rest;
}

const LONG_OPTS = new Set([
  "out",
  "width",
  "height",
  "top",
  "bottom",
  "pad",
  "inner-pad",
  "format",
  "quality",
]);

function assign(out, key, val) {
  const n = Number(val);
  if (key === "out" || key === "o") out.outDir = val;
  else if (key === "width" || key === "w") out.width = n;
  else if (key === "height" || key === "H" || key === "h") out.height = n;
  else if (key === "top" || key === "t") out.top = n;
  else if (key === "bottom" || key === "b") out.bottom = n;
  else if (key === "fit-width") out.fitWidth = val === "1" || val === "true" || val === "yes";
  else if (key === "pad" || key === "inner-pad") out.innerPad = n;
  else if (key === "format" || key === "f")
    out.format = String(val).toLowerCase();
  else if (key === "quality" || key === "q") out.quality = n;
}

function parseArgs(argv) {
  const raw = argv.slice(2);
  const out = {};
  const positional = [];
  for (let i = 0; i < raw.length; i++) {
    const a = normalizeArg(raw[i]);
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq > 0) {
        assign(out, a.slice(2, eq), a.slice(eq + 1));
        continue;
      }
      const name = a.slice(2);
      if (name === "fit-width") {
        out.fitWidth = true;
        continue;
      }
      const next = raw[i + 1];
      if (
        LONG_OPTS.has(name) &&
        next &&
        !LEADING_DASH.test(normalizeArg(next)[0])
      ) {
        assign(out, name, next);
        i++;
      }
      continue;
    }
    if (a.startsWith("-") && a.length >= 2) {
      const body = a.slice(1);
      const compact = body.match(/^([wHhtbop])(\d+(?:\.\d+)?)$/);
      if (compact) {
        const k = compact[1] === "p" ? "pad" : compact[1];
        assign(out, k, compact[2]);
        continue;
      }
      const flag = body[0];
      const next = raw[i + 1];
      if (next && !LEADING_DASH.test(normalizeArg(next)[0])) {
        assign(
          out,
          flag === "p"
            ? "pad"
            : flag === "f"
              ? "format"
              : flag === "q"
                ? "quality"
                : flag,
          normalizeArg(next)
        );
        i++;
        continue;
      }
      continue;
    }
    if (!a.startsWith("-")) positional.push(a);
  }
  out.pdfPath = positional[0];
  return out;
}

function usage() {
  process.stderr.write(
    "Usage: pdftoimg <file.pdf> [--out|-o dir] [--width|-w px] [--height|-h|-H px] [--top|-t px] [--bottom|-b px] [--pad|-p px] [--fit-width]\n" +
      "       [--format|-f png|webp|jpeg|jpg] [--quality|-q 0..1 or 1..100]\n" +
      "Also: --width=1728 --height=2166 --top=149 --bottom=149 (works if copy-paste used a unicode dash)\n" +
      "--fit-width: scale to full width (-w), no side gaps; crops top/bottom if taller than -h\n" +
      "--pad: scale page to fit inside -w/-h minus pad on each side; margins are white (page), not transparent\n" +
      "--format webp or jpeg: smaller files; webp keeps transparent -t/-b bands, jpeg fills them white\n" +
      "Defaults: --out ./output --width 1200 --height 1600 --top 0 --bottom 0 --pad 0 --format png\n"
  );
}

const parsed = parseArgs(process.argv);
const w = parsed.width ?? 1200;
const h = parsed.height ?? 1600;
const top = parsed.top ?? 0;
const bottom = parsed.bottom ?? 0;
const pad = parsed.innerPad ?? 0;
const fmtRaw = (parsed.format ?? "png").toLowerCase();
const allowedFmt = new Set(["png", "webp", "jpeg", "jpg"]);
const encFormat = fmtRaw === "jpg" ? "jpeg" : fmtRaw;
let qualityOut = parsed.quality;

function normalizeQuality(q) {
  const n = Number(q);
  if (Number.isNaN(n)) return NaN;
  if (n > 1 && n <= 100) return n / 100;
  return n;
}

if (!parsed.pdfPath || [w, h, top, bottom, pad].some((n) => Number.isNaN(n))) {
  usage();
  process.exit(1);
}

if (!allowedFmt.has(fmtRaw)) {
  usage();
  process.exit(1);
}

if (encFormat === "webp" || encFormat === "jpeg") {
  const nq = qualityOut != null ? normalizeQuality(qualityOut) : 0.82;
  if (Number.isNaN(nq) || nq <= 0 || nq > 1) {
    usage();
    process.exit(1);
  }
  qualityOut = nq;
} else if (parsed.quality != null && Number.isNaN(normalizeQuality(parsed.quality))) {
  usage();
  process.exit(1);
}

if (w <= 0 || h <= 0 || top < 0 || bottom < 0 || pad < 0 || 2 * pad >= w || 2 * pad >= h) {
  usage();
  process.exit(1);
}

await convertPdfToImages({
  pdfPath: parsed.pdfPath,
  outDir: parsed.outDir ?? "./output",
  contentWidth: w,
  contentHeight: h,
  topPadding: top,
  bottomPadding: bottom,
  fitWidth: Boolean(parsed.fitWidth),
  innerPad: pad,
  outputFormat: encFormat,
  quality:
    encFormat === "webp" || encFormat === "jpeg" ? qualityOut : undefined,
});
