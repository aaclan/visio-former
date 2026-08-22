import OpenAI from "openai";
import { config } from "./config.js";

let openai: OpenAI | null = null;

const DESCRIBE_SYSTEM_PROMPT = `You are a movement analyst describing still frames from an exercise video.
For each frame, write a precise, quantified description of the person's body position — specific enough that
someone could reconstruct the pose without seeing the image. Include, wherever visible:
- Estimated joint angles in degrees for each major joint in frame (ankle, knee, hip, spine/torso lean from
  vertical, shoulder, elbow) — give a number or narrow range (e.g. "knee flexion ~110°"), not just "bent".
- Weight distribution: which foot/feet bear weight, and whether it's shifted toward heels, toes, or centered.
- Alignment cues: whether knees track over toes or cave inward, whether shoulders/hips/ankles form a straight
  line, whether the spine is neutral or rounded/hyperextended.
- Any visible left/right asymmetry between limbs.
Do not compare frames to each other and do not judge whether the form is good or bad — just describe what is
visible, precisely and factually, as if writing biomechanics notes for later analysis. If a detail isn't
visible or estimable from the frame, omit it rather than guessing.`;

const DESCRIBE_SCHEMA = {
  type: "object",
  properties: {
    descriptions: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["descriptions"],
  additionalProperties: false,
} as const;

/** Captions a sequence of frames, one text description per frame, in order. */
export async function describeFrames(frames: string[], label: string): Promise<string[]> {
  if (!config.openaiApiKey) {
    throw new Error("openaiApiKey is not configured in secrets.yaml");
  }
  openai ??= new OpenAI({ apiKey: config.openaiApiKey });

  const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    {
      type: "text",
      text: `Describe each of these ${frames.length} frames (${label}), in chronological order. Return exactly ${frames.length} descriptions.`,
    },
    ...frames.map((frame) => ({
      type: "image_url" as const,
      image_url: { url: frame },
    })),
  ];

  const completion = await openai.chat.completions.create({
    model: config.openaiVisionModel,
    messages: [
      { role: "system", content: DESCRIBE_SYSTEM_PROMPT },
      { role: "user", content },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "frame_descriptions", schema: DESCRIBE_SCHEMA, strict: true },
    },
    max_tokens: 2000,
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw) as { descriptions?: unknown };

  if (!Array.isArray(parsed.descriptions)) {
    throw new Error("OpenAI Vision did not return frame descriptions");
  }

  return parsed.descriptions as string[];
}

const CATEGORIES_SYSTEM_PROMPT = `You are a physiotherapist designing a classification schema for evaluating
a specific exercise's form. Given an exercise name, output 6-8 short snake_case labels that a movement analyst
could assign to a text description of a single frame from that exercise. Include exactly one positive label
indicating correct form (e.g. "good_form"), and the rest should be specific, common form mistakes for that
particular exercise's biomechanics — not generic labels borrowed from an unrelated exercise. For example, a
bicep curl's mistakes involve the elbows/wrists/shoulders and momentum, not knees or hips; a squat's involve
knees/hips/spine, not elbows. Labels must be short, snake_case, and specific enough to be distinguishable from
each other by a zero-shot text classifier.`;

const CATEGORIES_SCHEMA = {
  type: "object",
  properties: {
    categories: { type: "array", items: { type: "string" } },
  },
  required: ["categories"],
  additionalProperties: false,
} as const;

/** Generates exercise-specific form classification labels (one positive, several common-mistake labels). */
export async function generateFormCategories(exercise: string): Promise<string[]> {
  if (!config.openaiApiKey) {
    throw new Error("openaiApiKey is not configured in secrets.yaml");
  }
  openai ??= new OpenAI({ apiKey: config.openaiApiKey });

  const completion = await openai.chat.completions.create({
    model: config.openaiVisionModel,
    messages: [
      { role: "system", content: CATEGORIES_SYSTEM_PROMPT },
      { role: "user", content: `Exercise: ${exercise}` },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "form_categories", schema: CATEGORIES_SCHEMA, strict: true },
    },
    max_tokens: 300,
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw) as { categories?: unknown };

  if (!Array.isArray(parsed.categories) || parsed.categories.length === 0) {
    throw new Error("OpenAI did not return form categories");
  }

  return parsed.categories as string[];
}

const SPOKEN_FEEDBACK_SYSTEM_PROMPT = `You are a warm, encouraging physiotherapist speaking directly to a
client right after watching them attempt an exercise. You'll be given data-driven notes (joint angle deltas,
percentages, category labels). Rewrite them as a short spoken script you'd actually say out loud to the
client's face — natural, conversational, human. Keep the substance (what was good, what to fix), but drop
robotic phrasing like "on average", "% of frames", or long lists of raw numbers. Where a specific correction
matters, describe it the way a coach would cue a movement (e.g. "straighten your arm a bit more at the top"
instead of "elbow off by 22 degrees"), not the way a sensor would report it. Prioritize the single most
important correction if there are several — don't try to cover everything.

Hard constraint: at most 55 words total, no exceptions — this becomes a short spoken video, not an essay.
End on a brief encouraging note. Output only the spoken script, nothing else.`;

/** Rewrites data-driven comparison feedback into a short natural-sounding spoken script for VEED. */
export async function generateSpokenFeedback(feedback: string): Promise<string> {
  if (!config.openaiApiKey) {
    throw new Error("openaiApiKey is not configured in secrets.yaml");
  }
  openai ??= new OpenAI({ apiKey: config.openaiApiKey });

  const completion = await openai.chat.completions.create({
    model: config.openaiVisionModel,
    messages: [
      { role: "system", content: SPOKEN_FEEDBACK_SYSTEM_PROMPT },
      { role: "user", content: feedback },
    ],
    max_tokens: 120,
  });

  const spoken = completion.choices[0]?.message?.content?.trim();
  if (!spoken) {
    throw new Error("OpenAI did not return spoken feedback");
  }
  return spoken;
}
