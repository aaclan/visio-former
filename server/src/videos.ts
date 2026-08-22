import { pipeline } from "node:stream/promises";
import type { FastifyInstance } from "fastify";
import { requireAuth } from "./auth.js";
import { getBucket } from "./storage.js";
import { generateVeedVideo } from "./veed.js";

const OBJECT_PREFIX = "videos/";

// MediaRecorder in most browsers can only produce webm, not mp4, so we accept both.
const MIME_TO_EXT: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
};

function slugifyUsername(username: string): string {
  return username.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "user";
}

export async function registerVideoRoutes(app: FastifyInstance) {
  app.post("/api/videos/generate", { preHandler: requireAuth }, async (request, reply) => {
    const { imageUrl, text, resolution } = (request.body ?? {}) as {
      imageUrl?: string;
      text?: string;
      resolution?: "480p" | "720p";
    };

    if (!imageUrl?.trim() || !text?.trim()) {
      return reply.code(400).send({ error: "imageUrl and text are required" });
    }

    try {
      new URL(imageUrl);
    } catch {
      return reply.code(400).send({ error: "imageUrl must be a valid URL" });
    }

    if (resolution && !["480p", "720p"].includes(resolution)) {
      return reply.code(400).send({ error: "resolution must be 480p or 720p" });
    }

    try {
      return await generateVeedVideo(imageUrl.trim(), text.trim(), resolution);
    } catch (error) {
      request.log.error(error, "VEED video generation failed");
      const message = error instanceof Error ? error.message : "unknown error";
      const isConfigurationError = /not configured|credentials/i.test(message);
      return reply.code(isConfigurationError ? 503 : 502).send({
        error: isConfigurationError ? message : "VEED video generation failed",
      });
    }
  });

  app.post("/api/videos", { preHandler: requireAuth }, async (request, reply) => {
    const file = await request.file();

    if (!file) {
      return reply.code(400).send({ error: "no file uploaded (field name: video)" });
    }

    const ext = MIME_TO_EXT[file.mimetype];
    if (!ext) {
      return reply.code(415).send({ error: "only video/mp4 or video/webm files are accepted" });
    }

    const username = slugifyUsername(request.username ?? "user");
    const id = `${username}-user-recording`;
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

  app.get("/api/videos/reference", { preHandler: requireAuth }, async (request, reply) => {
    const username = slugifyUsername(request.username ?? "user");
    const id = `${username}-exercise`;
    const url = await getSignedUrlForId(id);

    if (!url) {
      return reply.code(404).send({ error: "reference video not found" });
    }

    return { url };
  });

  app.get<{ Params: { id: string } }>(
    "/api/videos/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const url = await getSignedUrlForId(request.params.id);

      if (!url) {
        return reply.code(404).send({ error: "video not found" });
      }

      return { url };
    },
  );
}

async function getSignedUrlForId(id: string): Promise<string | null> {
  const bucket = getBucket();
  const [matches] = await bucket.getFiles({ prefix: `${OBJECT_PREFIX}${id}.` });

  const gcsFile = matches[0];
  if (!gcsFile) return null;

  const [url] = await gcsFile.getSignedUrl({
    action: "read",
    expires: Date.now() + 15 * 60 * 1000,
  });

  return url;
}
