import { existsSync, readFileSync } from "node:fs";
import { load } from "js-yaml";

interface Secrets {
  port: number;
  jwtSecret: string;
  googleClientId: string;
  gcsBucketName: string;
  googleApplicationCredentials: string;
  demoUsername: string;
  demoPassword: string;
}

const SECRETS_FILE = process.env.SECRETS_FILE ?? new URL("../secrets.yaml", import.meta.url).pathname;

function loadSecrets(): Partial<Secrets> {
  if (!existsSync(SECRETS_FILE)) {
    return {};
  }
  const raw = readFileSync(SECRETS_FILE, "utf8");
  return (load(raw) ?? {}) as Partial<Secrets>;
}

const loaded = loadSecrets();

export const config: Secrets = {
  port: loaded.port ?? 3001,
  jwtSecret: loaded.jwtSecret ?? "dev-secret-change-me",
  googleClientId: loaded.googleClientId ?? "",
  gcsBucketName: loaded.gcsBucketName ?? "",
  googleApplicationCredentials: loaded.googleApplicationCredentials ?? "",
  demoUsername: loaded.demoUsername ?? "demo",
  demoPassword: loaded.demoPassword ?? "password123",
};
