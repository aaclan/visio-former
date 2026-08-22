import { spawn } from "node:child_process";
import { access, mkdir, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";

// ffmpeg-static is CommonJS but ships ESM-style types, so under NodeNext the
// default import is typed as the module namespace. At runtime it is the path.
const ffmpegPath = ffmpegStatic as unknown as string | null;

/** Defaults: the first 10s of the video, sampled 20 times (every 0.5s). */
export const DEFAULT_START_SECONDS = 0;
export const DEFAULT_DURATION_SECONDS = 10;
export const DEFAULT_FRAME_COUNT = 20;

export interface CaptureFramesOptions {
  /** Path to the source .mp4 file. */
  inputPath: string;
  /** Directory the screenshots are written to. Created if missing. */
  outputDir: string;
  /** Offset into the video where the window starts, in seconds. Defaults to 0. */
  startSeconds?: number;
  /** Length of the window, in seconds. Defaults to 10. */
  durationSeconds?: number;
  /** Number of screenshots to take, spread evenly across the window. Defaults to 20. */
  frameCount?: number;
  /** Basename for the generated files, e.g. "frame" -> "frame-01.jpg". Defaults to "frame". */
  filePrefix?: string;
}

export interface CapturedFrame {
  /** 1-based position within the window. */
  index: number;
  /** Offset of this frame into the source video, in seconds. */
  timestamp: number;
  /** Absolute path to the written screenshot. */
  path: string;
}

export interface CaptureFramesResult {
  frames: CapturedFrame[];
  startSeconds: number;
  durationSeconds: number;
  /** Seconds between consecutive frames. */
  intervalSeconds: number;
}

/**
 * Extracts a window from an mp4 and writes evenly spaced screenshots from it.
 *
 * With the defaults this takes the first 10 seconds of the video and produces
 * 20 JPEGs at even 0.5s intervals (at 0s, 0.5s, 1s, ... 9.5s).
 *
 * Rejects if the video is too short to fill the requested window.
 */
export async function captureFrames(
  options: CaptureFramesOptions,
): Promise<CaptureFramesResult> {
  const {
    inputPath,
    outputDir,
    startSeconds = DEFAULT_START_SECONDS,
    durationSeconds = DEFAULT_DURATION_SECONDS,
    frameCount = DEFAULT_FRAME_COUNT,
    filePrefix = "frame",
  } = options;

  if (!Number.isFinite(startSeconds) || startSeconds < 0) {
    throw new TypeError("startSeconds must be a finite number >= 0");
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new TypeError("durationSeconds must be a finite number > 0");
  }
  if (!Number.isInteger(frameCount) || frameCount < 1) {
    throw new TypeError("frameCount must be an integer >= 1");
  }
  if (!ffmpegPath) {
    throw new Error("ffmpeg binary is unavailable on this platform");
  }

  try {
    await access(inputPath);
  } catch {
    throw new Error(`input video not found: ${inputPath}`);
  }

  await mkdir(outputDir, { recursive: true });

  // Clear frames from an earlier run, otherwise leftovers that ffmpeg does not
  // overwrite would be counted as fresh output and hide a too-short video.
  const stale = await listFrames(outputDir, filePrefix);
  await Promise.all(stale.map((file) => unlink(file).catch(() => {})));

  const intervalSeconds = durationSeconds / frameCount;
  const padWidth = String(frameCount).length;
  const outputPattern = path.join(
    outputDir,
    `${filePrefix}-%0${padWidth}d.jpg`,
  );

  // Seeking before -i lets ffmpeg jump to the window instead of decoding up to it.
  // fps= drops the stream to one frame per interval, and -frames:v caps the count.
  // The rate is passed as a fraction so ffmpeg gets an exact value rather than a
  // rounded decimal (e.g. 20/3 instead of 6.666667).
  const args = [
    "-nostdin",
    "-y",
    "-ss",
    String(startSeconds),
    "-i",
    inputPath,
    "-t",
    String(durationSeconds),
    "-vf",
    `fps=${frameCount}/${durationSeconds}`,
    "-frames:v",
    String(frameCount),
    "-q:v",
    "2",
    outputPattern,
  ];

  await runFfmpeg(ffmpegPath, args);

  const written = await listFrames(outputDir, filePrefix);

  if (written.length < frameCount) {
    await Promise.all(written.map((file) => unlink(file).catch(() => {})));
    throw new Error(
      `video is too short: needed ${startSeconds + durationSeconds}s to capture ` +
        `${frameCount} frames, but only ${written.length} frame(s) were available`,
    );
  }

  const frames: CapturedFrame[] = written
    .slice(0, frameCount)
    .map((file, i) => ({
      index: i + 1,
      // Rounded so uneven intervals don't surface float dust like 1.7999999999.
      timestamp: Number((startSeconds + i * intervalSeconds).toFixed(6)),
      path: file,
    }));

  return { frames, startSeconds, durationSeconds, intervalSeconds };
}

function runFfmpeg(binary: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["ignore", "ignore", "pipe"] });

    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      reject(new Error(`failed to start ffmpeg: ${err.message}`));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      // ffmpeg's failure reason is on the last few lines of its log.
      const detail = stderr.trim().split("\n").slice(-5).join("\n");
      reject(new Error(`ffmpeg exited with code ${code}\n${detail}`));
    });
  });
}

async function listFrames(
  outputDir: string,
  filePrefix: string,
): Promise<string[]> {
  const pattern = new RegExp(`^${escapeRegExp(filePrefix)}-\\d+\\.jpg$`);
  const entries = await readdir(outputDir);

  return entries
    .filter((name) => pattern.test(name))
    .sort()
    .map((name) => path.join(outputDir, name));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
