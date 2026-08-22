import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance } from "fastify";
import { requireAuth } from "./auth.js";
import { getBucket } from "./storage.js";

const OBJECT_PREFIX = "videos/";

// MediaRecorder in most browsers can only produce webm, not mp4, so we accept both.
const MIME_TO_EXT: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
};

export async function registerVideoRoutes(app: FastifyInstance) {
  app.post("/api/videos", { preHandler: requireAuth }, async (request, reply) => {
    const file = await request.file();

    if (!file) {
      return reply.code(400).send({ error: "no file uploaded (field name: video)" });
    }

    const ext = MIME_TO_EXT[file.mimetype];
    if (!ext) {
      return reply.code(415).send({ error: "only video/mp4 or video/webm files are accepted" });
    }

    const id = randomUUID();
    const objectName = `${OBJECT_PREFIX}${id}.${ext}`;
    const bucket = getBucket();
    const gcsFile = bucket.file(objectName);

    try {
      await pipeline(
        file.file,
        gcsFile.createWriteStream({
          contentType: file.mimetype,
          resumable: false,
        }),
      );
    } catch (err) {
      request.log.error(err);
      return reply.code(502).send({ error: "failed to store video" });
    }

    if (file.file.truncated) {
      await gcsFile.delete({ ignoreNotFound: true });
      return reply.code(413).send({ error: "file exceeds the 500MB upload limit" });
    }

    return reply.code(201).send({ id, filename: objectName });
  });

  app.get("/api/videos", { preHandler: requireAuth }, async () => {
    const bucket = getBucket();
    const [files] = await bucket.getFiles({ prefix: OBJECT_PREFIX });

    return files.map((f) => ({
      id: f.name.slice(OBJECT_PREFIX.length).replace(/\.[^.]+$/, ""),
      filename: f.name,
      size: Number(f.metadata.size ?? 0),
      updated: f.metadata.updated,
    }));
  });

  app.get<{ Params: { id: string } }>(
    "/api/videos/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const bucket = getBucket();
      const [matches] = await bucket.getFiles({
        prefix: `${OBJECT_PREFIX}${request.params.id}.`,
      });

      const gcsFile = matches[0];
      if (!gcsFile) {
        return reply.code(404).send({ error: "video not found" });
      }

      const [url] = await gcsFile.getSignedUrl({
        action: "read",
        expires: Date.now() + 15 * 60 * 1000,
      });

      return { url };
    },
  );
}
