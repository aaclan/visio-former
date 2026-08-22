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
  openaiVisionModel: string;
  pioneerApiKey: string;
  pioneerBaseUrl: string;
  pioneerModelId: string;
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
  port: loaded.port ?? (Number(process.env.PORT) || 3001),
  jwtSecret: loaded.jwtSecret || process.env.JWT_SECRET || "dev-secret-change-me",
  googleClientId: loaded.googleClientId ?? process.env.GOOGLE_CLIENT_ID ?? "",
  gcsBucketName: loaded.gcsBucketName ?? process.env.GCP_BUCKET_NAME ?? "",
  googleApplicationCredentials:
    loaded.googleApplicationCredentials ?? process.env.GOOGLE_APPLICATION_CREDENTIALS ?? "",
  demoUsername: loaded.demoUsername ?? process.env.DEMO_USERNAME ?? "demo",
  demoPassword: loaded.demoPassword ?? process.env.DEMO_PASSWORD ?? "password123",
  falKey: loaded.falKey ?? process.env.FAL_KEY ?? "",
  openaiApiKey: loaded.openaiApiKey ?? "",
  openaiVisionModel: loaded.openaiVisionModel ?? "gpt-4o",
  pioneerApiKey: loaded.pioneerApiKey ?? "",
  pioneerBaseUrl: loaded.pioneerBaseUrl ?? "https://api.pioneer.ai",
  pioneerModelId: loaded.pioneerModelId ?? "fastino/gliner2-base-v1",
};
