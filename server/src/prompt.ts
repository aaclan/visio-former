export type CameraView = "side" | "front";

export interface ReferencePromptInput {
  exercise: string;
  view?: CameraView;
  reps?: number;
}

const VIEW_PHRASING: Record<CameraView, string> = {
  side: "a side-on profile view, with the subject's body side-on to the camera",
  front: "a front-on view, with the subject facing the camera squarely",
};

export function normaliseExerciseName(raw: string): string {
  const cleaned = raw.trim().replace(/\s+/g, " ").toLowerCase();
  if (!cleaned) {
    throw new Error("Exercise name is empty.");
  }
  return cleaned;
}

export function buildReferencePrompt({
  exercise,
  view = "side",
  reps = 3,
}: ReferencePromptInput): string {
  const name = normaliseExerciseName(exercise);

  return [
    `A single person performing the ${name} exercise with textbook-perfect form,`,
    "filmed as one continuous unbroken take from a locked-off camera at",
    `${VIEW_PHRASING[view]}.`,
    "The full body stays in frame from head to feet for the entire clip and is never cropped.",
    "The subject wears form-fitting athletic clothing so joint positions are clearly visible.",
    "Plain uncluttered light-grey studio background, even neutral lighting, no harsh shadows.",
    "The camera never moves, pans, zooms or cuts.",
    `The subject completes ${reps} slow controlled repetitions at a steady even tempo,`,
    "with correct technique throughout.",
    "Photorealistic. No cuts, no change of angle, no on-screen text or graphic overlays.",
  ].join(" ");
}
