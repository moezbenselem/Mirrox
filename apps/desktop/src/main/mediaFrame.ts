import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app, nativeImage } from "electron";

/** CPU count for ffmpeg decode/filter/encode parallelism. */
function cpuThreads(): number {
  return Math.max(1, os.cpus().length || 1);
}

export interface GreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type MediaFrameId = "custom" | string;

export interface MediaFrameInfo {
  id: MediaFrameId;
  name: string;
  path: string;
  rect: GreenRect;
  dataUrl: string;
  width: number;
  height: number;
  builtin: boolean;
}

export interface BuiltinFrameMeta {
  id: string;
  name: string;
  file: string;
}

const GREEN_TOLERANCE = 40;
const MIN_GREEN_AREA = 64;

export const BUILTIN_FRAMES: BuiltinFrameMeta[] = [
  { id: "pixel-obsidian", name: "Pixel · Obsidian", file: "pixel-obsidian.png" },
  { id: "pixel-porcelain", name: "Pixel · Porcelain", file: "pixel-porcelain.png" },
  { id: "pixel-hazel", name: "Pixel · Hazel", file: "pixel-hazel.png" },
  { id: "pixel-pro", name: "Pixel Pro", file: "pixel-pro.png" },
];

function isGreen(r: number, g: number, b: number): boolean {
  return (
    g >= 255 - GREEN_TOLERANCE &&
    r <= GREEN_TOLERANCE &&
    b <= GREEN_TOLERANCE &&
    g > r + 40 &&
    g > b + 40
  );
}

/** Axis-aligned bounding box of near-#00FF00 pixels. */
export function detectGreenRect(framePath: string): GreenRect {
  const image = nativeImage.createFromPath(framePath);
  if (image.isEmpty()) throw new Error("Could not load frame image");

  const { width, height } = image.getSize();
  if (width < 1 || height < 1) throw new Error("Frame image is empty");

  const bitmap = image.toBitmap();
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let count = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const b = bitmap[i]!;
      const g = bitmap[i + 1]!;
      const r = bitmap[i + 2]!;
      if (!isGreen(r, g, b)) continue;
      count += 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (count < MIN_GREEN_AREA || maxX < minX || maxY < minY) {
    throw new Error(
      "No green placeholder found. Use a solid #00FF00 (green) area where the capture should appear."
    );
  }

  const rect: GreenRect = {
    x: minX,
    y: minY,
    w: maxX - minX + 1,
    h: maxY - minY + 1,
  };

  if (rect.w < 8 || rect.h < 8) {
    throw new Error("Green placeholder is too small");
  }

  return rect;
}

function formatFfmpegError(stderr: string, code: number | null): string {
  const text = stderr.trim();
  const lower = text.toLowerCase();
  if (lower.includes("not divisible by 2")) {
    return "Framed video encode failed: output size must be even (yuv420p). Try another fit mode or frame.";
  }
  if (lower.includes("could not open encoder") || lower.includes("invalid argument")) {
    return "Framed video encode failed: invalid filter output. Try another fit mode or a different frame.";
  }
  if (lower.includes("nothing was written") || lower.includes("received no packets")) {
    return "Framed video encode failed: no frames produced (recording may be empty or too short).";
  }
  const hint = text.split("\n").slice(-6).join("\n");
  return hint || `ffmpeg exited with code ${code ?? "unknown"}`;
}

function runFfmpeg(ffmpegPath: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(formatFfmpegError(stderr, code)));
    });
  });
}

export type MediaFrameFitMode = "media-to-frame" | "frame-to-media";

/** Even width/height for libx264 + yuv420p (floor to even, min 2). */
function evenDim(n: number): number {
  return Math.max(2, n & ~1);
}

/** Final safety: force even overlay output before encode. */
const EVEN_OUT = "scale=trunc(iw/2)*2:trunc(ih/2)*2";

function overlayFilterMediaToFrame(rect: GreenRect, frameW: number, frameH: number): string {
  const { x, y, w, h } = rect;
  return [
    `[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1,pad=${frameW}:${frameH}:${x}:${y}:black[bg]`,
    `[1:v]format=rgba,colorkey=0x00FF00:0.35:0.2[fg]`,
    `[bg][fg]overlay=0:0:format=auto,${EVEN_OUT}[out]`,
  ].join(";");
}

