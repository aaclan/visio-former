import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { requireAuth } from "./auth.js";
import { getBucket } from "./storage.js";
import { captureFrames } from "./video.js";
import { describeFrames, generateFormCategories, generateSpokenFeedback } from "./vision.js";
import { DEFAULT_FORM_CLASSIFICATIONS, classifyDescriptions, compareClassifications } from "./pioneer.js";
import { generateVeedVideo } from "./veed.js";

const REFERENCE_PREFIX = "references/";
const USER_VIDEO_PREFIX = "videos/";
const REFERENCE_FRAME_PREFIX = "reference-frames/";
const COMPARE_WINDOW_SECONDS = 4;
const COMPARE_FRAME_INTERVAL_SECONDS = 0.4;
const COMPARE_FRAME_COUNT = Math.round(COMPARE_WINDOW_SECONDS / COMPARE_FRAME_INTERVAL_SECONDS);

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

async function downloadFirstMatch(prefix: string, destination: string): Promise<boolean> {
  const bucket = getBucket();
  const [matches] = await bucket.getFiles({ prefix });
  const gcsFile = matches[0];
  if (!gcsFile) return false;

  await gcsFile.download({ destination });
  return true;
}

async function frameToDataUri(filePath: string): Promise<string> {
  const buffer = await readFile(filePath);
  return `data:image/jpeg;base64,${buffer.toString("base64")}`;
}

/** Uploads the reference video's first frame to GCS and returns a short-lived signed URL to it. */
async function storeReferenceFrame(framePath: string, objectId: string): Promise<string> {
  const buffer = await readFile(framePath);
  const gcsFile = getBucket().file(`${REFERENCE_FRAME_PREFIX}${objectId}.jpg`);
  await gcsFile.save(buffer, { contentType: "image/jpeg", resumable: false });

  const [url] = await gcsFile.getSignedUrl({
    action: "read",
    expires: Date.now() + 15 * 60 * 1000,
  });
  return url;
}

/** Uploads a `data:image/...;base64,...` string (e.g. a client-side canvas snapshot) to GCS. */
async function storeImageDataUrl(dataUrl: string, objectId: string): Promise<string> {
  const match = /^data:(image\/\w+);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    throw new Error("imageDataUrl must be a base64 image data URL");
  }
  const [, contentType, base64] = match;

  const gcsFile = getBucket().file(`${REFERENCE_FRAME_PREFIX}${objectId}.jpg`);
  await gcsFile.save(Buffer.from(base64, "base64"), { contentType, resumable: false });

  const [url] = await gcsFile.getSignedUrl({
    action: "read",
    expires: Date.now() + 15 * 60 * 1000,
  });
  return url;
}

/** Rewrites data-driven feedback into a natural spoken script; falls back to the raw text if that fails. */
async function toSpokenFeedback(feedback: string, log: FastifyInstance["log"]): Promise<string> {
  try {
    return await generateSpokenFeedback(feedback);
  } catch (err) {
    log.warn(err, "failed to generate spoken feedback, sending raw feedback to VEED instead");
    return feedback;
  }
}

