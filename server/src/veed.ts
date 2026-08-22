import { fal } from "@fal-ai/client";
import { config } from "./config.js";
import { getBucket, getLatestFileUrl } from "./storage.js";

const REFERENCE_IMAGE_PREFIX = "reference-frames/";

/**
 * Generates a physiotherapist-style advice video via fal's veed/fabric-1.0/text model: an
 * image narrating the given script text. If `imageUrl` isn't given, falls back to the most
 * recently stored reference frame. If `filename` isn't given, defaults to a fixed name.
 */
export async function generateVeedVideo(
  text: string,
  opts: { imageUrl?: string; filename?: string; resolution?: "480p" | "720p" } = {},
): Promise<{ url: string; filename: string }> {
  if (!config.falKey) throw new Error("falKey is not configured in secrets.yaml");

  const imageUrl = opts.imageUrl ?? (await getLatestFileUrl(REFERENCE_IMAGE_PREFIX));
  if (!imageUrl) {
    throw new Error(`no reference image found under ${REFERENCE_IMAGE_PREFIX}`);
  }

  fal.config({ credentials: config.falKey });
  const result = await fal.subscribe("veed/fabric-1.0/text", {
    input: { image_url: imageUrl, text, resolution: opts.resolution ?? "720p" },
  });

  const videoUrl = result.data.video?.url;
  if (!videoUrl) throw new Error("VEED did not return a video URL");

  const videoResponse = await fetch(videoUrl);
  if (!videoResponse.ok) {
    throw new Error(`Could not download VEED video (${videoResponse.status})`);
  }

  const filename = opts.filename ?? "demo-user-veel.mp4";
  const file = getBucket().file(`videos/${filename}`);
  await file.save(Buffer.from(await videoResponse.arrayBuffer()), {
    resumable: false,
    metadata: { contentType: result.data.video.content_type ?? "video/mp4" },
  });

  const [url] = await file.getSignedUrl({
    action: "read",
    expires: Date.now() + 15 * 60 * 1000,
  });
  return { url, filename };
}
