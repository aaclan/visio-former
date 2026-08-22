import type { FastifyInstance } from "fastify";
import { requireAuth } from "./auth.js";
import { getBucket } from "./storage.js";
import { generateReferenceVideo } from "./videoGeneration.js";

const OBJECT_PREFIX = "references/";
const SIGNED_URL_TTL_MS = 15 * 60 * 1000;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function registerExerciseRoutes(app: FastifyInstance) {
  app.post(
    "/api/exercises/generate",
    { preHandler: requireAuth },
    async (request, reply) => {
      const { exercise } = (request.body ?? {}) as { exercise?: string };

      if (!exercise?.trim()) {
        return reply.code(400).send({ error: "exercise is required" });
      }

      const exerciseSlug = slugify(exercise);
      if (!exerciseSlug) {
        return reply
          .code(400)
          .send({ error: "exercise must contain letters or numbers" });
      }

      const username = slugify(request.username ?? "user") || "user";
      const id = `${username}-${exerciseSlug}`;
      const objectName = `${OBJECT_PREFIX}${id}.mp4`;

      let gcsFile;
      let alreadyStored: boolean;
      try {
        gcsFile = getBucket().file(objectName);
        [alreadyStored] = await gcsFile.exists();
      } catch (err) {
        request.log.error(err);
        return reply
          .code(502)
          .send({ error: "could not reach cloud storage — check the credentials in secrets.yaml" });
      }

      // Generation costs real money per call, so an existing reference is reused.
      // Delete the object in the bucket to force a regeneration.
      if (!alreadyStored) {
        let videoUrl: string;
        try {
          ({ videoUrl } = await generateReferenceVideo({ exercise }));
        } catch (err) {
          request.log.error(err);
          return reply
            .code(502)
            .send({ error: "failed to generate the reference video" });
        }

        try {
          // fal-hosted URLs are not permanent, so the bytes are copied into our bucket.
          const download = await fetch(videoUrl);
          if (!download.ok) {
            throw new Error(`fal returned ${download.status} for the video`);
          }
          await gcsFile.save(Buffer.from(await download.arrayBuffer()), {
            contentType: "video/mp4",
            resumable: false,
          });
        } catch (err) {
          request.log.error(err);
          return reply
            .code(502)
            .send({ error: "failed to store the reference video" });
        }
      }

      let url: string;
      try {
        [url] = await gcsFile.getSignedUrl({
          action: "read",
          expires: Date.now() + SIGNED_URL_TTL_MS,
        });
      } catch (err) {
        request.log.error(err);
        return reply
          .code(502)
          .send({ error: "could not sign the reference video URL" });
      }

      return reply.code(alreadyStored ? 200 : 201).send({
        id,
        filename: objectName,
        url,
        cached: alreadyStored,
      });
    },
  );

  // Streams the video through our own origin (which already has CORS enabled for the
  // client) instead of a GCS signed URL, so client-side code (e.g. MediaPipe reading pixel
  // data from a <video> element) doesn't hit GCS's own CORS policy, which isn't configured.
  app.get<{ Params: { exercise: string } }>(
    "/api/exercises/:exercise/video",
    { preHandler: requireAuth },
    async (request, reply) => {
      const exerciseSlug = slugify(request.params.exercise);
      if (!exerciseSlug) {
        return reply.code(400).send({ error: "exercise must contain letters or numbers" });
      }
      const username = slugify(request.username ?? "user") || "user";
      const objectName = `${OBJECT_PREFIX}${username}-${exerciseSlug}.mp4`;

      const gcsFile = getBucket().file(objectName);
      const [exists] = await gcsFile.exists();
      if (!exists) {
        return reply.code(404).send({ error: "reference video not found" });
      }

      reply.type("video/mp4");
      return gcsFile.createReadStream();
    },
  );
}
