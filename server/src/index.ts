import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";
import { JWT_SECRET, verifyCredentials } from "./auth.js";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

const app = Fastify({ logger: true });

await app.register(cors, { origin: "http://localhost:5173" });

app.get("/api/health", async () => {
  return { status: "ok" };
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

const port = Number(process.env.PORT) || 3001;

app.listen({ port }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
});
