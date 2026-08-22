/**
 * Smoke test for the video.ts -> vision.ts leg of the compare pipeline: extracts frames
 * from a video and captions them via OpenAI Vision. Pioneer classification isn't run here.
 *
 *   npx tsx scripts/check-describe.ts               # generates a 6s test clip
 *   npx tsx scripts/check-describe.ts my-video.mp4  # uses your own file
 *
 * Requires openaiApiKey in server/secrets.yaml.
 */
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ffmpegStatic from "ffmpeg-static";
import { captureFrames } from "../src/video.js";
import { describeFrames } from "../src/vision.js";

const ffmpegPath = ffmpegStatic as unknown as string | null;
const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, ".out", "describe");

function run(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath!, args, { stdio: "ignore" });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)),
    );
  });
}

async function frameToDataUri(filePath: string): Promise<string> {
  const buffer = await readFile(filePath);
  return `data:image/jpeg;base64,${buffer.toString("base64")}`;
}

const userVideo = process.argv[2];
await mkdir(outDir, { recursive: true });

let input = userVideo;
if (!input) {
  input = path.join(outDir, "fixture.mp4");
  console.log("No video passed, generating a 6s test clip...\n");
  await run([
    "-nostdin",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=320x240:rate=30:duration=6",
    "-pix_fmt",
    "yuv420p",
    input,
  ]);
}

console.log(`Input: ${input}\n`);

console.log("Extracting frames (every 0.4s)...");
const { frames } = await captureFrames({
  inputPath: input,
  outputDir: outDir,
  startSeconds: 0,
  durationSeconds: 4,
  frameCount: 10,
});
console.log(`  ${frames.length} frames written to ${outDir}\n`);

console.log("Captioning frames via OpenAI Vision...");
const dataUris = await Promise.all(frames.map((f) => frameToDataUri(f.path)));
const descriptions = await describeFrames(dataUris, "test clip");

console.log("\nDescriptions:");
frames.forEach((f, i) => {
  console.log(`\n#${f.index} (${f.timestamp}s):`);
  console.log(`  ${descriptions[i] ?? "(no description returned)"}`);
});

const reportPath = path.join(outDir, "descriptions.json");
await writeFile(
  reportPath,
  JSON.stringify(
    { input, frames: frames.map((f, i) => ({ ...f, description: descriptions[i] })) },
    null,
    2,
  ),
);
console.log(`\nSaved: ${reportPath}`);
