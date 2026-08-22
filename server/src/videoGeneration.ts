import { fal } from "@fal-ai/client";
import { config } from "./config.js";
import { buildReferencePrompt, normaliseExerciseName } from "./prompt.js";
import type { CameraView } from "./prompt.js";

const MODEL_ID = "blackforestlabs/flux-3/text-to-video/draft";

export interface ReferencePromptRequest {
  exercise: string;
  view?: CameraView;
  reps?: number;
}

export interface ComposedPrompt {
  exercise: string;
  prompt: string;
  view: CameraView;
}

export interface GenerateReferenceVideoInput extends ReferencePromptRequest {
  durationSeconds?: number;
  onProgress?: (message: string) => void;
}

export interface ReferenceVideo extends ComposedPrompt {
  videoUrl: string;
  // Re-renders this exact motion at full quality via flux-3/draft-enhance.
  draftCacheUrl: string;
  durationSeconds: number;
}

// The draft endpoint returns no seed; only the full-quality endpoints do.
interface FluxDraftOutput {
  video: { url: string };
  draft_cache: { url: string };
}

export function composeReferencePrompt({
  exercise,
  view = "side",
  reps = 3,
}: ReferencePromptRequest): ComposedPrompt {
  const name = normaliseExerciseName(exercise);

  return {
    exercise: name,
    prompt: buildReferencePrompt({ exercise: name, view, reps }),
    view,
  };
}

export async function generateReferenceVideo({
  exercise,
  view = "side",
  reps = 3,
  durationSeconds = 10,
  onProgress,
}: GenerateReferenceVideoInput): Promise<ReferenceVideo> {
  if (!config.falKey) {
    throw new Error("falKey is not configured in secrets.yaml");
  }
  fal.config({ credentials: config.falKey });

  const composed = composeReferencePrompt({ exercise, view, reps });

  const result = await fal.subscribe(MODEL_ID, {
    input: {
      prompt: composed.prompt,
      aspect_ratio: "16:9",
      duration: durationSeconds,
      generate_audio: false,
    },
    logs: true,
    onQueueUpdate: (update) => {
      if (update.status === "IN_PROGRESS" && onProgress) {
        for (const entry of update.logs ?? []) {
          onProgress(entry.message);
        }
      }
    },
  });

  const data = result.data as FluxDraftOutput;

  return {
    ...composed,
    videoUrl: data.video.url,
    draftCacheUrl: data.draft_cache.url,
    durationSeconds,
  };
}
