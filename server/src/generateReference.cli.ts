import {
  composeReferencePrompt,
  generateReferenceVideo,
} from "./videoGeneration.js";
import type { CameraView } from "./prompt.js";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry");
const positional = args.filter((arg) => !arg.startsWith("--"));

const exercise = positional[0] ?? "squat";
const view = (positional[1] as CameraView | undefined) ?? "side";

if (dryRun) {
  const composed = composeReferencePrompt({ exercise, view });
  console.log("\n--- prompt for fal ---");
  console.log(composed.prompt);
} else {
  const result = await generateReferenceVideo({
    exercise,
    view,
    onProgress: (message) => console.log(`  fal: ${message}`),
  });

  console.log("\n--- prompt for fal ---");
  console.log(result.prompt);
  console.log("\n--- result ---");
  console.log(`exercise:    ${result.exercise}`);
  console.log(`view:        ${result.view}`);
  console.log(`duration:    ${result.durationSeconds}s`);
  console.log(`video:       ${result.videoUrl}`);
  console.log(`draft cache: ${result.draftCacheUrl}`);
}
