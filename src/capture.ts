import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { getCursorInfo } from "./cursor.js";
import { capturePngWindows } from "./screenCaptureWin.js";

/* Returns raw PNG bytes of the desktop. We dispatch by platform so Windows uses
 * GDI+ via PowerShell (no native binary), and other platforms can plug in their
 * own backend later. */
async function capturePngBackend(display?: number): Promise<Buffer> {
  if (process.platform === "win32") return capturePngWindows(display);
  /* Fallback: try screenshot-desktop only on non-Windows so the bundled
   * Linux/macOS helpers are still available. */
  const mod = await import("screenshot-desktop");
  return mod.default({ format: "png", screen: display });
}

export interface CaptureOptions {
  /** Crop a square region around the current cursor position with this radius (px). 0 = full screen. */
  cursorRadius?: number;
  /** Output format. */
  format?: "png" | "jpeg" | "webp";
  /** JPEG/WebP quality 1..100. */
  quality?: number;
  /** Resize the longest edge of the image to this many pixels (preserves aspect). 0 = no resize. */
  maxEdge?: number;
  /** Monitor display id (screenshot-desktop displays). Defaults to primary. */
  display?: number;
  /** If false, omit base64 from the result and only persist to disk. */
  includeBase64?: boolean;
  /** Where to write the captured image. */
  outDir: string;
}

export interface CaptureResult {
  filePath: string;
  bytes: number;
  width: number;
  height: number;
  format: string;
  takenAt: string;
  cursor?: { x: number; y: number; foregroundWindow?: string; windowUnderCursor?: string };
  base64?: string;
}

/* Wraps screenshot-desktop + sharp so callers get a single async helper that
 * also handles cursor-region cropping and on-disk persistence. */
export async function capture(opts: CaptureOptions): Promise<CaptureResult> {
  const fmt = opts.format ?? "jpeg";
  const quality = clamp(opts.quality ?? 70, 1, 100);
  const maxEdge = opts.maxEdge ?? 1600;
  const includeBase64 = opts.includeBase64 ?? true;

  const rawPng: Buffer = await capturePngBackend(opts.display);

  let pipeline = sharp(rawPng);
  const meta = await pipeline.metadata();
  const fullW = meta.width ?? 0;
  const fullH = meta.height ?? 0;

  let cursorMeta: CaptureResult["cursor"] | undefined;
  if (opts.cursorRadius && opts.cursorRadius > 0) {
    const ci = await getCursorInfo();
    cursorMeta = ci;
    const r = Math.max(32, Math.floor(opts.cursorRadius));
    const left = clamp(ci.x - r, 0, Math.max(0, fullW - 1));
    const top = clamp(ci.y - r, 0, Math.max(0, fullH - 1));
    const width = clamp(2 * r, 1, Math.max(1, fullW - left));
    const height = clamp(2 * r, 1, Math.max(1, fullH - top));
    pipeline = pipeline.extract({ left, top, width, height });
  }

  if (maxEdge > 0) {
    pipeline = pipeline.resize({
      width: maxEdge,
      height: maxEdge,
      fit: "inside",
      withoutEnlargement: true,
    });
  }

  if (fmt === "jpeg") pipeline = pipeline.jpeg({ quality, mozjpeg: true });
  else if (fmt === "webp") pipeline = pipeline.webp({ quality });
  else pipeline = pipeline.png({ compressionLevel: 9 });

  const out = await pipeline.toBuffer({ resolveWithObject: true });

  if (!existsSync(opts.outDir)) await mkdir(opts.outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `cap-${stamp}.${fmt === "jpeg" ? "jpg" : fmt}`;
  const filePath = path.join(opts.outDir, filename);
  await writeFile(filePath, out.data);

  const result: CaptureResult = {
    filePath,
    bytes: out.data.length,
    width: out.info.width,
    height: out.info.height,
    format: fmt,
    takenAt: new Date().toISOString(),
    cursor: cursorMeta,
  };
  if (includeBase64) result.base64 = out.data.toString("base64");
  return result;
}

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}
