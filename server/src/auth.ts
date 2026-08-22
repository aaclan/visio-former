import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "./config.js";

declare module "fastify" {
  interface FastifyRequest {
    username?: string;
  }
}

const JWT_SECRET = config.jwtSecret;

// Demo user for local development, sourced from secrets.yaml. Replace with a real user store before production use.
const DEMO_PASSWORD_HASH = bcrypt.hashSync(config.demoPassword, 10);

export function verifyCredentials(username: string, password: string): boolean {
  if (username !== config.demoUsername) return false;
  return bcrypt.compareSync(password, DEMO_PASSWORD_HASH);
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;

  if (!token) {
    return reply.code(401).send({ error: "missing or invalid Authorization header" });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    request.username = typeof payload === "object" ? (payload.sub as string) : undefined;
  } catch {
    return reply.code(401).send({ error: "invalid or expired token" });
  }
}

export { JWT_SECRET };
