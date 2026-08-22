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
