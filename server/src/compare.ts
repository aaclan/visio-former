import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { requireAuth } from "./auth.js";
import { getBucket } from "./storage.js";
import { captureFrames } from "./video.js";
import { describeFrames } from "./vision.js";
import { FORM_CLASSIFICATIONS, classifyDescriptions, compareClassifications } from "./pioneer.js";

const REFERENCE_PREFIX = "references/";
const USER_VIDEO_PREFIX = "videos/";
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

        const combinedResults = await classifyDescriptions(
          [...referenceDescriptions, ...userDescriptions],
          FORM_CLASSIFICATIONS,
        );
        const referenceResults = combinedResults.slice(0, referenceDescriptions.length);
        const userResults = combinedResults.slice(referenceDescriptions.length);

        const { feedback, referenceScores, userScores } = compareClassifications(
          referenceResults,
          userResults,
          FORM_CLASSIFICATIONS,
        );

        return { feedback, referenceScores, userScores };
      } catch (err) {
        request.log.error(err);
        const message = err instanceof Error ? err.message : "comparison failed";
        return reply.code(502).send({ error: message });
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }
    },
  );
}
