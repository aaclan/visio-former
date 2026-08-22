import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";
import { config } from "./config.js";
import { JWT_SECRET, verifyCredentials } from "./auth.js";
import { registerVideoRoutes } from "./videos.js";
import { getBucket } from "./storage.js";
import { describeFrames } from "./vision.js";
import { FORM_CLASSIFICATIONS, classifyDescriptions, compareClassifications } from "./pioneer.js";
import { captureFrames } from "./video.js";

const GOOGLE_CLIENT_ID = config.googleClientId;
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const REFERENCE_VIDEO_PATH = path.join(serverDir, "..", "assets", "reference-video.mp4");
const COMPARE_WINDOW_SECONDS = 4;
const COMPARE_FRAME_INTERVAL_SECONDS = 0.4;
const COMPARE_FRAME_COUNT = Math.round(COMPARE_WINDOW_SECONDS / COMPARE_FRAME_INTERVAL_SECONDS);
const REFERENCE_IMAGE_OBJECT = "reference-frames/reference.jpg";
const UPLOAD_LIMIT_BYTES = 500 * 1024 * 1024;

const app = Fastify({ logger: true, bodyLimit: UPLOAD_LIMIT_BYTES });

await app.register(cors, { origin: "http://localhost:5173" });
await app.register(multipart, { limits: { fileSize: UPLOAD_LIMIT_BYTES } });
await registerVideoRoutes(app);

app.get("/api/health", async () => {
  return { status: "ok" };
});

app.get("/reference-video.mp4", async (request, reply) => {
  reply.type("video/mp4");
  return createReadStream(REFERENCE_VIDEO_PATH);
});

app.post("/api/login", async (request, reply) => {
  const { username, password } = request.body as {
    username?: string;
    password?: string;
  };

  if (!username || !password) {
    return reply.code(400).send({ error: "username and password are required" });
  }

  if (!verifyCredentials(username, password)) {
    return reply.code(401).send({ error: "invalid credentials" });
  }

  const token = jwt.sign({ sub: username }, JWT_SECRET, { expiresIn: "1h" });
  return { token };
});

app.post("/api/login/google", async (request, reply) => {
  const { credential } = request.body as { credential?: string };

  if (!credential) {
    return reply.code(400).send({ error: "credential is required" });
  }

  if (!GOOGLE_CLIENT_ID) {
    app.log.error("GOOGLE_CLIENT_ID is not configured");
    return reply.code(500).send({ error: "Google login is not configured" });
  }

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch {
    return reply.code(401).send({ error: "invalid Google credential" });
  }

  if (!payload?.email) {
    return reply.code(401).send({ error: "invalid Google credential" });
  }

  const token = jwt.sign({ sub: payload.email }, JWT_SECRET, { expiresIn: "1h" });
  return { token };
});

app.post("/api/compare", async (request, reply) => {
  const upload = await request.file();
  if (!upload) {
    return reply.code(400).send({ error: "a video file is required" });
  }

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "visio-compare-"));

  try {
    const userVideoPath = path.join(tmpDir, "user-video.mp4");
    await pipeline(upload.file, createWriteStream(userVideoPath));

    const extractOptions = {
      startSeconds: 0,
      durationSeconds: COMPARE_WINDOW_SECONDS,
      frameCount: COMPARE_FRAME_COUNT,
    };

    const [referenceResult, userResult] = await Promise.all([
      captureFrames({
        inputPath: REFERENCE_VIDEO_PATH,
        outputDir: path.join(tmpDir, "reference-frames"),
        ...extractOptions,
      }),
      captureFrames({
        inputPath: userVideoPath,
        outputDir: path.join(tmpDir, "user-frames"),
        ...extractOptions,
      }),
    ]);

    const storeReferenceImage = storeReferenceFrame(referenceResult.frames[0].path).catch((err) => {
      app.log.warn(err, "failed to store reference frame in GCS");
    });

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

    await storeReferenceImage;
    return { feedback, referenceScores, userScores };
  } catch (err) {
    app.log.error(err);
    const message = err instanceof Error ? err.message : "comparison failed";
    return reply.code(502).send({ error: message });
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

async function frameToDataUri(filePath: string): Promise<string> {
  const buffer = await readFile(filePath);
  return `data:image/jpeg;base64,${buffer.toString("base64")}`;
}

/** Uploads the reference video's first frame to GCS, overwriting the previous one. */
async function storeReferenceFrame(framePath: string): Promise<void> {
  const bucket = getBucket();
  const gcsFile = bucket.file(REFERENCE_IMAGE_OBJECT);
  await pipeline(
    createReadStream(framePath),
    gcsFile.createWriteStream({ contentType: "image/jpeg", resumable: false }),
  );
}

app.listen({ port: config.port }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
});
