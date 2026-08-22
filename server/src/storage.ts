import { Storage } from "@google-cloud/storage";
import { config } from "./config.js";

// keyFilename falls back to Application Default Credentials when empty
// (e.g. `gcloud auth application-default login`).
const storage = new Storage(
  config.googleApplicationCredentials ? { keyFilename: config.googleApplicationCredentials } : {},
);

export function getBucket() {
  if (!config.gcsBucketName) {
    throw new Error("gcsBucketName is not configured");
  }
  return storage.bucket(config.gcsBucketName);
}

/** Returns a signed read URL for the most recently updated object under the given prefix, or null if none exist. */
export async function getLatestFileUrl(
  prefix: string,
  expiresInMs = 15 * 60 * 1000,
): Promise<string | null> {
  const bucket = getBucket();
  const [files] = await bucket.getFiles({ prefix });
  if (files.length === 0) return null;

  const latest = files.reduce((newest, file) => {
    const newestTime = new Date(newest.metadata.updated ?? 0).getTime();
    const fileTime = new Date(file.metadata.updated ?? 0).getTime();
    return fileTime > newestTime ? file : newest;
  });

  const [url] = await latest.getSignedUrl({
    action: "read",
    expires: Date.now() + expiresInMs,
  });
  return url;
}