/** Scale frame so its green hole matches media size; media stays native resolution. */
function overlayFilterFrameToMedia(
  rect: GreenRect,
  frameW: number,
  frameH: number,
  mediaW: number,
  mediaH: number
): string {
  const mw = evenDim(mediaW);
  const mh = evenDim(mediaH);
  const scaleX = mw / rect.w;
  const scaleY = mh / rect.h;
  let outW = Math.max(mw, Math.round(frameW * scaleX));
  let outH = Math.max(mh, Math.round(frameH * scaleY));
  outW = evenDim(outW);
  outH = evenDim(outH);
  // Clamp offsets so pad never expands past even canvas (overflow → odd sizes → x264 fail).
  const ox = Math.max(0, Math.min(Math.round(rect.x * scaleX), outW - mw));
  const oy = Math.max(0, Math.min(Math.round(rect.y * scaleY), outH - mh));
  return [
    `[0:v]scale=${mw}:${mh}:force_original_aspect_ratio=decrease,pad=${mw}:${mh}:(ow-iw)/2:(oh-ih)/2,setsar=1,pad=${outW}:${outH}:${ox}:${oy}:black[bg]`,
    `[1:v]scale=${outW}:${outH},format=rgba,colorkey=0x00FF00:0.35:0.2[fg]`,
    `[bg][fg]overlay=0:0:format=auto,${EVEN_OUT}[out]`,
  ].join(";");
}

async function probeMediaSize(
  ffmpegPath: string,
  mediaPath: string
): Promise<{ width: number; height: number }> {
  const image = nativeImage.createFromPath(mediaPath);
  if (!image.isEmpty()) {
    const { width, height } = image.getSize();
    if (width > 0 && height > 0) return { width, height };
  }

  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ["-i", mediaPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", () => {
      const match = stderr.match(/Stream #.+Video:.+?,\s*(\d{2,5})x(\d{2,5})/);
      if (!match) {
        reject(new Error("Could not read media dimensions"));
        return;
      }
      resolve({
        width: Number.parseInt(match[1]!, 10),
        height: Number.parseInt(match[2]!, 10),
      });
    });
  });
}

function buildOverlayFilter(
  fitMode: MediaFrameFitMode,
  rect: GreenRect,
  frameW: number,
  frameH: number,
  mediaW: number,
  mediaH: number
): string {
  if (fitMode === "frame-to-media") {
    return overlayFilterFrameToMedia(rect, frameW, frameH, mediaW, mediaH);
  }
  return overlayFilterMediaToFrame(rect, frameW, frameH);
}

function frameSize(framePath: string): { width: number; height: number } {
  const image = nativeImage.createFromPath(framePath);
  if (image.isEmpty()) throw new Error("Could not load frame image");
  return image.getSize();
}

export async function applyFrameToImage(
  ffmpegPath: string,
  mediaPath: string,
  framePath: string,
  rect: GreenRect,
  outPath: string,
  fitMode: MediaFrameFitMode = "media-to-frame"
): Promise<void> {
  const { width: fw, height: fh } = frameSize(framePath);
  const media = await probeMediaSize(ffmpegPath, mediaPath);
  await runFfmpeg(ffmpegPath, [
    "-y",
    "-i",
    mediaPath,
    "-i",
    framePath,
    "-filter_complex",
    buildOverlayFilter(fitMode, rect, fw, fh, media.width, media.height),
    "-map",
    "[out]",
    "-frames:v",
    "1",
    "-update",
    "1",
    outPath,
  ]);
  if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 32) {
    throw new Error("Framed screenshot was not written");
  }
}

export async function applyFrameToVideo(
  ffmpegPath: string,
  mediaPath: string,
  framePath: string,
  rect: GreenRect,
  outPath: string,
  fitMode: MediaFrameFitMode = "media-to-frame"
): Promise<void> {
  if (!fs.existsSync(mediaPath) || fs.statSync(mediaPath).size < 32) {
    throw new Error("Recording file is empty or missing");
  }
  const { width: fw, height: fh } = frameSize(framePath);
  const media = await probeMediaSize(ffmpegPath, mediaPath);
  if (media.width < 2 || media.height < 2) {
    throw new Error("Recording has invalid dimensions");
  }
  const threads = cpuThreads();
  await runFfmpeg(ffmpegPath, [
    "-y",
    "-threads",
    String(threads),
    "-filter_complex_threads",
    String(threads),
    "-i",
    mediaPath,
    "-i",
    framePath,
    "-filter_complex",
    buildOverlayFilter(fitMode, rect, fw, fh, media.width, media.height),
    "-map",
    "[out]",
    "-map",
    "0:a?",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "18",
    "-threads",
    String(threads),
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-shortest",
    "-movflags",
    "+faststart",
    outPath,
  ]);
  if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 1024) {
    throw new Error("Framed recording was not written");
  }
}

