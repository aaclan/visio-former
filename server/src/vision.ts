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
