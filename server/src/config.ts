import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { load } from "js-yaml";

interface Secrets {
  port: number;
  jwtSecret: string;
  googleClientId: string;
  gcsBucketName: string;
  googleApplicationCredentials: string;
  demoUsername: string;
  demoPassword: string;
  falKey: string;
  openaiApiKey: string;
}

// fileURLToPath, not URL.pathname: on Windows the latter yields "/C:/..." and
// percent-encodes non-ASCII path segments, so the file is never found.
const SECRETS_FILE =
  process.env.SECRETS_FILE ??
  fileURLToPath(new URL("../secrets.yaml", import.meta.url));

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
  jwtSecret: loaded.jwtSecret || "dev-secret-change-me",
  googleClientId: loaded.googleClientId ?? "",
  gcsBucketName: loaded.gcsBucketName ?? "",
  googleApplicationCredentials: loaded.googleApplicationCredentials ?? "",
  demoUsername: loaded.demoUsername ?? "demo",
  demoPassword: loaded.demoPassword ?? "password123",
  falKey: loaded.falKey ?? "",
  openaiApiKey: loaded.openaiApiKey ?? "",
};