export async function registerCompareRoutes(app: FastifyInstance) {
  app.post<{ Params: { exercise: string } }>(
    "/api/compare/:exercise",
    { preHandler: requireAuth },
    async (request, reply) => {
      const exerciseSlug = slugify(request.params.exercise);
      if (!exerciseSlug) {
        return reply.code(400).send({ error: "exercise must contain letters or numbers" });
      }
      const username = slugify(request.username ?? "user") || "user";

      const tmpDir = await mkdtemp(path.join(os.tmpdir(), "visio-compare-"));

      try {
        const referenceVideoPath = path.join(tmpDir, "reference.mp4");
        const userVideoPath = path.join(tmpDir, "user-video");

        const [hasReference, hasUserVideo] = await Promise.all([
          downloadFirstMatch(`${REFERENCE_PREFIX}${username}-${exerciseSlug}.`, referenceVideoPath),
          downloadFirstMatch(`${USER_VIDEO_PREFIX}${username}-user-recording.`, userVideoPath),
        ]);

        if (!hasReference) {
          return reply.code(404).send({
            error: `no reference video found for "${exerciseSlug}" — call POST /api/exercises/generate first`,
          });
        }
        if (!hasUserVideo) {
          return reply.code(404).send({
            error: "no recorded video found — record and save one via POST /api/videos first",
          });
        }

        const categoriesPromise = generateFormCategories(request.params.exercise).catch((err) => {
          request.log.warn(err, "failed to generate exercise-specific form categories, using defaults");
          return DEFAULT_FORM_CLASSIFICATIONS;
        });

        const extractOptions = {
          startSeconds: 0,
          durationSeconds: COMPARE_WINDOW_SECONDS,
          frameCount: COMPARE_FRAME_COUNT,
        };

        const [referenceResult, userResult] = await Promise.all([
          captureFrames({
            inputPath: referenceVideoPath,
            outputDir: path.join(tmpDir, "reference-frames"),
            ...extractOptions,
          }),
          captureFrames({
            inputPath: userVideoPath,
            outputDir: path.join(tmpDir, "user-frames"),
            ...extractOptions,
          }),
        ]);

        const [referenceFrames, userFrames] = await Promise.all([
          Promise.all(referenceResult.frames.map((frame) => frameToDataUri(frame.path))),
          Promise.all(userResult.frames.map((frame) => frameToDataUri(frame.path))),
        ]);

        const [referenceDescriptions, userDescriptions] = await Promise.all([
          describeFrames(referenceFrames, "reference"),
          describeFrames(userFrames, "user attempt"),
        ]);

        console.log(`\n=== OpenAI Vision descriptions: ${username}/${exerciseSlug} ===`);
        console.log("--- reference ---");
        referenceDescriptions.forEach((d, i) => console.log(`  [${i}] ${d}`));
        console.log("--- user attempt ---");
        userDescriptions.forEach((d, i) => console.log(`  [${i}] ${d}`));

        // Appended unconditionally (not left to the LLM) so a video that doesn't actually show the
        // exercise — person not visible, sitting still, wrong movement — has somewhere to land instead
        // of defaulting to the closest "good form" label by omission.
        const classifications = [...(await categoriesPromise), "not_performing_exercise"];
        console.log(`\n=== Form categories for "${request.params.exercise}" ===`, classifications);

        const combinedResults = await classifyDescriptions(
          [...referenceDescriptions, ...userDescriptions],
          classifications,
        );
        const referenceResults = combinedResults.slice(0, referenceDescriptions.length);
        const userResults = combinedResults.slice(referenceDescriptions.length);

        console.log(`\n=== Pioneer classifications: ${username}/${exerciseSlug} ===`);
        console.log("--- reference (per frame) ---");
        referenceResults.forEach((r, i) => console.log(`  [${i}] ${r.label} (${(r.confidence * 100).toFixed(1)}%)`));
        console.log("--- user attempt (per frame) ---");
        userResults.forEach((r, i) => console.log(`  [${i}] ${r.label} (${(r.confidence * 100).toFixed(1)}%)`));

        const { feedback, referenceScores, userScores } = compareClassifications(
          referenceResults,
          userResults,
          classifications,
        );

        console.log("--- distribution (fraction of frames per label) ---");
        console.log("  reference:", referenceScores);
        console.log("  user:     ", userScores);
        console.log("  feedback:", feedback, "\n");

        let referenceImageUrl: string | null = null;
        let veedVideoUrl: string | null = null;
        let veedError: string | undefined;

        try {
          const objectId = `${username}-${exerciseSlug}`;
          referenceImageUrl = await storeReferenceFrame(referenceResult.frames[0].path, objectId);
          const spokenFeedback = await toSpokenFeedback(feedback, request.log);
          const veed = await generateVeedVideo(spokenFeedback, {
            imageUrl: referenceImageUrl,
            filename: `${objectId}-advice.mp4`,
          });
          veedVideoUrl = veed.url;
        } catch (err) {
          request.log.warn(err, "failed to generate VEED advice video");
          veedError = err instanceof Error ? err.message : "failed to generate advice video";
        }

        return {
          feedback,
          classifications,
          referenceScores,
          userScores,
          referenceDescriptions,
          userDescriptions,
          referenceImageUrl,
          veedVideoUrl,
          ...(veedError ? { veedError } : {}),
        };
      } catch (err) {
        request.log.error(err);
        const message = err instanceof Error ? err.message : "comparison failed";
        return reply.code(502).send({ error: message });
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }
    },
  );

  // Feeds a client-computed (MediaPipe) feedback string + a canvas-snapshot reference image
  // into VEED, for when the comparison itself already happened live in the browser and the
  // server's only job is generating the advice video from that result.
  app.post<{ Params: { exercise: string }; Body: { feedback?: string; imageDataUrl?: string } }>(
    "/api/mediapipe-veed/:exercise",
    { preHandler: requireAuth },
    async (request, reply) => {
      const exerciseSlug = slugify(request.params.exercise);
      if (!exerciseSlug) {
        return reply.code(400).send({ error: "exercise must contain letters or numbers" });
      }
      const { feedback, imageDataUrl } = request.body ?? {};
      if (!feedback?.trim() || !imageDataUrl?.trim()) {
        return reply.code(400).send({ error: "feedback and imageDataUrl are required" });
      }

      const username = slugify(request.username ?? "user") || "user";
      const objectId = `${username}-${exerciseSlug}-mediapipe`;

      try {
        const imageUrl = await storeImageDataUrl(imageDataUrl, objectId);
        const spokenFeedback = await toSpokenFeedback(feedback, request.log);
        const veed = await generateVeedVideo(spokenFeedback, {
          imageUrl,
          filename: `${objectId}-advice.mp4`,
        });
        return { veedVideoUrl: veed.url };
      } catch (err) {
        request.log.error(err, "failed to generate VEED advice video from MediaPipe feedback");
        const message = err instanceof Error ? err.message : "failed to generate advice video";
        return reply.code(502).send({ error: message });
      }
    },
  );
}