export function framesDir(): string {
  const dir = path.join(app.getPath("userData"), "frames");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function storedFramePath(): string {
  return path.join(framesDir(), "custom-frame.png");
}

export function resolveBuiltinFramesDir(): string {
  const candidates = [
    path.join(process.resourcesPath, "frames"),
    path.join(app.getAppPath(), "resources", "frames"),
    path.join(__dirname, "../../resources/frames"),
    path.join(process.cwd(), "apps/desktop/resources/frames"),
    path.join(process.cwd(), "resources/frames"),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(path.join(candidate, "pixel-obsidian.png"))) return candidate;
    } catch {
      /* ignore */
    }
  }
  return candidates[0]!;
}

function frameInfoFromPath(
  id: MediaFrameId,
  name: string,
  framePath: string,
  builtin: boolean
): MediaFrameInfo {
  const rect = detectGreenRect(framePath);
  const image = nativeImage.createFromPath(framePath);
  if (image.isEmpty()) throw new Error("Could not load frame image");
  const png = image.toPNG();
  const { width, height } = image.getSize();
  return {
    id,
    name,
    path: framePath,
    rect,
    dataUrl: `data:image/png;base64,${png.toString("base64")}`,
    width,
    height,
    builtin,
  };
}

export function listBuiltinFrames(): MediaFrameInfo[] {
  const dir = resolveBuiltinFramesDir();
  const out: MediaFrameInfo[] = [];
  for (const meta of BUILTIN_FRAMES) {
    const filePath = path.join(dir, meta.file);
    if (!fs.existsSync(filePath)) continue;
    try {
      out.push(frameInfoFromPath(meta.id, meta.name, filePath, true));
    } catch {
      /* skip broken asset */
    }
  }
  return out;
}

export function resolveFrameById(id: MediaFrameId | null | undefined): MediaFrameInfo | null {
  if (!id) return null;
  if (id === "custom") {
    const dest = storedFramePath();
    if (!fs.existsSync(dest)) return null;
    try {
      return frameInfoFromPath("custom", "Custom", dest, false);
    } catch {
      return null;
    }
  }
  const meta = BUILTIN_FRAMES.find((f) => f.id === id);
  if (!meta) return null;
  const filePath = path.join(resolveBuiltinFramesDir(), meta.file);
  if (!fs.existsSync(filePath)) return null;
  try {
    return frameInfoFromPath(meta.id, meta.name, filePath, true);
  } catch {
    return null;
  }
}

/** Active frame: prefer selected id, else custom file if present. */
export function loadActiveMediaFrame(
  selectedId: MediaFrameId | null | undefined
): MediaFrameInfo | null {
  const byId = resolveFrameById(selectedId);
  if (byId) return byId;
  if (selectedId && selectedId !== "custom") return null;
  return resolveFrameById("custom");
}

/** Copy + validate uploaded frame; returns stored custom frame. */
export function installMediaFrame(sourcePath: string): MediaFrameInfo {
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    throw new Error("Frame file missing");
  }
  detectGreenRect(sourcePath);
  const dest = storedFramePath();
  const image = nativeImage.createFromPath(sourcePath);
  if (image.isEmpty()) throw new Error("Could not load frame image");
  fs.writeFileSync(dest, image.toPNG());
  return frameInfoFromPath("custom", "Custom", dest, false);
}

export function clearStoredMediaFrame(): void {
  const dest = storedFramePath();
  if (fs.existsSync(dest)) {
    try {
      fs.unlinkSync(dest);
    } catch {
      /* ignore */
    }
  }
}

export async function compositeWithActiveFrame(
  ffmpegPath: string,
  mediaPath: string,
  kind: "image" | "video",
  selectedId: MediaFrameId | null | undefined,
  fitMode: MediaFrameFitMode = "media-to-frame"
): Promise<string> {
  const frame = loadActiveMediaFrame(selectedId);
  if (!frame) {
    throw new Error(
      "No frame selected. Choose a Pixel frame or upload one with a green placeholder."
    );
  }
  const ext = kind === "image" ? ".png" : ".mp4";
  const outPath = path.join(app.getPath("temp"), `mirrox-framed-${Date.now()}${ext}`);
  if (kind === "image") {
    await applyFrameToImage(ffmpegPath, mediaPath, frame.path, frame.rect, outPath, fitMode);
  } else {
    await applyFrameToVideo(ffmpegPath, mediaPath, frame.path, frame.rect, outPath, fitMode);
  }
  return outPath;
}
