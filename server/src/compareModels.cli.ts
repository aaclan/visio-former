import { fal } from "@fal-ai/client";
import { config } from "./config.js";
import { composeReferencePrompt } from "./videoGeneration.js";
import type { CameraView } from "./prompt.js";

interface Candidate {
  label: string;
  modelId: string;
  input: (prompt: string) => Record<string, unknown>;
  estimatedCost: string;
}

const CANDIDATES: Candidate[] = [
  {
    label: "Veo 3.1",
    modelId: "fal-ai/veo3.1",
    // Veo caps at 8s and takes duration as an enum string, unlike the others.
    input: (prompt) => ({
      prompt,
      aspect_ratio: "16:9",
      duration: "8s",
      resolution: "720p",
      generate_audio: false,
    }),
    estimatedCost: "$1.60 (8s @ $0.20/s)",
  },
  {
    label: "Seedance 2.0",
    modelId: "bytedance/seedance-2.0/text-to-video",
    input: (prompt) => ({
      prompt,
      aspect_ratio: "16:9",
      duration: 10,
      resolution: "720p",
      generate_audio: false,
    }),
    estimatedCost: "$3.03 (10s @ $0.3034/s)",
  },
];

const args = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const exercise = args[0] ?? "squat";
const view = (args[1] as CameraView | undefined) ?? "side";

if (!config.falKey) {
  throw new Error("falKey is not configured in secrets.yaml");
}
fal.config({ credentials: config.falKey });

const composed = composeReferencePrompt({ exercise, view });

console.log("\n--- prompt, shared by every model ---");
console.log(composed.prompt);

for (const candidate of CANDIDATES) {
  console.log(`\n=== ${candidate.label} — ${candidate.estimatedCost} ===`);
  try {
    const result = await fal.subscribe(candidate.modelId, {
      input: candidate.input(composed.prompt),
    });
    const data = result.data as { video?: { url?: string } };
    console.log(`video: ${data.video?.url ?? "(no url in response)"}`);
  } catch (error) {
    console.log(`FAILED: ${error instanceof Error ? error.message : error}`);
  }
}
