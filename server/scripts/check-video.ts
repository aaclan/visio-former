/**
 * Smoke test for captureFrames().
 *
 *   npx tsx scripts/check-video.ts               # generates a 25s test clip
 *   npx tsx scripts/check-video.ts my-video.mp4  # uses your own file
 *
 * Screenshots are written to scripts/.out/ so you can eyeball them afterwards.
 */
import { spawn } from "node:child_process";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ffmpegStatic from "ffmpeg-static";
import { captureFrames } from "../src/video.js";

const ffmpegPath = ffmpegStatic as unknown as string | null;
const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, ".out");

let failures = 0;
const results: { label: string; ok: boolean; detail: string }[] = [];

function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  results.push({ label, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

function run(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath!, args, { stdio: "ignore" });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)),
    );
  });
}

// A 25s clip is long enough for the default 10s-onward window.
async function makeFixture(file: string, seconds: number) {
  await run([
    "-nostdin", "-y",
    "-f", "lavfi",
    "-i", `testsrc=size=320x240:rate=30:duration=${seconds}`,
    "-pix_fmt", "yuv420p",
    file,
  ]);
}

const userVideo = process.argv[2];
await mkdir(outDir, { recursive: true });

let input = userVideo;
if (!input) {
  input = path.join(outDir, "fixture.mp4");
  console.log("No video passed, generating a 25s test clip...\n");
  await makeFixture(input, 25);
}

console.log(`Input: ${input}\n`);

// 1. The documented behaviour: first 10s, 20 shots at even 0.5s intervals.
console.log("Default window (first 10s, 20 frames):");
const result = await captureFrames({ inputPath: input, outputDir: outDir });

check("returns 20 frames", result.frames.length === 20, `got ${result.frames.length}`);
check("interval is 0.5 seconds", result.intervalSeconds === 0.5);
check(
  "timestamps are 0, 0.5 .. 9.5",
  result.frames.every((f, i) => f.timestamp === i * 0.5),
  result.frames.map((f) => f.timestamp).join(", "),
);

const onDisk = (await readdir(outDir)).filter((f) => /^frame-\d+\.jpg$/.test(f));
check("20 files written", onDisk.length === 20, `got ${onDisk.length}`);

// 2. A video shorter than the window must fail loudly, not return partial output.
console.log("\nToo-short video:");
const shortFile = path.join(outDir, "short.mp4");
const shortOut = path.join(outDir, "short");
await makeFixture(shortFile, 4);
try {
  await captureFrames({ inputPath: shortFile, outputDir: shortOut });
  check("rejects a 4s video", false, "it returned successfully");
} catch (err) {
  check("rejects a 4s video", true, (err as Error).message);
}
const leftovers = (await readdir(shortOut)).filter((f) => /^frame-\d+\.jpg$/.test(f));
check("no partial frames left behind", leftovers.length === 0);

// 3. Reusing a directory must not count the previous run's frames as fresh.
console.log("\nReused output directory:");
try {
  await captureFrames({ inputPath: shortFile, outputDir: outDir });
  check("stale frames are not reused", false, "it returned successfully");
} catch {
  check("stale frames are not reused", true);
}

// 4. Missing input.
console.log("\nMissing input:");
try {
  await captureFrames({ inputPath: "does-not-exist.mp4", outputDir: outDir });
  check("rejects a missing file", false);
} catch (err) {
  check("rejects a missing file", (err as Error).message.includes("not found"));
}

// Re-run the good case so the leftover screenshots are the interesting ones.
await rm(shortOut, { recursive: true, force: true });
const final = await captureFrames({ inputPath: input, outputDir: outDir });

// --- Visual output -----------------------------------------------------------

// One image with every frame tiled in capture order, for a quick glance.
const cols = Math.ceil(Math.sqrt(final.frames.length));
const rows = Math.ceil(final.frames.length / cols);
const sheet = path.join(outDir, "contact-sheet.jpg");
await run([
  "-nostdin", "-y",
  "-framerate", "1",
  "-i", path.join(outDir, `frame-%0${String(final.frames.length).length}d.jpg`),
  "-vf", `scale=240:-1,tile=${cols}x${rows}:padding=4:margin=4:color=0x1a1a1a`,
  "-frames:v", "1",
  sheet,
]);

// A browser page: check results up top, then every frame with its timestamp.
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const html = `<!doctype html>
<meta charset="utf-8">
<title>captureFrames check</title>
<style>
  body { font: 14px/1.5 system-ui, sans-serif; margin: 2rem; background: #111; color: #eee; }
  h1, h2 { font-weight: 600; }
  .r { padding: .3rem 0; border-bottom: 1px solid #333; }
  .ok { color: #4ade80; } .bad { color: #f87171; }
  .detail { color: #888; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 1rem; }
  figure { margin: 0; }
  img { width: 100%; border-radius: 4px; display: block; }
  figcaption { font-size: 12px; color: #aaa; padding-top: .3rem; }
</style>
<h1>captureFrames — ${failures === 0 ? "all checks passed" : `${failures} failed`}</h1>
<p class="detail">Input: ${esc(input)}<br>
${final.frames.length} frames · ${final.durationSeconds}s window from ${final.startSeconds}s · every ${final.intervalSeconds}s</p>
<h2>Checks</h2>
${results
  .map(
    (r) =>
      `<div class="r"><span class="${r.ok ? "ok" : "bad"}">${r.ok ? "PASS" : "FAIL"}</span> ${esc(r.label)}${
        r.detail ? ` <span class="detail">— ${esc(r.detail)}</span>` : ""
      }</div>`,
  )
  .join("\n")}
<h2>Frames</h2>
<div class="grid">
${final.frames
  .map(
    (f) =>
      `<figure><img src="${path.basename(f.path)}" alt="frame at ${f.timestamp}s"><figcaption>#${f.index} · ${f.timestamp}s</figcaption></figure>`,
  )
  .join("\n")}
</div>
<h2>Contact sheet</h2>
<img src="contact-sheet.jpg" alt="all frames tiled">
`;
await writeFile(path.join(outDir, "index.html"), html);

console.log(
  failures === 0
    ? `\nAll checks passed.`
    : `\n${failures} check(s) failed.`,
);
console.log(`\nView it:\n  open ${path.join(outDir, "index.html")}`);
console.log(`  open ${sheet}`);
process.exit(failures === 0 ? 0 : 1);
